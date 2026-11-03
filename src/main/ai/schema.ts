import { z } from 'zod'
import { PROJECT_COLORS, type BriefScope, type SuggestionKind, type SuggestionPayload } from '@shared/types'
import type { ExtractionContext } from './context'

/** The JSON shape the AI must return (enforced with structured outputs for Claude). */
export const RawSuggestionSchema = z.object({
  kind: z.enum(['new_task', 'needs_reply', 'status_update', 'mark_done', 'waiting_on', 'brief_update', 'new_project', 'new_person']),
  task_id: z.number().int().nullable().describe('ID of the existing task this is about, from the open-task list; null for new tasks'),
  title: z.string().describe("New task title (imperative, under 80 characters); the project's name for new_project; the person's full name for new_person; else a short headline"),
  details: z.string().describe('Status update text, brief text to add, a new project summary, what to remember about a new person, or useful detail for a new task'),
  due_date: z.string().nullable().describe('YYYY-MM-DD if a deadline is stated or clearly implied, else null'),
  project_id: z.number().int().nullable().describe('ID of the matching existing project, else null'),
  project_name: z.string().nullable().describe('For a task in a project you propose with new_project in this response: that project name exactly; else null'),
  requester_name: z.string().nullable().describe('Who asked for this, as written in the source, else null'),
  waiting_on: z.string().nullable().describe('Who or what the user is waiting on (waiting_on only), else null'),
  brief_scope: z.enum(['project', 'task', 'person']).nullable().describe('For brief_update: which kind of brief'),
  brief_owner_id: z.number().int().nullable().describe('For brief_update: ID of the project, task, or person'),
  role: z.string().nullable().describe("For new_person, or brief_update on a person: their job title or role as stated in the source, else null"),
  company: z.string().nullable().describe('For new_person, or brief_update on a person: the company or organization they work for, as stated in the source, else null'),
  email: z.string().nullable().describe('For new_person: their email address if it appears in the source, else null'),
  evidence: z.string().describe('A short verbatim quote from the source that supports this suggestion'),
})

export const ExtractionSchema = z.object({
  suggestions: z.array(RawSuggestionSchema),
})

export type RawSuggestion = z.infer<typeof RawSuggestionSchema>

export interface SuggestionDraft {
  kind: SuggestionKind
  payload: SuggestionPayload
  evidence: string
  /** Names of new projects or people proposed in the same batch, resolved to suggestion ids when saved. */
  links?: { project?: string; requester?: string; waitingOn?: string }
}

/** New projects and people first, then context, then everything else in the AI's order, so links read top to bottom in Review. */
const FIRST: SuggestionKind[] = ['new_project', 'new_person', 'brief_update']
const rank = (k: SuggestionKind) => (FIRST.includes(k) ? FIRST.indexOf(k) : FIRST.length)
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const lower = (s: string) => s.trim().toLowerCase()

const DATE = /^\d{4}-\d{2}-\d{2}$/
const validDate = (d: string | null) => (d && DATE.test(d) && !Number.isNaN(Date.parse(d)) ? d : null)
const clean = (s: string | null | undefined, max = 2000) => (s ?? '').replace(/\s+\n/g, '\n').trim().slice(0, max)

/** A suggestion the AI proposed that didn't reach Review, and why (shown in the AI log). */
export interface DroppedSuggestion {
  kind: string
  title: string
  reason: string
}

/**
 * Turns raw AI output into safe drafts: every id must exist, dates must be real dates, and
 * suggestions that can't be applied are dropped rather than guessed at. Pass `dropped` to
 * collect what was left out and why.
 */
