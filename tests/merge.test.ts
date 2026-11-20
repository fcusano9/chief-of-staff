import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db'
import { BriefService, PersonService, ProjectService } from '../src/main/services/directory'
import { NextActionService } from '../src/main/services/next-actions'
import { PriorityAdjustmentService } from '../src/main/services/priority-adjustments'
import { SuggestionService } from '../src/main/services/suggestions'
import { TaskEventService } from '../src/main/services/task-events'
import { TaskMergeService } from '../src/main/services/task-merge'
import { TaskService } from '../src/main/services/tasks'
import { eventOn, eventWhat } from '@shared/events'
import { joinNotes, mergedInput, mergeFields, mergeProblem } from '@shared/merge'
import { mergeUpdates } from '@shared/notes'
import { DEFAULT_SETTINGS, type Task, type TaskInput } from '@shared/types'

const input = (o: Partial<TaskInput>): TaskInput => ({
  id: 0, title: 'Task', notes: null, status: 'open', dueDate: null, projectId: null, requesterId: null,
  priorityOverride: null, followUpCount: 0, waitingOn: null, subtasks: [], ...o,
})
const at = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h)

/** A Task as the services return it, for the shared rules. */
const taskOf = (o: Partial<Task>): Task => ({
  id: 1, title: 'Task', notes: null, status: 'open', dueDate: null, projectId: null, requesterId: null, priorityScore: 50, priorityRationale: null,
  priorityOverride: null, aiAdjustment: null, followUpCount: 0, waitingOn: null, waitingSince: null, waitedOn: null, createdAt: '2026-11-01T10:00:00.000Z',
  lastActivityAt: '2026-11-01T10:00:00.000Z', completedAt: null, resolution: null, subtasks: [], linkedSources: [], project: null, requester: null, ...o,
})

describe('merge rules', () => {
  it('asks only where both items have a different value; a value wins over an empty one', () => {
    const keep = taskOf({ id: 1, title: 'Dealer FAQ', projectId: 1, dueDate: '2026-11-21', requesterId: 4, priorityOverride: null })
    const other = taskOf({ id: 2, title: 'dealer faq ', projectId: 2, dueDate: null, requesterId: 4, priorityOverride: 80 })
    expect(mergeFields(keep, other).map((r) => [r.field, r.state])).toEqual([
      ['title', 'same'],
      ['projectId', 'choose'],
      ['dueDate', 'keep'],
      ['requesterId', 'same'],
      ['priorityOverride', 'other'],
    ])
  })

  it('shows Waiting on only for waiting items', () => {
    const a = taskOf({ id: 1, status: 'waiting_on', waitingOn: 'Priya Shah' })
    const b = taskOf({ id: 2, status: 'waiting_on', waitingOn: 'Marco Diaz' })
    expect(mergeFields(a, b).find((r) => r.field === 'waitingOn')?.state).toBe('choose')
    expect(mergeFields(taskOf({ id: 1 }), taskOf({ id: 2 })).some((r) => r.field === 'waitingOn')).toBe(false)
  })

  it('keeps the kept item’s value unless the user picked the other’s', () => {
    const keep = taskOf({ id: 1, title: 'A', projectId: 1, dueDate: '2026-11-21', followUpCount: 1, notes: 'Mine', subtasks: [{ id: 5, title: 'One', isDone: true }] })
    const other = taskOf({ id: 2, title: 'B', projectId: 2, dueDate: '2026-11-24', followUpCount: 2, notes: 'Theirs', priorityOverride: 70, subtasks: [{ id: 9, title: 'Two', isDone: false }] })
    const merged = mergedInput(keep, other, { dueDate: 'other' })
    expect(merged).toMatchObject({ id: 1, title: 'A', projectId: 1, dueDate: '2026-11-24', priorityOverride: 70, followUpCount: 3, notes: 'Mine\n\nTheirs', status: 'open', waitingOn: null })
    expect(merged.subtasks).toEqual([{ id: 5, title: 'One', isDone: true }, { id: 0, title: 'Two', isDone: false }])
  })

  it('joins Notes with a blank line', () => {
    expect(joinNotes('Mine\n', '  Theirs ')).toBe('Mine\n\nTheirs')
    expect(joinNotes(null, 'Theirs')).toBe('Theirs')
    expect(joinNotes('  ', null)).toBeNull()
  })

  it('merges only two open tasks or two waiting items', () => {
    const open = taskOf({ id: 1 })
    expect(mergeProblem(open, taskOf({ id: 1 }))).toMatch(/different item/)
    expect(mergeProblem(open, taskOf({ id: 2, status: 'done' }))).toMatch(/Only open tasks and waiting items/)
    expect(mergeProblem(open, taskOf({ id: 2, status: 'waiting_on' }))).toMatch(/only be merged with another task/)
    expect(mergeProblem(open, taskOf({ id: 2 }))).toBeNull()
  })

  it('merges Updates in date order, keeping a line in both once', () => {
    const a = 'Nov 2, 2026: Kickoff\nNov 10, 2026: Draft sent\nno date, stays after Draft sent\nNov 12, 2026: Same line'
    const b = 'Oct 30, 2026: Asked for it\nNov 10, 2026: Legal has it\nNov 12, 2026: Same line'
    expect(mergeUpdates(a, b).split('\n')).toEqual([
      'Oct 30, 2026: Asked for it',
      'Nov 2, 2026: Kickoff',
      'Nov 10, 2026: Draft sent',
      'no date, stays after Draft sent',
      'Nov 10, 2026: Legal has it',
      'Nov 12, 2026: Same line',
    ])
    expect(mergeUpdates('', '')).toBe('')
  })

  it('reads in Activity', () => {
    const e = { kind: 'merged' as const, from: 'Firmware FAQ', to: null, note: null }
    expect(eventWhat(e)).toBe('Merged in “Firmware FAQ”')
    expect(eventOn({ mergedFrom: 'Firmware FAQ' })).toBe('on “Firmware FAQ”')
    expect(eventOn({ mergedFrom: null })).toBeNull()
  })
})

