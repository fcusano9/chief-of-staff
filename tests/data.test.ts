import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db'
import { createBackup } from '../src/main/services/backup'
import { BriefService, PersonService, ProjectService } from '../src/main/services/directory'
import { TaskService } from '../src/main/services/tasks'
import { DEFAULT_SETTINGS, type TaskInput } from '@shared/types'

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const yesterday = () => {
  const d = new Date(Date.now() - 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const input = (o: Partial<TaskInput>): TaskInput => ({
  id: 0,
  title: 'Task',
  notes: null,
  status: 'open',
  dueDate: null,
  projectId: null,
  requesterId: null,
  priorityOverride: null,
  followUpCount: 0,
  waitingOn: null,
  subtasks: [],
  ...o,
})

/** Runs the real services against a throwaway SQLite file with the real migrations. */
describe('data services', () => {
  let folder: string
  let db: DatabaseSync
  let tasks: TaskService
  let projects: ProjectService
  let people: PersonService
  let briefs: BriefService

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'cos-tests-'))
    db = openDatabase(join(folder, 'test.db'))
    tasks = new TaskService(db, () => DEFAULT_SETTINGS.priorityWeights)
    projects = new ProjectService(db)
    people = new PersonService(db)
    briefs = new BriefService(db)
  })

  afterEach(() => {
    db.close()
    rmSync(folder, { recursive: true, force: true })
  })

  it('allows a task without a project and scores it', () => {
    const saved = tasks.save(input({ title: 'Submit expense report', dueDate: today() }))
    const loaded = tasks.get(saved.id)!
    expect(loaded.projectId).toBeNull()
    expect(loaded.priorityScore).toBeGreaterThan(0)
    expect(loaded.priorityRationale?.toLowerCase()).toContain('due today')
  })

  it('adds, updates and removes subtasks', () => {
    const saved = tasks.save(input({ title: 'Roadmap slides', subtasks: [{ id: 0, title: 'Timeline', isDone: false }, { id: 0, title: 'Pricing', isDone: false }] }))
    expect(saved.subtasks.map((s) => s.title)).toEqual(['Timeline', 'Pricing'])

    const pricing = saved.subtasks[1]!
    const updated = tasks.save({ ...saved, subtasks: [{ ...pricing, isDone: true }, { id: 0, title: 'Send', isDone: false }] })
    expect(updated.subtasks.map((s) => s.title)).toEqual(['Pricing', 'Send'])
    expect(updated.subtasks[0]!.isDone).toBe(true)
    expect(updated.subtasks[0]!.id).toBe(pricing.id)
  })

  it('puts higher priority first and hides done tasks', () => {
    const vip = people.save({ id: 0, name: 'VP', role: null, company: null, email: null, priorityWeight: 5 })
    tasks.save(input({ title: 'Low' }))
    tasks.save(input({ title: 'High', dueDate: yesterday(), requesterId: vip.id }))
    const done = tasks.save(input({ title: 'Finished' }))
    tasks.setStatus(done.id, 'done')

    expect(tasks.listActive().map((t) => t.title)).toEqual(['High', 'Low'])
  })

  it('records when waiting started and clears it when reopened', () => {
    const saved = tasks.save(input({ title: 'Pricing input', status: 'waiting_on', waitingOn: 'Finance' }))
    expect(saved.waitingSince).not.toBeNull()
    expect(tasks.listWaiting()).toHaveLength(1)

    const reopened = tasks.save({ ...saved, status: 'open' })
    expect(reopened.waitingSince).toBeNull()
  })

  it('keeps tasks without a project when their project is deleted', () => {
    const project = projects.save({ id: 0, name: 'Roadmap', color: '#7F77DD', status: 'active' })
    const task = tasks.save(input({ title: 'Slides', projectId: project.id }))
    briefs.save({ scope: 'project', ownerId: project.id, summary: 'Goal', standingInstructions: '', updatedAt: null })

    projects.delete(project.id)

    expect(tasks.get(task.id)?.projectId).toBeNull()
    expect(briefs.get('project', project.id).summary).toBe('')
  })

  it('round-trips briefs per owner', () => {
    briefs.save({ scope: 'project', ownerId: 1, summary: 'Roadmap goal', standingInstructions: 'cc manager', updatedAt: null })
    briefs.save({ scope: 'person', ownerId: 1, summary: 'Prefers Teams', standingInstructions: '', updatedAt: null })
    briefs.save({ scope: 'project', ownerId: 1, summary: 'Updated goal', standingInstructions: 'cc manager', updatedAt: null })

    expect(briefs.get('project', 1).summary).toBe('Updated goal')
    expect(briefs.get('person', 1).summary).toBe('Prefers Teams')
  })

  it('creates a readable backup snapshot and prunes old ones', async () => {
    tasks.save(input({ title: 'Back me up' }))
    const backups = join(folder, 'backups')
    for (let i = 0; i < 4; i++) await createBackup(db, backups, 2, new Date(2026, 10, 1 + i, 8, 0, 0))

    const files = readdirSync(backups).sort()
    expect(files).toEqual(['chiefofstaff-20261103-080000.db', 'chiefofstaff-20261104-080000.db'])

    const snapshot = openDatabase(join(backups, files[1]!))
    expect(new TaskService(snapshot, () => DEFAULT_SETTINGS.priorityWeights).listActive().map((t) => t.title)).toEqual(['Back me up'])
    snapshot.close()
  })
})
