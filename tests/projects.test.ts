import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildExtractionContext, buildUserPrompt } from '../src/main/ai/context'
import { migrate, MIGRATIONS, openDatabase } from '../src/main/db'
import { BriefService, PersonService, ProjectService } from '../src/main/services/directory'
import { SuggestionService } from '../src/main/services/suggestions'
import { TaskService } from '../src/main/services/tasks'
import { DEFAULT_SETTINGS } from '@shared/types'

describe('projects: overview and history', () => {
  let folder: string
  let db: DatabaseSync
  let tasks: TaskService
  let projects: ProjectService
  let briefs: BriefService

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'cos-projects-'))
    db = openDatabase(join(folder, 'test.db'))
    tasks = new TaskService(db, () => DEFAULT_SETTINGS.priorityWeights)
    projects = new ProjectService(db)
    briefs = new BriefService(db)
  })
  afterEach(() => {
    db.close()
    rmSync(folder, { recursive: true, force: true })
  })

  const newProject = (name = 'Spring pricing launch') => projects.save({ id: 0, name, color: '#7F77DD', status: 'active' })
  const history = (id: number, summary: string, standingInstructions = '') => briefs.save({ scope: 'project', ownerId: id, summary, standingInstructions, updatedAt: null })

  it('lists archived projects apart, and unarchiving moves them back', () => {
    const live = newProject('Partner portal')
    const old = projects.save({ id: 0, name: 'CES 2026 booth', color: '#639922', status: 'archived' })
    projects.save({ id: 0, name: 'Old launch', color: '#D85A30', status: 'archived' })
    expect(projects.list().map((p) => p.name)).toEqual([live.name])
    expect(projects.listArchived().map((p) => p.name)).toEqual(['CES 2026 booth', 'Old launch'])
    projects.save({ ...old, status: 'active' })
    expect(projects.list().map((p) => p.name)).toEqual(['CES 2026 booth', 'Partner portal'])
    expect(projects.listArchived().map((p) => p.name)).toEqual(['Old launch'])
  })

  it('starts a project with no overview, and keeps existing history as it is', () => {
    const p = newProject()
    history(p.id, 'Oct 14, 2026: Kickoff.')
    expect(projects.list()[0]).toMatchObject({ overview: null, openCount: 0 })
    expect(projects.list()[0]).not.toHaveProperty('brief')
    expect(briefs.get('project', p.id).summary).toBe('Oct 14, 2026: Kickoff.')
  })

  it('saves the overview by hand, on one line, and clears a blank one', () => {
    const p = newProject()
    expect(projects.saveOverview(p.id, '  Four-tier dealer\n pricing.  ').overview).toBe('Four-tier dealer pricing.')
    expect(projects.saveOverview(p.id, '  ').overview).toBeNull()
    expect(() => projects.saveOverview(999, 'x')).toThrow('no longer exists')
  })

  it("keeps the overview when the project's name, color or status changes", () => {
    const p = newProject()
    projects.saveOverview(p.id, 'Four-tier dealer pricing.')
    const saved = projects.save({ ...p, name: 'Pricing launch', status: 'on_hold' })
    expect(saved).toMatchObject({ name: 'Pricing launch', overview: 'Four-tier dealer pricing.' })
  })

  it('adds accepted project context from Review to the history', () => {
    const p = newProject()
    const people = new PersonService(db)
    const suggestions = new SuggestionService(db, tasks, briefs, projects, people)
    const source = Number(db.prepare(`INSERT INTO source_items (kind, title, content, content_hash, occurred_at, imported_at) VALUES ('note', 'EMEA call', 'x', 'h', '2026-11-03', '2026-11-03')`).run().lastInsertRowid)
    const id = Number(
      db
        .prepare(`INSERT INTO suggestions (source_id, kind, status, payload, evidence, created_at) VALUES (?, 'brief_update', 'pending', ?, 'quote', '2026-11-03')`)
        .run(source, JSON.stringify({ taskId: null, title: 'EMEA', details: 'EMEA uses the same four tiers.', dueDate: null, projectId: null, requesterId: null, requesterName: null, waitingOn: null, briefScope: 'project', briefOwnerId: p.id }))
        .lastInsertRowid,
    )
    suggestions.accept(id)
    expect(briefs.get('project', p.id).summary).toMatch(/: EMEA uses the same four tiers\. \(from “EMEA call”\)$/)
  })

  it('gives the AI the overview and the newest history on imports', () => {
    const a = newProject('Alpha')
    projects.saveOverview(a.id, 'Four-tier dealer pricing.')
    history(a.id, `Sep 1, 2026: ${'old '.repeat(200)}\nNov 2, 2026: Pricing approved.`)
    const ctx = buildExtractionContext(db, 'Frank Cusano')
    expect(ctx.projects.find((p) => p.id === a.id)).toMatchObject({ overview: 'Four-tier dealer pricing.', brief: 'Nov 2, 2026: Pricing approved.' })
    const prompt = buildUserPrompt(ctx, { kind: 'note', title: 't', occurredAt: '2026-11-03', content: 'x', fromName: null })
    expect(prompt).toContain(`- [${a.id}] Alpha: Four-tier dealer pricing. (Status: Nov 2, 2026: Pricing approved.)`)
  })
})

describe('upgrading: project briefs become updates', () => {
  it('adds each existing brief to the end of its Updates, dated when it was written, and clears it', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    migrate(db, { migrations: MIGRATIONS.slice(0, -2) })
    const insert = db.prepare(`INSERT INTO projects (name, color, status, created_at, brief, brief_by, brief_at) VALUES (?, '#7F77DD', 'active', '2026-10-01', ?, 'ai', ?)`)
    const withHistory = Number(insert.run('Alpha', 'Pricing approved.\nNext: pilot.\nOpen: nothing recorded.', '2026-11-02T15:00:00.000Z').lastInsertRowid)
    const noHistory = Number(insert.run('Beta', 'Kickoff done.', '2026-11-03T15:00:00.000Z').lastInsertRowid)
    const none = Number(insert.run('Gamma', null, null).lastInsertRowid)
    db.prepare(`INSERT INTO context_briefs (scope, owner_id, summary, standing_instructions, updated_at) VALUES ('project', ?, 'Oct 28, 2026: Approved.', 'Always cc Priya.', '2026-10-28')`).run(withHistory)

    migrate(db)
    const summary = (id: number) => (db.prepare(`SELECT summary, standing_instructions FROM context_briefs WHERE scope = 'project' AND owner_id = ?`).get(id) as { summary: string; standing_instructions: string } | undefined)
    expect(summary(withHistory)).toEqual({
      summary: `Oct 28, 2026: Approved.\n${new Date('2026-11-02T15:00:00.000Z').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}: Project brief (kept when briefs were removed): Pricing approved. Next: pilot. Open: nothing recorded.`,
      standing_instructions: 'Always cc Priya.',
    })
    expect(summary(noHistory)!.summary).toMatch(/^Nov \d, 2026: Project brief \(kept when briefs were removed\): Kickoff done\.$/)
    expect(summary(none)).toBeUndefined()
    expect(db.prepare('SELECT COUNT(*) AS n FROM projects WHERE brief IS NOT NULL OR brief_at IS NOT NULL').get()).toEqual({ n: 0 })
    db.close()
  })
})
