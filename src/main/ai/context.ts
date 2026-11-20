import type { DatabaseSync } from 'node:sqlite'
import { ACTIVE_STATUSES, SOURCE_KIND_LABELS, type SourceKind, type SuggestionKind } from '@shared/types'
import { noteLines, parseNote, recentNotes } from '@shared/notes'
import { IMPORT_TEXT_CHARS, PROJECT_UPDATES_FOR_AI, UPDATES_FOR_AI } from './limits'
import { importAsk, importCalendar, importKindDefinitions, importNextActionRule, importSystem } from './prompts'

export const ALL_KINDS: SuggestionKind[] = ['new_task', 'needs_reply', 'status_update', 'mark_done', 'waiting_on', 'new_project', 'new_person', 'brief_update']

export interface ExtractionContext {
  today: string
  userName: string
  tasks: {
    id: number
    title: string
    status: string
    dueDate: string | null
    project: string | null
    requester: string | null
    waitingOn: string | null
    updates: string[]
    /** The app's computed score, before any AI change. */
    priority: number
    /** The AI's current change to it, if any. */
    aiChange: { delta: number; reason: string } | null
  }[]
  projects: { id: number; name: string; overview: string; brief: string; instructions: string }[]
  people: { id: number; name: string; role: string | null; company: string | null; brief: string }[]
}

export interface SourceForExtraction {
  kind: SourceKind
  title: string
  fromName: string | null
  occurredAt: string
  content: string
}

const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Everything the AI should know before reading a source: open tasks, projects with briefs, people. */
/**
 * An import's input rebuilt as it was when it was imported, for a model test: every model in the
 * test gets this same input. Approximate on purpose (see docs/DECISIONS.md, "Model tests rebuild an
 * import's input"): later edits to titles, dates and projects show as they are now, deleted or
 * merged tasks are gone, people added by hand later still appear, and earlier AI priority changes
 * are left out.
 */
export interface AsOf {
  /** The import being tested. */
  sourceId: number
}

/**
 * What the AI is told about the user's open work for an import. With `asOf`, it's rebuilt as it
 * was when that import came in: tasks, projects and people created then or later are left out,
 * tasks finished since count as open again, and updates after that day (or from that import) are dropped.
 */
