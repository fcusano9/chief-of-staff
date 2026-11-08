import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DemoProvider } from '../src/main/ai/demo'
import { openDatabase } from '../src/main/db'
import { AppleMailReader, header, replyRecipients, splitSender, threadRoot, toMailbox, topicOf, type RawAppleMessage } from '../src/main/mail/applemail'
import { FixtureOutlook, type OutlookReader } from '../src/main/mail/outlook'
import { planMailbox } from '../src/main/mail/plan'
import { MailService } from '../src/main/services/mail'
import { SettingsStore } from '../src/main/services/settings'
import { SourceService } from '../src/main/services/sources'
import { DEFAULT_SETTINGS } from '@shared/types'

const ACCOUNT = 'ACC-1'
// Two Thread-Index values from the same Exchange conversation: the first 22 bytes match.
const ROOT = Buffer.from('01dc4f2a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2', 'hex')
const ti = (extra: string) => Buffer.concat([ROOT, Buffer.from(extra, 'hex')]).toString('base64')

let seq = 0
const raw = (o: Partial<RawAppleMessage>): RawAppleMessage => {
  seq++
  return {
    ref: { account: ACCOUNT, path: ['Inbox'], id: seq },
    direction: 'received',
    folder: 'Inbox',
    subject: 'Q1 pricing',
    sender: 'Dana Lee <dana@example.com>',
    to: [{ name: 'Frank Cusano', address: 'frank@example.com' }, { name: 'Priya Shah', address: 'priya@example.com' }],
    cc: [{ name: 'Marcus Webb', address: 'marcus@example.com' }],
    time: `2026-11-0${Math.min(9, seq % 9 || 1)}T10:00:00.000Z`,
    headers: `Message-ID: <m${seq}@example.com>\nThread-Index: ${ti('aa')}`,
    ...o,
  }
}

describe('Apple Mail: reading what Mail reports', () => {
  it('reads headers, senders and subjects', () => {
    expect(header('Message-ID: <a@b>\nList-Id: <news.example.com>', 'list-id')).toBe('<news.example.com>')
    expect(header('Precedence: bulk', 'Auto-Submitted')).toBe('')
    expect(splitSender('Dana Lee <dana@example.com>')).toEqual({ name: 'Dana Lee', email: 'dana@example.com' })
    expect(splitSender('"Lee, Dana" <dana@example.com>')).toEqual({ name: 'Lee, Dana', email: 'dana@example.com' })
    expect(splitSender('dana@example.com')).toEqual({ name: 'dana@example.com', email: 'dana@example.com' })
    expect(topicOf('RE: Fw: [EXTERNAL] Q1   Pricing')).toBe('q1 pricing')
    expect(topicOf('AW: [Partners] Launch')).toBe('[partners] launch')
  })

  it('groups an Exchange conversation by its Thread-Index, and a reply without one by subject', () => {
    expect(threadRoot(`Thread-Index: ${ti('aa')}`)).toBe(threadRoot(`Thread-Index: ${ti('bbcc')}`))
    expect(threadRoot('Thread-Index: AQ==')).toBe('')
    const box = toMailbox(
      [
        raw({ headers: `Message-ID: <x1@e>\nThread-Index: ${ti('01')}` }),
        raw({ subject: 'RE: Q1 pricing', headers: 'Message-ID: <x2@e>' }),
        raw({ subject: 'Lunch?', headers: 'Message-ID: <x3@e>' }),
      ],
      { name: '', addresses: ['frank@example.com'] },
    )
    const [a, b, c] = box.messages
    expect(a!.conversationId).toBe(b!.conversationId)
    expect(c!.conversationId).toBe('')
    expect(a).toMatchObject({ messageId: '<x1@e>', from: 'Dana Lee', fromEmail: 'dana@example.com', to: 'Frank Cusano; Priya Shah', cc: 'Marcus Webb', isMail: true, messageClass: 'IPM.Note', body: '' })
    expect(JSON.parse(a!.entryId)).toEqual({ account: ACCOUNT, path: ['Inbox'], id: expect.any(Number) })
  })

  it('marks invites, newsletters and automated mail so the import skips them', () => {
    const box = toMailbox(
      [
        raw({ subject: 'Invitation: Sync', headers: 'Content-Class: urn:content-classes:calendarmessage' }),
        raw({ subject: 'Weekly digest', headers: 'List-Unsubscribe: <mailto:x>' }),
        raw({ subject: 'Build passed', sender: 'noreply@ci.example.com', headers: '' }),
      ],
      { name: '', addresses: ['frank@example.com'] },
    )
    const plan = planMailbox(box, new Date('2026-01-01'), () => false)
    expect(plan.conversations.map((c) => c.skipReason).sort()).toEqual(['Automated sender', 'Meeting invite', 'Newsletter or mailing list'])
  })

  it('works out Reply and Reply all, leaving the user out', () => {
    expect(replyRecipients(raw({}), ['frank@example.com'])).toEqual({ subject: 'Re: Q1 pricing', reply: { to: 'Dana Lee', cc: '' }, replyAll: { to: 'Dana Lee; Priya Shah', cc: 'Marcus Webb' } })
    const mine = raw({ direction: 'sent', subject: 'Re: Q1 pricing', sender: 'Frank Cusano <frank@example.com>', to: [{ name: 'Dana Lee', address: 'dana@example.com' }], cc: [] })
    expect(replyRecipients(mine, ['frank@example.com'])).toEqual({ subject: 'Re: Q1 pricing', reply: { to: 'Dana Lee', cc: '' }, replyAll: { to: 'Dana Lee', cc: '' } })
  })
})

