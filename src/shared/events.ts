// How a task's recorded changes read in its Activity log (see TaskEventService).
import type { TaskEvent } from './types'

/** A status as stored in an event: 'open', 'done', or 'waiting_on:Kenji Mori'. */
export const statusValue = (status: string, waitingOn: string | null): string => (status === 'waiting_on' ? `waiting_on:${waitingOn ?? 'someone'}` : status)

const STATUS_TEXT: Record<string, string> = { open: 'Open', done: 'Done', proposed: 'Proposed', dismissed: 'Dismissed' }

function statusText(value: string | null): string {
  if (!value) return 'none'
  if (value.startsWith('waiting_on')) return `Waiting on ${value.slice('waiting_on:'.length) || 'someone'}`
  return STATUS_TEXT[value] ?? value
}

/** 'YYYY-MM-DD' as "Nov 8", with the year when it isn't this year. */
export function shortDate(ymd: string, now: Date = new Date()): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const date = new Date(y!, m! - 1, d!)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(y === now.getFullYear() ? {} : { year: 'numeric' }) })
}

const signed = (n: string | null) => {
  const v = Number(n)
  return v > 0 ? `+${v}` : `−${Math.abs(v)}`
}

/** Who made a change, as Activity shows it: "by you", 'from “Import”, accepted in Review', "by the AI, daily briefing". */
export function eventWho(e: Pick<TaskEvent, 'by' | 'byLabel'>): string {
  if (e.by === 'review') return `from “${e.byLabel ?? 'an import'}”, accepted in Review`
  if (e.by === 'ai') return `by the AI${e.byLabel ? `, ${e.byLabel}` : ''}`
  return 'by you'
}

/** What changed, in a short line, e.g. "Due date moved: Nov 8 → Nov 14". */
export function eventWhat(e: Pick<TaskEvent, 'kind' | 'from' | 'to' | 'note'>, now: Date = new Date()): string {
  const d = (v: string | null) => (v ? shortDate(v, now) : '')
  switch (e.kind) {
    case 'created':
      return 'Created'
    case 'status':
      if (e.to === 'done') return 'Marked done'
      if (e.from === 'done') return e.to === 'open' ? 'Reopened' : `Reopened (${statusText(e.to)})`
      return `Status: ${statusText(e.to)}${e.from && e.from !== 'open' ? ` (was ${statusText(e.from)})` : ''}`
    case 'due':
      if (!e.from) return `Due date set: ${d(e.to)}`
      if (!e.to) return `Due date removed (was ${d(e.from)})`
      return `Due date moved: ${d(e.from)} → ${d(e.to)}`
    case 'project':
      if (!e.to) return `Project removed (was ${e.from})`
      return `Project: ${e.to} (was ${e.from ?? 'none'})`
    case 'requester':
      if (!e.to) return `Asked by removed (was ${e.from})`
      return `Asked by: ${e.to}${e.from ? ` (was ${e.from})` : ''}`
    case 'title':
      return `Renamed from “${e.from ?? ''}”`
    case 'override':
      if (e.to == null) return `Priority set by hand cleared (was ${e.from})`
      return e.from == null ? `Priority set by hand: ${e.to}` : `Priority set by hand: ${e.from} → ${e.to}`
    case 'followups':
      return `Follow-ups: ${e.from ?? 0} → ${e.to ?? 0}`
    case 'ai_priority':
      if (e.to == null) return `AI priority change removed (was ${signed(e.from)})`
      return `AI priority change ${signed(e.to)}${e.note ? `: ${e.note}` : ''}`
  }
}
