import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MailAccount } from '@shared/types'
import { OutlookError, type LatestMessage, type OutlookMailbox, type OutlookMessage, type OutlookReader, type ReplyRecipients } from './outlook'
import script from './applemail.jxa?raw'

/** Where a message is in Apple Mail: its account, the mailbox names from the account down, and Mail's id for it. */
export interface MailRef {
  account: string
  path: string[]
  id: number
}

interface Recipient {
  name: string
  address: string
}

/** One message as applemail.jxa reports it. */
export interface RawAppleMessage {
  ref: MailRef
  direction: 'received' | 'sent'
  folder: string
  subject: string
  /** "Dana Lee <dana@example.com>" or just the address. */
  sender: string
  to: Recipient[]
  cc: Recipient[]
  time: string
  /** Only the headers the app uses (Message-ID, References, Thread-Index, List-Id and so on), one per line. */
  headers: string
  body?: string
}

const MAX_BODY = 30_000

/** A header's value from applemail.jxa's header lines, or ''. */
export function header(headers: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
  const m = new RegExp(`^${escaped}:[ \\t]*(.*)$`, 'im').exec(headers)
  return m ? m[1]!.trim() : ''
}

/** "Dana Lee" and "dana@example.com" from "Dana Lee <dana@example.com>", '"Lee, Dana" <dana@…>' or a bare address. */
export function splitSender(sender: string): { name: string; email: string } {
  const m = /^\s*"?(.*?)"?\s*<([^>]+)>\s*$/.exec(sender)
  if (m) return { name: m[1]!.trim() || m[2]!.trim(), email: m[2]!.trim() }
  const s = sender.trim()
  return { name: s, email: s.includes('@') ? s : '' }
}

/** The subject without "RE:", "FW:" and the like, lower-cased, so replies group with the email they answer. */
export function topicOf(subject: string): string {
  let s = subject.trim()
  for (;;) {
    const next = s.replace(/^(re|fw|fwd|aw|wg|sv|vs|antw)\s*(\[\d+\])?\s*:\s*/i, '').replace(/^\[[^\]]*\]\s*/, (b) => (/^\[(ext|external)\]/i.test(b) ? '' : b))
    if (next === s) break
    s = next
  }
  return s.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * The conversation an Exchange message belongs to: the first 22 bytes of its Thread-Index header,
 * which every message in an Outlook/Exchange conversation shares. Empty when there's none.
 */
export function threadRoot(headers: string): string {
  const ti = header(headers, 'Thread-Index')
  if (!ti) return ''
  const bytes = Buffer.from(ti, 'base64')
  return bytes.length >= 22 ? `ti:${bytes.subarray(0, 22).toString('hex')}` : ''
}

const isInvite = (headers: string) => /calendarmessage/i.test(header(headers, 'Content-Class')) || /text\/calendar/i.test(header(headers, 'Content-Type'))
const names = (list: Recipient[]) => list.map((r) => r.name || r.address).join('; ')

/**
 * Turns Apple Mail's messages into the same shape as Outlook's, so the rest of the import (skips,
 * conversations, AI text) is shared. Conversations come from Exchange's Thread-Index where there is
 * one, else the subject without "RE:"; a message without a Thread-Index joins a conversation with
 * the same subject that has one.
 */
export function toMailbox(raw: RawAppleMessage[], me: { name: string; addresses: string[] }): OutlookMailbox {
  const byTopic = new Map<string, string>()
  for (const m of raw) {
    const root = threadRoot(m.headers)
    const topic = topicOf(m.subject)
    if (root && topic && !byTopic.has(topic)) byTopic.set(topic, root)
  }
  const messages: OutlookMessage[] = raw.map((m) => {
    const { name, email } = splitSender(m.sender)
    const topic = topicOf(m.subject)
    return {
      entryId: JSON.stringify(m.ref),
      storeId: m.ref.account,
      messageId: header(m.headers, 'Message-ID'),
      conversationId: threadRoot(m.headers) || byTopic.get(topic) || '',
      topic: header(m.headers, 'Thread-Topic') || m.subject.replace(/^((re|fw|fwd)\s*:\s*)+/i, ''),
      subject: m.subject,
      messageClass: isInvite(m.headers) ? 'IPM.Schedule.Meeting.Request' : 'IPM.Note',
      isMail: true,
      direction: m.direction,
      folder: m.folder,
      from: name,
      fromEmail: email,
      to: names(m.to),
      cc: names(m.cc),
      time: m.time,
      listUnsubscribe: header(m.headers, 'List-Unsubscribe') !== '',
      listId: header(m.headers, 'List-Id'),
      precedence: header(m.headers, 'Precedence'),
      autoSubmitted: header(m.headers, 'Auto-Submitted'),
      body: m.body ?? '',
    }
  })
  return { me, messages }
}

