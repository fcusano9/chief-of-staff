import type { DatabaseSync } from 'node:sqlite'
import type { ReplyDraft, ReplyTarget } from '@shared/types'
import { recentNotes } from '@shared/notes'
import { OutlookError, type LatestMessage, type OutlookReader } from '../mail/outlook'
import { splitQuoted, when } from '../mail/plan'
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
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * Draft replies to the email a task came from. draft() asks the AI and returns text for the user
 * to check and edit; nothing reaches Outlook until save(), which puts the reply in Outlook Drafts.
 * Nothing is ever sent. The reply is always made on the newest email in the conversation, sent or
 * received (Outlook is asked when drafting and saving), so every follow-up the user sent stays in
 * the chain. When that email is the user's own, the AI writes a follow-up nudge.
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
    const { entryId: _e, storeId: _s, thread: _t, conversation: _c, ...shown } = t
    return shown
  }

  /** Asks the AI for a draft. With a revision, it rewrites `previous` following the user's note. Saves nothing. */
  async draft(taskId: number, revision: { note: string; previous: string } | null = null): Promise<ReplyDraft> {
    const t = this.require(taskId)
    const live = await this.outlook((r) => r.latest(t.entryId, t.storeId))
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
      thread: this.withLatest(t, live, userName),
      task: { title: task.title, notes: task.notes?.trim() ? task.notes.trim().slice(0, REPLY_CHARS.notes) : null, updates: recentNotes(updates, REPLY_CHARS.updates) },
      recipients: { reply: recipients.reply, replyAll: recipients.replyAll },
      revision: revision ? { note: revision.note.slice(0, REPLY_CHARS.note), previous: revision.previous.slice(0, REPLY_CHARS.previous) } : null,
    }
    const provider = this.provider()
    const { replyAll, body } = cleanReply(await provider.writeReply(input, this.log()))
    return { replyAll, body, subject: recipients.subject || `RE: ${t.subject}`, reply: recipients.reply, replyAllTo: recipients.replyAll, writtenBy: provider.label, email: { from: person, at: live.time, followUp: live.fromMe } }
  }

  /** Saves the (possibly edited) reply to the mail app's Drafts and notes it in the task's Activity. Never sends. */
  async save(taskId: number, reply: { replyAll: boolean; body: string }): Promise<{ entryId: string; storeId: string }> {
    const t = this.require(taskId)
    const body = this.bodyOf(reply)
    const live = await this.outlook((r) => r.latest(t.entryId, t.storeId))
    const ids = await this.outlook((r) => r.saveReply(live.entryId, live.storeId, reply.replyAll, body), undefined, this.reader?.app === 'apple-mail')
    this.events.record(taskId, [{ kind: 'reply_draft', note: reply.replyAll ? 'Reply all' : 'Reply', to: this.appName() }], { by: 'user' })
    return ids
  }

  /** Opens the reply in a window of the mail app for the user to finish, and notes it in Activity. Never saves or sends it. */
  async open(taskId: number, reply: { replyAll: boolean; body: string }): Promise<void> {
    const t = this.require(taskId)
    const body = this.bodyOf(reply)
    const live = await this.outlook((r) => r.latest(t.entryId, t.storeId))
    await this.outlook((r) => r.openReply(live.entryId, live.storeId, reply.replyAll, body), undefined, this.reader?.app === 'apple-mail')
    this.events.record(taskId, [{ kind: 'reply_opened', note: reply.replyAll ? 'Reply all' : 'Reply', to: this.appName() }], { by: 'user' })
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
   * The thread the AI reads, plus the newest email when the app hasn't read it yet (for example a
   * follow-up the user sent after the last Check Outlook).
   */
  private withLatest(t: Target, live: LatestMessage, userName: string): string {
    const known = this.db
      .prepare(
        `SELECT 1 FROM mail_messages WHERE conversation_id = ? AND (entry_id = ? OR ABS(julianday(sent_at) - julianday(?)) * 86400 < 60) LIMIT 1`,
      )
      .get(t.conversation, live.entryId, live.time)
    if (known) return t.thread
    const text = splitQuoted(live.body).text || '(no text)'
    const block = [
      `=== Newest message, not read by the app before · ${live.fromMe ? `sent by ${userName}` : 'received'} · ${when(live.time)}`,
      `From: ${live.fromMe ? `${userName} (you)` : live.from}`,
      live.to ? `To: ${live.to}` : null,
      live.cc ? `Cc: ${live.cc}` : null,
      `Subject: ${live.subject}`,
      '',
      text.length > MAIL_CHARS.message ? `${text.slice(0, MAIL_CHARS.message).trimEnd()}\n[…cut]` : text,
    ]
    return `${t.thread}\n\n${block.filter((l) => l != null).join('\n')}`
  }

  /**
   * The newest linked Outlook conversation and the newest email the app has read in it, sent or
   * received, across every import of that conversation. draft() and save() then ask Outlook for
   * anything newer.
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
    const holder = msg.source_id == null ? source.content : ((this.db.prepare('SELECT content FROM source_items WHERE id = ?').get(msg.source_id) as { content: string } | undefined)?.content ?? source.content)
    const last = lastMessageOf(holder)
    const followUp = msg.direction === 'sent' || last?.fromMe === true
    const person = followUp ? people(last?.to ?? '') : last && !last.fromMe ? last.from : null
    return {
      sourceId: source.id,
      subject: source.title,
      from: person || senderOf(source.content) || source.from_name || 'them',
      at: msg.sent_at,
      followUp,
      supported: this.reader != null,
      app: this.reader?.app ?? null,
      entryId: msg.entry_id,
      storeId: msg.store_id ?? '',
      thread: imports.join('\n\n'),
      conversation,
    }
  }
}

/** "Dana Lee" from "Dana Lee <dana@example.com>" or "'Dana Lee'". */
const nameOf = (s: string) => s.replace(/\s*<[^>]*>$/, '').trim().replace(/^'|'$/g, '')

/** "Dana Lee and Priya Shah", "Dana Lee, Priya Shah and 2 more": who an email went to, from Outlook's "A; B" list. */
export function people(list: string): string {
  const names = list.split(';').map(nameOf).filter(Boolean)
  if (names.length <= 2) return names.join(' and ')
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
}

/** The newest message in a saved conversation text: who wrote it (the user's own say "(you)") and who it went to. */
export function lastMessageOf(content: string): { from: string; to: string; fromMe: boolean } | null {
  const blocks = content.split(/^=== /m).slice(1)
  const block = blocks.at(-1)
  if (!block) return null
  const from = /^From: (.+)$/m.exec(block)?.[1]?.trim() ?? ''
  const to = /^To: (.+)$/m.exec(block)?.[1]?.trim() ?? ''
  return { from: nameOf(from.replace(/\s*\(you\)$/, '')), to, fromMe: from.endsWith('(you)') }
}

/** The name on the newest message from someone else, from the thread text the mail import saved ("From: Dana Lee <dana@…>"). */
export function senderOf(content: string): string | null {
  const froms = [...content.matchAll(/^From: (.+)$/gm)].map((m) => m[1]!.trim()).filter((f) => !f.endsWith('(you)'))
  const last = froms.at(-1)
  return last ? last.replace(/\s*<[^>]*>$/, '').trim() || null : null
}
