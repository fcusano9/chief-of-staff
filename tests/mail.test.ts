import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DemoProvider } from '../src/main/ai/demo'
import { validateSuggestions } from '../src/main/ai/schema'
import { buildExtractionContext } from '../src/main/ai/context'
import { logged, type AiCallLog } from '../src/main/ai/provider'
import type { ExtractionContext, SourceForExtraction } from '../src/main/ai/context'
import { openDatabase } from '../src/main/db'
import type { OutlookMailbox, OutlookMessage, OutlookReader } from '../src/main/mail/outlook'
import { conversationContent, planMailbox, SKIP, skipReason, splitQuoted } from '../src/main/mail/plan'
import { BriefService, PersonService, ProjectService } from '../src/main/services/directory'
import { MailService } from '../src/main/services/mail'
import { applyMailRules, SourceService, type MailMeta } from '../src/main/services/sources'
import { SuggestionService } from '../src/main/services/suggestions'
import { TaskService } from '../src/main/services/tasks'
import { businessDaysSince, needsFollowUp, scorePriority } from '@shared/priority'
import { DEFAULT_SETTINGS, type MailJobStatus } from '@shared/types'

const ME = 'Frank Cusano'
let seq = 0
const msg = (o: Partial<OutlookMessage>): OutlookMessage => {
  seq++
  return {
    entryId: `E${seq}`, storeId: 'S1', messageId: `<m${seq}@example.com>`, conversationId: 'C1', topic: 'Q1 pricing', subject: 'Q1 pricing',
    messageClass: 'IPM.Note', isMail: true, direction: 'received', folder: 'Inbox', from: 'Dana Lee', fromEmail: 'dana@example.com',
    to: ME, cc: '', time: '2026-11-02T14:00:00.000Z', listUnsubscribe: false, listId: '', precedence: '', autoSubmitted: '', body: 'Hello', ...o,
  }
}
const box = (messages: OutlookMessage[]): OutlookMailbox => ({ me: { name: ME, addresses: ['frank@example.com'] }, messages })
const since = new Date('2026-10-27T00:00:00.000Z')
const never = () => false

describe('which mail is skipped', () => {
  it('skips invites, auto-replies, newsletters and automated senders', () => {
    expect(skipReason(msg({ messageClass: 'IPM.Schedule.Meeting.Request', isMail: false }))).toBe(SKIP.invite)
    expect(skipReason(msg({ messageClass: 'IPM.Note.Rules.OofTemplate.Microsoft' }))).toBe(SKIP.autoReply)
    expect(skipReason(msg({ subject: 'Automatic reply: Q1 pricing' }))).toBe(SKIP.autoReply)
    expect(skipReason(msg({ listUnsubscribe: true }))).toBe(SKIP.newsletter)
    expect(skipReason(msg({ precedence: 'bulk' }))).toBe(SKIP.newsletter)
    expect(skipReason(msg({ autoSubmitted: 'auto-generated' }))).toBe(SKIP.automated)
    expect(skipReason(msg({ fromEmail: 'no-reply@vendor.com' }))).toBe(SKIP.automated)
    expect(skipReason(msg({ fromEmail: 'notifications@build.example.com' }))).toBe(SKIP.automated)
  })

  it('reads ordinary mail, including mail sent to a person with "notify" elsewhere in the address', () => {
    expect(skipReason(msg({}))).toBeNull()
    expect(skipReason(msg({ fromEmail: 'alex.notifyer@example.com' }))).toBeNull()
    expect(skipReason(msg({ autoSubmitted: 'no' }))).toBeNull()
    expect(skipReason(msg({ direction: 'sent', listUnsubscribe: true }))).toBeNull()
  })
})

