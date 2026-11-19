import type { DatabaseSync } from 'node:sqlite'
import type { ReplyDraft, ReplyTarget } from '@shared/types'
import { recentNotes } from '@shared/notes'
import { OutlookError, type LatestMessage, type OutlookReader, type ReplyFind } from '../mail/outlook'
import { includesPerson, peopleOn, splitQuoted, when, type ReplyPerson } from '../mail/plan'
import { MAIL_CHARS, REPLY_CHARS } from '../ai/limits'
import { cleanReply, type ReplyInput } from '../ai/reply'
import type { AiCallLog, AiProvider } from '../ai/provider'
import { AiError } from '../ai/provider'
import { TaskEventService } from './task-events'


interface Target extends ReplyTarget {
  entryId: string
  storeId: string
  thread: string
  conversation: string
  /** Who the task is with: the sender of the email it was created from. The reply goes on the last email that included them. */
  person: ReplyPerson | null
  /** When the app first read mail in this conversation. */
  since: string | null
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * Draft replies to the email a task came from. draft() asks the AI and returns text for the user
 * to check and edit; nothing reaches Outlook until save(), which puts the reply in Outlook Drafts.
 * Nothing is ever sent. The reply is made on the last email, sent or received, that included the
 * person the task is with (the mail app is asked when drafting and saving), so every follow-up the
 * user sent stays in the chain and an internal side discussion without them is only context.
 * Automatic replies (out of office) don't count. Every draft is Reply all on that email, adding no
 * one. When that email is the user's own, the AI writes a follow-up nudge.
 */
export class ReplyService {
  private readonly events: TaskEventService

  constructor(
    private readonly db: DatabaseSync,
    private readonly reader: OutlookReader | null,
    private readonly provider: () => AiProvider,
    private readonly settings: () => { userName: string; replyStyle: string },
    private readonly log: () => AiCallLog,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.events = new TaskEventService(db, now)
  }

  /** The email the task's Reply card answers, or null when the task isn't linked to an Outlook email. */
  target(taskId: number): ReplyTarget | null {
    const t = this.find(taskId)
    if (!t) return null
    const { entryId: _e, storeId: _s, thread: _t, conversation: _c, person: _p, since: _n, ...shown } = t
    return shown
  }

  /** Asks the AI for a draft. With a revision, it rewrites `previous` following the user's note. Saves nothing. */
  async draft(taskId: number, revision: { note: string; previous: string } | null = null): Promise<ReplyDraft> {
    const t = this.require(taskId)
    const live = await this.outlook((r) => r.latest(t.entryId, t.storeId, findFor(t)))
    const recipients = await this.outlook((r) => r.recipients(live.entryId, live.storeId))
    const person = live.fromMe ? people(live.to) || t.from : nameOf(live.from) || t.from
    const task = this.db.prepare('SELECT title, notes FROM work_items WHERE id = ?').get(taskId) as { title: string; notes: string | null }
    const updates = (this.db.prepare(`SELECT summary FROM context_briefs WHERE scope = 'task' AND owner_id = ?`).get(taskId) as { summary: string } | undefined)?.summary ?? ''
    const { userName, replyStyle } = this.settings()
    const input: ReplyInput = {
      userName,
      today: ymd(this.now()),
      style: replyStyle,
      subject: t.subject,
      from: person,
      followUp: live.fromMe ? { to: person, sentAt: ymd(new Date(live.time)) } : null,
      thread: this.withUnread(t, live, userName),
      task: { title: task.title, notes: task.notes?.trim() ? task.notes.trim().slice(0, REPLY_CHARS.notes) : null, updates: recentNotes(updates, REPLY_CHARS.updates) },
      recipients: recipients.replyAll,
      revision: revision ? { note: revision.note.slice(0, REPLY_CHARS.note), previous: revision.previous.slice(0, REPLY_CHARS.previous) } : null,
    }
    const provider = this.provider()
    const { body } = cleanReply(await provider.writeReply(input, this.log()))
    return { body, subject: recipients.subject || `RE: ${t.subject}`, to: recipients.replyAll, writtenBy: provider.label, email: { from: person, at: live.time, followUp: live.fromMe } }
  }

