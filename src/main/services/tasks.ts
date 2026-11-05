import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import { scorePriority } from '@shared/priority'
import {
  ACTIVE_STATUSES,
  type ChangeBy,
  effectivePriority,
  type Person,
  type PriorityAdjustment,
  type PriorityWeights,
  type Project,
  type SourceKind,
  type Subtask,
  type Task,
  type TaskActivity,
  type TaskFilter,
  type TaskInput,
  type TaskStatus,
  type TodaySummary,
} from '@shared/types'
import { nowIso, transaction } from '../db'
import { taskChanges, TaskEventService } from './task-events'

const BY_USER: ChangeBy = { by: 'user' }

type Row = Record<string, SQLInputValue>

const ACTIVE_SQL = `w.status IN (${ACTIVE_STATUSES.map((s) => `'${s}'`).join(', ')})`

const SELECT = `
  SELECT w.*,
         p.id AS p_id, p.name AS p_name, p.color AS p_color, p.status AS p_status, p.created_at AS p_created_at,
         p.overview AS p_overview, p.brief AS p_brief, p.brief_by AS p_brief_by, p.brief_at AS p_brief_at,
         r.id AS r_id, r.name AS r_name, r.role AS r_role, r.company AS r_company, r.email AS r_email, r.priority_weight AS r_weight,
         r.brief AS r_brief, r.brief_by AS r_brief_by, r.brief_at AS r_brief_at,
         a.delta AS a_delta, a.reason AS a_reason, a.written_at AS a_written_at, a.written_by AS a_written_by, a.origin AS a_origin, a.origin_label AS a_origin_label
  FROM work_items w
  LEFT JOIN projects p ON p.id = w.project_id
  LEFT JOIN people r ON r.id = w.requester_id
  LEFT JOIN priority_adjustments a ON a.work_item_id = w.id`

function toTask(row: Row): Task {
  const project: Project | null =
    row.p_id == null
      ? null
      : {
          id: Number(row.p_id),
          name: String(row.p_name),
          color: String(row.p_color),
          status: row.p_status as Project['status'],
          createdAt: String(row.p_created_at),
          overview: (row.p_overview as string) ?? null,
          brief: (row.p_brief as string) ?? null,
          briefBy: (row.p_brief_by as Project['briefBy']) ?? null,
          briefAt: (row.p_brief_at as string) ?? null,
        }
  const requester: Person | null =
    row.r_id == null
      ? null
      : { id: Number(row.r_id), name: String(row.r_name), role: (row.r_role as string) ?? null, company: (row.r_company as string) ?? null, email: (row.r_email as string) ?? null,
          priorityWeight: Number(row.r_weight), brief: (row.r_brief as string) ?? null, briefBy: (row.r_brief_by as Person['briefBy']) ?? null, briefAt: (row.r_brief_at as string) ?? null }
  return {
    id: Number(row.id),
    title: String(row.title),
    notes: (row.notes as string) ?? null,
    status: row.status as TaskStatus,
    dueDate: (row.due_date as string) ?? null,
    projectId: row.project_id == null ? null : Number(row.project_id),
    requesterId: row.requester_id == null ? null : Number(row.requester_id),
    priorityScore: Number(row.priority_score),
    priorityRationale: (row.priority_rationale as string) ?? null,
    priorityOverride: row.priority_override == null ? null : Number(row.priority_override),
    aiAdjustment:
      row.a_delta == null
        ? null
        : {
            delta: Number(row.a_delta),
            reason: String(row.a_reason),
            writtenAt: String(row.a_written_at),
            writtenBy: String(row.a_written_by),
            origin: row.a_origin as PriorityAdjustment['origin'],
            originLabel: (row.a_origin_label as string) ?? null,
          },
    followUpCount: Number(row.follow_up_count),
    waitingOn: (row.waiting_on as string) ?? null,
    waitingSince: (row.waiting_since as string) ?? null,
    waitedOn: (row.waited_on as string) ?? null,
    createdAt: String(row.created_at),
    lastActivityAt: String(row.last_activity_at),
    completedAt: (row.completed_at as string) ?? null,
    subtasks: [],
    linkedSources: [],
    project,
    requester,
  }
}

const byPriority = (a: Task, b: Task) =>
  effectivePriority(b) - effectivePriority(a) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.id - b.id
const longestWaiting = (a: Task, b: Task) => (a.waitingSince ?? a.lastActivityAt).localeCompare(b.waitingSince ?? b.lastActivityAt) || a.id - b.id

