import type { DatabaseSync } from 'node:sqlite'
import { effectivePriority, type AiCall, type Briefing, type BriefingListItem, type BriefingTrigger, type Task } from '@shared/types'
import { assembleBriefing, type BriefingInput } from '../ai/briefing'
import type { AiCallRecord, AiProvider } from '../ai/provider'
import { nowIso, transaction } from '../db'
import type { TaskService } from './tasks'
import { paidModelOf, UsageService } from './usage'

/** Briefings whose AI requests are kept. The briefings themselves are all kept. */
export const BRIEFING_CALLS_KEPT = 5
/** Open tasks sent to the AI to pick priorities from, highest priority first (overdue ones always go). */
const TASKS_SENT = 25
const WAITING_SENT = 20

const DAY = 86_400_000
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
/** Whole days from one 'YYYY-MM-DD' to another. */
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY)
const stamp = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/**
 * The daily briefing: a short read on the day, written by the AI from the open tasks, the
 * waiting-on list and what's new since the last briefing. It only ever reads; nothing is changed
 * and nothing goes to Review. Every briefing is saved.
 *
 * write() takes a trigger so a scheduler can call it later exactly as the button does.
 */
export class BriefingService {
  private writing: Promise<Briefing> | null = null
  private readonly usage: UsageService

  constructor(
    private readonly db: DatabaseSync,
    private readonly tasks: TaskService,
    private readonly provider: () => AiProvider,
    private readonly userName: () => string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.usage = new UsageService(db)
  }

  /** Writes and saves a new briefing. A second call while one is being written gets the same one. */
  write(trigger: BriefingTrigger = 'manual'): Promise<Briefing> {
    this.writing ??= this.writeNow(trigger).finally(() => {
      this.writing = null
    })
    return this.writing
  }

  /** True while a briefing is being written, so the UI can show it after switching screens. */
  isWriting(): boolean {
    return this.writing !== null
  }

  latest(): Briefing | null {
    const row = this.db.prepare('SELECT * FROM briefings ORDER BY id DESC LIMIT 1').get() as Record<string, unknown> | undefined
    return row ? toBriefing(row) : null
  }

