import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assembleBriefing, buildBriefingPrompt, type BriefingInput, type RawBriefing } from '../src/main/ai/briefing'
import { buildExtractionContext, buildSystemPrompt } from '../src/main/ai/context'
import { DemoProvider } from '../src/main/ai/demo'
import { extractionJsonSchema } from '../src/main/ai/ollama'
import type { AiProvider } from '../src/main/ai/provider'
import type { RawNextAction, RawSuggestion } from '../src/main/ai/schema'
import { openDatabase } from '../src/main/db'
import { BriefingService } from '../src/main/services/briefings'
import { BriefService } from '../src/main/services/directory'
import { cleanNextActions, NextActionService } from '../src/main/services/next-actions'
import { SourceService } from '../src/main/services/sources'
import { TaskService } from '../src/main/services/tasks'
import { DEFAULT_SETTINGS, type TaskInput } from '@shared/types'
import { noteStamp } from '@shared/notes'

const task = (o: Partial<TaskInput>): TaskInput => ({
  id: 0, title: 'Task', notes: null, status: 'open', dueDate: null, projectId: null, requesterId: null,
  priorityOverride: null, followUpCount: 0, waitingOn: null, subtasks: [], ...o,
})
const raw = (o: Partial<RawSuggestion>): RawSuggestion => ({
  kind: 'new_task', task_id: null, title: '', details: '', due_date: null, project_id: null, requester_name: null,
  waiting_on: null, brief_scope: null, brief_owner_id: null, project_name: null, role: null, company: null, email: null, evidence: 'quote', ...o,
})
const next = (task_id: number, action: string, why = 'Because.'): RawNextAction => ({ task_id, action, why })

/** Stands in for an AI: canned import answer and briefing. */
class Fake implements AiProvider {
  readonly label = 'Fake AI'
  readonly sendsDataExternally = false
  constructor(private readonly o: { suggestions?: RawSuggestion[]; next?: RawNextAction[]; briefing?: RawBriefing } = {}) {}
  async extract() {
    return { suggestions: this.o.suggestions ?? [], next_actions: this.o.next ?? [], priority_changes: [] }
  }
  async writePersonBrief() {
    return ''
  }
  async writeProjectBrief() {
    return ''
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
    { id: 1, title: 'Roadmap slides', project: null, requester: null, due: '2026-11-04', overdueDays: null, priority: 92, reason: 'Due today', notes: null, updates: [], aiChange: null },
    { id: 2, title: 'Margin model', project: null, requester: null, due: '2026-11-03', overdueDays: 1, priority: 74, reason: 'Overdue', notes: null, updates: [], aiChange: null },
  ],
  waiting: [{ id: 10, title: 'Pilot agreement', project: null, waitingOn: 'Northwind AV', days: 8, followUps: 1, due: null, updates: [] }],
  newTasks: [],
  newReviewCount: 0,
})