export class TaskService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly weights: () => PriorityWeights,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.events = new TaskEventService(db, now)
  }

  private readonly events: TaskEventService

  /** The task's recorded changes for its Activity log, newest first. */
  activity(id: number): TaskActivity {
    return this.events.activity(id)
  }

  /**
   * Active tasks sorted by effective priority, highest first. With list "waiting", only waiting-on
   * items, longest waiting first; with "tasks", everything else that's active.
   */
  listActive(filter: TaskFilter = {}): Task[] {
    const status = filter.list === 'waiting' ? `w.status = 'waiting_on'` : filter.list === 'tasks' ? `w.status = 'open'` : ACTIVE_SQL
    const tasks = this.load(`${SELECT} WHERE ${this.where(status, filter)}`, this.params(filter))
    return filter.list === 'waiting' ? tasks.sort(longestWaiting) : tasks.sort(byPriority)
  }

  /** Finished tasks, newest first. List "waiting" means ones that were waiting on someone. */
  listDone(filter: TaskFilter = {}, limit = 200): Task[] {
    const kind = filter.list === 'waiting' ? ' AND w.waited_on IS NOT NULL' : filter.list === 'tasks' ? ' AND w.waited_on IS NULL' : ''
    return this.load(`${SELECT} WHERE ${this.where(`w.status = 'done'${kind}`, filter)} ORDER BY w.completed_at DESC, w.id DESC LIMIT ${Math.floor(limit)}`, this.params(filter))
  }

  private where(status: string, filter: TaskFilter): string {
    const where = [status]
    if (filter.projectId != null) where.push('w.project_id = $projectId')
    if (filter.noProjectOnly) where.push('w.project_id IS NULL')
    // Search also matches who it's waiting on (or was).
    if (filter.search?.trim()) where.push(`(w.title LIKE $search OR IFNULL(w.notes, '') LIKE $search OR IFNULL(w.waiting_on, '') LIKE $search OR IFNULL(w.waited_on, '') LIKE $search)`)
    return where.join(' AND ')
  }

  private params(filter: TaskFilter): Record<string, SQLInputValue> {
    const params: Record<string, SQLInputValue> = {}
    if (filter.projectId != null) params.projectId = filter.projectId
    if (filter.search?.trim()) params.search = `%${filter.search.trim()}%`
    return params
  }

  /** Reopens a finished task: back to Waiting if it was waiting on someone, else to Tasks. */
  reopen(id: number, by: ChangeBy = BY_USER): Task {
    const task = this.get(id)
    if (!task) throw new Error(`Task ${id} not found`)
    return this.save(task.waitedOn ? { ...task, status: 'waiting_on', waitingOn: task.waitedOn } : { ...task, status: 'open' }, by)
  }

  /**
   * Everything a week's review can mention: tasks created before the week ended that were still
   * active at its start or finished during or after it. Proposed and dismissed tasks are left out.
   */
  listForWeek(from: string, to: string): Task[] {
    return this.load(`${SELECT} WHERE w.status IN ('open', 'waiting_on', 'done') AND w.created_at < $to AND (w.status != 'done' OR w.completed_at >= $from)`, { from, to })
  }

  /** Waiting-on tasks, longest waiting first. */
  listWaiting(): Task[] {
    return this.load(`${SELECT} WHERE w.status = 'waiting_on'`).sort(longestWaiting)
  }

  listForPerson(personId: number): Task[] {
    return this.load(`${SELECT} WHERE ${ACTIVE_SQL} AND w.requester_id = $personId`, { personId }).sort(byPriority)
  }

  get(id: number): Task | null {
    return this.load(`${SELECT} WHERE w.id = $id`, { id })[0] ?? null
  }

  /**
   * Inserts (id 0) or updates a task including its subtasks, and recomputes its priority. Each
   * changed field is recorded in the task's Activity, with who made the change.
   */
  save(input: TaskInput, by: ChangeBy = BY_USER): Task {
    const title = input.title.trim()
    if (!title) throw new Error('A task needs a title.')
    const now = nowIso()

    const id = transaction(this.db, () => {
      const existing = input.id ? this.get(input.id) : null
      if (input.id && !existing) throw new Error(`Task ${input.id} not found`)

      const enteringWaiting = input.status === 'waiting_on' && existing?.status !== 'waiting_on'
      const enteringDone = input.status === 'done' && existing?.status !== 'done'
      const values = {
        title,
        notes: input.notes?.trim() ? input.notes : null,
        status: input.status,
        dueDate: input.dueDate || null,
        projectId: input.projectId,
        requesterId: input.requesterId,
        priorityOverride: input.priorityOverride,
        followUpCount: input.followUpCount,
        waitingOn: input.status === 'waiting_on' ? input.waitingOn?.trim() || null : null,
        waitingSince: input.status !== 'waiting_on' ? null : enteringWaiting ? (input.waitingSince ?? now) : (existing?.waitingSince ?? now),
        completedAt: input.status !== 'done' ? null : enteringDone ? now : (existing?.completedAt ?? now),
        waitedOn: input.status !== 'done' ? null : enteringDone ? (existing?.status === 'waiting_on' ? existing.waitingOn : null) : (existing?.waitedOn ?? null),
        now,
      }

      let taskId: number
      if (existing) {
        this.db
          .prepare(
            `UPDATE work_items SET title=$title, notes=$notes, status=$status, due_date=$dueDate, project_id=$projectId,
               requester_id=$requesterId, priority_override=$priorityOverride, follow_up_count=$followUpCount,
               waiting_on=$waitingOn, waiting_since=$waitingSince, waited_on=$waitedOn, completed_at=$completedAt, last_activity_at=$now
             WHERE id=$id`,
          )
          .run({ ...values, id: existing.id })
        taskId = existing.id
      } else {
        const result = this.db
          .prepare(
            `INSERT INTO work_items (title, notes, status, due_date, project_id, requester_id, priority_override,
               follow_up_count, waiting_on, waiting_since, waited_on, completed_at, created_at, last_activity_at)
             VALUES ($title, $notes, $status, $dueDate, $projectId, $requesterId, $priorityOverride,
               $followUpCount, $waitingOn, $waitingSince, $waitedOn, $completedAt, $now, $now)`,
          )
          .run(values)
        taskId = Number(result.lastInsertRowid)
      }

      this.syncSubtasks(taskId, input.subtasks)
      this.rescore(taskId)
      this.events.record(taskId, taskChanges(existing, this.get(taskId)!), by)
      return taskId
    })
    return this.get(id)!
  }

  setStatus(id: number, status: TaskStatus, by: ChangeBy = BY_USER): Task {
    const task = this.get(id)
    if (!task) throw new Error(`Task ${id} not found`)
    return this.save({ ...task, status }, by)
  }

  delete(id: number): void {
    transaction(this.db, () => {
      this.db.prepare('DELETE FROM work_items WHERE id = ?').run(id)
      this.db.prepare(`DELETE FROM context_briefs WHERE scope = 'task' AND owner_id = ?`).run(id)
    })
  }

  /** Recomputes scores for all active tasks (time moves on, weights change). */
  recomputeAll(): void {
    const ids = this.db.prepare(`SELECT w.id FROM work_items w WHERE ${ACTIVE_SQL}`).all() as { id: number }[]
    transaction(this.db, () => ids.forEach(({ id }) => this.rescore(Number(id))))
  }

  summary(): TodaySummary {
    const active = this.load(`${SELECT} WHERE ${ACTIVE_SQL}`)
    const now = this.now()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    return {
      urgent: active.filter((t) => effectivePriority(t) >= 80).length,
      waitingOn: active.filter((t) => t.status === 'waiting_on').length,
      overdue: active.filter((t) => t.dueDate != null && t.dueDate < today).length,
      open: active.length,
    }
  }

  private rescore(id: number): void {
    const task = this.get(id)
    if (!task) return
    const { score, rationale } = scorePriority(task, this.weights(), this.now())
    this.db.prepare('UPDATE work_items SET priority_score = ?, priority_rationale = ? WHERE id = ?').run(score, rationale, id)
  }

  private syncSubtasks(taskId: number, desired: Subtask[]): void {
    const keep = desired.filter((s) => s.id).map((s) => s.id)
    const existing = this.db.prepare('SELECT id FROM subtasks WHERE work_item_id = ?').all(taskId) as { id: number }[]
    for (const { id } of existing) {
      if (!keep.includes(Number(id))) this.db.prepare('DELETE FROM subtasks WHERE id = ?').run(id)
    }
    desired
      .filter((s) => s.title.trim())
      .forEach((s, i) => {
        if (s.id && existing.some((e) => Number(e.id) === s.id)) {
          this.db.prepare('UPDATE subtasks SET title = ?, is_done = ?, sort_order = ? WHERE id = ?').run(s.title.trim(), s.isDone ? 1 : 0, i, s.id)
        } else {
          this.db
            .prepare('INSERT INTO subtasks (work_item_id, title, is_done, sort_order) VALUES (?, ?, ?, ?)')
            .run(taskId, s.title.trim(), s.isDone ? 1 : 0, i)
        }
      })
  }

  /** Runs a task query and attaches subtasks and linked imports. */
  private load(sql: string, params: Record<string, SQLInputValue> = {}): Task[] {
    const tasks = (this.db.prepare(sql).all(params) as Row[]).map(toTask)
    if (tasks.length === 0) return tasks
    const byId = new Map(tasks.map((t) => [t.id, t]))
    const ids = tasks.map((t) => t.id).join(',')
    for (const s of this.db.prepare(`SELECT * FROM subtasks WHERE work_item_id IN (${ids}) ORDER BY sort_order, id`).all() as Row[]) {
      byId.get(Number(s.work_item_id))?.subtasks.push({ id: Number(s.id), title: String(s.title), isDone: Number(s.is_done) === 1 })
    }
    const links = this.db
      .prepare(
        `SELECT ts.work_item_id, s.id, s.kind, s.title, s.occurred_at FROM task_sources ts
         JOIN source_items s ON s.id = ts.source_id WHERE ts.work_item_id IN (${ids}) ORDER BY s.occurred_at DESC`,
      )
      .all() as Row[]
    for (const l of links) {
      byId.get(Number(l.work_item_id))?.linkedSources.push({ id: Number(l.id), kind: l.kind as SourceKind, title: String(l.title), occurredAt: String(l.occurred_at) })
    }
    return tasks
  }
}
