import type { DatabaseSync } from 'node:sqlite'
import type { ReplyDraft, ReplyTarget } from '@shared/types'
import { recentNotes } from '@shared/notes'
import { OutlookError, type OutlookReader } from '../mail/outlook'
import { REPLY_CHARS } from '../ai/limits'
import { cleanReply, type ReplyInput } from '../ai/reply'
import type { AiCallLog, AiProvider } from '../ai/provider'
import { AiError } from '../ai/provider'
import { TaskEventService } from './task-events'


interface Target extends ReplyTarget {
  entryId: string
  storeId: string
  thread: string
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * Draft replies to the email a task came from. draft() asks the AI and returns text for the user
 * to check and edit; nothing reaches Outlook until save(), which puts the reply in Outlook Drafts.
 * Nothing is ever sent.
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
    const { entryId: _e, storeId: _s, thread: _t, ...shown } = t
    return shown
  }

  /** Asks the AI for a draft. With a revision, it rewrites `previous` following the user's note. Saves nothing. */
  async draft(taskId: number, revision: { note: string; previous: string } | null = null): Promise<ReplyDraft> {
    const t = this.require(taskId)
    const recipients = await this.outlook((r) => r.recipients(t.entryId, t.storeId))
    const task = this.db.prepare('SELECT title, notes FROM work_items WHERE id = ?').get(taskId) as { title: string; notes: string | null }
    const updates = (this.db.prepare(`SELECT summary FROM context_briefs WHERE scope = 'task' AND owner_id = ?`).get(taskId) as { summary: string } | undefined)?.summary ?? ''
    const { userName, replyStyle } = this.settings()
    const input: ReplyInput = {
      userName,
      today: ymd(this.now()),
      style: replyStyle,
      subject: t.subject,
      from: t.from,
      thread: t.thread,
      task: { title: task.title, notes: task.notes?.trim() ? task.notes.trim().slice(0, REPLY_CHARS.notes) : null, updates: recentNotes(updates, REPLY_CHARS.updates) },
      recipients: { reply: recipients.reply, replyAll: recipients.replyAll },
      revision: revision ? { note: revision.note.slice(0, REPLY_CHARS.note), previous: revision.previous.slice(0, REPLY_CHARS.previous) } : null,
    }
    const provider = this.provider()
    const { replyAll, body } = cleanReply(await provider.writeReply(input, this.log()))
    return { replyAll, body, subject: recipients.subject || `RE: ${t.subject}`, reply: recipients.reply, replyAllTo: recipients.replyAll, writtenBy: provider.label }
  }

  /** Saves the (possibly edited) reply to Outlook Drafts and notes it in the task's Activity. Never sends. */
  async save(taskId: number, reply: { replyAll: boolean; body: string }): Promise<{ entryId: string; storeId: string }> {
    const t = this.require(taskId)
    const body = reply.body.trim()
    if (!body) throw new OutlookError('The reply is empty. Write something, or Discard it.')
    const ids = await this.outlook((r) => r.saveReply(t.entryId, t.storeId, reply.replyAll, body))
    this.events.record(taskId, [{ kind: 'reply_draft', note: reply.replyAll ? 'Reply all' : 'Reply' }], { by: 'user' })
    return ids
  }

  /** Shows a saved draft in Outlook, so the user can check it and send it themselves. */
  async openDraft(entryId: string, storeId: string): Promise<void> {
    await this.outlook((r) => r.open(entryId, storeId), "Couldn't find that draft in Outlook. It may have been sent or deleted.")
  }

  private require(taskId: number): Target {
    const t = this.find(taskId)
    if (!t) throw new OutlookError('This task is not linked to an Outlook email.')
    if (!this.reader) throw new OutlookError('Draft replies only work with Classic Outlook on Windows.')
    return t
  }

  private async outlook<T>(run: (r: OutlookReader) => Promise<T>, notFound = "Couldn't find that email in Outlook. It may have been moved or deleted."): Promise<T> {
    if (!this.reader) throw new OutlookError('Draft replies only work with Classic Outlook on Windows.')
    try {
      return await run(this.reader)
    } catch (err) {
      if (err instanceof OutlookError && /isn't running/.test(err.message)) throw err
      if (err instanceof AiError) throw err
      throw new OutlookError(notFound)
    }
  }

  /** The newest linked Outlook conversation, and in it the newest message from someone else. */
  private find(taskId: number): Target | null {
    const source = this.db
      .prepare(
        `SELECT s.id, s.title, s.content, s.from_name FROM task_sources ts JOIN source_items s ON s.id = ts.source_id
         WHERE ts.work_item_id = ? AND s.kind = 'email' AND s.mail_meta IS NOT NULL ORDER BY s.occurred_at DESC, s.id DESC LIMIT 1`,
      )
      .get(taskId) as { id: number; title: string; content: string; from_name: string | null } | undefined
    if (!source) return null
    const msg = this.db
      .prepare(
        `SELECT entry_id, store_id, sent_at FROM mail_messages WHERE source_id = ? AND direction = 'received' AND entry_id IS NOT NULL
         ORDER BY sent_at DESC LIMIT 1`,
      )
      .get(source.id) as { entry_id: string; store_id: string; sent_at: string } | undefined
    if (!msg) return null
    return {
      sourceId: source.id,
      subject: source.title,
      from: senderOf(source.content) ?? source.from_name ?? 'them',
      at: msg.sent_at,
      supported: this.reader != null,
      entryId: msg.entry_id,
      storeId: msg.store_id ?? '',
      thread: source.content,
    }
  }
}

/** The name on the newest message from someone else, from the thread text the mail import saved ("From: Dana Lee <dana@…>"). */
export function senderOf(content: string): string | null {
  const froms = [...content.matchAll(/^From: (.+)$/gm)].map((m) => m[1]!.trim()).filter((f) => !f.endsWith('(you)'))
  const last = froms.at(-1)
  return last ? last.replace(/\s*<[^>]*>$/, '').trim() || null : null
}