describe('next actions: checking what the AI wrote', () => {
  it('keeps one per known task, tidied, and drops made-up ids and empty actions', () => {
    const out = cleanNextActions([next(1, '  Send   the deck. '), next(1, 'Second one'), next(99, 'Made up'), next(2, '   ')], new Set([1, 2]))
    expect(out).toEqual([{ taskId: 1, action: 'Send the deck.', why: 'Because.' }])
  })

  it('the briefing keeps next actions only for the tasks it lists as top priorities', () => {
    const b = assembleBriefing(briefingInput(), {
      summary: 'S',
      priorities: [
        { task_id: 1, note: 'Due today.', next_action: 'Finish the last two slides.', next_why: 'Dana reviews them at 3.' },
        { task_id: 10, note: 'Wrong section.', next_action: 'Chase Northwind.', next_why: 'x' },
        { task_id: 99, note: 'Made up.', next_action: 'Nothing.', next_why: 'x' },
      ],
      nudges: [],
      new_items: [], priority_changes: [],
    })
    // Task 2 is overdue so it's listed, but the AI gave it no next action.
    expect(b.priorities.map((p) => [p.taskId, p.nextAction])).toEqual([[2, null], [1, 'Finish the last two slides.']])
    expect(b.nextActions).toEqual([{ taskId: 1, action: 'Finish the last two slides.', why: 'Dana reviews them at 3.' }])
  })

  it('asks for next actions in the briefing prompt, and with the task kinds of an import only', () => {
    expect(buildBriefingPrompt(briefingInput()).system).toMatch(/next_action/)
    const ctx = { today: '2026-11-04', userName: 'Frank Cusano', tasks: [], projects: [], people: [] }
    expect(buildSystemPrompt(ctx)).toMatch(/next_actions/)
    expect(buildSystemPrompt(ctx, ['new_task', 'status_update', 'mark_done', 'waiting_on', 'needs_reply'])).toMatch(/next_actions/)
    expect(buildSystemPrompt(ctx, ['new_project', 'new_person', 'brief_update'])).not.toMatch(/next_actions/)
    // The local model's second pass isn't given the field at all.
    const pass2 = extractionJsonSchema(['new_project', 'new_person', 'brief_update']) as { properties: object; required: string[] }
    expect(Object.keys(pass2.properties)).toEqual(['suggestions'])
    expect(pass2.required).toEqual(['suggestions'])
    expect(Object.keys((extractionJsonSchema() as { properties: object }).properties)).toEqual(['suggestions', 'next_actions', 'priority_changes'])
  })
})

