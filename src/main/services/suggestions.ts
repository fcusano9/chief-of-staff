import type { DatabaseSync } from 'node:sqlite'
import { PROJECT_COLORS, type BriefScope, type SourceKind, type Suggestion, type SuggestionKind, type SuggestionPayload, type TaskStatus } from '@shared/types'
import { nowIso, transaction } from '../db'
import type { BriefService, PersonService, ProjectService } from './directory'
import type { TaskService } from './tasks'

function toSuggestion(r: Record<string, unknown>): Suggestion {
  return {
    id: Number(r.id),
    kind: r.kind as SuggestionKind,
    status: r.status as Suggestion['status'],
    payload: JSON.parse(String(r.payload)) as SuggestionPayload,
    evidence: String(r.evidence),
    createdAt: String(r.created_at),
    source: {
      id: Number(r.source_id),
      kind: r.source_kind as SourceKind,
      title: String(r.source_title),
      occurredAt: String(r.source_occurred_at),
      fromOutlook: Number(r.source_from_outlook) === 1,
    },
    taskTitle: (r.task_title as string) ?? null,
    taskStatus: (r.task_status as TaskStatus) ?? null,
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
    private readonly projects: ProjectService,
    private readonly people: PersonService,
  ) {}

  listPending(): Suggestion[] {
    const rows = this.db
      .prepare(
        `SELECT g.*, s.kind AS source_kind, s.title AS source_title, s.occurred_at AS source_occurred_at, s.mail_meta IS NOT NULL AS source_from_outlook,
                w.title AS task_title, w.status AS task_status
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
    transaction(this.db, () => {
      const changed = this.db.prepare(`UPDATE suggestions SET status = 'rejected', decided_at = ? WHERE id = ? AND status = 'pending'`).run(nowIso(), id).changes
      // Tasks that linked to a rejected new project or person just lose the link.
      if (changed) this.relink(id, { projectSuggestionId: null }, { requesterSuggestionId: null }, { waitingOnSuggestionId: null })
    })
  }

  /**
   * Applies a suggestion, with any edits the user made, and records it as accepted.
   * Returns the id of the task it created or changed (null for projects, people and their briefs).
   * A task linked to a new project or person from the same import creates that too.
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
      let refId: number | null = null
      if (kind === 'new_task' || kind === 'needs_reply' || (kind === 'waiting_on' && !p.taskId)) {
        if (!p.projectId && p.projectSuggestionId) p.projectId = this.createdBy(p.projectSuggestionId)
        if (!p.requesterId && p.requesterSuggestionId) p.requesterId = this.createdBy(p.requesterSuggestionId)
        if (p.waitingOnSuggestionId) this.createdBy(p.waitingOnSuggestionId)
        p.projectSuggestionId = p.requesterSuggestionId = p.waitingOnSuggestionId = null
      }
      switch (kind) {
        case 'new_project': {
          const name = p.title.trim()
          if (!name) throw new Error('A new project needs a name.')
          const existing = this.projects.list().find((x) => x.name.toLowerCase() === name.toLowerCase())
          const project = existing ?? this.projects.save({ id: 0, name, color: p.color || PROJECT_COLORS[0]!, status: 'active' })
          if (p.details.trim()) this.appendBrief('project', project.id, p.details, sourceTitle)
          refId = project.id
          this.relink(id, { projectSuggestionId: null, projectId: project.id })
          break
        }
        case 'new_person': {
          const name = p.title.trim()
          if (!name) throw new Error('A new person needs a name.')
          const existing = this.people.list().find((x) => x.name.toLowerCase() === name.toLowerCase())
          // New people start at 3 stars; the AI never guesses how much their requests matter.
          const person = existing ?? this.people.save({ id: 0, name, role: p.role ?? null, company: p.company ?? null, email: p.email ?? null, priorityWeight: 3 })
          if (p.details.trim()) this.appendBrief('person', person.id, p.details, sourceTitle)
          refId = person.id
          this.relink(id, { requesterSuggestionId: null, requesterId: person.id }, { waitingOnSuggestionId: null })
          break
        }
        case 'new_task':
        case 'needs_reply':
          taskId = this.createTask(p, 'open')
          break
        case 'waiting_on':
          if (p.taskId) {
            const task = this.requireTask(p.taskId)
            this.tasks.save({ ...task, status: 'waiting_on', waitingOn: p.waitingOn || task.waitingOn || 'someone', waitingSince: p.waitingSince ?? null })
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
        case 'brief_update': {
          // Person context can also fill in or correct their role and company.
          const person = p.briefScope === 'person' ? this.people.list().find((x) => x.id === p.briefOwnerId) : undefined
          const role = p.role?.trim() || null
          const company = p.company?.trim() || null
          if (p.details.trim() || !person || !(role || company)) this.appendBrief(p.briefScope, p.briefOwnerId, p.details, sourceTitle)
          if (person && (role || company)) this.people.save({ ...person, role: role ?? person.role, company: company ?? person.company })
          taskId = p.briefScope === 'task' ? p.briefOwnerId : null
          break
        }
      }
      if (taskId) this.db.prepare('INSERT OR IGNORE INTO task_sources (work_item_id, source_id) VALUES (?, ?)').run(taskId, sourceId)
      this.db
        .prepare(`UPDATE suggestions SET status = 'accepted', decided_at = ?, result_task_id = ?, result_ref_id = ?, payload = ? WHERE id = ?`)
        .run(nowIso(), taskId, refId, JSON.stringify(p), id)
      return taskId
    })
  }

  /**
   * The project or person a new_project / new_person suggestion created, accepting it first if
   * it's still pending. Null if it was rejected or what it created has since been deleted.
   */
  private createdBy(suggestionId: number): number | null {
    const status = () => this.db.prepare('SELECT kind, status, result_ref_id FROM suggestions WHERE id = ?').get(suggestionId) as Record<string, unknown> | undefined
    let row = status()
    if (row?.status === 'pending') {
      this.accept(suggestionId)
      row = status()
    }
    if (row?.status !== 'accepted' || row.result_ref_id == null) return null
    const table = row.kind === 'new_project' ? 'projects' : 'people'
    return this.db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(Number(row.result_ref_id)) ? Number(row.result_ref_id) : null
  }

  /**
   * Updates pending suggestions that link to a new project or person suggestion once it's decided.
   * Each patch applies where its first key (the link field) currently points at the suggestion.
   */
  private relink(suggestionId: number, ...patches: Partial<SuggestionPayload>[]): void {
    const rows = this.db.prepare(`SELECT id, payload FROM suggestions WHERE status = 'pending' AND id <> ?`).all(suggestionId) as Record<string, unknown>[]
    const update = this.db.prepare('UPDATE suggestions SET payload = ? WHERE id = ?')
    for (const row of rows) {
      const payload = JSON.parse(String(row.payload)) as SuggestionPayload
      let next = payload
      for (const patch of patches) {
        const field = Object.keys(patch)[0] as keyof SuggestionPayload
        if (payload[field] === suggestionId) next = { ...next, ...patch }
      }
      if (next !== payload) update.run(JSON.stringify(next), Number(row.id))
    }
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
      waitingSince: status === 'waiting_on' ? (p.waitingSince ?? null) : null,
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
