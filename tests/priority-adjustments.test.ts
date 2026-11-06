import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assembleBriefing, buildBriefingPrompt, type BriefingInput, type RawBriefing } from '../src/main/ai/briefing'
import { buildExtractionContext, buildSystemPrompt, buildUserPrompt } from '../src/main/ai/context'
import { DemoProvider } from '../src/main/ai/demo'
import { extractionJsonSchema } from '../src/main/ai/ollama'
import type { AiProvider } from '../src/main/ai/provider'
import type { RawPriorityChange, RawSuggestion } from '../src/main/ai/schema'
import { openDatabase } from '../src/main/db'
import { BriefingService } from '../src/main/services/briefings'
import { cleanAdjustments, PriorityAdjustmentService } from '../src/main/services/priority-adjustments'
import { SourceService } from '../src/main/services/sources'
import { TaskService } from '../src/main/services/tasks'
import { DEFAULT_SETTINGS, effectivePriority, type TaskInput } from '@shared/types'

const task = (o: Partial<TaskInput>): TaskInput => ({
  id: 0, title: 'Task', notes: null, status: 'open', dueDate: null, projectId: null, requesterId: null,
  priorityOverride: null, followUpCount: 0, waitingOn: null, subtasks: [], ...o,
})
const raw = (o: Partial<RawSuggestion>): RawSuggestion => ({
  kind: 'new_task', task_id: null, title: '', details: '', due_date: null, project_id: null, requester_name: null,
  waiting_on: null, brief_scope: null, brief_owner_id: null, project_name: null, role: null, company: null, email: null, evidence: 'quote', ...o,
})
const change = (task_id: number, n: number, reason = 'Dana needs it first.'): RawPriorityChange => ({ task_id, change: n, reason })

class Fake implements AiProvider {
  readonly label = 'Fake AI'
  readonly sendsDataExternally = false
  constructor(private readonly o: { suggestions?: RawSuggestion[]; changes?: RawPriorityChange[]; briefing?: RawBriefing } = {}) {}
  async extract() {
    return { suggestions: this.o.suggestions ?? [], next_actions: [], priority_changes: this.o.changes ?? [] }
  }
  async writePersonBrief() {
    return ''
  }
  async writeStatus() {
    return { status: ['Done.'], action: 'Do it.' }
  }
  async writeReply() {
    return { reply_all: false, body: 'Hi.' }
  }
  async writeBriefing() {
    return this.o.briefing ?? { summary: 'S', priorities: [], nudges: [], new_items: [], priority_changes: [] }
  }
  async writeWeeklyReflection() {
    return { summary: '', went_well: [], slipped: [], focus_next: [] }
  }
  async test() {
    return 'ok'
  }
}

const briefingInput = (): BriefingInput => ({
  userName: 'Frank Cusano', today: '2026-11-04', weekday: 'Wednesday', sinceLabel: 'Nov 3, 4:40 PM',
  tasks: [
    { id: 1, title: 'Roadmap slides', project: null, requester: null, due: null, overdueDays: null, priority: 40, aiChange: { delta: 10, reason: 'Board meeting moved up.' }, reason: null, notes: null, updates: [] },
    { id: 2, title: 'Old wiki cleanup', project: null, requester: null, due: null, overdueDays: null, priority: 30, aiChange: null, reason: null, notes: null, updates: [] },
  ],
  waiting: [],
  newTasks: [],
  newReviewCount: 0,
})