/**
 * Who Reply and Reply all would go to, worked out from the email (Apple Mail can't preview a reply
 * without making one). The user's own addresses are left out.
 */
export function replyRecipients(m: RawAppleMessage, mine: string[]): ReplyRecipients {
  const me = new Set(mine.map((a) => a.toLowerCase()))
  const others = (list: Recipient[]) => list.filter((r) => !me.has(r.address.toLowerCase()))
  const sender = splitSender(m.sender)
  const fromMe = m.direction === 'sent' || me.has(sender.email.toLowerCase())
  const subject = /^re\s*:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`
  if (fromMe) return { subject, reply: { to: names(others(m.to)), cc: '' }, replyAll: { to: names(others(m.to)), cc: names(others(m.cc)) } }
  const replyTo = header(m.headers, 'Reply-To')
  const first = replyTo ? splitSender(replyTo).name : sender.name
  const all = [first, ...others(m.to).map((r) => r.name || r.address)].filter((n, i, a) => n && a.indexOf(n) === i)
  return { subject, reply: { to: first, cc: '' }, replyAll: { to: all.join('; '), cc: names(others(m.cc)) } }
}

/** Runs applemail.jxa and returns its result, or throws an OutlookError with a message that's safe to show. */
export type AppleMailRunner = (request: Record<string, unknown>) => Promise<Record<string, unknown>>

/**
 * Reads Apple Mail on the Mac through its scripting (applemail.jxa, bundled as text, run with
 * osascript). Only the accounts the user ticked in Settings are read. Mail opens if it isn't running.
 */
export class AppleMailReader implements OutlookReader {
  readonly app = 'apple-mail' as const
  private accountCache: MailAccount[] | null = null

  constructor(
    private readonly chosen: () => string[],
    private readonly run: AppleMailRunner = runAppleMail,
  ) {}

  async accounts(refresh = false): Promise<MailAccount[]> {
    if (!this.accountCache || refresh) {
      const r = await this.run({ action: 'accounts' })
      this.accountCache = ((r.accounts as MailAccount[] | undefined) ?? []).map((a) => ({ id: String(a.id), name: String(a.name), type: String(a.type), enabled: a.enabled !== false, addresses: (a.addresses ?? []).map(String) }))
    }
    return this.accountCache
  }

  async addresses(): Promise<string[]> {
    const ids = new Set(this.chosen())
    if (ids.size === 0) return []
    return (await this.accounts()).filter((a) => ids.has(a.id)).map((a) => a.addresses[0] ?? a.name)
  }

  async list(since: Date): Promise<OutlookMailbox> {
    const ids = this.chosen()
    if (ids.length === 0) throw new OutlookError('Choose which Apple Mail accounts to read in Settings.')
    const r = await this.run({ action: 'list', accounts: ids, since: since.toISOString() })
    const accounts = (r.accounts as { name: string; addresses: string[] }[] | undefined) ?? []
    if (accounts.length === 0) throw new OutlookError("The Apple Mail accounts chosen in Settings aren't in Mail any more. Choose them again in Settings.")
    const me = { name: '', addresses: accounts.flatMap((a) => a.addresses ?? []) }
    return toMailbox((r.messages as RawAppleMessage[]) ?? [], me)
  }

  /** Reading every message's text is slow in Mail (about a third of a second each), so it's done only for what the AI reads. */
  async fillBodies(messages: OutlookMessage[]): Promise<void> {
    const missing = messages.filter((m) => !m.body)
    if (missing.length === 0) return
    const r = await this.run({ action: 'bodies', refs: missing.map((m) => refOf(m.entryId)) })
    const bodies = (r.bodies as (string | null)[] | undefined) ?? []
    missing.forEach((m, i) => (m.body = (bodies[i] ?? '').slice(0, MAX_BODY)))
  }

  async open(entryId: string): Promise<void> {
    if (!entryId) {
      await this.run({ action: 'drafts' })
      return
    }
    await this.run({ action: 'open', ref: refOf(entryId) })
  }

  async latest(entryId: string): Promise<LatestMessage> {
    const ref = refOf(entryId)
    const start = await this.message(ref)
    const mine = await this.mine(ref.account)
    const key = conversationKey(start.raw)
    const after = new Date(Date.parse(start.raw.time) - 60_000).toISOString()
    const r = await this.run({ action: 'thread', account: ref.account, since: after })
    const same = ((r.messages as RawAppleMessage[]) ?? []).filter((m) => conversationKey(m) === key || topicOf(m.subject) === topicOf(start.raw.subject))
    const newest = same.sort((a, b) => a.time.localeCompare(b.time)).at(-1)
    const best = newest && newest.time > start.raw.time ? await this.message(newest.ref) : start
    const { name, email } = splitSender(best.raw.sender)
    const fromMe = best.raw.direction === 'sent' || mine.includes(email.toLowerCase())
    return { entryId: JSON.stringify(best.raw.ref), storeId: best.raw.ref.account, fromMe, from: name, to: names(best.raw.to), cc: names(best.raw.cc), subject: best.raw.subject, time: best.raw.time, body: best.body }
  }

  async recipients(entryId: string): Promise<ReplyRecipients> {
    const ref = refOf(entryId)
    const { raw } = await this.message(ref)
    return replyRecipients(raw, await this.mine(ref.account))
  }

  /** Saves a reply to Mail's Drafts. Never sends. Mail doesn't say where the draft went, so no ids come back. */
  async saveReply(entryId: string, _storeId: string, replyAll: boolean, body: string): Promise<{ entryId: string; storeId: string }> {
    await this.run({ action: 'reply', ref: refOf(entryId), replyAll, body, open: false })
    return { entryId: '', storeId: '' }
  }

  /** Opens a reply window in Mail with the text in it, for the user to finish. Never sends. */
  async openReply(entryId: string, _storeId: string, replyAll: boolean, body: string): Promise<void> {
    await this.run({ action: 'reply', ref: refOf(entryId), replyAll, body, open: true })
  }

  private async message(ref: MailRef): Promise<{ raw: RawAppleMessage; body: string }> {
    const r = await this.run({ action: 'message', ref })
    const raw = r.message as RawAppleMessage
    return { raw, body: String(raw.body ?? '').slice(0, MAX_BODY) }
  }

  private async mine(account: string): Promise<string[]> {
    const a = (await this.accounts()).find((x) => x.id === account)
    return (a?.addresses ?? []).map((x) => x.toLowerCase())
  }
}

const conversationKey = (m: RawAppleMessage) => threadRoot(m.headers) || `topic:${topicOf(m.subject)}`

function refOf(entryId: string): MailRef {
  try {
    const r = JSON.parse(entryId) as MailRef
    if (r && typeof r.account === 'string' && Array.isArray(r.path) && typeof r.id === 'number') return r
  } catch {}
  throw new OutlookError("Couldn't find that email in Mail. It may have been moved or deleted.")
}

/** Runs applemail.jxa with osascript. The request goes in a temporary file, since reply text can be long. */
export const runAppleMail: AppleMailRunner = async (request) => {
  const id = randomUUID()
  const scriptPath = join(tmpdir(), `cos-mail-${id}.js`)
  const requestPath = join(tmpdir(), `cos-mail-${id}.json`)
  // Only the user can read these (the request can hold reply text); both are deleted when osascript finishes.
  writeFileSync(scriptPath, script, { encoding: 'utf8', mode: 0o600 })
  writeFileSync(requestPath, JSON.stringify(request), { encoding: 'utf8', mode: 0o600 })
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile('osascript', ['-l', 'JavaScript', scriptPath, requestPath], { timeout: 10 * 60_000, maxBuffer: 256 * 1024 * 1024 }, (err, out, stderr) => {
        if (err) {
          const text = `${stderr} ${err.message}`
          reject(
            new OutlookError(
              /-1743|not allowed/i.test(text)
                ? "Chief of Staff isn't allowed to control Mail. Open System Settings → Privacy & Security → Automation, turn on Mail under Chief of Staff, then try again."
                : `Couldn't run the Apple Mail reader: ${stderr.trim() || err.message}`,
            ),
          )
        } else resolve(out)
      })
    })
    let result: Record<string, unknown>
    try {
      result = JSON.parse(stdout) as Record<string, unknown>
    } catch {
      throw new OutlookError("The Apple Mail reader didn't return a result.")
    }
    if (!result.ok) throw new OutlookError(String(result.error ?? 'Apple Mail could not be read.'))
    return result
  } finally {
    rmSync(scriptPath, { force: true })
    rmSync(requestPath, { force: true })
  }
}