  get(id: number): Briefing | null {
    const row = this.db.prepare('SELECT * FROM briefings WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? toBriefing(row) : null
  }

  /** Every saved briefing, newest first. */
  list(): BriefingListItem[] {
    return (this.db.prepare('SELECT id, created_at, started_by FROM briefings ORDER BY id DESC').all() as Record<string, unknown>[]).map((r) => ({
      id: Number(r.id),
      createdAt: String(r.created_at),
      trigger: r.started_by as BriefingTrigger,
      estimatedCost: this.usage.briefingCost(Number(r.id)),
    }))
  }

  /** The requests sent to the AI for a briefing and what came back. Empty for older briefings. */
  aiCalls(id: number): AiCall[] {
    return (this.db.prepare('SELECT * FROM briefing_ai_calls WHERE briefing_id = ? ORDER BY id').all(id) as Record<string, unknown>[]).map((c) => ({
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

  /** What the AI is given: open tasks, waiting-on items and what's new since the last briefing. */
  buildInput(): { input: BriefingInput; since: string } {
    const now = this.now()
    const today = ymd(now)
    const previous = this.db.prepare('SELECT created_at FROM briefings ORDER BY id DESC LIMIT 1').get() as { created_at: string } | undefined
    const since = previous?.created_at ?? new Date(now.getTime() - DAY).toISOString()

    const active = this.tasks.listActive()
    const open = active.filter((t) => t.status !== 'waiting_on')
    const overdue = (t: Task) => (t.dueDate && t.dueDate < today ? daysBetween(t.dueDate, today) : null)
    const sent = open.filter((t, i) => i < TASKS_SENT || overdue(t))
    const waiting = this.tasks.listWaiting().slice(0, WAITING_SENT)
    const isNew = (t: Task) => t.createdAt > since || (t.status === 'waiting_on' && (t.waitingSince ?? '') > since)
    const fresh = active.filter(isNew).sort((a, b) => Math.max(+new Date(b.createdAt), +new Date(b.waitingSince ?? 0)) - Math.max(+new Date(a.createdAt), +new Date(a.waitingSince ?? 0)))
    const newReviewCount = Number((this.db.prepare(`SELECT COUNT(*) AS n FROM suggestions WHERE status = 'pending' AND created_at > ?`).get(since) as { n: number }).n)

    return {
      since,
      input: {
        userName: this.userName(),
        today,
        weekday: now.toLocaleDateString('en-US', { weekday: 'long' }),
        sinceLabel: stamp(since),
        tasks: sent.map((t) => ({
          id: t.id,
          title: t.title,
          project: t.project?.name ?? null,
          requester: t.requester?.name ?? null,
          due: t.dueDate,
          overdueDays: overdue(t),
          priority: effectivePriority(t),
          reason: t.priorityRationale,
          notes: t.notes,
        })),
        waiting: waiting.map((t) => ({
          id: t.id,
          title: t.title,
          project: t.project?.name ?? null,
          waitingOn: t.waitingOn ?? 'someone',
          days: Math.max(0, Math.floor((now.getTime() - Date.parse(t.waitingSince ?? t.lastActivityAt)) / DAY)),
          followUps: t.followUpCount,
          due: t.dueDate,
        })),
        newTasks: fresh.map((t) => ({
          id: t.id,
          title: t.title,
          project: t.project?.name ?? null,
          waitingOn: t.status === 'waiting_on' ? (t.waitingOn ?? 'someone') : null,
          fallbackNote: t.status === 'waiting_on' && t.createdAt <= since ? `Now waiting on ${t.waitingOn ?? 'someone'}.` : `Added ${stamp(t.createdAt)}.`,
        })),
        newReviewCount,
      },
    }
  }

  private async writeNow(trigger: BriefingTrigger): Promise<Briefing> {
    const provider = this.provider()
    const { input, since } = this.buildInput()
    const calls: AiCallRecord[] = []
    const raw = await provider.writeBriefing(input, { record: (c) => void calls.push(c) })
    const sections = assembleBriefing(input, raw)
    const createdAt = nowIso()

    const id = transaction(this.db, () => {
      const id = Number(
        this.db
          .prepare('INSERT INTO briefings (created_at, started_by, written_by, since, content) VALUES (?, ?, ?, ?, ?)')
          .run(createdAt, trigger, provider.label, since, JSON.stringify(sections)).lastInsertRowid,
      )
      const insert = this.db.prepare(
        `INSERT INTO briefing_ai_calls (briefing_id, purpose, endpoint, request, response, error, started_at, duration_ms, input_tokens, output_tokens)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      const pretty = (v: unknown) => JSON.stringify(v, null, 2)
      for (const c of calls) {
        insert.run(id, c.purpose, c.endpoint, pretty(c.request), c.response == null ? null : pretty(c.response), c.error, c.startedAt, c.durationMs, c.inputTokens, c.outputTokens)
        this.usage.record(c, 'briefing', id)
      }
      // The AI requests are the bulky part; keep them for the newest few briefings only.
      this.db
        .prepare(`DELETE FROM briefing_ai_calls WHERE briefing_id NOT IN (SELECT id FROM briefings ORDER BY id DESC LIMIT ${BRIEFING_CALLS_KEPT})`)
        .run()
      return id
    })
    return this.get(id)!
  }
}

function toBriefing(row: Record<string, unknown>): Briefing {
  const content = JSON.parse(String(row.content)) as Pick<Briefing, 'summary' | 'priorities' | 'nudges' | 'newItems'>
  return {
    id: Number(row.id),
    createdAt: String(row.created_at),
    trigger: row.started_by as BriefingTrigger,
    writtenBy: String(row.written_by),
    since: String(row.since),
    summary: content.summary,
    priorities: content.priorities ?? [],
    nudges: content.nudges ?? [],
    newItems: content.newItems ?? [],
  }
}
