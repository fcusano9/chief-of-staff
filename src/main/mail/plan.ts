import type { OutlookMailbox, OutlookMessage } from './outlook'

/**
 * Turning raw Outlook messages into conversations for the AI: which to skip, which were read
 * before, and the text the AI reads. Pure functions, so they're easy to test without Outlook.
 */

export interface PlannedMessage extends OutlookMessage {
  key: string
  fromMe: boolean
  /** Why this message alone is left out, or null. */
  skip: string | null
}

export interface PlannedConversation {
  key: string
  subject: string
  people: string
  /** The messages to read, oldest first: the new ones, minus skipped ones unless all were skipped. */
  messages: PlannedMessage[]
  skipReason: string | null
  /** The user sent the newest message in the conversation, so nobody is waiting on their reply. */
  lastFromMe: boolean
  lastAt: string
  /** When the user last wrote in it, for waiting-on items. */
  lastSentByMeAt: string | null
}

export interface MailPlan {
  received: number
  sent: number
  alreadyRead: number
  conversations: PlannedConversation[]
}

export const SKIP = {
  invite: 'Meeting invite',
  autoReply: 'Automatic reply',
  newsletter: 'Newsletter or mailing list',
  automated: 'Automated sender',
} as const

/** A stable id for a message: its Internet message id, which survives moving it between folders. */
export const messageKey = (m: OutlookMessage): string => (m.messageId ? `mid:${m.messageId}` : `entry:${m.entryId}`)

const AUTOMATED_SENDER = /^(no-?reply|do-?not-?reply|notifications?|notify|alerts?|mailer-daemon|postmaster|bounces?)([+._-].*)?@/i

/** Why a message shouldn't be read: invites, auto-replies, newsletters and automated senders. */
export function skipReason(m: OutlookMessage): string | null {
  if (!m.isMail || /^IPM\.Schedule\.Meeting/i.test(m.messageClass)) return SKIP.invite
  if (/^IPM\.Note\.Rules\.OofTemplate/i.test(m.messageClass) || /^\s*(automatic reply|auto(matic)?[- ]reply|out of (the )?office)\b/i.test(m.subject) || /auto-replied/i.test(m.autoSubmitted)) {
    return SKIP.autoReply
  }
  if (m.direction === 'sent') return null
  if (m.listUnsubscribe || m.listId || /^(bulk|list|junk)$/i.test(m.precedence.trim())) return SKIP.newsletter
  if ((m.autoSubmitted && !/^no$/i.test(m.autoSubmitted.trim())) || AUTOMATED_SENDER.test(m.fromEmail) || /\bno-?reply\b/i.test(m.fromEmail)) return SKIP.automated
  return null
}

/**
 * Groups new mail into conversations. `wasRead` says whether an earlier import already read a
 * message (by key); those are left out of what the AI reads but still count for who wrote last.
 */
export function planMailbox(box: OutlookMailbox, since: Date, wasRead: (key: string) => boolean): MailPlan {
  const mine = new Set(box.me.addresses.map((a) => a.trim().toLowerCase()).filter(Boolean))
  const byKey = new Map<string, PlannedMessage>()
  for (const m of box.messages) {
    if (Date.parse(m.time) < since.getTime()) continue
    const key = messageKey(m)
    const fromMe = m.direction === 'sent' || mine.has(m.fromEmail.trim().toLowerCase())
    const planned: PlannedMessage = { ...m, key, fromMe, skip: skipReason(m) }
    // A message to yourself is in both Inbox and Sent Items; keep one.
    const existing = byKey.get(key)
    if (!existing || (planned.direction === 'sent' && existing.direction !== 'sent')) byKey.set(key, planned)
  }

  const groups = new Map<string, PlannedMessage[]>()
  for (const m of byKey.values()) {
    const key = m.conversationId || `topic:${(m.topic || m.subject).trim().toLowerCase()}`
    groups.set(key, [...(groups.get(key) ?? []), m])
  }

  const plan: MailPlan = { received: 0, sent: 0, alreadyRead: 0, conversations: [] }
  for (const [key, all] of groups) {
    all.sort((a, b) => a.time.localeCompare(b.time))
    const fresh = all.filter((m) => !wasRead(m.key))
    plan.alreadyRead += all.length - fresh.length
    if (fresh.length === 0) continue
    const sent = fresh.filter((m) => m.direction === 'sent').length
    plan.sent += sent
    plan.received += fresh.length - sent

    const included = fresh.filter((m) => !m.skip)
    const real = all.filter((m) => !m.skip)
    const last = (real.length ? real : all).at(-1)!
    const messages = included.length ? included : fresh
    plan.conversations.push({
      key,
      subject: (messages.at(-1)!.subject || messages.at(-1)!.topic || '(no subject)').trim(),
      people: peopleIn(messages),
      messages,
      skipReason: included.length ? null : mostCommon(fresh.map((m) => m.skip!)),
      lastFromMe: last.fromMe,
      lastAt: all.at(-1)!.time,
      lastSentByMeAt: all.filter((m) => m.fromMe).at(-1)?.time ?? null,
    })
  }
  plan.conversations.sort((a, b) => b.lastAt.localeCompare(a.lastAt))
  return plan
}

