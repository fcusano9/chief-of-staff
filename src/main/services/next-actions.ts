import type { DatabaseSync } from 'node:sqlite'
import { ACTIVE_STATUSES, type NextAction, type NextActionOrigin } from '@shared/types'
import { noteLines, parseNote } from '@shared/notes'
import { nowIso, transaction } from '../db'

/** One next action the AI wrote, already checked against the tasks it was sent. */
export interface NextActionDraft {
  taskId: number
  action: string
  why: string
}

const tidy = (s: string | null | undefined, max: number) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

/**
 * Keeps only next actions for tasks that were sent to the AI (each task once, first wins) and
 * that have an action. Anything else is dropped rather than guessed at.
 */
export function cleanNextActions(raw: { task_id: number; action: string; why: string }[], allowed: Set<number>): NextActionDraft[] {
  const out = new Map<number, NextActionDraft>()
  for (const r of raw) {
    const action = tidy(r.action, 200)
    if (!allowed.has(r.task_id) || out.has(r.task_id) || !action) continue
    out.set(r.task_id, { taskId: r.task_id, action, why: tidy(r.why, 300) })
  }
  return [...out.values()]
}

/** Local calendar day of an ISO time, as a number for comparing (yyyymmdd). */
const dayNumber = (d: Date) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()

/**
 * Each task's suggested next action: written as part of a daily briefing or an import, shown
 * on the task's card only. It never changes the task. A newer one replaces the old one.
 */
export class NextActionService {
  constructor(private readonly db: DatabaseSync) {}

  get(taskId: number): NextAction | null {
    const row = this.db.prepare('SELECT * FROM next_actions WHERE work_item_id = ?').get(taskId) as Record<string, unknown> | undefined
    if (!row) return null
    const summary = this.db.prepare(`SELECT summary FROM context_briefs WHERE scope = 'task' AND owner_id = ?`).get(taskId) as { summary: string } | undefined
    return toNextAction(row, latestUpdateDate(summary?.summary ?? ''))
  }

  /** Saves next actions for open tasks only, replacing any earlier ones (and un-dismissing them). */
  save(drafts: NextActionDraft[], meta: { writtenBy: string; origin: NextActionOrigin; originLabel?: string | null }): void {
    if (!drafts.length) return
    const active = ACTIVE_STATUSES.map((s) => `'${s}'`).join(', ')
    const isOpen = this.db.prepare(`SELECT 1 FROM work_items WHERE id = ? AND status IN (${active})`)
    const upsert = this.db.prepare(
      `INSERT INTO next_actions (work_item_id, action, why, written_at, written_by, origin, origin_label, dismissed)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(work_item_id) DO UPDATE SET action = excluded.action, why = excluded.why, written_at = excluded.written_at,
         written_by = excluded.written_by, origin = excluded.origin, origin_label = excluded.origin_label, dismissed = 0`,
    )
    const now = nowIso()
    transaction(this.db, () => {
      for (const d of drafts) if (isOpen.get(d.taskId)) upsert.run(d.taskId, d.action, d.why, now, meta.writtenBy, meta.origin, meta.originLabel ?? null)
    })
  }

  setDismissed(taskId: number, dismissed: boolean): NextAction | null {
    this.db.prepare('UPDATE next_actions SET dismissed = ? WHERE work_item_id = ?').run(dismissed ? 1 : 0, taskId)
    return this.get(taskId)
  }
}

/** The date of the task's newest dated update, or null. */
function latestUpdateDate(summary: string): { label: string; day: number } | null {
  let best: { label: string; day: number } | null = null
  for (const line of noteLines(summary)) {
    const n = parseNote(line)
    const t = n.date ? Date.parse(n.date) : NaN
    if (Number.isNaN(t)) continue
    const day = dayNumber(new Date(t))
    if (!best || day > best.day) best = { label: n.date, day }
  }
  return best
}

function toNextAction(row: Record<string, unknown>, latest: { label: string; day: number } | null): NextAction {
  const writtenAt = String(row.written_at)
  // Updates are dated by day, so only one dated a later day than the suggestion counts as newer.
  const stale = latest && latest.day > dayNumber(new Date(writtenAt)) ? latest.label : null
  return {
    taskId: Number(row.work_item_id),
    action: String(row.action),
    why: String(row.why),
    writtenAt,
    writtenBy: String(row.written_by),
    origin: row.origin as NextActionOrigin,
    originLabel: (row.origin_label as string) ?? null,
    dismissed: Number(row.dismissed) === 1,
    staleSince: stale,
  }
}
