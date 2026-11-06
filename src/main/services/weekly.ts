import type { DatabaseSync } from 'node:sqlite'
import type { AiCall, Task, WeekListItem, WeeklyItem, WeeklyLists, WeeklyReflection, WeeklyReview, WeekRecord } from '@shared/types'
import { addDays, dayStart, weekBounds, weekLabel, weekStartOf, ymd } from '@shared/week'
import { dueLabel } from '../ai/briefing'
import type { AiCallRecord, AiProvider } from '../ai/provider'
import { assembleReflection, type WeeklyInput } from '../ai/weekly'
import { nowIso, transaction } from '../db'
import type { TaskService } from './tasks'
import { type DueMove, TaskEventService } from './task-events'
import { paidModelOf, UsageService } from './usage'
import { eventWho, shortDate } from '@shared/events'

/** Weeks whose reflection requests are kept for the AI log. Reflections themselves are all kept. */
export const WEEKLY_CALLS_KEPT = 5

const DAY = 86_400_000
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY)
const weekday = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short' })

/** Ids the reflection was written from, to count what changed since. */
interface Basis {
  completed: number[]
  added: number[]
}

/**
 * The weekly review: for each Sunday-to-Saturday week, what was completed, what was added, what
 * was overdue, and what was waiting on others. The current week is rebuilt every time it's shown.
 * The first time the app runs after a week ends, that week is saved and never changes. The AI
 * reflection is written only when Frank clicks, for the current week. Nothing here changes tasks.
 */
export class WeeklyService {
  private writing: Promise<WeeklyReview> | null = null
  private readonly usage: UsageService

  constructor(
    private readonly db: DatabaseSync,
    private readonly tasks: TaskService,
    private readonly provider: () => AiProvider,
    private readonly userName: () => string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.usage = new UsageService(db)
    this.events = new TaskEventService(db, now)
  }

  private readonly events: TaskEventService

  /** The week the weekly review started: set the first time this runs. Weeks before it are only partly known. */
  startedWeek(): string {
    const row = this.db.prepare('SELECT started_week FROM weekly_meta LIMIT 1').get() as { started_week: string } | undefined
    if (row) return row.started_week
    const week = weekStartOf(this.now())
    this.db.prepare('INSERT INTO weekly_meta (started_week) VALUES (?)').run(week)
    return week
  }

  currentWeek(): string {
    return weekStartOf(this.now())
  }

  /**
   * Saves every week that has ended since the weekly review started and isn't saved yet. The week
   * that just ended is saved in full, as it stood at its end. Older ones (the app wasn't opened
   * for a whole week after they ended) are saved partly: what was completed and added.
   */
  saveEndedWeeks(): void {
    const started = this.startedWeek()
    const last = addDays(this.currentWeek(), -7)
    const saved = new Set((this.db.prepare('SELECT week_start FROM weekly_reviews').all() as { week_start: string }[]).map((r) => r.week_start))
    const insert = this.db.prepare('INSERT INTO weekly_reviews (week_start, record, saved_at, lists) VALUES (?, ?, ?, ?)')
    transaction(this.db, () => {
      for (let week = started; week <= last; week = addDays(week, 7)) {
        if (saved.has(week)) continue
        const record: WeekRecord = week === last ? 'saved' : 'partial'
        insert.run(week, record, nowIso(), JSON.stringify(this.lists(week, record)))
      }
    })
  }