/** "Dana Lee, Marcus Webb and 2 more": who wrote, and for the user's own messages, who they wrote to. */
function peopleIn(messages: PlannedMessage[]): string {
  const names: string[] = []
  const add = (n: string) => {
    const name = n.trim().replace(/^'|'$/g, '')
    if (name && !names.some((x) => x.toLowerCase() === name.toLowerCase())) names.push(name)
  }
  for (const m of messages) {
    if (!m.fromMe) add(m.from || m.fromEmail)
    else m.to.split(';').forEach(add)
  }
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ')
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0]
}

/**
 * Splits a message into what its author wrote and the earlier messages quoted below it
 * (Outlook's "From: … Sent: …" block, "-----Original Message-----", or "On … wrote:").
 */
export function splitQuoted(body: string): { text: string; quoted: string } {
  const patterns = [/^[ \t]*_{8,}[ \t]*\r?\n(?:[ \t]*\r?\n)?[ \t]*From:[^\n]*\r?\n[ \t]*(Sent|Date):/m, /^[ \t]*From:[^\n]*\r?\n[ \t]*(Sent|Date):/m, /^[ \t]*-{2,}[ \t]*Original Message[ \t]*-{2,}/im, /^[ \t]*On [^\n]{5,200} wrote:[ \t]*$/m]
  let cut = -1
  for (const p of patterns) {
    const m = p.exec(body)
    if (m && (cut < 0 || m.index < cut)) cut = m.index
  }
  return cut < 0 ? { text: tidy(body), quoted: '' } : { text: tidy(body.slice(0, cut)), quoted: tidy(body.slice(cut)) }
}

/** Drops image placeholders and runs of blank lines. */
function tidy(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((l) => !/^\s*\[cid:[^\]]*\]\s*$/i.test(l))
    .map((l) => l.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const MAX_MESSAGE = 8000
const MAX_QUOTED = 4000
const MAX_TOTAL = 40000

const cap = (s: string, max: number) => (s.length > max ? `${s.slice(0, max).trimEnd()}\n[…cut, ${(s.length - max).toLocaleString('en-US')} more characters]` : s)
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

/**
 * The text the AI reads for one conversation: a line on who wrote last, then each message,
 * oldest first, without the quoted history (except under the first one, for context).
 */
export function conversationContent(c: PlannedConversation, userName: string): string {
  const latest = c.messages.at(-1)!
  const header = [
    `Email conversation: ${c.subject}`,
    `${c.messages.length} message${c.messages.length === 1 ? '' : 's'} below, oldest first.`,
    c.lastFromMe
      ? `${userName} sent the latest message in this conversation, so nobody is waiting on ${userName}'s reply.`
      : `The latest message is from ${latest.from || latest.fromEmail}; ${userName} has not replied after it.`,
  ].join('\n')

  const parts = c.messages.map((m, i) => {
    const { text, quoted } = splitQuoted(m.body)
    const who = m.fromMe ? `${userName} (you)` : `${m.from}${m.fromEmail && m.fromEmail !== m.from ? ` <${m.fromEmail}>` : ''}`
    const lines = [
      `=== Message ${i + 1} of ${c.messages.length} · ${m.fromMe ? `sent by ${userName}` : 'received'} · ${when(m.time)}`,
      `From: ${who}`,
      m.to ? `To: ${m.to}` : null,
      m.cc ? `Cc: ${m.cc}` : null,
      `Subject: ${m.subject}`,
      '',
      cap(text || '(no text)', MAX_MESSAGE),
    ]
    if (i === 0 && quoted) lines.push('', '(Earlier messages quoted in this email, for context:)', cap(quoted, MAX_QUOTED))
    return lines.filter((l) => l != null).join('\n')
  })
  return cap(`${header}\n\n${parts.join('\n\n')}`, MAX_TOTAL)
}
