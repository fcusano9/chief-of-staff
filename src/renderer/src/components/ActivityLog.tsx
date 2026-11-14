import { useEffect, useState } from 'react'
import { eventWhat, eventWho } from '@shared/events'
import { SOURCE_KIND_LABELS, type Task, type TaskActivity } from '@shared/types'
import { cos } from '../api'

/** Lines shown before "Show all". */
const SHOWN = 8

interface Line {
  key: string
  at: string
  what: string
  who: string | null
}

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const full = (iso: string) => new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const longDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

/**
 * A task's Activity: every recorded change, newest first, each saying who made it, plus the
 * imports linked to it. Tasks older than the log say what wasn't recorded. Read-only.
 * `folded` shows it as one "Activity" line with the count, opened by a click.
 */
export function ActivityLog({ task, reloadKey = 0, folded = false }: { task: Task | null; reloadKey?: number; folded?: boolean }) {
  const [activity, setActivity] = useState<TaskActivity | null>(null)
  const [all, setAll] = useState(false)
  const [open, setOpen] = useState(!folded)

  useEffect(() => {
    if (!task) return
    let cancelled = false
    void cos['tasks.activity'](task.id).then((a) => !cancelled && setActivity(a))
    return () => {
      cancelled = true
    }
  }, [task, reloadKey])

  if (!task) return folded ? null : <div className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Not saved yet</div>

  const events = activity?.events ?? []
  const lines: Line[] = [
    ...events.map((e) => ({ key: `e-${e.id}`, at: e.at, what: eventWhat(e), who: eventWho(e) })),
    ...task.linkedSources.map((s) => ({ key: `s-${s.id}`, at: s.occurredAt, what: `Linked: ${SOURCE_KIND_LABELS[s.kind].toLowerCase()} “${s.title}”`, who: 'accepted in Review' })),
  ].sort((a, b) => b.at.localeCompare(a.at))
  // Tasks from before the log have no Created event: show when they were created, and say what's missing.
  const older = activity != null && !events.some((e) => e.kind === 'created')
  if (older) lines.push({ key: 'created', at: task.createdAt, what: 'Created', who: null })
  const shown = all ? lines : lines.slice(0, SHOWN)

  const header = folded && (
    <button type="button" className={`fold ${open ? 'open' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
      <span className="chev" />
      Activity <span className="mono faint">{activity ? lines.length : ''}</span>
    </button>
  )
  if (!open) return header

  return (
    <>
    {header}
    <div className="activity" data-testid="activity">
      {shown.map((l) => (
        <div className="act-e" key={l.key}>
          <span className="act-d" title={full(l.at)}>
            {day(l.at)}
          </span>
          <span>
            <span className="act-what">{l.what}</span>
            {l.who && <span className="act-who"> · {l.who}</span>}
          </span>
        </div>
      ))}
      {lines.length > SHOWN && (
        <div className="act-more">
          <button type="button" className="link-btn" onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : `Show all ${lines.length}`}
          </button>
        </div>
      )}
      {older && (all || lines.length <= SHOWN) && <div className="act-old">Changes before {longDay(activity.loggedSince)} weren’t recorded.</div>}
    </div>
    </>
  )
}
