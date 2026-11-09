import type { DatabaseSync } from 'node:sqlite'
import { ACTIVE_STATUSES, SOURCE_KIND_LABELS, type SourceKind, type SuggestionKind } from '@shared/types'
import { recentNotes } from '@shared/notes'
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
export function buildExtractionContext(db: DatabaseSync, userName: string, now = new Date()): ExtractionContext {
  const active = ACTIVE_STATUSES.map((s) => `'${s}'`).join(', ')
  const tasks = db
    .prepare(
      `SELECT w.id, w.title, w.status, w.due_date, w.waiting_on, w.priority_score, p.name AS project, r.name AS requester, IFNULL(b.summary, '') AS updates,
              a.delta AS ai_delta, a.reason AS ai_reason
       FROM work_items w LEFT JOIN projects p ON p.id = w.project_id LEFT JOIN people r ON r.id = w.requester_id
       LEFT JOIN context_briefs b ON b.scope = 'task' AND b.owner_id = w.id
       LEFT JOIN priority_adjustments a ON a.work_item_id = w.id
       WHERE w.status IN (${active}) ORDER BY w.id`,
    )
    .all() as Record<string, unknown>[]
  const projects = db
    .prepare(
      `SELECT p.id, p.name, p.overview, IFNULL(b.summary, '') AS history, IFNULL(b.standing_instructions, '') AS instructions
       FROM projects p LEFT JOIN context_briefs b ON b.scope = 'project' AND b.owner_id = p.id
       WHERE p.status <> 'archived' ORDER BY p.name`,
    )
    .all() as Record<string, unknown>[]
  const people = db
    .prepare(
      `SELECT p.id, p.name, p.role, p.company, p.brief, IFNULL(b.summary, '') AS history
       FROM people p LEFT JOIN context_briefs b ON b.scope = 'person' AND b.owner_id = p.id ORDER BY p.name`,
    )
    .all() as Record<string, unknown>[]

  return {
    today: localDate(now),
    userName,
    tasks: tasks.map((t) => ({
      id: Number(t.id),
      title: String(t.title),
      status: String(t.status),
      dueDate: (t.due_date as string) ?? null,
      project: (t.project as string) ?? null,
      requester: (t.requester as string) ?? null,
      waitingOn: (t.waiting_on as string) ?? null,
      // The task's latest updates, whole ones only, so the AI can match new items to it.
      updates: recentNotes(String(t.updates), UPDATES_FOR_AI),
      priority: Number(t.priority_score),
      aiChange: t.ai_delta == null ? null : { delta: Number(t.ai_delta), reason: String(t.ai_reason) },
    })),
    // A project's overview and its latest updates (whole ones only).
    projects: projects.map((p) => ({
      id: Number(p.id),
      name: String(p.name),
      overview: (p.overview as string) ?? '',
      brief: recentNotes(String(p.history), PROJECT_UPDATES_FOR_AI).join(' | '),
      instructions: String(p.instructions),
    })),
    // A person's one-line brief; without one, their latest updates (whole ones only).
    people: people.map((p) => ({
      id: Number(p.id),
      name: String(p.name),
      role: (p.role as string) ?? null,
      company: (p.company as string) ?? null,
      brief: (p.brief as string) || recentNotes(String(p.history), UPDATES_FOR_AI).join(' | '),
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
