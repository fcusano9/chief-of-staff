import type { DatabaseSync } from 'node:sqlite'
import type { BriefScope, SourceKind, Suggestion, SuggestionKind, SuggestionPayload } from '@shared/types'
import { nowIso, transaction } from '../db'
import type { BriefService } from './directory'
import type { TaskService } from './tasks'

function toSuggestion(r: Record<string, unknown>): Suggestion {
  return {
    id: Number(r.id),
    kind: r.kind as SuggestionKind,
    status: r.status as Suggestion['status'],
    payload: JSON.parse(String(r.payload)) as SuggestionPayload,
    evidence: String(r.evidence),
    createdAt: String(r.created_at),
    source: { id: Number(r.source_id), kind: r.source_kind as SourceKind, title: String(r.source_title), occurredAt: String(r.source_occurred_at) },
    taskTitle: (r.task_title as string) ?? null,
  }
}

/**
 * The review queue. AI suggestions wait here until the user accepts (optionally after editing)
 * or rejects them. Nothing in the task list changes until a suggestion is accepted.
 */
export class SuggestionService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly tasks: TaskService,
    private readonly briefs: BriefService,
  ) {}

  listPending(): Suggestion[] {
    const rows = this.db
      .prepare(
        `SELECT g.*, s.kind AS source_kind, s.title AS source_title, s.occurred_at AS source_occurred_at, w.title AS task_title
         FROM suggestions g JOIN source_items s ON s.id = g.source_id
         LEFT JOIN work_items w ON w.id = json_extract(g.payload, '$.taskId')
         WHERE g.status = 'pending' ORDER BY s.imported_at DESC, s.id DESC, g.id`,
      )
      .all() as Record<string, unknown>[]
    return rows.map(toSuggestion)
  }

  pendingCount(): number {
    return Number((this.db.prepare(`SELECT COUNT(*) AS n FROM suggestions WHERE status = 'pending'`).get() as { n: number }).n)
  }

  reject(id: number): void {
    this.db.prepare(`UPDATE suggestions SET status = 'rejected', decided_at = ? WHERE id = ? AND status = 'pending'`).run(nowIso(), id)
  }

  /**
   * Applies a suggestion, with any edits the user made, and records it as accepted.
   * Returns the id of the task it created or changed (null for project/person brief updates).
   */
  accept(id: number, edits: Partial<SuggestionPayload> = {}): number | null {
    const row = this.db.prepare(`SELECT * FROM suggestions WHERE id = ? AND status = 'pending'`).get(id) as Record<string, unknown> | undefined
    if (!row) throw new Error('That suggestion was already handled.')
    const kind = row.kind as SuggestionKind
    const p: SuggestionPayload = { ...(JSON.parse(String(row.payload)) as SuggestionPayload), ...edits }
    const sourceId = Number(row.source_id)
    const sourceTitle = String((this.db.prepare('SELECT title FROM source_items WHERE id = ?').get(sourceId) as { title: string }).title)

    return transaction(this.db, () => {
      let taskId: number | null = null
      switch (kind) {
        case 'new_task':
          taskId = this.createTask(p, 'open')
          break
        case 'waiting_on':
          if (p.taskId) {
            const task = this.requireTask(p.taskId)
            this.tasks.save({ ...task, status: 'waiting_on', waitingOn: p.waitingOn || task.waitingOn || 'someone' })
            taskId = task.id
          } else {
            taskId = this.createTask(p, 'waiting_on')
          }
          break
        case 'status_update': {
          const task = this.requireTask(p.taskId)
          this.addUpdate(task.id, p.details)
          if (p.dueDate && p.dueDate !== task.dueDate) this.tasks.save({ ...this.requireTask(task.id), dueDate: p.dueDate })
          taskId = task.id
          break
        }
        case 'mark_done': {
          const task = this.requireTask(p.taskId)
          if (p.details) this.addUpdate(task.id, p.details)
          this.tasks.save({ ...this.requireTask(task.id), status: 'done' })
          taskId = task.id
          break
        }
        case 'brief_update':
          this.appendBrief(p.briefScope, p.briefOwnerId, p.details, sourceTitle)
          taskId = p.briefScope === 'task' ? p.briefOwnerId : null
          break
      }
      if (taskId) this.db.prepare('INSERT OR IGNORE INTO task_sources (work_item_id, source_id) VALUES (?, ?)').run(taskId, sourceId)
      this.db
        .prepare(`UPDATE suggestions SET status = 'accepted', decided_at = ?, result_task_id = ?, payload = ? WHERE id = ?`)
        .run(nowIso(), taskId, JSON.stringify(p), id)
      return taskId
    })
  }

  private requireTask(id: number | null) {
    const task = id ? this.tasks.get(id) : null
    if (!task) throw new Error('The task this suggestion refers to no longer exists.')
    return task
  }

  private createTask(p: SuggestionPayload, status: 'open' | 'waiting_on'): number {
    const title = p.title.trim()
    if (!title) throw new Error('A new task needs a title.')
    return this.tasks.save({
      id: 0,
      title,
      notes: p.details || null,
      status,
      dueDate: p.dueDate,
      projectId: p.projectId,
      requesterId: p.requesterId,
      priorityOverride: null,
      followUpCount: 0,
      waitingOn: status === 'waiting_on' ? p.waitingOn || 'someone' : null,
      subtasks: [],
    }).id
  }

  private addUpdate(taskId: number, text: string): void {
    if (!text.trim()) return
    const now = nowIso()
    this.db.prepare('INSERT INTO status_updates (work_item_id, text, is_ai_generated, created_at) VALUES (?, ?, 1, ?)').run(taskId, text.trim(), now)
    this.db.prepare('UPDATE work_items SET last_activity_at = ? WHERE id = ?').run(now, taskId)
  }

  private appendBrief(scope: BriefScope | null, ownerId: number | null, text: string, sourceTitle: string): void {
    if (!scope || !ownerId || !text.trim()) throw new Error('This brief update is missing what it applies to.')
    const brief = this.briefs.get(scope, ownerId)
    const stamp = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    const line = `${stamp}: ${text.trim()} (from “${sourceTitle}”)`
    this.briefs.save({ ...brief, summary: brief.summary.trim() ? `${brief.summary.trim()}\n${line}` : line })
  }
}