describe('priority adjustments: rules', () => {
  it('holds changes to ±15, rounds them, keeps one per known task, and needs a reason unless it is 0', () => {
    const out = cleanAdjustments(
      [change(1, 40), change(1, 5), change(2, -22.6), change(3, 7, '  '), change(4, 0, ''), change(99, 5)],
      new Set([1, 2, 3, 4]),
    )
    expect(out).toEqual([
      { taskId: 1, delta: 15, reason: 'Dana needs it first.' },
      { taskId: 2, delta: -15, reason: 'Dana needs it first.' },
      { taskId: 4, delta: 0, reason: '' },
    ])
  })

  it('the score lists use is the computed score plus the change, kept within 0 to 100; a score set by hand wins', () => {
    expect(effectivePriority({ priorityScore: 54, priorityOverride: null, aiAdjustment: { delta: 10 } })).toBe(64)
    expect(effectivePriority({ priorityScore: 95, priorityOverride: null, aiAdjustment: { delta: 15 } })).toBe(100)
    expect(effectivePriority({ priorityScore: 5, priorityOverride: null, aiAdjustment: { delta: -15 } })).toBe(0)
    expect(effectivePriority({ priorityScore: 54, priorityOverride: 20, aiAdjustment: { delta: 10 } })).toBe(20)
    expect(effectivePriority({ priorityScore: 54, priorityOverride: null })).toBe(54)
  })

  it('the briefing sends the computed score and the current change, and asks for changes to any task it was sent', () => {
    const { system, user } = buildBriefingPrompt(briefingInput())
    expect(system).toMatch(/priority_changes/)
    expect(system).toMatch(/-15 to 15/)
    expect(user).toContain('priority 40, AI change +10: Board meeting moved up.')
    const b = assembleBriefing(briefingInput(), { summary: 'S', priorities: [], nudges: [], new_items: [], priority_changes: [change(2, -8, 'Nobody uses the wiki.'), change(9, 5)] })
    expect(b.adjustments).toEqual([{ taskId: 2, delta: -8, reason: 'Nobody uses the wiki.' }])
  })

  it('imports ask for changes with the task kinds only, and send each task its score', () => {
    const ctx = { today: '2026-11-04', userName: 'Frank Cusano', projects: [], people: [], tasks: [{ id: 1, title: 'Deck', status: 'open', dueDate: null, project: null, requester: null, waitingOn: null, updates: [], priority: 54, aiChange: null }] }
    expect(buildSystemPrompt(ctx)).toMatch(/priority_changes/)
    expect(buildSystemPrompt(ctx, ['new_project', 'new_person', 'brief_update'])).not.toMatch(/priority_changes/)
    expect(buildUserPrompt(ctx, { kind: 'note', title: 'n', fromName: null, occurredAt: '2026-11-04T12:00:00Z', content: 'x' })).toContain('[1] Deck (open, priority 54)')
    expect(Object.keys((extractionJsonSchema(['new_project', 'new_person', 'brief_update']) as { properties: object }).properties)).toEqual(['suggestions'])
  })
})

