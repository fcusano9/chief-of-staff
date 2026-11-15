import { useState } from 'react'
import { meetingPeople, nameKey, nextMeetingWith } from '@shared/calendar'
import { useApp } from '../context'
import { clock, dayName, isPast, useCalendarWeek } from './calendar'
import { MeetingPanel } from './MeetingPanel'
import { MeetingRow } from './MeetingsCard'

/** The person ids for a task's Asked by and Waiting on (matched by name, when exactly one person has it). */
export function idsFor(requesterId: number | null, waitingOn: string | null, people: { id: number; name: string }[]): number[] {
  const ids = requesterId != null ? [requesterId] : []
  if (waitingOn?.trim()) {
    const hits = people.filter((p) => nameKey(p.name) === nameKey(waitingOn))
    if (hits.length === 1 && !ids.includes(hits[0]!.id)) ids.push(hits[0]!.id)
  }
  return ids
}

/** "Next meeting with Priya  Today 15:00  Margin model walkthrough" in the task editor. Hidden when there's none this week. */
export function NextMeeting({ personIds }: { personIds: number[] }) {
  const { people } = useApp()
  const { week, now } = useCalendarWeek()
  const [open, setOpen] = useState(false)
  const next = week ? nextMeetingWith(personIds, week.meetings, now) : null
  if (!week || !next) return null
  const name = people.find((p) => p.id === next.personId)?.name.split(/\s+/)[0] ?? ''
  const m = next.meeting
  return (
    <div style={{ marginBottom: 10 }}>
      <button className="next-mt" onClick={() => setOpen(true)} data-next-meeting>
        <span className="label" style={{ whiteSpace: 'nowrap' }}>
          Next meeting with {name}
        </span>
        <span className="tm">
          {dayName(m.start, now)} {clock(m.start)}
        </span>
        <span className="ttl" style={{ flex: 1, minWidth: 0 }}>
          {m.title}
        </span>
      </button>
      {open && <MeetingPanel meeting={m} app={week.app} onClose={() => setOpen(false)} />}
    </div>
  )
}

/** "Meetings this week" with one person, in the person editor. Hidden when there are none left. */
export function PersonMeetings({ personId }: { personId: number }) {
  const { week, now } = useCalendarWeek()
  const [open, setOpen] = useState<string | null>(null)
  if (!week) return null
  const ms = week.meetings.filter((m) => !isPast(m, now) && meetingPeople(m).includes(personId))
  if (!ms.length) return null
  const selected = ms.find((m) => m.id === open) ?? null
  return (
    <div className="card" style={{ marginBottom: 12 }} data-person-meetings>
      <div className="label" style={{ marginBottom: 2 }}>
        Meetings this week <span className="faint mono">{ms.length}</span>
      </div>
      {ms.map((m) => (
        <div key={m.id} style={{ display: 'grid', gridTemplateColumns: '64px minmax(0, 1fr)', alignItems: 'baseline' }}>
          <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
            {dayName(m.start, now)}
          </span>
          <MeetingRow m={m} now={now} selected={open === m.id} onClick={() => setOpen(m.id)} />
        </div>
      ))}
      {selected && <MeetingPanel meeting={selected} app={week.app} onClose={() => setOpen(null)} />}
    </div>
  )
}