describe('next actions: saving and showing', () => {
  let folder: string
  let db: DatabaseSync
  let tasks: TaskService
  let briefs: BriefService
  let nextActions: NextActionService

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'cos-next-'))
    db = openDatabase(join(folder, 'test.db'))
    tasks = new TaskService(db, () => DEFAULT_SETTINGS.priorityWeights)
    briefs = new BriefService(db)
    nextActions = new NextActionService(db)
  })
  afterEach(() => {
    db.close()
    rmSync(folder, { recursive: true, force: true })
  })

  const importWith = (p: AiProvider, title = 'Pricing sync') =>
    new SourceService(db, () => p, () => 'Frank Cusano').importAndExtract({ kind: 'note', title, content: `notes ${Math.random()}` })

  it('an import saves next actions for open tasks it was sent, and none for tasks it marks done', async () => {
    const deck = tasks.save(task({ title: 'Pricing deck' }))
    const old = tasks.save(task({ title: 'Old report' }))
    const finished = tasks.save(task({ title: 'Finished thing', status: 'done' }))
    const result = await importWith(
      new Fake({
        suggestions: [raw({ kind: 'mark_done', task_id: old.id, title: 'Old report' })],
        next: [next(deck.id, 'Send the deck to EMEA.', 'Dana asked for it by Friday.'), next(old.id, 'Archive it.'), next(finished.id, 'Nope.'), next(999, 'Made up.')],
      }),
    )
    expect(result.error).toBeNull()
    expect(nextActions.get(deck.id)).toMatchObject({
      action: 'Send the deck to EMEA.',
      why: 'Dana asked for it by Friday.',
      origin: 'import',
      originLabel: 'Pricing sync',
      writtenBy: 'Fake AI',
      dismissed: false,
      staleSince: null,
    })
    expect(nextActions.get(old.id)).toBeNull()
    expect(nextActions.get(finished.id)).toBeNull()
    // Nothing goes to Review for next actions; only the mark-done suggestion is there.
    expect(Number((db.prepare('SELECT COUNT(*) AS n FROM suggestions').get() as { n: number }).n)).toBe(1)
  })

  it('the import AI log still counts suggestions, and shows the next actions in what was proposed', async () => {
    const deck = tasks.save(task({ title: 'Pricing deck' }))
    const s = new SourceService(db, () => new Fake({ suggestions: [raw({ title: 'Book the room' })], next: [next(deck.id, 'Send it.')] }), () => 'Frank Cusano')
    const { source } = await s.importAndExtract({ kind: 'note', title: 'n', content: 'x' })
    const [run] = s.aiRuns(source.id)
    expect(run).toMatchObject({ rawCount: 1, keptCount: 1 })
    expect(JSON.parse(run!.rawOutput!).next_actions).toEqual([next(deck.id, 'Send it.')])
  })

  it('a briefing saves next actions for its top priorities; Basic writes none', async () => {
    const t = tasks.save(task({ title: 'Roadmap slides', dueDate: '2026-11-04' }))
    const fake = new Fake({ briefing: { summary: 'S', priorities: [{ task_id: t.id, note: 'Due.', next_action: 'Finish the slides.', next_why: 'Due today.' }], nudges: [], new_items: [], priority_changes: [] } })
    const b = await new BriefingService(db, tasks, () => fake, () => 'Frank Cusano').write()
    expect(b.priorities[0]).toMatchObject({ taskId: t.id, nextAction: 'Finish the slides.' })
    expect(nextActions.get(t.id)).toMatchObject({ action: 'Finish the slides.', why: 'Due today.', origin: 'briefing', originLabel: null })

    const other = tasks.save(task({ title: 'Something else' }))
    const basic = await new BriefingService(db, tasks, () => new DemoProvider(), () => 'Frank Cusano').write()
    expect(basic.priorities.every((p) => p.nextAction == null)).toBe(true)
    expect(nextActions.get(other.id)).toBeNull()
    expect(nextActions.get(t.id)!.action).toBe('Finish the slides.') // Basic didn't replace it
  })

  it('dismiss folds it away and Show brings it back; a newer one replaces it and shows again', async () => {
    const t = tasks.save(task({ title: 'Pricing deck' }))
    await importWith(new Fake({ next: [next(t.id, 'First.')] }))
    expect(nextActions.setDismissed(t.id, true)).toMatchObject({ action: 'First.', dismissed: true })
    expect(nextActions.setDismissed(t.id, false)).toMatchObject({ dismissed: false })
    nextActions.setDismissed(t.id, true)
    await importWith(new Fake({ next: [next(t.id, 'Second.')] }), 'Later call')
    expect(nextActions.get(t.id)).toMatchObject({ action: 'Second.', dismissed: false, originLabel: 'Later call' })
  })

  it('is marked out of date only by an update dated after the day it was written', () => {
    const t = tasks.save(task({ title: 'Pricing deck' }))
    nextActions.save([{ taskId: t.id, action: 'Send it.', why: '' }], { writtenBy: 'Fake AI', origin: 'briefing' })
    const today = noteStamp(new Date())
    const tomorrow = noteStamp(new Date(Date.now() + 86_400_000))
    const setUpdates = (summary: string) => briefs.save({ scope: 'task', ownerId: t.id, summary, standingInstructions: '', updatedAt: null })

    setUpdates(`${today}: Same-day update (from “Pricing sync”)`)
    expect(nextActions.get(t.id)!.staleSince).toBeNull()
    setUpdates(`${today}: Same-day update\n${tomorrow}: Dana moved the date`)
    expect(nextActions.get(t.id)!.staleSince).toBe(tomorrow)
  })

  it('is deleted with its task', () => {
    const t = tasks.save(task({ title: 'Pricing deck' }))
    nextActions.save([{ taskId: t.id, action: 'Send it.', why: '' }], { writtenBy: 'Fake AI', origin: 'briefing' })
    tasks.delete(t.id)
    expect(Number((db.prepare('SELECT COUNT(*) AS n FROM next_actions').get() as { n: number }).n)).toBe(0)
  })

  it('the extraction context still lists only open tasks, so next actions never reach done ones', () => {
    tasks.save(task({ title: 'Open one' }))
    tasks.save(task({ title: 'Done one', status: 'done' }))
    expect(buildExtractionContext(db, 'Frank Cusano').tasks.map((t) => t.title)).toEqual(['Open one'])
  })
})
