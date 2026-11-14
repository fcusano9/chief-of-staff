import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildWeeklyPrompt, demoReflection, type WeeklyInput } from '../src/main/ai/weekly'
import { openDatabase } from '../src/main/db'
import { BriefService, PersonService, ProjectService } from '../src/main/services/directory'
import { PriorityAdjustmentService } from '../src/main/services/priority-adjustments'
import { SuggestionService } from '../src/main/services/suggestions'
import { TaskService } from '../src/main/services/tasks'
import { WeeklyService } from '../src/main/services/weekly'
import { DemoProvider } from '../src/main/ai/demo'
import { eventWhat, eventWho } from '@shared/events'
import { DEFAULT_SETTINGS, type TaskEvent, type TaskInput } from '@shared/types'

const task = (o: Partial<TaskInput>): TaskInput => ({
  id: 0, title: 'Task', notes: null, status: 'open', dueDate: null, projectId: null, requesterId: null,
  priorityOverride: null, followUpCount: 0, waitingOn: null, subtasks: [], ...o,
})
const at = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h)
const NOW = at(2026, 11, 5)
const ev = (o: Partial<TaskEvent>) => ({ kind: 'created' as const, from: null, to: null, note: null, ...o })

describe('task events: how they read', () => {
  it('says what changed', () => {
    const what = (o: Partial<TaskEvent>) => eventWhat(ev(o), NOW)
    expect(what({ kind: 'created' })).toBe('Created')
    expect(what({ kind: 'status', from: 'open', to: 'done' })).toBe('Marked done')
    expect(what({ kind: 'status', from: 'done', to: 'waiting_on:Kenji Mori' })).toBe('Reopened (Waiting on Kenji Mori)')
    expect(what({ kind: 'status', from: 'done', to: 'open' })).toBe('Reopened')
    expect(what({ kind: 'status', from: 'open', to: 'waiting_on:Kenji Mori' })).toBe('Status: Waiting on Kenji Mori')
    expect(what({ kind: 'status', from: 'waiting_on:Kenji Mori', to: 'open' })).toBe('Status: Open (was Waiting on Kenji Mori)')
    expect(what({ kind: 'due', from: null, to: '2026-11-08' })).toBe('Due date set: Nov 8')
    expect(what({ kind: 'due', from: '2026-11-08', to: '2026-11-14' })).toBe('Due date moved: Nov 8 → Nov 14')
    expect(what({ kind: 'due', from: '2026-11-08', to: null })).toBe('Due date removed (was Nov 8)')
    expect(what({ kind: 'due', from: '2026-11-08', to: '2027-01-04' })).toBe('Due date moved: Nov 8 → Jan 4, 2027')
    expect(what({ kind: 'project', from: null, to: 'DM-NVX 3.2 launch' })).toBe('Project: DM-NVX 3.2 launch (was none)')
    expect(what({ kind: 'project', from: 'Pricing', to: null })).toBe('Project removed (was Pricing)')
    expect(what({ kind: 'requester', from: null, to: 'Kenji Mori' })).toBe('Asked by: Kenji Mori')
    expect(what({ kind: 'title', from: 'Dealer FAQ', to: 'Dealer FAQ v2' })).toBe('Renamed from “Dealer FAQ”')
    expect(what({ kind: 'override', from: null, to: '80' })).toBe('Priority set by hand: 80')
    expect(what({ kind: 'override', from: '80', to: null })).toBe('Priority set by hand cleared (was 80)')
    expect(what({ kind: 'followups', from: '1', to: '2' })).toBe('Follow-ups: 1 → 2')
    expect(what({ kind: 'ai_priority', from: null, to: '10', note: 'Board moved up.' })).toBe('AI priority change +10: Board moved up.')
    expect(what({ kind: 'ai_priority', from: '-12', to: null })).toBe('AI priority change removed (was −12)')
  })

  it('always says who', () => {
    expect(eventWho({ by: 'user', byLabel: null })).toBe('by you')
    expect(eventWho({ by: 'review', byLabel: 'Pricing call' })).toBe('from “Pricing call”, accepted in Review')
    expect(eventWho({ by: 'ai', byLabel: 'daily briefing' })).toBe('by the AI, daily briefing')
  })
})