describe('grouping mail into conversations', () => {
  it('groups by conversation, oldest first, and knows who wrote last', () => {
    const plan = planMailbox(
      box([
        msg({ time: '2026-11-02T15:00:00.000Z', direction: 'sent', from: ME, fromEmail: 'frank@example.com', to: 'Dana Lee', body: 'Sure, by Friday.' }),
        msg({ time: '2026-11-02T14:00:00.000Z', body: 'Can you confirm the discount?' }),
        msg({ conversationId: 'C2', subject: 'Firmware', from: 'Marcus Webb', fromEmail: 'marcus@example.com', time: '2026-11-01T10:00:00.000Z' }),
      ]),
      since,
      never,
    )
    expect(plan.received).toBe(2)
    expect(plan.sent).toBe(1)
    expect(plan.conversations.map((c) => c.key)).toEqual(['C1', 'C2'])
    const c1 = plan.conversations[0]!
    expect(c1.messages.map((m) => m.body)).toEqual(['Can you confirm the discount?', 'Sure, by Friday.'])
    expect(c1.lastFromMe).toBe(true)
    expect(c1.lastSentByMeAt).toBe('2026-11-02T15:00:00.000Z')
    expect(c1.people).toBe('Dana Lee')
    expect(plan.conversations[1]!.lastFromMe).toBe(false)
  })

  it('counts mail from my own address as mine, and keeps one copy of mail sent to myself', () => {
    const both = { messageId: '<self@example.com>', from: ME, fromEmail: 'Frank@Example.com', to: ME }
    const plan = planMailbox(box([msg({ ...both, direction: 'sent' }), msg({ ...both, direction: 'received' })]), since, never)
    expect(plan.conversations[0]!.messages).toHaveLength(1)
    expect(plan.conversations[0]!.lastFromMe).toBe(true)
  })

  it('skips a conversation only when all its new messages are skipped, and leaves skipped messages out of the rest', () => {
    const plan = planMailbox(
      box([
        msg({ conversationId: 'N', subject: 'Weekly digest', listUnsubscribe: true }),
        msg({ conversationId: 'R', body: 'Real question?' }),
        msg({ conversationId: 'R', subject: 'Automatic reply: Q1 pricing', time: '2026-11-02T16:00:00.000Z' }),
      ]),
      since,
      never,
    )
    const n = plan.conversations.find((c) => c.key === 'N')!
    const r = plan.conversations.find((c) => c.key === 'R')!
    expect(n.skipReason).toBe(SKIP.newsletter)
    expect(n.messages).toHaveLength(1) // kept so "Read anyway" can read it
    expect(r.skipReason).toBeNull()
    expect(r.messages.map((m) => m.body)).toEqual(['Real question?'])
  })

  it('leaves out messages read before and mail older than the start date', () => {
    const old = msg({ time: '2026-10-01T00:00:00.000Z' })
    const read = msg({})
    const fresh = msg({ time: '2026-11-03T09:00:00.000Z' })
    const plan = planMailbox(box([old, read, fresh]), since, (key) => key === `mid:${read.messageId}`)
    expect(plan.alreadyRead).toBe(1)
    expect(plan.conversations[0]!.messages.map((m) => m.entryId)).toEqual([fresh.entryId])
  })
})

describe('the text the AI reads', () => {
  it('splits off quoted history in the usual reply formats', () => {
    expect(splitQuoted('Looks good.\r\n\r\n________________________________\r\nFrom: Dana Lee\r\nSent: Monday\r\nOld text').text).toBe('Looks good.')
    expect(splitQuoted('Yes.\n-----Original Message-----\nFrom: x').quoted).toMatch(/^-----Original Message/)
    expect(splitQuoted('Thanks!\n\nOn Mon, Nov 2, 2026 at 9:14 AM Dana Lee wrote:\n> hi').text).toBe('Thanks!')
    expect(splitQuoted('No quotes here.\n[cid:image001.png@01DB]\n\n\n\nBye').text).toBe('No quotes here.\n\nBye')
  })

  it('says who wrote last and marks the user’s own messages', () => {
    const plan = planMailbox(
      box([msg({ body: 'Can you confirm?\nFrom: Old\nSent: Friday\nEarlier ask' }), msg({ direction: 'sent', from: ME, time: '2026-11-02T15:00:00.000Z', body: 'Will do.\nFrom: Dana\nSent: Mon\nRepeated history' })]),
      since,
      never,
    )
    const text = conversationContent(plan.conversations[0]!, ME)
    expect(text).toContain(`${ME} sent the latest message in this conversation`)
    expect(text).toContain(`sent by ${ME}`)
    expect(text).toContain(`From: ${ME} (you)`)
    expect(text).toContain('Earlier ask') // the first message keeps its quoted history for context
    expect(text).not.toContain('Repeated history') // later ones don't
  })
})

