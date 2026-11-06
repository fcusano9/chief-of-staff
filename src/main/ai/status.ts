// "Where this stands" and the next step, written when the user clicks Write on a task or a
// project. Imports and daily briefings write the same card for tasks as part of their own request.
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { ACTIVE_STATUSES, type Task, type TaskEvent } from '@shared/types'
import { eventWhat, eventWho } from '@shared/events'
import { recentNotes } from '@shared/notes'
import { cleanStatus } from '../services/next-actions'
import { STATUS_CARD_FIELDS, statusCardAsk, statusCardSystem } from './prompts'
import { AiError } from './provider'
import { StatusBulletsSchema } from './schema'

/** How much of an item's Updates is sent: whole updates only, newest first. */
export const STATUS_UPDATES_CHARS = 1500
/** How many of a task's newest Activity lines are sent. */
export const STATUS_ACTIVITY_LINES = 20
/** How much of a task's Notes is sent. */
const NOTES_CHARS = 1000

/** What the AI is sent when it writes a card. */
export interface StatusInput {
  userName: string
  /** 'YYYY-MM-DD'. */
  today: string
  scope: 'task' | 'project'
  name: string
  /** One line each: "Status: Open", "Due: 2026-11-14", "Project: …" and so on. */
  facts: string[]
  notes: string | null
  /** Newest first. */
  updates: string[]
  /** Tasks: the newest Activity lines. Projects: its open tasks, one line each. */
  lines: string[]
}

export const StatusSchema = z.object({
  status: StatusBulletsSchema,
  action: z.string().describe(STATUS_CARD_FIELDS.action),
})
export type RawStatus = z.infer<typeof StatusSchema>

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const updatesFor = (db: DatabaseSync, scope: 'task' | 'project', id: number) =>
  recentNotes((db.prepare('SELECT summary FROM context_briefs WHERE scope = ? AND owner_id = ?').get(scope, id) as { summary: string } | undefined)?.summary ?? '', STATUS_UPDATES_CHARS)

export function buildTaskStatusInput(db: DatabaseSync, task: Task, events: TaskEvent[], userName: string, now = new Date()): StatusInput {
  const waiting = task.status === 'waiting_on' ? `Waiting on ${task.waitingOn ?? 'someone'}` : task.status === 'done' ? 'Done' : 'Open'
  const subtasks = task.subtasks.map((s) => `${s.isDone ? '[done]' : '[open]'} ${s.title}`)
  const facts = [
    `Status: ${waiting}`,
    `Due: ${task.dueDate ?? 'no due date'}`,
    task.project ? `Project: ${task.project.name}` : null,
    task.requester ? `Asked by: ${task.requester.name}` : null,
    subtasks.length ? `Subtasks: ${subtasks.join('; ')}` : null,
  ].filter((f): f is string => !!f)
  const updates = updatesFor(db, 'task', task.id)
  const notes = task.notes?.trim() ? task.notes.trim().slice(0, NOTES_CHARS) : null
  if (!updates.length && !notes && !events.some((e) => e.kind !== 'created')) {
    throw new AiError('There is nothing to go on yet. Add a note or an update, then try again.')
  }
  return {
    userName,
    today: ymd(now),
    scope: 'task',
    name: task.title,
    facts,
    notes,
    updates,
    lines: events.slice(0, STATUS_ACTIVITY_LINES).map((e) => `${e.at.slice(0, 10)}: ${eventWhat(e, now)} (${eventWho(e).replace(/^by you$/, 'by the user')})`),
  }
}

export function buildProjectStatusInput(db: DatabaseSync, projectId: number, userName: string, now = new Date()): StatusInput {
  const project = db.prepare('SELECT name, status, overview FROM projects WHERE id = ?').get(projectId) as { name: string; status: string; overview: string | null } | undefined
  if (!project) throw new Error('That project no longer exists.')
  const active = ACTIVE_STATUSES.map((s) => `'${s}'`).join(', ')
  const tasks = db
    .prepare(`SELECT title, status, due_date, waiting_on FROM work_items WHERE project_id = ? AND status IN (${active}) ORDER BY due_date IS NULL, due_date, id LIMIT 40`)
    .all(projectId) as { title: string; status: string; due_date: string | null; waiting_on: string | null }[]
  const updates = updatesFor(db, 'project', projectId)
  if (!updates.length && !tasks.length) throw new AiError('There is nothing to go on yet. Add an update or a task, then try again.')
  return {
    userName,
    today: ymd(now),
    scope: 'project',
    name: project.name,
    facts: [`Status: ${project.status.replace('_', ' ')}`, project.overview ? `Overview: ${project.overview}` : null].filter((f): f is string => !!f),
    notes: null,
    updates,
    lines: tasks.map((t) => `${t.title} (${t.status === 'waiting_on' ? `waiting on ${t.waiting_on ?? 'someone'}` : 'open'}${t.due_date ? `, due ${t.due_date}` : ''})`),
  }
}

export function buildStatusPrompt(input: StatusInput): { system: string; user: string } {
  const me = input.userName
  const first = me.split(/\s+/)[0] || me
  const system = statusCardSystem({ me, first, scope: input.scope, today: input.today })
  const list = (items: string[]) => (items.length ? items.map((t) => `- ${t}`).join('\n') : '(none)')
  const fence = (s: string) => s.replace(/<\/?(item|notes|updates|activity|open_tasks)/gi, '[$1')
  const user = `<item>
${input.scope === 'task' ? 'Task' : 'Project'}: ${fence(input.name)}
${input.facts.map(fence).join('\n')}
</item>
${input.notes ? `\n<notes>\n${fence(input.notes)}\n</notes>\n` : ''}
<updates>
${fence(list(input.updates))}
</updates>

<${input.scope === 'task' ? 'activity' : 'open_tasks'}>
${fence(list(input.lines))}
</${input.scope === 'task' ? 'activity' : 'open_tasks'}>

${statusCardAsk(input.name)}`
  return { system, user }
}

/** Tidies the card and refuses one with no next step or no bullets. */
export function cleanStatusCard(raw: RawStatus): { status: string[]; action: string } {
  const status = cleanStatus(raw.status)
  const action = raw.action.replace(/\s+/g, ' ').trim().slice(0, 200)
  if (!status.length || !action) throw new AiError("The AI didn't write a full card. Try again.")
  return { status, action }
}