describe('task events: recording', () => {
  let folder: string
  let db: DatabaseSync
  let tasks: TaskService
  let projects: ProjectService
  let people: PersonService
  let suggestions: SuggestionService
  let clock: Date

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'cos-events-'))
    db = openDatabase(join(folder, 'test.db'))
    clock = NOW
    tasks = new TaskService(db, () => DEFAULT_SETTINGS.priorityWeights, () => clock)
    projects = new ProjectService(db)
    people = new PersonService(db)
    suggestions = new SuggestionService(db, tasks, new BriefService(db), projects, people)
  })
  afterEach(() => {
    db.close()
    rmSync(folder, { recursive: true, force: true })
  })

  const kinds = (id: number) => tasks.activity(id).events.map((e) => [e.kind, e.from, e.to, e.by, e.byLabel])

  it('records creation, then one line per changed field, by you; subtasks and notes are not recorded', () => {
    const p = projects.save({ id: 0, name: 'DM-NVX 3.2 launch', color: '#378ADD', status: 'active' })
    const kenji = people.save({ id: 0, name: 'Kenji Mori', role: null, company: null, email: null, priorityWeight: 3 })
    const t = tasks.save(task({ title: 'Dealer FAQ' }))
    clock = at(2026, 11, 6)
    tasks.save({ ...tasks.get(t.id)!, title: 'Dealer FAQ for 3.2', dueDate: '2026-11-08', projectId: p.id, requesterId: kenji.id, notes: 'x', subtasks: [{ id: 0, title: 'Draft', isDone: false }] })
    clock = at(2026, 11, 7)
    tasks.save({ ...tasks.get(t.id)!, status: 'waiting_on', waitingOn: 'Kenji Mori', priorityOverride: 80, followUpCount: 1 })
    expect(kinds(t.id)).toEqual([
      ['status', 'open', 'waiting_on:Kenji Mori', 'user', null],
      ['override', null, '80', 'user', null],
      ['followups', '0', '1', 'user', null],
      ['due', null, '2026-11-08', 'user', null],
      ['project', null, 'DM-NVX 3.2 launch', 'user', null],
      ['requester', null, 'Kenji Mori', 'user', null],
      ['title', 'Dealer FAQ', 'Dealer FAQ for 3.2', 'user', null],
      ['created', null, null, 'user', null],
    ])
    // A save with no changes adds nothing.
    tasks.save(tasks.get(t.id)!)
    expect(tasks.activity(t.id).events).toHaveLength(8)
  })

  it('done and reopen are recorded', () => {
    const t = tasks.save(task({ title: 'Deck', status: 'waiting_on', waitingOn: 'Priya' }))
    tasks.setStatus(t.id, 'done')
    tasks.reopen(t.id)
    expect(tasks.activity(t.id).events.slice(0, 2).map((e) => eventWhat(e, NOW))).toEqual(['Reopened (Waiting on Priya)', 'Marked done'])
  })

  it('changes from accepting a Review suggestion say which import', () => {
    const t = tasks.save(task({ title: 'Roadmap slides', dueDate: '2026-11-09' }))
    db.prepare(`INSERT INTO source_items (id, kind, title, occurred_at, content, content_hash, imported_at) VALUES (1, 'email', 'Roadmap review moved up', ?, 'x', 'h1', ?)`).run(NOW.toISOString(), NOW.toISOString())
    const insert = (kind: string, payload: object) =>
      Number(db.prepare(`INSERT INTO suggestions (source_id, kind, payload, evidence, created_at) VALUES (1, ?, ?, '', ?)`).run(kind, JSON.stringify(payload), NOW.toISOString()).lastInsertRowid)
    const base = { taskId: null, title: '', details: '', dueDate: null, projectId: null, requesterId: null, requesterName: null, waitingOn: null, briefScope: null, briefOwnerId: null }
    suggestions.accept(insert('status_update', { ...base, taskId: t.id, details: 'Draft due Monday.', dueDate: '2026-11-17' }))
    const created = suggestions.accept(insert('new_task', { ...base, title: 'Book the room' }))!
    suggestions.accept(insert('mark_done', { ...base, taskId: t.id }))

    expect(kinds(t.id).slice(0, 2)).toEqual([
      ['status', 'open', 'done', 'review', 'Roadmap review moved up'],
      ['due', '2026-11-09', '2026-11-17', 'review', 'Roadmap review moved up'],
    ])
    expect(kinds(created)).toEqual([['created', null, null, 'review', 'Roadmap review moved up']])
  })

  it('AI priority changes are recorded as the AI, and Remove as you', () => {
    const t = tasks.save(task({ title: 'Deck' }))
    const adjust = new PriorityAdjustmentService(db)
    adjust.save([{ taskId: t.id, delta: 10, reason: 'Board moved up.' }], { writtenBy: 'Claude', origin: 'briefing' })
    adjust.save([{ taskId: t.id, delta: 10, reason: 'Board moved up.' }], { writtenBy: 'Claude', origin: 'briefing' }) // unchanged: not recorded again
    adjust.save([{ taskId: t.id, delta: -5, reason: 'Slipped a month.' }], { writtenBy: 'Claude', origin: 'import', originLabel: 'Team sync' })
    adjust.save([{ taskId: t.id, delta: 0, reason: '' }], { writtenBy: 'Claude', origin: 'briefing' })
    adjust.save([{ taskId: t.id, delta: 7, reason: 'Again.' }], { writtenBy: 'Claude', origin: 'briefing' })
    adjust.remove(t.id)
    adjust.remove(t.id) // nothing left to remove: not recorded
    expect(kinds(t.id).filter((k) => k[0] === 'ai_priority')).toEqual([
      ['ai_priority', '7', null, 'user', null],
      ['ai_priority', null, '7', 'ai', 'daily briefing'],
      ['ai_priority', '-5', null, 'ai', 'daily briefing'],
      ['ai_priority', '10', '-5', 'ai', 'import “Team sync”'],
      ['ai_priority', null, '10', 'ai', 'daily briefing'],
    ])
  })

  it('is deleted with the task', () => {
    const t = tasks.save(task({ title: 'Deck' }))
    expect(tasks.activity(t.id).events.length).toBeGreaterThan(0)
    tasks.delete(t.id)
    expect(Number((db.prepare('SELECT COUNT(*) AS n FROM task_events').get() as { n: number }).n)).toBe(0)
  })
})

