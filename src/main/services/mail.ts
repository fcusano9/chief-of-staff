import type { DatabaseSync } from 'node:sqlite'
import type { MailCheck, MailImportRun, MailInfo, MailJobStatus } from '@shared/types'
import { nowIso, transaction } from '../db'
import { OutlookError, type OutlookReader } from '../mail/outlook'
import { conversationContent, planMailbox, type PlannedConversation } from '../mail/plan'
import { contentHash, type MailMeta, type SourceService } from './sources'

const FIRST_RUN_DAYS = 7

interface PendingCheck {
  check: MailCheck
  conversations: Map<string, PlannedConversation>
}

/**
 * Outlook mail import, in two steps. check() only looks at Outlook and reports what it found;
 * read() sends the chosen conversations to the AI one at a time, in the background, while the
 * UI polls status(). Each conversation becomes an import (source) whose suggestions go to Review.
 */
export class MailService {
  private pending: PendingCheck | null = null
  private nextCheckId = 1
  private job: MailJobStatus = { state: 'idle', done: 0, total: 0, suggestions: 0, failed: 0, estimatedCost: null, current: null }
  private stopRequested = false

  constructor(
    private readonly db: DatabaseSync,
    private readonly sources: SourceService,
    private readonly reader: OutlookReader | null,
    private readonly userName: () => string,
    private readonly providerLabel: () => string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  info(): MailInfo {
    const last = this.db.prepare('SELECT checked_at FROM mail_imports WHERE complete = 1 ORDER BY checked_at DESC LIMIT 1').get() as { checked_at: string } | undefined
    const firstRun = new Date(this.now().getTime() - FIRST_RUN_DAYS * 86_400_000).toISOString()
    return { supported: this.reader != null, defaultSince: last?.checked_at ?? firstRun, lastImportAt: last?.checked_at ?? null }
  }

  /** Looks through Outlook for mail since `since` (ISO). Nothing is sent to the AI. */
  async check(since: string): Promise<MailCheck> {
    if (!this.reader) throw new OutlookError('Reading Outlook needs classic Outlook on Windows.')
    if (this.job.state === 'reading') throw new OutlookError('Mail is still being read. Wait for it to finish, or stop it.')
    const from = new Date(since)
    if (Number.isNaN(from.getTime())) throw new OutlookError('Pick a valid date to read mail from.')
    const checkedAt = this.now().toISOString()
    const box = await this.reader.list(from)
    const read = this.db.prepare('SELECT 1 FROM mail_messages WHERE message_key = ?')
    const plan = planMailbox(box, from, (key) => read.get(key) != null)
    const check: MailCheck = {
      id: this.nextCheckId++,
      since: from.toISOString(),
      checkedAt,
      received: plan.received,
      sent: plan.sent,
      alreadyRead: plan.alreadyRead,
      conversations: plan.conversations.map((c) => ({ key: c.key, subject: c.subject, people: c.people, messageCount: c.messages.length, lastAt: c.lastAt, skipReason: c.skipReason })),
    }
    this.pending = { check, conversations: new Map(plan.conversations.map((c) => [c.key, c])) }
    this.job = { state: 'idle', done: 0, total: 0, suggestions: 0, failed: 0, estimatedCost: null, current: null }
    return check
  }

  /**
   * Starts reading the chosen conversations from the last check (skipped ones only if chosen).
   * Returns at once; progress is in status(). A finished run moves the default start of the next check.
   */
  read(checkId: number, keys: string[]): MailJobStatus {
    const pending = this.pending
    if (!pending || pending.check.id !== checkId) throw new OutlookError('That check is out of date. Check Outlook again.')
    if (this.job.state === 'reading') throw new OutlookError('Mail is already being read.')
    const chosen = keys.map((k) => pending.conversations.get(k)).filter((c): c is PlannedConversation => c != null)
    if (chosen.length === 0) throw new OutlookError('There is nothing to read.')
    this.pending = null

    const importId = Number(
      this.db
        .prepare('INSERT INTO mail_imports (since, checked_at, started_at, provider) VALUES (?, ?, ?, ?)')
        .run(pending.check.since, pending.check.checkedAt, nowIso(), this.providerLabel()).lastInsertRowid,
    )
    this.stopRequested = false
    this.job = { state: 'reading', done: 0, total: chosen.length, suggestions: 0, failed: 0, estimatedCost: null, current: chosen[0]!.subject }
    void this.run(importId, chosen)
    return { ...this.job }
  }

  status(): MailJobStatus {
    return { ...this.job }
  }

  /** Stops after the conversation being read. What's left is offered again next time. */
  stop(): void {
    if (this.job.state === 'reading') this.stopRequested = true
  }

  imports(limit = 10): MailImportRun[] {
    const rows = this.db.prepare('SELECT * FROM mail_imports ORDER BY started_at DESC, id DESC LIMIT ?').all(limit) as Record<string, unknown>[]
    return rows
      .map((r) => ({
        id: Number(r.id),
        since: String(r.since),
        startedAt: String(r.started_at),
        finishedAt: (r.finished_at as string) ?? null,
        provider: (r.provider as string) ?? null,
        complete: Number(r.complete) === 1,
        conversations: this.sources.forMailImport(Number(r.id)),
      }))
      .filter((r) => r.conversations.length > 0 || r.finishedAt == null)
  }

  /** Shows the newest message of an imported conversation in Outlook. */
  async open(sourceId: number): Promise<void> {
    const meta = this.sources.mailMeta(sourceId)
    if (!meta) throw new OutlookError('That import is not from Outlook.')
    if (!this.reader) throw new OutlookError('Opening mail needs classic Outlook on Windows.')
    try {
      await this.reader.open(meta.entryId, meta.storeId)
    } catch (err) {
      throw err instanceof OutlookError && /isn't running/.test(err.message)
        ? err
        : new OutlookError("Couldn't find that email in Outlook. It may have been moved or deleted.")
    }
  }

  private async run(importId: number, chosen: PlannedConversation[]): Promise<void> {
    try {
      for (const c of chosen) {
        if (this.stopRequested) break
        this.job.current = c.subject
        try {
          const result = await this.sources.extract(this.save(importId, c))
          this.job.suggestions += result.suggestionsCreated
          if (result.source.estimatedCost != null) this.job.estimatedCost = (this.job.estimatedCost ?? 0) + result.source.estimatedCost
          if (result.error) this.job.failed++
        } catch {
          this.job.failed++
        }
        this.job.done++
      }
    } finally {
      const complete = this.job.done === this.job.total
      this.db.prepare('UPDATE mail_imports SET finished_at = ?, complete = ? WHERE id = ?').run(nowIso(), complete ? 1 : 0, importId)
      this.job = { ...this.job, state: complete ? 'done' : 'stopped', current: null }
    }
  }

  /** Saves a conversation as an import and marks its messages read, so they're never read twice. */
  private save(importId: number, c: PlannedConversation): number {
    const latest = c.messages.at(-1)!
    const meta: MailMeta = {
      conversationId: c.key,
      entryId: latest.entryId,
      storeId: latest.storeId,
      messageCount: c.messages.length,
      people: c.people,
      lastFromMe: c.lastFromMe,
      lastSentByMeAt: c.lastSentByMeAt,
    }
    const content = conversationContent(c, this.userName())
    return transaction(this.db, () => {
      const id = Number(
        this.db
          .prepare(
            `INSERT INTO source_items (kind, title, from_name, occurred_at, content, content_hash, external_id, imported_at, mail_import_id, mail_meta)
             VALUES ('email', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(c.subject.slice(0, 200), c.people || null, latest.time, content, contentHash(`outlook ${c.messages.map((m) => m.key).join(' ')}`), c.key, nowIso(), importId, JSON.stringify(meta))
          .lastInsertRowid,
      )
      const mark = this.db.prepare(
        'INSERT OR REPLACE INTO mail_messages (message_key, conversation_id, source_id, direction, sent_at, entry_id, store_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      for (const m of c.messages) mark.run(m.key, c.key, id, m.direction, m.time, m.entryId, m.storeId)
      return id
    })
  }
}
