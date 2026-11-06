import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildExtractionContext } from '../src/main/ai/context'
import { validateSuggestions, type RawSuggestion } from '../src/main/ai/schema'
import { openDatabase } from '../src/main/db'
import { BriefService, PersonService, ProjectService } from '../src/main/services/directory'
import { SuggestionService } from '../src/main/services/suggestions'
import { TaskService } from '../src/main/services/tasks'
import { DEFAULT_SETTINGS } from '@shared/types'

const raw = (o: Partial<RawSuggestion>): RawSuggestion => ({
  kind: 'brief_update', task_id: null, title: 'Context', details: '', due_date: null, project_id: null, requester_name: null,
  waiting_on: null, brief_scope: 'person', brief_owner_id: null, project_name: null, role: null, company: null, email: null, evidence: 'quote', ...o,
})

describe('person context fills in role and company', () => {
  let folder: string
  let db: DatabaseSync
  let people: PersonService
  let briefs: BriefService
  let suggestions: SuggestionService
  let robin: number

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'cos-person-ctx-'))
    db = openDatabase(join(folder, 'test.db'))
    people = new PersonService(db)
    briefs = new BriefService(db)
    const tasks = new TaskService(db, () => DEFAULT_SETTINGS.priorityWeights)
    suggestions = new SuggestionService(db, tasks, briefs, new ProjectService(db), people)
    robin = people.save({ id: 0, name: 'Robin Hale', role: null, company: 'Stark Industries', email: null, priorityWeight: 4 }).id
  })
  afterEach(() => {
    db.close()
    rmSync(folder, { recursive: true, force: true })
  })

  const validate = (r: RawSuggestion) => validateSuggestions([r], buildExtractionContext(db, 'Frank Cusano'))

  it('keeps a role or company only when it differs from what People has', () => {
    const [d] = validate(raw({ brief_owner_id: robin, details: 'Leads the SDK team.', role: 'Engineering manager', company: 'stark industries' }))
    expect(d!.payload).toMatchObject({ role: 'Engineering manager', company: null })
  })

  it('allows an update that only fills in details, and drops one with nothing new', () => {
    expect(validate(raw({ brief_owner_id: robin, role: 'Engineering manager' }))).toHaveLength(1)
    expect(validate(raw({ brief_owner_id: robin, company: 'Stark Industries' }))).toHaveLength(0)
  })

  it('accepting saves the role and company and adds the context', () => {
    const [d] = validate(raw({ brief_owner_id: robin, details: 'Leads the SDK team.', role: 'Engineering manager', company: 'Stark Industries International' }))
    const id = Number(db.prepare(`INSERT INTO source_items (kind, title, occurred_at, content, content_hash, imported_at) VALUES ('email', 'SDK', '2026-11-03', 'x', 'h', '2026-11-03')`).run().lastInsertRowid)
    const sid = Number(db.prepare('INSERT INTO suggestions (source_id, kind, payload, evidence, created_at) VALUES (?, ?, ?, ?, ?)').run(id, d!.kind, JSON.stringify(d!.payload), '', '2026-11-03').lastInsertRowid)
    suggestions.accept(sid)
    const person = people.list().find((p) => p.id === robin)!
    expect(person).toMatchObject({ role: 'Engineering manager', company: 'Stark Industries International', priorityWeight: 4 })
    expect(briefs.get('person', robin).summary).toContain('Leads the SDK team.')
  })

  it('a details-only update changes them without adding an empty context note', () => {
    const [d] = validate(raw({ brief_owner_id: robin, role: 'Engineering manager' }))
    const id = Number(db.prepare(`INSERT INTO source_items (kind, title, occurred_at, content, content_hash, imported_at) VALUES ('email', 'SDK', '2026-11-03', 'x', 'h2', '2026-11-03')`).run().lastInsertRowid)
    const sid = Number(db.prepare('INSERT INTO suggestions (source_id, kind, payload, evidence, created_at) VALUES (?, ?, ?, ?, ?)').run(id, d!.kind, JSON.stringify(d!.payload), '', '2026-11-03').lastInsertRowid)
    suggestions.accept(sid)
    expect(people.list().find((p) => p.id === robin)!.role).toBe('Engineering manager')
    expect(briefs.get('person', robin).summary).toBe('')
  })
})
