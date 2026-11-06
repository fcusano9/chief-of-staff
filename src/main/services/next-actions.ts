import type { DatabaseSync } from 'node:sqlite'
import { ACTIVE_STATUSES, type NextAction, type NextActionOrigin, type ProjectCard } from '@shared/types'
import { noteLines, parseNote } from '@shared/notes'
import { nowIso, transaction } from '../db'
import { MAX_STATUS_BULLETS } from '../ai/limits'

/** One task card the AI wrote (where it stands, and the next step), already checked against the tasks it was sent. */
export interface NextActionDraft {
  taskId: number
  status: string[]
  action: string
}

/** At most this many "Where this stands" bullets are kept. */
export { MAX_STATUS_BULLETS }

const tidy = (s: string | null | undefined, max: number) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

/** Tidies the AI's bullets: one line each, no leading bullet marks, no empties, at most 3. */
export function cleanStatus(raw: readonly string[] | null | undefined): string[] {
  return (raw ?? [])
    .map((b) => tidy(String(b).replace(/^\s*(?:[-*•‣·]|\d+[.)])\s+/, ''), 240))
    .filter(Boolean)
    .slice(0, MAX_STATUS_BULLETS)
}

/**
 * Keeps only cards for tasks that were sent to the AI (each task once, first wins) that have an
 * action. Anything else is dropped rather than guessed at.
 */
export function cleanNextActions(raw: { task_id: number; action: string; status?: readonly string[] | null }[], allowed: Set<number>): NextActionDraft[] {
  const out = new Map<number, NextActionDraft>()
  for (const r of raw) {
    const action = tidy(r.action, 200)
    if (!allowed.has(r.task_id) || out.has(r.task_id) || !action) continue
    out.set(r.task_id, { taskId: r.task_id, status: cleanStatus(r.status), action })
  }
  return [...out.values()]
}

/** Local calendar day of an ISO time, as a number for comparing (yyyymmdd). */
const dayNumber = (d: Date) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()

/**
 * Each task's card ("Where this stands" plus the suggested next action): written on Write, as
 * part of a daily briefing, or as part of an import, and shown on the task only. It never
 * changes the task. A newer one replaces the whole card.
 */
export class NextActionService {
  constructor(private readonly db: DatabaseSync) {}

  get(taskId: number): NextAction | null {
    const row = this.db.prepare('SELECT * FROM next_actions WHERE work_item_id = ?').get(taskId) as Record<string, unknown> | undefined
    if (!row) return null
    return toNextAction(row, latestUpdateDate(updatesOf(this.db, 'task', taskId)))
  }

  /** Saves next actions for open tasks only, replacing any earlier ones (and un-dismissing them). */
  save(drafts: NextActionDraft[], meta: { writtenBy: string; origin: NextActionOrigin; originLabel?: string | null }): void {
    if (!drafts.length) return
    const active = ACTIVE_STATUSES.map((s) => `'${s}'`).join(', ')
    const isOpen = this.db.prepare(`SELECT 1 FROM work_items WHERE id = ? AND status IN (${active})`)
    const upsert = this.db.prepare(
      `INSERT INTO next_actions (work_item_id, status, action, why, written_at, written_by, origin, origin_label, dismissed)
       VALUES (?, ?, ?, '', ?, ?, ?, ?, 0)
       ON CONFLICT(work_item_id) DO UPDATE SET status = excluded.status, action = excluded.action, why = '', written_at = excluded.written_at,
         written_by = excluded.written_by, origin = excluded.origin, origin_label = excluded.origin_label, dismissed = 0`,
    )
    const now = nowIso()
    transaction(this.db, () => {
      for (const d of drafts) if (isOpen.get(d.taskId)) upsert.run(d.taskId, JSON.stringify(d.status), d.action, now, meta.writtenBy, meta.origin, meta.originLabel ?? null)
    })
  }

  setDismissed(taskId: number, dismissed: boolean): NextAction | null {
    this.db.prepare('UPDATE next_actions SET dismissed = ? WHERE work_item_id = ?').run(dismissed ? 1 : 0, taskId)
    return this.get(taskId)
  }
}

/**
 * Each project's card: where it stands and one next step for the project as a whole. Written only
 * when the user clicks Write, shown on the project only, and it changes nothing.
 */
export class ProjectCardService {
  constructor(private readonly db: DatabaseSync) {}

  get(projectId: number): ProjectCard | null {
    const row = this.db.prepare('SELECT * FROM project_cards WHERE project_id = ?').get(projectId) as Record<string, unknown> | undefined
    if (!row) return null
    const writtenAt = String(row.written_at)
    return {
      projectId,
      status: parseStatus(row.status),
      action: String(row.action),
      writtenAt,
      writtenBy: String(row.written_by),
      dismissed: Number(row.dismissed) === 1,
      staleSince: staleSince(latestUpdateDate(updatesOf(this.db, 'project', projectId)), writtenAt),
    }
  }

  save(projectId: number, card: { status: string[]; action: string }, writtenBy: string): ProjectCard {
    this.db
      .prepare(
        `INSERT INTO project_cards (project_id, status, action, written_at, written_by, dismissed) VALUES (?, ?, ?, ?, ?, 0)
         ON CONFLICT(project_id) DO UPDATE SET status = excluded.status, action = excluded.action, written_at = excluded.written_at,
           written_by = excluded.written_by, dismissed = 0`,
      )
      .run(projectId, JSON.stringify(card.status), card.action, nowIso(), writtenBy)
    return this.get(projectId)!
  }

  setDismissed(projectId: number, dismissed: boolean): ProjectCard | null {
    this.db.prepare('UPDATE project_cards SET dismissed = ? WHERE project_id = ?').run(dismissed ? 1 : 0, projectId)
    return this.get(projectId)
  }
}

const updatesOf = (db: DatabaseSync, scope: 'task' | 'project', id: number): string =>
  (db.prepare('SELECT summary FROM context_briefs WHERE scope = ? AND owner_id = ?').get(scope, id) as { summary: string } | undefined)?.summary ?? ''

function parseStatus(value: unknown): string[] {
  try {
    const list = JSON.parse(String(value ?? '[]')) as unknown
    return Array.isArray(list) ? list.map(String) : []
  } catch {
    return []
  }
}

/** Updates are dated by day, so only one dated a later day than the card counts as newer. */
const staleSince = (latest: { label: string; day: number } | null, writtenAt: string): string | null =>
  latest && latest.day > dayNumber(new Date(writtenAt)) ? latest.label : null

/** The date of the newest dated update, or null. */
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
  const stale = staleSince(latest, writtenAt)
  return {
    taskId: Number(row.work_item_id),
    status: parseStatus(row.status),
    action: String(row.action),
    writtenAt,
    writtenBy: String(row.written_by),
    origin: row.origin as NextActionOrigin,
    originLabel: (row.origin_label as string) ?? null,
    dismissed: Number(row.dismissed) === 1,
    staleSince: stale,
  }
}