describe('email rules the app applies to AI output', () => {
  const meta = (o: Partial<MailMeta>): MailMeta => ({ conversationId: 'C1', entryId: 'E', storeId: 'S', messageCount: 2, people: 'Dana Lee', lastFromMe: false, lastSentByMeAt: null, ...o })
  const draft = (kind: 'needs_reply' | 'waiting_on') => ({ kind, evidence: 'q', payload: { taskId: null, title: 'Reply to Dana: pricing', details: '', dueDate: null, projectId: null, requesterId: null, requesterName: 'Dana Lee', waitingOn: kind === 'waiting_on' ? 'Dana Lee' : null, briefScope: null, briefOwnerId: null } })

  it('drops "needs reply" when the user wrote last, with a reason for the AI log', () => {
    const dropped: { kind: string; title: string; reason: string }[] = []
    expect(applyMailRules([draft('needs_reply')], meta({ lastFromMe: true }), dropped)).toEqual([])
    expect(dropped[0]!.reason).toMatch(/latest message/)
    expect(applyMailRules([draft('needs_reply')], meta({}), [])).toHaveLength(1)
  })

  it('starts a wait when the user sent the ask', () => {
    const [d] = applyMailRules([draft('waiting_on')], meta({ lastFromMe: true, lastSentByMeAt: '2026-10-28T15:00:00.000Z' }), [])
    expect(d!.payload.waitingSince).toBe('2026-10-28T15:00:00.000Z')
  })
})

describe('follow-ups on waiting items', () => {
  const now = new Date(2026, 10, 3, 9, 0, 0) // Tuesday, Nov 3
  it('counts business days, skipping weekends', () => {
    expect(businessDaysSince(new Date(2026, 9, 30, 15, 0).toISOString(), now)).toBe(2) // Fri → Mon, Tue
    expect(businessDaysSince(new Date(2026, 9, 29, 15, 0).toISOString(), now)).toBe(3) // Thu → Fri, Mon, Tue
  })

  it('flags waits of 3 business days and raises their priority', () => {
    const base = { dueDate: null, requester: null, followUpCount: 0, lastActivityAt: new Date(2026, 10, 3, 8).toISOString(), status: 'waiting_on' }
    const fresh = { ...base, waitingSince: new Date(2026, 10, 2, 15).toISOString() }
    const stale = { ...base, waitingSince: new Date(2026, 9, 28, 15).toISOString() }
    expect(needsFollowUp(fresh, now)).toBe(false)
    expect(needsFollowUp(stale, now)).toBe(true)
    expect(needsFollowUp({ ...stale, status: 'open' }, now)).toBe(false)
    const weights = DEFAULT_SETTINGS.priorityWeights
    const high = scorePriority(stale, weights, now)
    expect(high.score).toBeGreaterThan(scorePriority(fresh, weights, now).score)
    expect(high.rationale).toMatch(/no reply in 4 business days/i)
  })
})

/** Stands in for Outlook: returns whatever mailbox the test sets. */
class FakeOutlook implements OutlookReader {
  mailbox: OutlookMailbox = box([])
  opened: string[] = []
  async list(from: Date) {
    return { ...this.mailbox, messages: this.mailbox.messages.filter((m) => Date.parse(m.time) >= from.getTime()) }
  }
  async open(entryId: string) {
    this.opened.push(entryId)
  }
}