describe('weekly review: pushed-back due dates', () => {
  let folder: string
  let db: DatabaseSync
  let tasks: TaskService
  let weekly: WeeklyService
  let clock: Date

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'cos-pushed-'))
    db = openDatabase(join(folder, 'test.db'))
    clock = at(2026, 10, 30) // the week before
    tasks = new TaskService(db, () => DEFAULT_SETTINGS.priorityWeights, () => clock)
    weekly = new WeeklyService(db, tasks, () => new DemoProvider(), () => 'Frank Cusano', () => clock)
  })
  afterEach(() => {
    db.close()
    rmSync(folder, { recursive: true, force: true })
  })
  const move = (id: number, due: string | null, when: Date) => {
    clock = when
    tasks.save({ ...tasks.get(id)!, dueDate: due })
  }

  it('lists tasks pushed later this week, net of all moves, after the overdue ones', () => {
    // Runs as if today were after that week, so a task's creation time must come from the test's clock.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-20T12:00:00Z') })
    const sow = tasks.save(task({ title: 'Review SOW', dueDate: '2026-11-06' }))
    const slides = tasks.save(task({ title: 'Roadmap slides', dueDate: '2026-11-09' }))
    const pulled = tasks.save(task({ title: 'Pulled in', dueDate: '2026-11-20' }))
    const removed = tasks.save(task({ title: 'Date removed', dueDate: '2026-11-10' }))
    const late = tasks.save(task({ title: 'Expense report', dueDate: '2026-11-01' }))
    const finished = tasks.save(task({ title: 'Finished anyway', dueDate: '2026-11-06' }))
    move(sow.id, '2026-11-11', at(2026, 11, 2))
    move(sow.id, '2026-11-13', at(2026, 11, 3))
    move(slides.id, '2026-11-17', at(2026, 11, 3))
    move(pulled.id, '2026-11-12', at(2026, 11, 3))
    move(removed.id, null, at(2026, 11, 3))
    move(late.id, '2026-11-04', at(2026, 11, 2)) // pushed, and still overdue by Thursday
    move(finished.id, '2026-11-08', at(2026, 11, 2))
    clock = at(2026, 11, 4)
    tasks.setStatus(finished.id, 'done')
    clock = at(2026, 11, 5)

    const slipping = weekly.get('2026-11-01').lists.slipping!
    expect(slipping.map((i) => [i.title, i.overdueDays, i.pushedDays ?? null, i.detail])).toEqual([
      ['Expense report', 1, 3, 'Due Wed, Nov 4 · pushed back from Nov 1, by you'],
      ['Roadmap slides', null, 8, 'Nov 9 → Nov 17, by you'],
      ['Review SOW', null, 7, 'Nov 6 → Nov 11, then Nov 13, by you'],
    ])
    vi.useRealTimers()
  })

  it('moves from before the week do not count, and the AI reflection hears about pushed-back tasks', () => {
    const t = tasks.save(task({ title: 'Old move', dueDate: '2026-11-03' }))
    move(t.id, '2026-11-20', at(2026, 10, 31)) // Saturday of the week before
    clock = at(2026, 11, 5)
    expect(weekly.get('2026-11-01').lists.slipping).toEqual([])

    const input: WeeklyInput = {
      userName: 'Frank Cusano', weekLabel: 'Nov 1 – 7', today: '2026-11-05', weekday: 'Thursday', lastDay: false, completed: [], added: [], waiting: [],
      slipping: [{ title: 'Roadmap slides', project: null, due: '2026-11-17', overdueDays: 0, pushedDays: 8, pushed: 'Nov 9 → Nov 17, by you' }],
    }
    expect(buildWeeklyPrompt(input).user).toContain('- Roadmap slides · due 2026-11-17, not overdue, due date pushed back 8 days this week (Nov 9 → Nov 17, by you)')
    expect(demoReflection(input).slipped).toEqual(['Roadmap slides was pushed back 8 days.'])
    expect(demoReflection(input).summary).not.toMatch(/overdue/)
  })
})