describe('Apple Mail reader (fake osascript)', () => {
  function reader(chosen: string[], answers: Record<string, (req: Record<string, unknown>) => Record<string, unknown>>) {
    const asked: Record<string, unknown>[] = []
    const r = new AppleMailReader(
      () => chosen,
      async (req) => {
        asked.push(req)
        const answer = answers[String(req.action)]
        if (!answer) throw new Error(`unexpected ${String(req.action)}`)
        return { ok: true, ...answer(req) }
      },
    )
    return { r, asked }
  }
  const accounts = () => ({ accounts: [{ id: ACCOUNT, name: 'Exchange', type: 'unknown', enabled: true, addresses: ['frank@example.com'] }, { id: 'G', name: 'Google', type: 'imap', enabled: true, addresses: ['me@gmail.com'] }] })

  it('reads only the accounts chosen in Settings, and asks for nothing without one', async () => {
    const none = reader([], { accounts })
    await expect(none.r.list(new Date())).rejects.toThrow('Choose which Apple Mail accounts to read in Settings.')
    expect(await none.r.addresses()).toEqual([])

    const one = reader([ACCOUNT], { accounts, list: () => ({ accounts: [{ name: 'Exchange', addresses: ['frank@example.com'] }], messages: [raw({})] }) })
    const box = await one.r.list(new Date('2026-11-01T00:00:00Z'))
    expect(one.asked[0]).toEqual({ action: 'list', accounts: [ACCOUNT], since: '2026-11-01T00:00:00.000Z' })
    expect(box.me.addresses).toEqual(['frank@example.com'])
    expect(await one.r.addresses()).toEqual(['frank@example.com'])
  })

  it('fetches message text only for what the AI reads', async () => {
    const { r, asked } = reader([ACCOUNT], { bodies: (req) => ({ bodies: (req.refs as unknown[]).map((_, i) => `text ${i}`) }) })
    const box = toMailbox([raw({}), raw({ body: 'already here' })], { name: '', addresses: [] })
    await r.fillBodies(box.messages)
    expect(box.messages.map((m) => m.body)).toEqual(['text 0', 'already here'])
    expect((asked[0]!.refs as unknown[]).length).toBe(1)
  })

  it('replies on the newest email in the conversation, and opens or saves without sending', async () => {
    const first = raw({ time: '2026-11-03T10:00:00.000Z' })
    const newer = raw({ time: '2026-11-04T09:00:00.000Z', direction: 'sent', ref: { account: ACCOUNT, path: ['Sent Items'], id: 99 }, sender: 'Frank Cusano <frank@example.com>', subject: 'RE: Q1 pricing', headers: `Thread-Index: ${ti('ff')}` })
    const other = raw({ time: '2026-11-05T09:00:00.000Z', subject: 'Something else', headers: 'Thread-Index: ' + Buffer.alloc(24, 7).toString('base64') })
    const { r, asked } = reader([ACCOUNT], {
      accounts,
      message: (req) => {
        const id = (req.ref as { id: number }).id
        const m = [first, newer].find((x) => x.ref.id === id)!
        return { message: { ...m, body: `body of ${id}` } }
      },
      thread: () => ({ messages: [first, newer, other] }),
      reply: () => ({}),
    })
    const latest = await r.latest(JSON.stringify(first.ref))
    expect(latest).toMatchObject({ entryId: JSON.stringify(newer.ref), fromMe: true, from: 'Frank Cusano', body: 'body of 99' })
    expect(asked.find((a) => a.action === 'thread')).toMatchObject({ account: ACCOUNT, since: '2026-11-03T09:59:00.000Z' })

    await r.openReply(latest.entryId, '', true, 'Hi Dana')
    await r.saveReply(latest.entryId, '', false, 'Hi Dana')
    expect(asked.filter((a) => a.action === 'reply')).toEqual([
      { action: 'reply', ref: newer.ref, replyAll: true, body: 'Hi Dana', open: true },
      { action: 'reply', ref: newer.ref, replyAll: false, body: 'Hi Dana', open: false },
    ])
  })
})