export function validateSuggestions(raw: RawSuggestion[], ctx: ExtractionContext, dropped?: DroppedSuggestion[]): SuggestionDraft[] {
  const drop = (r: RawSuggestion, reason: string) => dropped?.push({ kind: r.kind, title: clean(r.title, 200) || '(no title)', reason })
  const taskIds = new Set(ctx.tasks.map((t) => t.id))
  const projectIds = new Set(ctx.projects.map((p) => p.id))
  const personByName = new Map(ctx.people.map((p) => [p.name.toLowerCase(), p.id]))
  const personIds = new Set(ctx.people.map((p) => p.id))
  const projectNames = new Set(ctx.projects.map((p) => lower(p.name)))
  const drafts: SuggestionDraft[] = []
  const seen = new Set<string>()

  // New projects and people the AI proposed, minus anything already in the lists (or the user).
  const isKnownPerson = (name: string) => personByName.has(lower(name)) || matchFirstName(name, ctx) != null || lower(name) === lower(ctx.userName)
  const newProjects = new Map<string, string>()
  const newPeople = new Map<string, string>()
  for (const r of raw) {
    const name = clean(r.title, 120)
    if (r.kind === 'new_project' && name && !projectNames.has(lower(name))) newProjects.set(lower(name), name)
    if (r.kind === 'new_person' && name && !isKnownPerson(name)) newPeople.set(lower(name), name)
  }
  /** "Alex" finds "Alex Rivera" when exactly one new person has that first name. */
  const findNewPerson = (name: string | null): string | undefined => {
    if (!name?.trim()) return undefined
    const exact = newPeople.get(lower(name))
    if (exact) return exact
    const first = lower(name).split(/\s+/)[0]
    const hits = [...newPeople.values()].filter((n) => lower(n).split(/\s+/)[0] === first)
    return hits.length === 1 ? hits[0] : undefined
  }
  let colorIndex = ctx.projects.length

  for (const r of raw) {
    if (r.kind === 'new_project' || r.kind === 'new_person') {
      const name = clean(r.title, 120)
      if (!(r.kind === 'new_project' ? newProjects : newPeople).has(lower(name))) {
        drop(
          r,
          !name ? 'No name given'
          : r.kind === 'new_project' ? `"${name}" is already a project`
          : lower(name) === lower(ctx.userName) ? "That's you"
          : `"${name}" is already in People`,
        )
        continue
      }
      const key = `${r.kind}|${lower(name)}`
      if (seen.has(key)) {
        drop(r, 'Same as another suggestion')
        continue
      }
      seen.add(key)
      const email = clean(r.email, 200)
      drafts.push({
        kind: r.kind,
        evidence: clean(r.evidence, 600),
        payload: {
          taskId: null, title: name, details: clean(r.details), dueDate: null, projectId: null, requesterId: null, requesterName: null,
          waitingOn: null, briefScope: null, briefOwnerId: null,
          ...(r.kind === 'new_project'
            ? { color: PROJECT_COLORS[colorIndex++ % PROJECT_COLORS.length] }
            : { role: clean(r.role, 120) || null, company: clean(r.company, 120) || null, email: EMAIL.test(email) ? email : null }),
        },
      })
      continue
    }

    const taskId = r.task_id != null && taskIds.has(r.task_id) ? r.task_id : null
    const title = clean(r.title, 200)
    const details = clean(r.details)
    const requesterName = clean(r.requester_name, 120) || null
    const requesterId = requesterName ? (personByName.get(requesterName.toLowerCase()) ?? matchFirstName(requesterName, ctx)) : null

    let briefScope: BriefScope | null = null
    let briefOwnerId: number | null = null
    // Person context can also fill in or correct their role and company; only values that differ count.
    let personDetails: { role?: string | null; company?: string | null } = {}
    if (r.kind === 'brief_update') {
      const owner = r.brief_owner_id
      const ok =
        (r.brief_scope === 'project' && owner != null && projectIds.has(owner)) ||
        (r.brief_scope === 'task' && owner != null && taskIds.has(owner)) ||
        (r.brief_scope === 'person' && owner != null && personIds.has(owner))
      if (ok && r.brief_scope === 'person') {
        const person = ctx.people.find((x) => x.id === owner)!
        const changed = (value: string | null, current: string | null) => {
          const v = clean(value, 120)
          return v && lower(v) !== lower(current ?? '') ? v : null
        }
        personDetails = { role: changed(r.role, person.role), company: changed(r.company, person.company) }
      }
      if (!ok || (!details && !personDetails.role && !personDetails.company)) {
        drop(r, !details ? 'No text to add to the brief' : !r.brief_scope || owner == null ? "Didn't say whose brief" : `${r.brief_scope} #${owner} doesn't exist`)
        continue
      }
      briefScope = r.brief_scope
      briefOwnerId = owner
    }
    const missingTask = r.task_id != null ? `Task #${r.task_id} doesn't exist` : "Didn't say which task"
    if ((r.kind === 'status_update' || r.kind === 'mark_done') && taskId == null) {
      drop(r, missingTask)
      continue
    }
    if (r.kind === 'status_update' && !details) {
      drop(r, 'No update text')
      continue
    }
    if ((r.kind === 'new_task' || r.kind === 'needs_reply') && !title) {
      drop(r, 'No task title')
      continue
    }
    if (r.kind === 'waiting_on' && taskId == null && !title) {
      drop(r, `${missingTask}, and no title for a new item`)
      continue
    }

    const key = `${r.kind}|${taskId}|${title.toLowerCase()}|${briefScope}|${briefOwnerId}`
    if (seen.has(key)) {
      drop(r, 'Same as another suggestion')
      continue
    }
    seen.add(key)

    const projectId = r.project_id != null && projectIds.has(r.project_id) ? r.project_id : null
    const waitingOn = r.kind === 'waiting_on' ? clean(r.waiting_on, 200) || null : null
    const creates = r.kind === 'new_task' || r.kind === 'needs_reply' || (r.kind === 'waiting_on' && taskId == null)
    const links = creates
      ? {
          project: projectId == null && r.project_name ? newProjects.get(lower(r.project_name)) : undefined,
          requester: requesterId == null ? findNewPerson(requesterName) : undefined,
          waitingOn: findNewPerson(waitingOn),
        }
      : {}
    drafts.push({
      kind: r.kind,
      evidence: clean(r.evidence, 600),
      links,
      payload: {
        taskId,
        title: title || ctx.tasks.find((t) => t.id === taskId)?.title || '',
        details,
        dueDate: validDate(r.due_date),
        projectId,
        requesterId,
        requesterName,
        waitingOn,
        briefScope,
        briefOwnerId,
        ...personDetails,
      },
    })
  }
  return drafts.sort((a, b) => rank(a.kind) - rank(b.kind))
}

/** "Dana" matches "Dana Lee" when exactly one person has that first name. */
function matchFirstName(name: string, ctx: ExtractionContext): number | null {
  const first = name.trim().split(/\s+/)[0]?.toLowerCase()
  if (!first) return null
  const hits = ctx.people.filter((p) => p.name.toLowerCase().split(/\s+/)[0] === first)
  return hits.length === 1 ? hits[0]!.id : null
}