export function buildExtractionContext(db: DatabaseSync, userName: string, now = new Date(), asOf?: AsOf): ExtractionContext {
  const active = ACTIVE_STATUSES.map((s) => `'${s}'`).join(', ')
  const source = asOf ? (db.prepare('SELECT title, imported_at FROM source_items WHERE id = ?').get(asOf.sourceId) as { title: string; imported_at: string } | undefined) : undefined
  if (asOf && !source) throw new Error(`Import ${asOf.sourceId} not found`)
  const cutoff = source?.imported_at ?? null
  if (cutoff) now = new Date(cutoff)
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
  /** Updates as they stood then: nothing dated after the import's day, nothing from the import itself. */
  const asThen = (summary: string) =>
    !source
      ? summary
      : noteLines(summary)
          .filter((line) => {
            const n = parseNote(line)
            const t = n.date ? Date.parse(n.date) : NaN
            return n.source !== source.title && (Number.isNaN(t) || t < endOfDay)
          })
          .join('\n')
  const tasks = db
    .prepare(
      `SELECT w.id, w.title, w.status, w.due_date, w.waiting_on, w.priority_score, p.name AS project, r.name AS requester, IFNULL(b.summary, '') AS updates,
              a.delta AS ai_delta, a.reason AS ai_reason
       FROM work_items w LEFT JOIN projects p ON p.id = w.project_id LEFT JOIN people r ON r.id = w.requester_id
       LEFT JOIN context_briefs b ON b.scope = 'task' AND b.owner_id = w.id
       LEFT JOIN priority_adjustments a ON a.work_item_id = w.id
       WHERE ${cutoff ? `w.created_at < :cutoff AND (w.status IN (${active}) OR (w.status = 'done' AND w.completed_at >= :cutoff))` : `w.status IN (${active})`}
       ORDER BY w.id`,
    )
    .all(cutoff ? { cutoff } : {}) as Record<string, unknown>[]
  const projects = db
    .prepare(
      `SELECT p.id, p.name, p.overview, IFNULL(b.summary, '') AS history, IFNULL(b.standing_instructions, '') AS instructions
       FROM projects p LEFT JOIN context_briefs b ON b.scope = 'project' AND b.owner_id = p.id
       WHERE p.status <> 'archived' ${cutoff ? 'AND p.created_at < :cutoff' : ''} ORDER BY p.name`,
    )
    .all(cutoff ? { cutoff } : {}) as Record<string, unknown>[]
  // People have no created date; leave out those that this import or a later one created.
  const people = db
    .prepare(
      `SELECT p.id, p.name, p.role, p.company, p.brief, IFNULL(b.summary, '') AS history
       FROM people p LEFT JOIN context_briefs b ON b.scope = 'person' AND b.owner_id = p.id
       ${
         cutoff
           ? `WHERE p.id NOT IN (SELECT g.result_ref_id FROM suggestions g JOIN source_items s ON s.id = g.source_id
                                 WHERE g.kind = 'new_person' AND g.status = 'accepted' AND g.result_ref_id IS NOT NULL AND (s.id = :source OR s.imported_at >= :cutoff))`
           : ''
       }
       ORDER BY p.name`,
    )
    .all(cutoff ? { cutoff, source: asOf!.sourceId } : {}) as Record<string, unknown>[]

  return {
    today: localDate(now),
    userName,
    tasks: tasks.map((t) => ({
      id: Number(t.id),
      title: String(t.title),
      // Finished since the import: open again, as it was then (waiting, if it waits on someone).
      status: t.status === 'done' ? (t.waiting_on ? 'waiting_on' : 'open') : String(t.status),
      dueDate: (t.due_date as string) ?? null,
      project: (t.project as string) ?? null,
      requester: (t.requester as string) ?? null,
      waitingOn: (t.waiting_on as string) ?? null,
      // The task's latest updates, whole ones only, so the AI can match new items to it.
      updates: recentNotes(asThen(String(t.updates)), UPDATES_FOR_AI),
      priority: Number(t.priority_score),
      // Rebuilt inputs leave out AI changes: today's may have come from this import or a later one.
      aiChange: t.ai_delta == null || source ? null : { delta: Number(t.ai_delta), reason: String(t.ai_reason) },
    })),
    // A project's overview and its latest updates (whole ones only).
    projects: projects.map((p) => ({
      id: Number(p.id),
      name: String(p.name),
      overview: (p.overview as string) ?? '',
      brief: recentNotes(asThen(String(p.history)), PROJECT_UPDATES_FOR_AI).join(' | '),
      instructions: String(p.instructions),
    })),
    // A person's one-line brief; without one, their latest updates (whole ones only).
    people: people.map((p) => ({
      id: Number(p.id),
      name: String(p.name),
      role: (p.role as string) ?? null,
      company: (p.company as string) ?? null,
      brief: (p.brief as string) || recentNotes(asThen(String(p.history)), UPDATES_FOR_AI).join(' | '),
    })),
  }
}

/**
 * The system prompt. `kinds` limits which suggestions to ask for: the local model does better
 * with a few kinds per request (see OllamaProvider's split passes); Claude gets them all at once.
 */
/** The item's local date (YYYY-MM-DD) from its occurredAt, for the calendar. */
export const itemDateOf = (source: Pick<SourceForExtraction, 'occurredAt'>): string | null => {
  const d = new Date(source.occurredAt)
  return Number.isNaN(d.getTime()) ? null : localDate(d)
}

export function buildSystemPrompt(ctx: ExtractionContext, kinds: SuggestionKind[] = ALL_KINDS, itemDate: string | null = null): string {
  const name = ctx.userName
  const defs = importKindDefinitions(name)
  return importSystem({
    name,
    kindList: kinds.map((k) => `- ${k}: ${defs[k]}`).join('\n'),
    nextActions: asksForNextActions(kinds) ? importNextActionRule(name) : '',
    calendar: calendar(ctx.today, itemDate),
  })
}

