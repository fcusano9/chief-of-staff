import type { DatabaseSync } from 'node:sqlite'
import { ACTIVE_STATUSES, MAX_AI_ADJUSTMENT, type ChangeBy, type NextActionOrigin } from '@shared/types'
import { nowIso, transaction } from '../db'
import { TaskEventService } from './task-events'

/** One priority change the AI proposed, already checked. A change of 0 clears the task's adjustment. */
export interface AdjustmentDraft {
  taskId: number
  delta: number
  reason: string
}

const tidy = (s: string | null | undefined, max: number) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

/**
 * Keeps changes only for tasks that were sent to the AI (each task once, first wins). The change
 * is rounded and held to ±15. A non-zero change needs a reason; one without is dropped.
 */
export function cleanAdjustments(raw: { task_id: number; change: number; reason: string }[], allowed: Set<number>): AdjustmentDraft[] {
  const out = new Map<number, AdjustmentDraft>()
  for (const r of raw) {
    if (!allowed.has(r.task_id) || out.has(r.task_id) || !Number.isFinite(r.change)) continue
    const delta = Math.max(-MAX_AI_ADJUSTMENT, Math.min(MAX_AI_ADJUSTMENT, Math.round(r.change)))
    const reason = tidy(r.reason, 200)
    if (delta !== 0 && !reason) continue
    out.set(r.task_id, { taskId: r.task_id, delta, reason })
  }
  return [...out.values()]
}

/**
 * AI adjustments to task priority scores. Written only as part of a daily briefing or an import;
 * applied at once (effectivePriority adds them) and shown on the priority card. One per task.
 */
export class PriorityAdjustmentService {
  private readonly events: TaskEventService

  constructor(private readonly db: DatabaseSync) {
    this.events = new TaskEventService(db)
  }

  private current(taskId: number): { delta: number; reason: string } | null {
    const row = this.db.prepare('SELECT delta, reason FROM priority_adjustments WHERE work_item_id = ?').get(taskId) as { delta: number; reason: string } | undefined
    return row ? { delta: Number(row.delta), reason: String(row.reason) } : null
  }

  /** Saves changes for open tasks only. A change of 0 clears the task's adjustment. */
  save(drafts: AdjustmentDraft[], meta: { writtenBy: string; origin: NextActionOrigin; originLabel?: string | null }): void {
    if (!drafts.length) return
    const active = ACTIVE_STATUSES.map((s) => `'${s}'`).join(', ')
    const isOpen = this.db.prepare(`SELECT 1 FROM work_items WHERE id = ? AND status IN (${active})`)
    const upsert = this.db.prepare(
      `INSERT INTO priority_adjustments (work_item_id, delta, reason, written_at, written_by, origin, origin_label)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(work_item_id) DO UPDATE SET delta = excluded.delta, reason = excluded.reason, written_at = excluded.written_at,
         written_by = excluded.written_by, origin = excluded.origin, origin_label = excluded.origin_label`,
    )
    const now = nowIso()
    // Recorded in each task's Activity as made by the AI, with where it came from.
    const by: ChangeBy = { by: 'ai', label: meta.origin === 'briefing' ? 'daily briefing' : `import “${meta.originLabel ?? 'Imported item'}”` }
    transaction(this.db, () => {
      for (const d of drafts) {
        if (!isOpen.get(d.taskId)) continue
        if (d.delta === 0) {
          this.remove(d.taskId, by)
          continue
        }
        const before = this.current(d.taskId)
        upsert.run(d.taskId, d.delta, d.reason, now, meta.writtenBy, meta.origin, meta.originLabel ?? null)
        if (before?.delta !== d.delta || before.reason !== d.reason) this.events.record(d.taskId, [{ kind: 'ai_priority', from: before ? String(before.delta) : null, to: String(d.delta), note: d.reason }], by)
      }
    })
  }

  /** Takes a task's AI change off (Remove on the priority card, or the AI giving 0), and records it. */
  remove(taskId: number, by: ChangeBy = { by: 'user' }): void {
    const before = this.current(taskId)
    if (!before) return
    this.db.prepare('DELETE FROM priority_adjustments WHERE work_item_id = ?').run(taskId)
    this.events.record(taskId, [{ kind: 'ai_priority', from: String(before.delta), to: null }], by)
  }
}