describe('priority adjustments: saving and applying', () => {
  let folder: string
  let db: DatabaseSync
  let tasks: TaskService
  let adjustments: PriorityAdjustmentService

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'cos-adjust-'))
    db = openDatabase(join(folder, 'test.db'))
    tasks = new TaskService(db, () => DEFAULT_SETTINGS.priorityWeights)
    adjustments = new PriorityAdjustmentService(db)
  })
  afterEach(() => {
    db.close()
    rmSync(folder, { recursive: true, force: true })
  })

  const importWith = (p: AiProvider, title = 'Pricing sync') =>
    new SourceService(db, () => p, () => 'Frank Cusano').importAndExtract({ kind: 'note', title, content: `notes ${Math.random()}` })

  it('an import applies changes at once and reorders the list; none for tasks it marks done or done tasks', async () => {
    const a = tasks.save(task({ title: 'Deck' }))
    const b = tasks.save(task({ title: 'Wiki' }))
    const old = tasks.save(task({ title: 'Old report' }))
    const done = tasks.save(task({ title: 'Done one', status: 'done' }))
    const base = a.priorityScore
    await importWith(new Fake({ suggestions: [raw({ kind: 'mark_done', task_id: old.id, title: 'Old report' })], changes: [change(b.id, 12), change(old.id, 10), change(done.id, 10)] }))

    const wiki = tasks.get(b.id)!
    expect(wiki.aiAdjustment).toMatchObject({ delta: 12, reason: 'Dana needs it first.', origin: 'import', originLabel: 'Pricing sync', writtenBy: 'Fake AI' })
    expect(effectivePriority(wiki)).toBe(Math.min(100, base + 12))
    expect(tasks.listActive()[0]!.id).toBe(b.id)
    expect(tasks.get(old.id)!.aiAdjustment).toBeNull()
    expect(tasks.get(done.id)!.aiAdjustment).toBeNull()
    // The AI is shown its own change on the next import, next to the computed score.
    expect(buildExtractionContext(db, 'Frank Cusano').tasks.find((t) => t.id === b.id)).toMatchObject({ priority: wiki.priorityScore, aiChange: { delta: 12 } })
  })

  it('a later change replaces it, 0 removes it, and Remove takes it off', async () => {
    const t = tasks.save(task({ title: 'Deck' }))
    await importWith(new Fake({ changes: [change(t.id, 10)] }))
    await importWith(new Fake({ changes: [change(t.id, -5, 'Launch slipped a month.')] }), 'Later')
    expect(tasks.get(t.id)!.aiAdjustment).toMatchObject({ delta: -5, reason: 'Launch slipped a month.', originLabel: 'Later' })
    await importWith(new Fake({ changes: [change(t.id, 0, '')] }), 'Third')
    expect(tasks.get(t.id)!.aiAdjustment).toBeNull()

    await importWith(new Fake({ changes: [change(t.id, 7)] }), 'Fourth')
    adjustments.remove(t.id)
    expect(tasks.get(t.id)!.aiAdjustment).toBeNull()
  })

  it('an import that skips a task keeps its change', async () => {
    const t = tasks.save(task({ title: 'Deck' }))
    await importWith(new Fake({ changes: [change(t.id, 10)] }))
    await importWith(new Fake({ changes: [] }), 'Unrelated')
    expect(tasks.get(t.id)!.aiAdjustment?.delta).toBe(10)
  })

  it('a briefing applies changes; Basic changes none', async () => {
    const t = tasks.save(task({ title: 'Deck' }))
    const fake = new Fake({ briefing: { summary: 'S', priorities: [], nudges: [], new_items: [], priority_changes: [change(t.id, 9, 'Board meeting moved up.')] } })
    await new BriefingService(db, tasks, () => fake, () => 'Frank Cusano').write()
    expect(tasks.get(t.id)!.aiAdjustment).toMatchObject({ delta: 9, origin: 'briefing', originLabel: null })
    await new BriefingService(db, tasks, () => new DemoProvider(), () => 'Frank Cusano').write()
    expect(tasks.get(t.id)!.aiAdjustment?.delta).toBe(9)
  })

  it('the briefing is sent the computed score, not the adjusted one, so a change is not counted twice', async () => {
    const t = tasks.save(task({ title: 'Deck' }))
    adjustments.save([{ taskId: t.id, delta: 15, reason: 'Board.' }], { writtenBy: 'Fake AI', origin: 'briefing' })
    const sent = new BriefingService(db, tasks, () => new DemoProvider(), () => 'Frank Cusano').buildInput().input.tasks[0]!
    expect(sent).toMatchObject({ priority: t.priorityScore, aiChange: { delta: 15, reason: 'Board.' } })
  })

  it('a score set by hand still wins, and the change is kept for the card', () => {
    const t = tasks.save(task({ title: 'Deck', priorityOverride: 20 }))
    adjustments.save([{ taskId: t.id, delta: 15, reason: 'Board.' }], { writtenBy: 'Fake AI', origin: 'briefing' })
    const loaded = tasks.get(t.id)!
    expect(effectivePriority(loaded)).toBe(20)
    expect(loaded.aiAdjustment?.delta).toBe(15)
  })

  it('is deleted with its task', () => {
    const t = tasks.save(task({ title: 'Deck' }))
    adjustments.save([{ taskId: t.id, delta: 5, reason: 'x' }], { writtenBy: 'Fake AI', origin: 'briefing' })
    tasks.delete(t.id)
    expect(Number((db.prepare('SELECT COUNT(*) AS n FROM priority_adjustments').get() as { n: number }).n)).toBe(0)
  })
})