  /** Every week from the first task to this one, newest first. */
  list(): WeekListItem[] {
    this.saveEndedWeeks()
    const current = this.currentWeek()
    const started = this.startedWeek()
    const saved = new Map(
      (this.db.prepare('SELECT week_start, record, lists FROM weekly_reviews').all() as Record<string, unknown>[]).map((r) => [
        String(r.week_start),
        { record: r.record as WeekRecord, lists: JSON.parse(String(r.lists)) as WeeklyLists },
      ]),
    )
    const reflected = new Set((this.db.prepare('SELECT week_start FROM weekly_reflections').all() as { week_start: string }[]).map((r) => r.week_start))

    // Weeks before the weekly review started are counted from task dates.
    const counts = new Map<string, { completed: number; added: number }>()
    const bump = (iso: string | null, key: 'completed' | 'added') => {
      if (!iso) return
      const week = weekStartOf(new Date(iso))
      const c = counts.get(week) ?? { completed: 0, added: 0 }
      c[key]++
      counts.set(week, c)
    }
    for (const r of this.db.prepare(`SELECT created_at, completed_at, status FROM work_items WHERE status IN ('open', 'waiting_on', 'done')`).all() as Record<string, unknown>[]) {
      bump(String(r.created_at), 'added')
      if (r.status === 'done') bump((r.completed_at as string) ?? null, 'completed')
    }
    const first = [...counts.keys(), started].sort()[0]!
    const live = this.lists(current, 'live')

    const weeks: WeekListItem[] = []
    for (let week = current; week >= first; week = addDays(week, -7)) {
      const s = saved.get(week)
      const c =
        week === current ? { completed: live.completed.length, added: live.added.length }
        : s ? { completed: s.lists.completed.length, added: s.lists.added.length }
        : (counts.get(week) ?? { completed: 0, added: 0 })
      weeks.push({ weekStart: week, record: week === current ? 'live' : (s?.record ?? 'partial'), ...c, hasReflection: reflected.has(week) })
    }
    return weeks
  }

  /** One week's review. Throws for a week that hasn't started yet. */
  get(weekStart: string): WeeklyReview {
    this.saveEndedWeeks()
    const current = this.currentWeek()
    if (weekStart > current) throw new Error('That week hasn’t started yet.')
    const reflection = this.reflection(weekStart)
    if (weekStart === current) {
      const lists = this.lists(current, 'live')
      const basis = this.basis(weekStart)
      const changedSince = reflection && basis ? { completed: lists.completed.filter((i) => !basis.completed.includes(i.taskId)).length, added: lists.added.filter((i) => !basis.added.includes(i.taskId)).length } : null
      return { weekStart, record: 'live', savedAt: null, lists, reflection: reflection, changedSince }
    }
    const row = this.db.prepare('SELECT record, saved_at, lists FROM weekly_reviews WHERE week_start = ?').get(weekStart) as Record<string, unknown> | undefined
    if (row) return { weekStart, record: row.record as WeekRecord, savedAt: String(row.saved_at), lists: JSON.parse(String(row.lists)) as WeeklyLists, reflection, changedSince: null }
    // Before the weekly review started: rebuilt from task dates, only partly known.
    return { weekStart, record: 'partial', savedAt: null, lists: this.lists(weekStart, 'partial'), reflection, changedSince: null }
  }

  /** Writes (or rewrites) this week's reflection. A second call while one is being written gets the same one. */
  writeReflection(): Promise<WeeklyReview> {
    this.writing ??= this.writeNow().finally(() => {
      this.writing = null
    })
    return this.writing
  }

  isWriting(): boolean {
    return this.writing !== null
  }

  /** The requests behind a week's latest reflection. Kept for the newest few weeks only. */
  aiCalls(weekStart: string): AiCall[] {
    return (this.db.prepare('SELECT * FROM weekly_ai_calls WHERE week_start = ? ORDER BY id').all(weekStart) as Record<string, unknown>[]).map((c) => ({
      id: Number(c.id),
      purpose: String(c.purpose),
      endpoint: String(c.endpoint),
      request: String(c.request),
      response: (c.response as string) ?? null,
      error: (c.error as string) ?? null,
      startedAt: String(c.started_at),
      durationMs: Number(c.duration_ms),
      inputTokens: c.input_tokens == null ? null : Number(c.input_tokens),
      outputTokens: c.output_tokens == null ? null : Number(c.output_tokens),
      paidModel: paidModelOf(String(c.endpoint), String(c.request), (c.response as string) ?? null),
    }))
  }

  /** What the AI is given: this week's four lists, as plain facts. */
  buildInput(): { input: WeeklyInput; basis: Basis } {
    const now = this.now()
    const week = this.currentWeek()
    const lists = this.lists(week, 'live')
    const byId = new Map(this.tasks.listForWeek(weekBounds(week).from, weekBounds(week).to).map((t) => [t.id, t]))
    return {
      basis: { completed: lists.completed.map((i) => i.taskId), added: lists.added.map((i) => i.taskId) },
      input: {
        userName: this.userName(),
        weekLabel: weekLabel(week),
        today: ymd(now),
        weekday: now.toLocaleDateString('en-US', { weekday: 'long' }),
        lastDay: now.getDay() === 6,
        completed: lists.completed.map((i) => ({ title: i.title, project: i.project, day: i.at ? weekday(i.at) : '' })),
        added: lists.added.map((i) => ({ title: i.title, project: i.project, source: i.detail })),
        slipping: (lists.slipping ?? []).map((i) => ({
          title: i.title,
          project: i.project,
          due: byId.get(i.taskId)?.dueDate ?? '',
          overdueDays: i.overdueDays ?? 0,
          pushedDays: i.pushedDays ?? null,
          pushed: i.pushedDays ? i.detail : null,
        })),
        waiting: (lists.waiting ?? []).map((i) => ({ title: i.title, project: i.project, waitingOn: i.detail, days: i.days })),
      },
    }
  }