describe('TaskMergeService', () => {
  let folder: string
  let db: DatabaseSync
  let tasks: TaskService
  let merges: TaskMergeService
  let briefs: BriefService
  let clock: Date

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'cos-merge-'))
    db = openDatabase(join(folder, 'test.db'))
    clock = at(2026, 11, 3)
    tasks = new TaskService(db, () => DEFAULT_SETTINGS.priorityWeights, () => clock)
    merges = new TaskMergeService(db, tasks, () => clock)
    briefs = new BriefService(db)
  })
  afterEach(() => {
    db.close()
    rmSync(folder, { recursive: true, force: true })
  })

  const count = (sql: string, ...args: (number | string)[]) => Number((db.prepare(sql).get(...args) as { n: number }).n)
  const source = (id: number, title: string) =>
    db.prepare(`INSERT INTO source_items (id, kind, title, occurred_at, content, content_hash, imported_at) VALUES (?, 'email', ?, ?, 'x', ?, ?)`).run(id, title, clock.toISOString(), `h${id}`, clock.toISOString())

  it('keeps the chosen fields and combines Notes, subtasks, follow-ups, and dates, then removes the other', () => {
    const launch = new ProjectService(db).save({ id: 0, name: 'Launch', color: '#378ADD', status: 'active' })
    const portal = new ProjectService(db).save({ id: 0, name: 'Portal', color: '#3B9C6E', status: 'active' })
    const kenji = new PersonService(db).save({ id: 0, name: 'Kenji Mori', role: null, company: null, email: null, priorityWeight: 3 })
    const other = tasks.save(input({ title: 'Firmware FAQ', projectId: portal.id, dueDate: '2026-11-24', notes: 'Portal version too.', followUpCount: 2, priorityOverride: 80, subtasks: [{ id: 0, title: 'Collect questions', isDone: false }] }))
    clock = at(2026, 11, 5)
    const keep = tasks.save(input({ title: 'Dealer FAQ', projectId: launch.id, dueDate: '2026-11-21', requesterId: kenji.id, notes: 'Upgrade steps.', followUpCount: 1, subtasks: [{ id: 0, title: 'Draft Q&A', isDone: true }] }))

    clock = at(2026, 11, 17)
    const merged = merges.merge(keep.id, other.id, { projectId: 'other' })

    expect(merged).toMatchObject({ id: keep.id, title: 'Dealer FAQ', projectId: portal.id, dueDate: '2026-11-21', requesterId: kenji.id, priorityOverride: 80, followUpCount: 3, notes: 'Upgrade steps.\n\nPortal version too.' })
    expect(merged.subtasks.map((s) => [s.title, s.isDone])).toEqual([['Draft Q&A', true], ['Collect questions', false]])
    expect(merged.createdAt).toBe(other.createdAt)
    expect(tasks.get(other.id)).toBeNull()
  })

  it('keeps the earlier wait start and the chosen person for waiting items', () => {
    const a = tasks.save(input({ title: 'Signed SOW', status: 'waiting_on', waitingOn: 'Priya Shah' }))
    clock = at(2026, 11, 6)
    const b = tasks.save(input({ title: 'SOW countersignature', status: 'waiting_on', waitingOn: 'Marco Diaz' }))
    clock = at(2026, 11, 17)
    const merged = merges.merge(b.id, a.id, { waitingOn: 'other' })
    expect(merged).toMatchObject({ status: 'waiting_on', waitingOn: 'Priya Shah', waitingSince: a.waitingSince, createdAt: a.createdAt })
  })

  it('moves Activity over, tagged with the other’s title, under one Merged line', () => {
    const other = tasks.save(input({ title: 'Firmware FAQ' }))
    clock = at(2026, 11, 4)
    tasks.save({ ...tasks.get(other.id)!, dueDate: '2026-11-08' })
    clock = at(2026, 11, 5)
    tasks.save({ ...tasks.get(other.id)!, dueDate: '2026-11-12' })
    const keep = tasks.save(input({ title: 'Dealer FAQ', dueDate: '2026-11-21' }))

    clock = at(2026, 11, 17)
    merges.merge(keep.id, other.id, { dueDate: 'other' })
    const lines = tasks.activity(keep.id).events.map((e) => [eventWhat(e, clock), e.mergedFrom])
    expect(lines).toEqual([
      ['Merged in “Firmware FAQ”', null],
      ['Due date moved: Nov 21 → Nov 12', null],
      ['Created', null],
      ['Due date moved: Nov 8 → Nov 12', 'Firmware FAQ'],
      ['Due date set: Nov 8', 'Firmware FAQ'],
      ['Created', 'Firmware FAQ'],
    ])
    // The other task's own date moves aren't the kept task slipping.
    const moves = new TaskEventService(db).dueMoves('2026-11-01T00:00:00.000Z', '2026-11-30T00:00:00.000Z')
    expect(moves.map((m) => [m.taskId, m.from, m.to])).toEqual([[keep.id, '2026-11-21', '2026-11-12']])
  })

  it('keeps a line’s first title when an already-merged task is merged again', () => {
    const c = tasks.save(input({ title: 'C' }))
    const b = tasks.save(input({ title: 'B' }))
    const a = tasks.save(input({ title: 'A' }))
    merges.merge(b.id, c.id)
    merges.merge(a.id, b.id)
    const created = tasks.activity(a.id).events.filter((e) => e.kind === 'created').map((e) => e.mergedFrom)
    expect(created.sort()).toEqual(['B', 'C', null].sort())
  })

  it('merges Updates and linked imports, and repoints Review suggestions', () => {
    const keep = tasks.save(input({ title: 'Dealer FAQ' }))
    const other = tasks.save(input({ title: 'Firmware FAQ' }))
    briefs.save({ scope: 'task', ownerId: keep.id, summary: 'Nov 10, 2026: Draft sent', standingInstructions: '', updatedAt: null })
    briefs.save({ scope: 'task', ownerId: other.id, summary: 'Nov 2, 2026: Asked for it\nNov 12, 2026: Legal has it', standingInstructions: '', updatedAt: null })
    source(1, 'Launch sync')
    source(2, 'Dealer email')
    db.prepare('INSERT INTO task_sources (work_item_id, source_id) VALUES (?, 1), (?, 1), (?, 2)').run(keep.id, other.id, other.id)
    const suggest = (kind: string, status: string, payload: object, result: number | null = null) =>
      Number(db.prepare(`INSERT INTO suggestions (source_id, kind, status, payload, evidence, created_at, result_task_id) VALUES (2, ?, ?, ?, '', ?, ?)`).run(kind, status, JSON.stringify(payload), clock.toISOString(), result).lastInsertRowid)
    const base = { taskId: null, title: '', details: '', dueDate: null, projectId: null, requesterId: null, requesterName: null, waitingOn: null, briefScope: null, briefOwnerId: null }
    const done = suggest('mark_done', 'pending', { ...base, taskId: other.id })
    const brief = suggest('brief_update', 'pending', { ...base, briefScope: 'task', briefOwnerId: other.id, details: 'Legal approved.' })
    const created = suggest('new_task', 'accepted', { ...base, title: 'Firmware FAQ' }, other.id)

    merges.merge(keep.id, other.id)

    expect(briefs.get('task', keep.id).summary).toBe('Nov 2, 2026: Asked for it\nNov 10, 2026: Draft sent\nNov 12, 2026: Legal has it')
    expect(count(`SELECT COUNT(*) AS n FROM context_briefs WHERE scope = 'task' AND owner_id = ?`, other.id)).toBe(0)
    expect(tasks.get(keep.id)!.linkedSources.map((s) => s.title).sort()).toEqual(['Dealer email', 'Launch sync'])
    const payload = (id: number) => JSON.parse(String((db.prepare('SELECT payload FROM suggestions WHERE id = ?').get(id) as { payload: string }).payload))
    expect(payload(done).taskId).toBe(keep.id)
    expect(payload(brief).briefOwnerId).toBe(keep.id)
    expect(count('SELECT result_task_id AS n FROM suggestions WHERE id = ?', created)).toBe(keep.id)

    // The repointed suggestion still works.
    const service = new SuggestionService(db, tasks, briefs, new ProjectService(db), new PersonService(db))
    expect(service.listPending().find((s) => s.id === done)?.taskTitle).toBe('Dealer FAQ')
    service.accept(brief)
    expect(briefs.get('task', keep.id).summary).toContain('Legal approved.')
  })

  it('clears both status cards and AI priority changes, and records the kept one’s removal', () => {
    const keep = tasks.save(input({ title: 'Dealer FAQ' }))
    const other = tasks.save(input({ title: 'Firmware FAQ' }))
    const cards = new NextActionService(db)
    cards.save([{ taskId: keep.id, action: 'Send it.', status: ['Draft done'] }, { taskId: other.id, action: 'Ask legal.', status: [] }], { writtenBy: 'Fake AI', origin: 'briefing' })
    new PriorityAdjustmentService(db).save([{ taskId: keep.id, delta: 10, reason: 'Webinar.' }, { taskId: other.id, delta: -5, reason: 'Later.' }], { writtenBy: 'Fake AI', origin: 'briefing' })

    clock = new Date(Date.now() + 60_000) // after the AI changes, which are stamped with the real time
    const merged = merges.merge(keep.id, other.id)
    expect(cards.get(keep.id)).toBeNull()
    expect(merged.aiAdjustment).toBeNull()
    expect(count('SELECT COUNT(*) AS n FROM next_actions')).toBe(0)
    expect(count('SELECT COUNT(*) AS n FROM priority_adjustments')).toBe(0)
    const own = tasks.activity(keep.id).events.filter((e) => !e.mergedFrom).map((e) => eventWhat(e, clock))
    expect(own.slice(0, 2)).toEqual(['Merged in “Firmware FAQ”', 'AI priority change removed (was +10)'])
  })

  it('refuses items that can’t be merged and changes nothing', () => {
    const open = tasks.save(input({ title: 'Open' }))
    const waiting = tasks.save(input({ title: 'Waiting', status: 'waiting_on', waitingOn: 'Priya' }))
    const done = tasks.save(input({ title: 'Done', status: 'done' }))
    expect(() => merges.merge(open.id, waiting.id)).toThrow(/another task/)
    expect(() => merges.merge(open.id, done.id)).toThrow(/Only open tasks/)
    expect(() => merges.merge(open.id, open.id)).toThrow(/different item/)
    expect(() => merges.merge(open.id, 999)).toThrow(/no longer exists/)
    expect(count('SELECT COUNT(*) AS n FROM work_items')).toBe(3)
    expect(tasks.activity(open.id).events).toHaveLength(1)
  })
})
