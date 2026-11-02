import { z } from 'zod'
import type { BriefScope, SuggestionKind, SuggestionPayload } from '@shared/types'
import type { ExtractionContext } from './context'

/** The JSON shape the AI must return (enforced with structured outputs for Claude). */
export const RawSuggestionSchema = z.object({
  kind: z.enum(['new_task', 'status_update', 'mark_done', 'waiting_on', 'brief_update']),
  task_id: z.number().int().nullable().describe('ID of the existing task this is about, from the open-task list; null for new tasks'),
  title: z.string().describe('New task title (imperative, under 80 characters), or a short headline'),
  details: z.string().describe('Status update text, brief text to add, or useful detail for a new task'),
  due_date: z.string().nullable().describe('YYYY-MM-DD if a deadline is stated or clearly implied, else null'),
  project_id: z.number().int().nullable().describe('ID of the matching project, else null'),
  requester_name: z.string().nullable().describe('Who asked for this, as written in the source, else null'),
  waiting_on: z.string().nullable().describe('Who or what the user is waiting on (waiting_on only), else null'),
  brief_scope: z.enum(['project', 'task', 'person']).nullable().describe('For brief_update: which kind of brief'),
  brief_owner_id: z.number().int().nullable().describe('For brief_update: ID of the project, task, or person'),
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
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const validDate = (d: string | null) => (d && DATE.test(d) && !Number.isNaN(Date.parse(d)) ? d : null)
const clean = (s: string | null | undefined, max = 2000) => (s ?? '').replace(/\s+\n/g, '\n').trim().slice(0, max)

/**
 * Turns raw AI output into safe drafts: every id must exist, dates must be real dates, and
 * suggestions that can't be applied are dropped rather than guessed at.
 */
export function validateSuggestions(raw: RawSuggestion[], ctx: ExtractionContext): SuggestionDraft[] {
  const taskIds = new Set(ctx.tasks.map((t) => t.id))
  const projectIds = new Set(ctx.projects.map((p) => p.id))
  const personByName = new Map(ctx.people.map((p) => [p.name.toLowerCase(), p.id]))
  const personIds = new Set(ctx.people.map((p) => p.id))
  const drafts: SuggestionDraft[] = []
  const seen = new Set<string>()

  for (const r of raw) {
    const taskId = r.task_id != null && taskIds.has(r.task_id) ? r.task_id : null
    const title = clean(r.title, 200)
    const details = clean(r.details)
    const requesterName = clean(r.requester_name, 120) || null
    const requesterId = requesterName ? (personByName.get(requesterName.toLowerCase()) ?? matchFirstName(requesterName, ctx)) : null

    let briefScope: BriefScope | null = null
    let briefOwnerId: number | null = null
    if (r.kind === 'brief_update') {
      const owner = r.brief_owner_id
      const ok =
        (r.brief_scope === 'project' && owner != null && projectIds.has(owner)) ||
        (r.brief_scope === 'task' && owner != null && taskIds.has(owner)) ||
        (r.brief_scope === 'person' && owner != null && personIds.has(owner))
      if (!ok || !details) continue
      briefScope = r.brief_scope
      briefOwnerId = owner
    }
    if ((r.kind === 'status_update' || r.kind === 'mark_done') && taskId == null) continue
    if (r.kind === 'status_update' && !details) continue
    if (r.kind === 'new_task' && !title) continue
    if (r.kind === 'waiting_on' && taskId == null && !title) continue

    const key = `${r.kind}|${taskId}|${title.toLowerCase()}|${briefScope}|${briefOwnerId}`
    if (seen.has(key)) continue
    seen.add(key)

    drafts.push({
      kind: r.kind,
      evidence: clean(r.evidence, 600),
      payload: {
        taskId,
        title: title || ctx.tasks.find((t) => t.id === taskId)?.title || '',
        details,
        dueDate: validDate(r.due_date),
        projectId: r.project_id != null && projectIds.has(r.project_id) ? r.project_id : null,
        requesterId,
        requesterName,
        waitingOn: r.kind === 'waiting_on' ? clean(r.waiting_on, 200) || null : null,
        briefScope,
        briefOwnerId,
      },
    })
  }
  return drafts
}

/** "Dana" matches "Dana Lee" when exactly one person has that first name. */
function matchFirstName(name: string, ctx: ExtractionContext): number | null {
  const first = name.trim().split(/\s+/)[0]?.toLowerCase()
  if (!first) return null
  const hits = ctx.people.filter((p) => p.name.toLowerCase().split(/\s+/)[0] === first)
  return hits.length === 1 ? hits[0]!.id : null
}