  private async writeNow(): Promise<WeeklyReview> {
    const provider = this.provider()
    const week = this.currentWeek()
    const { input, basis } = this.buildInput()
    const calls: AiCallRecord[] = []
    const raw = await provider.writeWeeklyReflection(input, { record: (c) => void calls.push(c) })
    const content = assembleReflection(raw)

    transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO weekly_reflections (week_start, written_at, written_by, content, basis) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (week_start) DO UPDATE SET written_at = excluded.written_at, written_by = excluded.written_by, content = excluded.content, basis = excluded.basis`,
        )
        .run(week, nowIso(), provider.label, JSON.stringify(content), JSON.stringify(basis))
      // The AI log shows the requests behind the latest reflection only.
      this.db.prepare('DELETE FROM weekly_ai_calls WHERE week_start = ?').run(week)
      const insert = this.db.prepare(
        `INSERT INTO weekly_ai_calls (week_start, purpose, endpoint, request, response, error, started_at, duration_ms, input_tokens, output_tokens)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      const pretty = (v: unknown) => JSON.stringify(v, null, 2)
      for (const c of calls) {
        insert.run(week, c.purpose, c.endpoint, pretty(c.request), c.response == null ? null : pretty(c.response), c.error, c.startedAt, c.durationMs, c.inputTokens, c.outputTokens)
        this.usage.record(c, 'weekly')
      }
      // Keep the newest weeks by week, not by write time: two writes can share a millisecond.
      this.db
        .prepare(`DELETE FROM weekly_ai_calls WHERE week_start NOT IN (SELECT week_start FROM weekly_reflections ORDER BY week_start DESC LIMIT ${WEEKLY_CALLS_KEPT})`)
        .run()
    })
    return this.get(week)
  }

  private reflection(weekStart: string): WeeklyReflection | null {
    const row = this.db.prepare('SELECT written_at, written_by, content FROM weekly_reflections WHERE week_start = ?').get(weekStart) as Record<string, unknown> | undefined
    if (!row) return null
    const c = JSON.parse(String(row.content)) as Pick<WeeklyReflection, 'summary' | 'wentWell' | 'slipped' | 'focusNext'>
    return { summary: c.summary, wentWell: c.wentWell ?? [], slipped: c.slipped ?? [], focusNext: c.focusNext ?? [], writtenAt: String(row.written_at), writtenBy: String(row.written_by) }
  }

  private basis(weekStart: string): Basis | null {
    const row = this.db.prepare('SELECT basis FROM weekly_reflections WHERE week_start = ?').get(weekStart) as { basis: string } | undefined
    return row ? (JSON.parse(row.basis) as Basis) : null
  }

  /**
   * A week's four lists. 'live' is the current week as it is now. 'saved' is an ended week as it
   * stood at its end (Saturday night): tasks finished later count as still open then. 'partial'
   * has only what was completed and added.
   */
  private lists(weekStart: string, record: WeekRecord): WeeklyLists {
    const { from, to } = weekBounds(weekStart)
    const tasks = this.tasks.listForWeek(from, to)
    const sources = this.sourcesOf(tasks.map((t) => t.id))
    const item = (t: Task, detail: string, extra: Partial<WeeklyItem> = {}): WeeklyItem => ({
      taskId: t.id,
      title: t.title,
      project: t.project?.name ?? null,
      projectColor: t.project?.color ?? null,
      detail,
      at: null,
      overdueDays: null,
      days: null,
      ...extra,
    })
    const inWeek = (iso: string | null) => !!iso && iso >= from && iso < to

    const completed = tasks
      .filter((t) => t.status === 'done' && inWeek(t.completedAt))
      .sort((a, b) => a.completedAt!.localeCompare(b.completedAt!))
      .map((t) => item(t, t.project?.name ?? '', { at: t.completedAt }))
    const added = tasks
      .filter((t) => inWeek(t.createdAt))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((t) => {
        const source = sources.get(t.id)
        return item(t, source ? `From import: ${source}` : 'Added by you', { at: t.createdAt })
      })
    if (record === 'partial') return { completed, added, slipping: null, waiting: null }

    // "Overdue" means due before the day it's measured on: today, or the Sunday after a saved week.
    const live = record === 'live'
    const asOfDay = live ? ymd(this.now()) : addDays(weekStart, 7)
    const asOf = live ? this.now().getTime() : dayStart(asOfDay).getTime()
    const finishedLater = (t: Task) => t.status === 'done' && (t.completedAt ?? '') >= to
    const openThen = (t: Task) => (live ? t.status === 'open' : t.status === 'open' || (finishedLater(t) && !t.waitedOn))
    const overdue = tasks
      .filter((t) => openThen(t) && t.dueDate && t.dueDate < asOfDay)
      .map((t) => item(t, `Due ${dueLabel(t.dueDate!)}`, { overdueDays: daysBetween(t.dueDate!, asOfDay) }))
      .sort((a, b) => b.overdueDays! - a.overdueDays! || a.title.localeCompare(b.title))
    // Also slipping: tasks whose due date was pushed later during the week (net, from the event log),
    // unless they were finished by the week's end. Dates moved earlier, set or removed don't count.
    const byTask = new Map(tasks.map((t) => [t.id, t]))
    const moves = new Map<number, DueMove[]>()
    for (const m of this.events.dueMoves(from, to)) moves.set(m.taskId, [...(moves.get(m.taskId) ?? []), m])
    const pushed: WeeklyItem[] = []
    for (const [taskId, list] of moves) {
      const t = byTask.get(taskId)
      const net = daysBetween(list[0]!.from, list.at(-1)!.to)
      if (!t || net <= 0 || (t.status === 'done' && (live || (t.completedAt ?? '') < to))) continue
      const who = eventWho(list.at(-1)!)
      const late = overdue.find((i) => i.taskId === taskId)
      if (late) {
        late.detail += ` · pushed back from ${shortDate(list[0]!.from)}, ${who}`
        late.pushedDays = net
        continue
      }
      const chain = [`${shortDate(list[0]!.from)} → ${shortDate(list[0]!.to)}`, ...list.slice(1).map((m) => `then ${shortDate(m.to)}`)].join(', ')
      pushed.push(item(t, `${chain}, ${who}`, { pushedDays: net }))
    }
    pushed.sort((a, b) => b.pushedDays! - a.pushedDays! || a.title.localeCompare(b.title))
    const slipping = [...overdue, ...pushed]
    // A task finished after a saved week was still waiting then; how long isn't kept once it's done.
    const waitingThen = (t: Task) => (live ? t.status === 'waiting_on' : (t.status === 'waiting_on' && (t.waitingSince ?? '') < to) || (finishedLater(t) && !!t.waitedOn))
    const waiting = tasks
      .filter(waitingThen)
      .map((t) => {
        const since = t.status === 'waiting_on' ? (t.waitingSince ?? t.lastActivityAt) : null
        return item(t, (t.waitingOn ?? t.waitedOn ?? 'someone').trim(), { days: since ? Math.max(0, Math.floor((asOf - Date.parse(since)) / DAY)) : null })
      })
      .sort((a, b) => (b.days ?? -1) - (a.days ?? -1) || a.title.localeCompare(b.title))
    return { completed, added, slipping, waiting }
  }

  /** The import each task came from, for tasks created by accepting a suggestion. */
  private sourcesOf(ids: number[]): Map<number, string> {
    if (!ids.length) return new Map()
    const rows = this.db
      .prepare(
        `SELECT s.result_task_id AS task_id, si.title AS title FROM suggestions s JOIN source_items si ON si.id = s.source_id
         WHERE s.status = 'accepted' AND s.kind IN ('new_task', 'needs_reply', 'waiting_on') AND s.result_task_id IN (${ids.map(() => '?').join(', ')})
         ORDER BY s.decided_at`,
      )
      .all(...ids) as { task_id: number; title: string }[]
    const map = new Map<number, string>()
    for (const r of rows) if (!map.has(Number(r.task_id))) map.set(Number(r.task_id), r.title)
    return map
  }
}