  /** Saves the (possibly edited) reply to the mail app's Drafts, as Reply all, and notes it in the task's Activity. Never sends. */
  async save(taskId: number, reply: { body: string }): Promise<{ entryId: string; storeId: string }> {
    const t = this.require(taskId)
    const body = this.bodyOf(reply)
    const live = await this.outlook((r) => r.latest(t.entryId, t.storeId, findFor(t)))
    const ids = await this.outlook((r) => r.saveReply(live.entryId, live.storeId, true, body), undefined, this.reader?.app === 'apple-mail')
    this.events.record(taskId, [{ kind: 'reply_draft', note: 'Reply all', to: this.appName() }], { by: 'user' })
    return ids
  }

  /** Opens the reply, as Reply all, in a window of the mail app for the user to finish, and notes it in Activity. Never saves or sends it. */
  async open(taskId: number, reply: { body: string }): Promise<void> {
    const t = this.require(taskId)
    const body = this.bodyOf(reply)
    const live = await this.outlook((r) => r.latest(t.entryId, t.storeId, findFor(t)))
    await this.outlook((r) => r.openReply(live.entryId, live.storeId, true, body), undefined, this.reader?.app === 'apple-mail')
    this.events.record(taskId, [{ kind: 'reply_opened', note: 'Reply all', to: this.appName() }], { by: 'user' })
  }

  /** Shows a saved draft in the mail app, so the user can check it and send it themselves (Apple Mail: its Drafts). */
  async openDraft(entryId: string, storeId: string): Promise<void> {
    await this.outlook((r) => r.open(entryId, storeId), `Couldn't find that draft in ${this.appName()}. It may have been sent or deleted.`)
  }

  private bodyOf(reply: { body: string }): string {
    const body = reply.body.trim()
    if (!body) throw new OutlookError('The reply is empty. Write something, or Discard it.')
    return body
  }

  /** "Mail" or "Outlook", as the buttons and Activity say it. */
  private appName(): string {
    return this.reader?.app === 'apple-mail' ? 'Mail' : 'Outlook'
  }

  private require(taskId: number): Target {
    const t = this.find(taskId)
    if (!t) throw new OutlookError('This task is not linked to an Outlook email.')
    if (!this.reader) throw new OutlookError('Draft replies only work with Classic Outlook on Windows.')
    return t
  }

  /** Runs a mail app step. Errors become "couldn't find that email" unless they say something more useful (`keep`: any OutlookError). */
  private async outlook<T>(run: (r: OutlookReader) => Promise<T>, notFound?: string, keep = false): Promise<T> {
    if (!this.reader) throw new OutlookError('Draft replies only work with Classic Outlook on Windows.')
    try {
      return await run(this.reader)
    } catch (err) {
      if (err instanceof OutlookError && (keep || /isn't running|isn't allowed/.test(err.message))) throw err
      notFound ??= `Couldn't find that email in ${this.appName()}. It may have been moved or deleted.`
      if (err instanceof AiError) throw err
      throw new OutlookError(notFound)
    }
  }