describe('mail import end to end (demo AI, fake Outlook)', () => {
  let folder: string
  let db: DatabaseSync
  let tasks: TaskService
  let suggestions: SuggestionService
  let sources: SourceService
  let outlook: FakeOutlook
  let mail: MailService
  const now = new Date('2026-11-03T15:00:00.000Z')

  beforeEach(() => {
    // The import reads today's date from the clock, so pin it to `now` ("by Friday" is then Nov 6).
    // Only Date is faked, so the polling timers below still run.
    vi.useFakeTimers({ toFake: ['Date'], now })
    folder = mkdtempSync(join(tmpdir(), 'cos-mail-'))
    db = openDatabase(join(folder, 'test.db'))
    tasks = new TaskService(db, () => DEFAULT_SETTINGS.priorityWeights)
    suggestions = new SuggestionService(db, tasks, new BriefService(db), new ProjectService(db), new PersonService(db))
    sources = new SourceService(db, () => new DemoProvider(), () => ME)
    outlook = new FakeOutlook()
    mail = new MailService(db, sources, outlook, () => ME, () => 'Demo AI', () => now)
  })
  afterEach(() => {
    vi.useRealTimers()
    db.close()
    rmSync(folder, { recursive: true, force: true })
  })

  const finished = async (): Promise<MailJobStatus> => {
    for (let i = 0; i < 100 && mail.status().state === 'reading'; i++) await new Promise((r) => setTimeout(r, 10))
    return mail.status()
  }

  it('checks without reading, then reads into Review and never reads the same mail twice', async () => {
    outlook.mailbox = box([
      msg({ conversationId: 'A', subject: 'Q1 pricing', body: 'Hi Frank,\nCan you confirm the tier 2 discount by Friday?' }),
      msg({ conversationId: 'B', subject: 'Spec review', direction: 'sent', from: ME, fromEmail: 'frank@example.com', to: 'Tom Alvarez', body: 'Tom, could you send your comments on the spec?' }),
      msg({ conversationId: 'N', subject: 'Digest', listUnsubscribe: true, body: 'Can you read this?' }),
    ])
    expect(mail.info().lastImportAt).toBeNull()
    expect(mail.info().defaultSince).toBe('2026-10-27T15:00:00.000Z') // 7 days back on the first run

    const check = await mail.check(since.toISOString())
    expect(check.conversations.map((c) => [c.key, c.skipReason])).toEqual(
      expect.arrayContaining([['A', null], ['B', null], ['N', SKIP.newsletter]]),
    )
    expect(db.prepare('SELECT COUNT(*) AS n FROM source_items').get()).toEqual({ n: 0 }) // checking sends nothing

    mail.read(check.id, ['A', 'B'])
    const status = await finished()
    expect(status).toMatchObject({ state: 'done', done: 2, total: 2, failed: 0, estimatedCost: null }) // Basic is free

    const pending = suggestions.listPending()
    const reply = pending.find((s) => s.kind === 'needs_reply')!
    expect(reply.payload.title).toBe('Reply to Dana: Q1 pricing')
    expect(reply.source.fromOutlook).toBe(true)
    const waiting = pending.find((s) => s.kind === 'waiting_on')!
    expect(waiting.payload.waitingOn).toBe('Tom Alvarez')
    expect(waiting.payload.waitingSince).toBe('2026-11-02T14:00:00.000Z')

    // Accepting: a "Reply to" task, and a wait that counts from when the email was sent.
    const replyTask = tasks.get(suggestions.accept(reply.id)!)!
    expect(replyTask).toMatchObject({ status: 'open', title: 'Reply to Dana: Q1 pricing', dueDate: '2026-11-06' })
    expect(replyTask.linkedSources.map((s) => s.title)).toEqual(['Q1 pricing'])
    const waitTask = tasks.get(suggestions.accept(waiting.id)!)!
    expect(waitTask).toMatchObject({ status: 'waiting_on', waitingOn: 'Tom Alvarez', waitingSince: '2026-11-02T14:00:00.000Z' })

    // The finished import moves the default start, and lists its conversations as one run.
    expect(mail.info().lastImportAt).toBe(check.checkedAt)
    const [run] = mail.imports()
    expect(run).toMatchObject({ complete: true, provider: 'Demo AI' })
    expect(run!.conversations.map((s) => s.title).sort()).toEqual(['Q1 pricing', 'Spec review'])
    expect(sources.list()).toEqual([]) // mail isn't mixed into the other recent imports

    // Checking again finds the same mail already read, except the skipped newsletter.
    const again = await mail.check(since.toISOString())
    expect(again.alreadyRead).toBe(2)
    expect(again.conversations.map((c) => c.key)).toEqual(['N'])

    await mail.open(run!.conversations[0]!.id)
    expect(outlook.opened).toHaveLength(1)
  })

  it('adds up what the conversations of a paid import are estimated to cost', async () => {
    /** Basic's answers, logged as if Claude Opus 5.5 gave them with 10,000 tokens in and 1,000 out ($0.06). */
    class PaidDemo extends DemoProvider {
      override extract(ctx: ExtractionContext, source: SourceForExtraction, log?: AiCallLog) {
        const meta = { purpose: 'Find suggestions', endpoint: 'Anthropic Messages API', request: { model: 'claude-opus-5-5' } }
        return logged(log, meta, () => super.extract(ctx, source), () => ({ response: {}, inputTokens: 10_000, outputTokens: 1_000, paidModel: 'claude-opus-5-5' }))
      }
    }
    sources = new SourceService(db, () => new PaidDemo(), () => ME)
    mail = new MailService(db, sources, outlook, () => ME, () => 'Claude', () => now)
    outlook.mailbox = box([msg({ conversationId: 'A', body: 'Can you confirm by Friday?' }), msg({ conversationId: 'B', subject: 'Spec', body: 'Can you review the spec?' })])
    mail.read((await mail.check(since.toISOString())).id, ['A', 'B'])
    expect((await finished()).estimatedCost).toBeCloseTo(0.12)
    expect(mail.imports()[0]!.conversations.map((s) => s.estimatedCost)).toEqual([expect.closeTo(0.06), expect.closeTo(0.06)])
  })

  it('reads a skipped conversation when chosen with "Read anyway"', async () => {
    outlook.mailbox = box([msg({ conversationId: 'N', listUnsubscribe: true, body: 'Can you take a look at this?' })])
    const check = await mail.check(since.toISOString())
    mail.read(check.id, ['N'])
    expect((await finished()).done).toBe(1)
  })

  it('a stopped import keeps the previous start date, so the rest is offered again', async () => {
    outlook.mailbox = box(['A', 'B', 'C'].map((c) => msg({ conversationId: c, body: 'Hello there' })))
    const check = await mail.check(since.toISOString())
    mail.read(check.id, ['A', 'B', 'C'])
    mail.stop()
    const status = await finished()
    expect(status.state).toBe('stopped')
    expect(status.done).toBeLessThan(3)
    expect(mail.info().lastImportAt).toBeNull()
    const again = await mail.check(mail.info().defaultSince)
    expect(again.conversations).toHaveLength(3 - status.done)
  })

  it('refuses an out-of-date check and a second read at the same time', async () => {
    outlook.mailbox = box([msg({ conversationId: 'A' }), msg({ conversationId: 'B' })])
    const first = await mail.check(since.toISOString())
    const second = await mail.check(since.toISOString())
    expect(() => mail.read(first.id, ['A'])).toThrow(/out of date/)
    mail.read(second.id, ['A'])
    await expect(mail.check(since.toISOString())).rejects.toThrow(/still being read/)
    await finished()
  })
})

describe('needs_reply suggestions', () => {
  it('pass validation like new tasks and need a title', () => {
    const folder = mkdtempSync(join(tmpdir(), 'cos-mail-v-'))
    const db = openDatabase(join(folder, 'v.db'))
    try {
      const ctx = buildExtractionContext(db, ME)
      const base = { task_id: null, details: '', due_date: '2026-11-06', project_id: null, project_name: null, requester_name: 'Dana Lee', waiting_on: null, brief_scope: null, brief_owner_id: null, role: null, company: null, email: null, evidence: 'Can you confirm?' }
      const dropped: { reason: string }[] = []
      const drafts = validateSuggestions([{ ...base, kind: 'needs_reply', title: 'Reply to Dana: pricing' }, { ...base, kind: 'needs_reply', title: '' }], ctx, dropped as never)
      expect(drafts.map((d) => [d.kind, d.payload.dueDate])).toEqual([['needs_reply', '2026-11-06']])
      expect(dropped).toHaveLength(1)
    } finally {
      db.close()
      rmSync(folder, { recursive: true, force: true })
    }
  })
})