describe('mail import with Apple Mail', () => {
  it('needs an account chosen first, then reads like Outlook, filling message text before the AI reads it', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'cos-applemail-'))
    const db = openDatabase(join(folder, 'test.db'))
    try {
      const fixture = join(folder, 'mail.json')
      const { writeFileSync } = await import('node:fs')
      writeFileSync(
        fixture,
        JSON.stringify({
          me: { name: 'Frank Cusano', addresses: ['frank@example.com'] },
          messages: [{ entryId: 'E1', storeId: 'S', messageId: '<m1@e>', conversationId: 'C1', topic: 'Q1 pricing', subject: 'Q1 pricing', messageClass: 'IPM.Note', isMail: true, direction: 'received', folder: 'Inbox', from: 'Dana Lee', fromEmail: 'dana@example.com', to: 'Frank Cusano', cc: '', time: '2026-11-03T10:00:00.000Z', listUnsubscribe: false, listId: '', precedence: '', autoSubmitted: '', body: '' }],
        }),
      )
      const reader = new FixtureOutlook(fixture, null, 'apple-mail')
      const filled: string[] = []
      const asReader: OutlookReader = reader
      asReader.fillBodies = async (messages) => {
        for (const m of messages) {
          m.body = 'Can you confirm the tier 2 discount by Friday?'
          filled.push(m.entryId)
        }
      }
      let chosen: string[] = []
      const mail = new MailService(db, new SourceService(db, () => new DemoProvider(), () => 'Frank Cusano'), reader, () => 'Frank Cusano', () => 'Basic', () => new Date('2026-11-04T00:00:00Z'), () => chosen)
      expect(mail.info()).toMatchObject({ supported: true, app: 'apple-mail', needsAccounts: true })
      chosen = ['fixture-account']
      expect(mail.info().needsAccounts).toBe(false)
      expect(await mail.addresses()).toEqual(['frank@example.com'])
      expect(await mail.accounts()).toEqual([{ id: 'fixture-account', name: 'Work', type: 'unknown', enabled: true, addresses: ['frank@example.com'] }])

      const check = await mail.check('2026-11-01T00:00:00.000Z')
      mail.read(check.id, check.conversations.map((c) => c.key))
      for (let i = 0; i < 50 && mail.status().state === 'reading'; i++) await new Promise((r) => setTimeout(r, 10))
      expect(mail.status()).toMatchObject({ state: 'done', done: 1, failed: 0 })
      expect(filled).toEqual(['E1'])
      const saved = db.prepare("SELECT content FROM source_items WHERE kind = 'email'").get() as { content: string }
      expect(saved.content).toContain('tier 2 discount')
    } finally {
      db.close()
      rmSync(folder, { recursive: true, force: true })
    }
  })

  it('keeps the chosen Apple Mail accounts in settings, without repeats', () => {
    const folder = mkdtempSync(join(tmpdir(), 'cos-applemail-settings-'))
    try {
      const s = new SettingsStore(join(folder, 'settings.json'))
      expect(s.current.mailAccounts).toEqual([])
      expect(s.save({ ...DEFAULT_SETTINGS, mailAccounts: ['A', 'A', '', 'B'] }).mailAccounts).toEqual(['A', 'B'])
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})
