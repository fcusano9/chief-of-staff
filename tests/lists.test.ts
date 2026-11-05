import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db'
import { TaskService } from '../src/main/services/tasks'
import { DEFAULT_SETTINGS, type TaskInput } from '@shared/types'

const input = (o: Partial<TaskInput>): TaskInput => ({
  id: 0, title: 'Task', notes: null, status: 'open', dueDate: null, projectId: null, requesterId: null,
  priorityOverride: null, followUpCount: 0, waitingOn: null, subtasks: [], ...o,
})

describe('Tasks, Waiting and Done lists', () => {
  let folder: string
  let db: DatabaseSync
  let tasks: TaskService

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'cos-lists-'))
    db = openDatabase(join(folder, 'test.db'))
    tasks = new TaskService(db, () => DEFAULT_SETTINGS.priorityWeights)
  })
  afterEach(() => {
    db.close()
    rmSync(folder, { recursive: true, force: true })
  })

  it('keeps waiting items off Tasks and on Waiting, longest waiting first', () => {
    tasks.save(input({ title: 'Send price list' }))
    tasks.save(input({ title: 'Draft outline' }))
    tasks.save(input({ title: 'Platform quotes', status: 'waiting_on', waitingOn: 'Alex Rivera', waitingSince: '2026-10-28T15:00:00.000Z' }))
    tasks.save(input({ title: 'Margin model', status: 'waiting_on', waitingOn: 'Priya Shah', waitingSince: '2026-11-02T15:00:00.000Z' }))
    expect(tasks.listActive({ list: 'tasks' }).map((t) => t.title).sort()).toEqual(['Draft outline', 'Send price list'])
    expect(tasks.listActive({ list: 'waiting' }).map((t) => t.title)).toEqual(['Platform quotes', 'Margin model'])
    expect(tasks.listActive()).toHaveLength(4) // Today and other screens still see everything active
  })

  it('searches titles, notes and who an item waits on', () => {
    tasks.save(input({ title: 'Platform quotes', status: 'waiting_on', waitingOn: 'Alex Rivera' }))
    tasks.save(input({ title: 'Send price list', notes: 'Munich distributor' }))
    expect(tasks.listActive({ list: 'waiting', search: 'alex' }).map((t) => t.title)).toEqual(['Platform quotes'])
    expect(tasks.listActive({ list: 'tasks', search: 'munich' }).map((t) => t.title)).toEqual(['Send price list'])
  })

  it('lists finished tasks newest first, apart from finished waiting items, and remembers who they waited on', () => {
    const a = tasks.save(input({ title: 'Roadmap slides' }))
    const b = tasks.save(input({ title: 'Platform quotes', status: 'waiting_on', waitingOn: 'Alex Rivera' }))
    const c = tasks.save(input({ title: 'Review SOW' }))
    tasks.setStatus(a.id, 'done')
    tasks.setStatus(b.id, 'done')
    tasks.setStatus(c.id, 'done')
    db.prepare(`UPDATE work_items SET completed_at = '2026-11-01T10:00:00.000Z' WHERE id = ?`).run(a.id)
    db.prepare(`UPDATE work_items SET completed_at = '2026-11-03T10:00:00.000Z' WHERE id = ?`).run(c.id)
    expect(tasks.listDone({ list: 'tasks' }).map((t) => t.title)).toEqual(['Review SOW', 'Roadmap slides'])
    const [waited] = tasks.listDone({ list: 'waiting' })
    expect(waited).toMatchObject({ title: 'Platform quotes', waitedOn: 'Alex Rivera', waitingOn: null })
    expect(tasks.listDone({ list: 'waiting', search: 'alex' })).toHaveLength(1)
    expect(tasks.listActive()).toHaveLength(0)
  })

  it('reopens to Waiting (with the same person) or to Tasks', () => {
    const w = tasks.save(input({ title: 'Platform quotes', status: 'waiting_on', waitingOn: 'Alex Rivera' }))
    const t = tasks.save(input({ title: 'Roadmap slides' }))
    tasks.setStatus(w.id, 'done')
    tasks.setStatus(t.id, 'done')
    expect(tasks.reopen(w.id)).toMatchObject({ status: 'waiting_on', waitingOn: 'Alex Rivera', waitedOn: null })
    expect(tasks.reopen(t.id)).toMatchObject({ status: 'open', waitedOn: null })
    expect(tasks.listDone()).toHaveLength(0)
  })

  it('editing a finished task keeps who it waited on', () => {
    const w = tasks.save(input({ title: 'Platform quotes', status: 'waiting_on', waitingOn: 'Alex Rivera' }))
    const done = tasks.setStatus(w.id, 'done')
    expect(tasks.save({ ...done, notes: 'Got two quotes' }).waitedOn).toBe('Alex Rivera')
  })
})