  /**
   * The thread the AI reads, plus every email the mail app returned that the app hasn't read yet:
   * the one answered (for example a follow-up the user sent after the last Check) and the side
   * discussion after it.
   */
  private withUnread(t: Target, live: LatestMessage, userName: string): string {
    const known = this.db.prepare(
      `SELECT 1 FROM mail_messages WHERE conversation_id = ? AND (entry_id = ? OR ABS(julianday(sent_at) - julianday(?)) * 86400 < 60) LIMIT 1`,
    )
    const unread = [live, ...live.after].filter((m) => !known.get(t.conversation, m.entryId, m.time)).sort((a, b) => a.time.localeCompare(b.time))
    if (unread.length === 0) return t.thread
    const blocks = unread.map((m) => {
      const text = splitQuoted(m.body).text || '(no text)'
      return [
        `=== Message not read by the app before · ${m.fromMe ? `sent by ${userName}` : 'received'} · ${when(m.time)}`,
        `From: ${m.fromMe ? `${userName} (you)` : m.from}`,
        m.to ? `To: ${m.to}` : null,
        m.cc ? `Cc: ${m.cc}` : null,
        `Subject: ${m.subject}`,
        '',
        text.length > MAIL_CHARS.message ? `${text.slice(0, MAIL_CHARS.message).trimEnd()}\n[…cut]` : text,
      ]
        .filter((l) => l != null)
        .join('\n')
    })
    return `${t.thread}\n\n${blocks.join('\n\n')}`
  }

