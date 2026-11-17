import type { DatabaseSync } from 'node:sqlite'
import { statusValue } from '@shared/events'
import type { ChangeBy, Task, TaskActivity, TaskEvent, TaskEventKind } from '@shared/types'

/** One change to record. Values are strings as they read then (names, not ids), or null. */
export interface EventDraft {
  kind: TaskEventKind
  from?: string | null
  to?: string | null
  note?: string | null
}

const str = (v: number | null | undefined) => (v == null ? null : String(v))

/** The changes between two versions of a task, one per field (subtasks, notes and the score aren't recorded). */
export function taskChanges(before: Task | null, after: Task): EventDraft[] {
  if (!before) return [{ kind: 'created' }]
  const out: EventDraft[] = []
  const add = (kind: TaskEventKind, from: string | null, to: string | null, note: string | null = null) => {
    if (from !== to) out.push({ kind, from, to, note })
  }
  add('status', statusValue(before.status, before.waitingOn), statusValue(after.status, after.waitingOn))
  add('due', before.dueDate, after.dueDate)
  add('project', before.project?.name ?? null, after.project?.name ?? null)
  add('requester', before.requester?.name ?? null, after.requester?.name ?? null)
  add('title', before.title, after.title)
  add('override', str(before.priorityOverride), str(after.priorityOverride))
  add('followups', str(before.followUpCount), str(after.followUpCount))
  return out
}

/** One due-date move inside a date range, for the weekly review. */
export interface DueMove {
  taskId: number
  at: string
  from: string
  to: string
  by: ChangeBy['by']
  byLabel: string | null
}

/**
 * The task event log behind each task's Activity, and the weekly review's pushed-back dates.
 * Rows are only ever added; they go when the task is deleted.
 */
export class TaskEventService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
  ) {}

  record(taskId: number, drafts: EventDraft[], by: ChangeBy): void {
    if (!drafts.length) return
    const insert = this.db.prepare('INSERT INTO task_events (work_item_id, at, kind, from_value, to_value, note, by, by_label) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    const at = this.now().toISOString()
    const label = by.by === 'user' ? null : by.label
    // Inserted last field first, so newest-first (highest id first) lists one save's fields in order.
    for (const d of [...drafts].reverse()) insert.run(taskId, at, d.kind, d.from ?? null, d.to ?? null, d.note ?? null, by.by, label)
  }

  /** A task's recorded changes, newest first; the fields changed in one save keep their order. */
  activity(taskId: number): TaskActivity {
    const rows = this.db.prepare('SELECT * FROM task_events WHERE work_item_id = ? ORDER BY at DESC, id DESC').all(taskId) as Record<string, unknown>[]
    return { events: rows.map(toEvent) }
  }

  /** Due dates moved from one date to another (not set or removed) between `from` and `to`, oldest first. */
  dueMoves(from: string, to: string): DueMove[] {
    const rows = this.db
      .prepare(`SELECT * FROM task_events WHERE kind = 'due' AND from_value IS NOT NULL AND to_value IS NOT NULL AND at >= ? AND at < ? ORDER BY at, id`)
      .all(from, to) as Record<string, unknown>[]
    return rows.map((r) => ({ taskId: Number(r.work_item_id), at: String(r.at), from: String(r.from_value), to: String(r.to_value), by: r.by as ChangeBy['by'], byLabel: (r.by_label as string) ?? null }))
  }
}

function toEvent(r: Record<string, unknown>): TaskEvent {
  return {
    id: Number(r.id),
    taskId: Number(r.work_item_id),
    at: String(r.at),
    kind: r.kind as TaskEventKind,
    from: (r.from_value as string) ?? null,
    to: (r.to_value as string) ?? null,
    note: (r.note as string) ?? null,
    by: r.by as ChangeBy['by'],
    byLabel: (r.by_label as string) ?? null,
  }
}