/** True when a request with these kinds also asks for next actions (the task kinds; see OllamaProvider's split passes). */
export const asksForNextActions = (kinds: SuggestionKind[]) => kinds.includes('status_update')

/** How a task's current AI priority change reads in a prompt, e.g. ", AI change +10: Dana's launch depends on it". */
export const aiChangeText = (c: { delta: number; reason: string } | null) => (c ? `, AI change ${c.delta > 0 ? '+' : ''}${c.delta}: ${c.reason}` : '')

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * Three weeks of dates with weekday names, so the model looks dates up instead of counting. Small
 * local models get relative dates like "by Friday" wrong without it. It starts on the item's date
 * when that's earlier than today (last week's transcript), else today.
 */
export function calendar(today: string, itemDate: string | null = null): string {
  const named = (ymd: string) => {
    const [y, m, d] = ymd.split('-').map(Number)
    return new Date(y!, m! - 1, d!)
  }
  const older = itemDate && itemDate < today ? itemDate : null
  const start = named(older ?? today)
  const lines: string[] = []
  for (let i = 0; i < 21; i++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    const ymd = localDate(day)
    const note = ymd === today ? ' (today)' : older && i === 0 ? ' (item date)' : !older && i === 1 ? ' (tomorrow)' : ''
    lines.push(`${DAY_NAMES[day.getDay()]} ${ymd}${note}`)
  }
  const label = (ymd: string) => `${DAY_NAMES[named(ymd).getDay()]} ${ymd}`
  return importCalendar({ today: label(today), itemDate: older ? label(older) : null, days: lines.join('\n') })
}

export function buildUserPrompt(ctx: ExtractionContext, source: SourceForExtraction): string {
  const tasks = ctx.tasks.length
    ? ctx.tasks
        .map((t) => `- [${t.id}] ${t.title} (${t.status.replace('_', ' ')}${t.dueDate ? `, due ${t.dueDate}` : ''}${t.project ? `, project: ${t.project}` : ''}${t.requester ? `, asked by ${t.requester}` : ''}${t.waitingOn ? `, waiting on ${t.waitingOn}` : ''}, priority ${t.priority}${aiChangeText(t.aiChange)})${t.updates.length ? ` Updates: ${t.updates.join(' | ')}` : ''}`)
        .join('\n')
    : '(none)'
  const projects = ctx.projects.length
    ? ctx.projects.map((p) => `- [${p.id}] ${p.name}${p.overview ? `: ${oneLine(p.overview, IMPORT_TEXT_CHARS.overview)}` : ''}${p.brief ? ` (Status: ${oneLine(p.brief, IMPORT_TEXT_CHARS.projectStatus)})` : ''}${p.instructions ? ` (Instructions: ${oneLine(p.instructions, IMPORT_TEXT_CHARS.instructions)})` : ''}`).join('\n')
    : '(none)'
  const people = ctx.people.length
    ? ctx.people.map((p) => `- [${p.id}] ${p.name}${p.role ? `, ${p.role}` : ''}${p.company ? `, ${p.company}` : ''}${p.brief ? `: ${oneLine(p.brief, IMPORT_TEXT_CHARS.personBrief)}` : ''}`).join('\n')
    : '(none)'

  return `<open_tasks>
${tasks}
</open_tasks>

<projects>
${projects}
</projects>

<people>
${people}
</people>

<imported_item kind="${SOURCE_KIND_LABELS[source.kind]}" title="${escapeAttr(source.title)}"${source.fromName ? ` from="${escapeAttr(source.fromName)}"` : ''} date="${source.occurredAt.slice(0, 10)}">
${source.content.replace(/<\/?imported_item/gi, '[imported_item')}
</imported_item>

${importAsk(ctx.userName)}`
}

const oneLine = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}
const escapeAttr = (s: string) => s.replace(/"/g, "'").replace(/[<>]/g, '')
