import type { DatabaseSync } from 'node:sqlite'
import type { BriefScope, ContextBrief, Person, PersonInput, PersonSummary, Project, ProjectSummary } from '@shared/types'
import { ACTIVE_STATUSES } from '@shared/types'
import { nowIso, transaction } from '../db'

const ACTIVE_IN = `(${ACTIVE_STATUSES.map((s) => `'${s}'`).join(', ')})`

export class ProjectService {
  constructor(private readonly db: DatabaseSync) {}

  /** Non-archived projects by name, with their open-task counts. */
  list(): ProjectSummary[] {
    const rows = this.db
      .prepare(
        `SELECT p.*, (SELECT COUNT(*) FROM work_items w WHERE w.project_id = p.id AND w.status IN ${ACTIVE_IN}) AS open_count
         FROM projects p WHERE p.status <> 'archived' ORDER BY p.name COLLATE NOCASE`,
      )
      .all() as Record<string, unknown>[]
    return rows.map((r) => ({ ...toProject(r), openCount: Number(r.open_count) }))
  }

  save(project: Pick<Project, 'id' | 'name' | 'color' | 'status'>): Project {
    const name = project.name.trim()
    if (!name) throw new Error('A project needs a name.')
    let id = project.id
    if (id) {
      this.db.prepare('UPDATE projects SET name = ?, color = ?, status = ? WHERE id = ?').run(name, project.color, project.status, id)
    } else {
      id = Number(this.db.prepare('INSERT INTO projects (name, color, status, created_at) VALUES (?, ?, ?, ?)').run(name, project.color, project.status, nowIso()).lastInsertRowid)
    }
    return toProject(this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Record<string, unknown>)
  }

  /** Deletes the project; its tasks become tasks with no project. */
  delete(id: number): void {
    transaction(this.db, () => {
      this.db.prepare('UPDATE work_items SET project_id = NULL WHERE project_id = ?').run(id)
      this.db.prepare('DELETE FROM projects WHERE id = ?').run(id)
      this.db.prepare(`DELETE FROM context_briefs WHERE scope = 'project' AND owner_id = ?`).run(id)
    })
  }
}

export class PersonService {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * Everyone, most important first, with their open asks, the tasks waiting on them, and how many
   * context notes arrived since their brief was written.
   */
  list(): PersonSummary[] {
    const rows = this.db
      .prepare(
        `SELECT p.*, IFNULL(b.summary, '') AS history,
           (SELECT COUNT(*) FROM work_items w WHERE w.requester_id = p.id AND w.status IN ${ACTIVE_IN}) AS open_count,
           (SELECT COUNT(*) FROM work_items w WHERE w.status = 'waiting_on' AND TRIM(w.waiting_on) = p.name COLLATE NOCASE
              AND (w.requester_id IS NULL OR w.requester_id <> p.id)) AS waiting_count
         FROM people p LEFT JOIN context_briefs b ON b.scope = 'person' AND b.owner_id = p.id
         ORDER BY p.priority_weight DESC, p.name COLLATE NOCASE`,
      )
      .all() as Record<string, unknown>[]
    return rows.map((r) => ({
      ...toPerson(r),
      openCount: Number(r.open_count),
      waitingCount: Number(r.waiting_count),
      newNotes: r.brief ? countNewNotes(String(r.history), String(r.brief_context ?? '')) : 0,
    }))
  }

  get(id: number): Person | null {
    const row = this.db.prepare('SELECT * FROM people WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? toPerson(row) : null
  }

  save(person: PersonInput): Person {
    const name = person.name.trim()
    if (!name) throw new Error('A person needs a name.')
    const weight = Math.min(5, Math.max(1, Math.round(person.priorityWeight)))
    const role = person.role?.trim() || null
    const company = person.company?.trim() || null
    const email = person.email?.trim() || null
    let id = person.id
    if (id) {
      this.db.prepare('UPDATE people SET name = ?, role = ?, company = ?, email = ?, priority_weight = ? WHERE id = ?').run(name, role, company, email, weight, id)
    } else {
      id = Number(this.db.prepare('INSERT INTO people (name, role, company, email, priority_weight) VALUES (?, ?, ?, ?, ?)').run(name, role, company, email, weight).lastInsertRowid)
    }
    return toPerson(this.db.prepare('SELECT * FROM people WHERE id = ?').get(id) as Record<string, unknown>)
  }

  /**
   * Sets the one-line brief (empty text clears it) and remembers the context history it was
   * written from, so later notes show as new.
   */
  saveBrief(id: number, text: string, by: 'ai' | 'user'): Person {
    const brief = text.replace(/\s+/g, ' ').trim().slice(0, 600) || null
    const history = (this.db.prepare(`SELECT summary FROM context_briefs WHERE scope = 'person' AND owner_id = ?`).get(id) as { summary: string } | undefined)?.summary ?? ''
    const changed = this.db
      .prepare('UPDATE people SET brief = ?, brief_by = ?, brief_at = ?, brief_context = ? WHERE id = ?')
      .run(brief, brief ? by : null, brief ? nowIso() : null, brief ? history : null, id).changes
    if (!changed) throw new Error('That person no longer exists.')
    return this.get(id)!
  }

  /** Deletes the person; tasks they requested keep existing with no requester. */
  delete(id: number): void {
    transaction(this.db, () => {
      this.db.prepare('UPDATE work_items SET requester_id = NULL WHERE requester_id = ?').run(id)
      this.db.prepare('DELETE FROM people WHERE id = ?').run(id)
      this.db.prepare(`DELETE FROM context_briefs WHERE scope = 'person' AND owner_id = ?`).run(id)
    })
  }
}

export class BriefService {
  constructor(private readonly db: DatabaseSync) {}

  /** The brief for an owner, or an empty one if none has been written. */
  get(scope: BriefScope, ownerId: number): ContextBrief {
    const row = this.db.prepare('SELECT * FROM context_briefs WHERE scope = ? AND owner_id = ?').get(scope, ownerId) as Record<string, unknown> | undefined
    return row
      ? { scope, ownerId, summary: String(row.summary), standingInstructions: String(row.standing_instructions), updatedAt: String(row.updated_at) }
      : { scope, ownerId, summary: '', standingInstructions: '', updatedAt: null }
  }

  save(brief: ContextBrief): ContextBrief {
    this.db
      .prepare(
        `INSERT INTO context_briefs (scope, owner_id, summary, standing_instructions, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (scope, owner_id) DO UPDATE SET summary = excluded.summary,
           standing_instructions = excluded.standing_instructions, updated_at = excluded.updated_at`,
      )
      .run(brief.scope, brief.ownerId, brief.summary, brief.standingInstructions, nowIso())
    return this.get(brief.scope, brief.ownerId)
  }
}

function toProject(r: Record<string, unknown>): Project {
  return { id: Number(r.id), name: String(r.name), color: String(r.color), status: r.status as Project['status'], createdAt: String(r.created_at) }
}

function toPerson(r: Record<string, unknown>): Person {
  return {
    id: Number(r.id),
    name: String(r.name),
    role: (r.role as string) ?? null,
    company: (r.company as string) ?? null,
    email: (r.email as string) ?? null,
    priorityWeight: Number(r.priority_weight),
    brief: (r.brief as string) ?? null,
    briefBy: (r.brief_by as Person['briefBy']) ?? null,
    briefAt: (r.brief_at as string) ?? null,
  }
}

/** Lines in the context history that weren't there when the brief was written. */
export function countNewNotes(history: string, writtenFrom: string): number {
  const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean)
  const before = new Set(lines(writtenFrom))
  return lines(history).filter((l) => !before.has(l)).length
}