  /**
   * The newest linked mail conversation, who the task is with, and the email the card shows until
   * the mail app is asked: the newest the app has read that included that person, across every
   * import of the conversation. draft() and save() then ask the mail app.
   */
  private find(taskId: number): Target | null {
    const source = this.db
      .prepare(
        `SELECT s.id, s.title, s.content, s.from_name, s.external_id FROM task_sources ts JOIN source_items s ON s.id = ts.source_id
         WHERE ts.work_item_id = ? AND s.kind = 'email' AND s.mail_meta IS NOT NULL ORDER BY s.occurred_at DESC, s.id DESC LIMIT 1`,
      )
      .get(taskId) as { id: number; title: string; content: string; from_name: string | null; external_id: string | null } | undefined
    if (!source) return null
    const conversation = source.external_id ?? ''
    const msg = this.db
      .prepare(
        `SELECT entry_id, store_id, sent_at, direction, source_id FROM mail_messages WHERE (conversation_id = ? OR source_id = ?) AND entry_id IS NOT NULL
         ORDER BY sent_at DESC LIMIT 1`,
      )
      .get(conversation, source.id) as { entry_id: string; store_id: string | null; sent_at: string; direction: string; source_id: number | null } | undefined
    if (!msg) return null
    const imports = (
      this.db
        .prepare(`SELECT content FROM source_items WHERE kind = 'email' AND mail_meta IS NOT NULL AND (external_id = ? OR id = ?) ORDER BY occurred_at, id`)
        .all(conversation, source.id) as { content: string }[]
    ).map((r) => r.content)
    // Who the task is with: the sender of the email it was created from (its first linked import of this conversation).
    const first = this.db
      .prepare(
        `SELECT s.content FROM task_sources ts JOIN source_items s ON s.id = ts.source_id
         WHERE ts.work_item_id = ? AND s.kind = 'email' AND s.mail_meta IS NOT NULL AND (s.external_id = ? OR s.id = ?) ORDER BY s.occurred_at, s.id LIMIT 1`,
      )
      .get(taskId, conversation, source.id) as { content: string } | undefined
    const person = replyPersonOf(first?.content ?? source.content)
    const since = (this.db.prepare('SELECT MIN(sent_at) AS since FROM mail_messages WHERE conversation_id = ? OR source_id = ?').get(conversation, source.id) as { since: string | null }).since
    const saved = imports.flatMap(messagesOf)
    const newest = saved.at(-1)
    const shown = (person && saved.findLast((m) => includesPerson(peopleOn(m), person))) || newest
    const followUp = shown ? shown.fromMe : msg.direction === 'sent'
    const who = shown ? (shown.fromMe ? people(shown.to) : shown.from) : null
    return {
      sourceId: source.id,
      subject: source.title,
      from: who || senderOf(source.content) || source.from_name || 'them',
      // The newest saved message is the newest one read, whose exact time is known; an older one's time comes from its saved text.
      at: shown && shown !== newest && shown.time ? shown.time : msg.sent_at,
      followUp,
      supported: this.reader != null,
      app: this.reader?.app ?? null,
      entryId: msg.entry_id,
      storeId: msg.store_id ?? '',
      thread: imports.join('\n\n'),
      conversation,
      person,
      since,
    }
  }
}

const findFor = (t: Target): ReplyFind => ({ person: t.person, since: t.since })

/** "Dana Lee" from "Dana Lee <dana@example.com>" or "'Dana Lee'". */
const nameOf = (s: string) => s.replace(/\s*<[^>]*>$/, '').trim().replace(/^'|'$/g, '')

/** "Dana Lee and Priya Shah", "Dana Lee, Priya Shah and 2 more": who an email went to, from Outlook's "A; B" list. */
export function people(list: string): string {
  const names = list.split(';').map(nameOf).filter(Boolean)
  if (names.length <= 2) return names.join(' and ')
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
}

/** One message of a conversation text the mail import saved. */
export interface SavedMessage {
  /** The sender's name ("Dana Lee"); the user's own messages give the user's name. */
  from: string
  fromEmail: string
  fromMe: boolean
  /** Names as Outlook shows them: "A; B". */
  to: string
  cc: string
  /** ISO time, to the minute, from the message's header line; null if it can't be read. */
  time: string | null
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** The time in a saved message's header line ("=== Message 2 of 3 · received · Thu, Nov 5, 2026, 2:00 PM"), as written by `when`. */
function timeOf(head: string): string | null {
  const m = /\b([A-Z][a-z]{2}) (\d{1,2}), (\d{4}),?\s+(\d{1,2}):(\d{2})\s*([AP]M)/.exec(head)
  const month = m ? MONTHS.indexOf(m[1]!.toLowerCase()) : -1
  if (!m || month < 0) return null
  const hour = (Number(m[4]) % 12) + (m[6] === 'PM' ? 12 : 0)
  return new Date(Number(m[3]), month, Number(m[2]), hour, Number(m[5])).toISOString()
}

/** Every message in a conversation text the mail import saved, oldest first: who wrote it (the user's own say "(you)"), to and cc, and when. */
export function messagesOf(content: string): SavedMessage[] {
  return content
    .split(/^=== /m)
    .slice(1)
    .map((block) => {
      const [head = '', ...rest] = block.split('\n')
      const end = rest.findIndex((l) => l.trim() === '')
      const header = end < 0 ? rest : rest.slice(0, end)
      const field = (k: string) => header.find((l) => l.startsWith(`${k}: `))?.slice(k.length + 2).trim() ?? ''
      const raw = field('From')
      const from = raw.replace(/\s*\(you\)$/, '')
      return { from: nameOf(from), fromEmail: /<([^>]+)>$/.exec(from)?.[1]?.trim() ?? '', fromMe: raw.endsWith('(you)'), to: field('To'), cc: field('Cc'), time: timeOf(head) }
    })
}

/** The newest message in a saved conversation text: who wrote it (the user's own say "(you)") and who it went to. */
export function lastMessageOf(content: string): { from: string; to: string; fromMe: boolean } | null {
  const last = messagesOf(content).at(-1)
  return last ? { from: last.from, to: last.to, fromMe: last.fromMe } : null
}

/** Who a task from this saved conversation is with: the sender of its newest message from someone else, with their address. */
export function replyPersonOf(content: string): ReplyPerson | null {
  const m = messagesOf(content).findLast((x) => !x.fromMe && (x.from || x.fromEmail))
  return m ? { name: m.from, email: m.fromEmail } : null
}

/** The name on the newest message from someone else, from the thread text the mail import saved ("From: Dana Lee <dana@…>"). */
export function senderOf(content: string): string | null {
  const froms = [...content.matchAll(/^From: (.+)$/gm)].map((m) => m[1]!.trim()).filter((f) => !f.endsWith('(you)'))
  const last = froms.at(-1)
  return last ? last.replace(/\s*<[^>]*>$/, '').trim() || null : null
}
