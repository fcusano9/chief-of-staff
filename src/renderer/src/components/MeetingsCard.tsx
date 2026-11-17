import { useEffect, useState } from 'react'
import { tasksForMeeting } from '@shared/calendar'
import type { Meeting, Task } from '@shared/types'
import { cos, errorMessage } from '../api'
import { useApp } from '../context'
import { clock, dayOf, isNow, isPast, useCalendarWeek, whoLine } from './calendar'
import { MeetingPanel } from './MeetingPanel'

/** One meeting: time, title, first names, and how many open tasks involve its attendees. */
export function MeetingRow({ m, now, count, selected, onClick }: { m: Meeting; now: Date; count?: number; selected?: boolean; onClick: () => void }) {
  return (
    <div className={`mt ${isPast(m, now) ? 'past' : ''} ${isNow(m, now) ? 'now' : ''} ${selected ? 'sel' : ''}`} onClick={onClick} data-meeting={m.id}>
      <span className="tm">{clock(m.start)}</span>
      <span style={{ minWidth: 0 }}>
        <div className="ttl">{m.title}</div>
        {m.attendees.length > 0 && <div className="who ttl">{whoLine(m)}</div>}
      </span>
      {count ? <span className="mt-n">{count}</span> : <span />}
    </div>
  )
}

/**
 * Today's meetings on the Today screen, with the rest of the week folded under them. A meeting
 * opens the side panel. Reading happens in the main process; Try again reads now.
 */
export function MeetingsCard() {
  const { people, version, go, toast } = useApp()
  const { week, now, setWeek } = useCalendarWeek()
  const [tasks, setTasks] = useState<Task[]>([])
  const [restOpen, setRestOpen] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [reading, setReading] = useState(false)

  useEffect(() => {
    void cos['tasks.listActive']().then(setTasks)
  }, [version])

  const readNow = () => {
    setReading(true)
    cos['calendar.refresh']()
      .then(setWeek)
      .catch((err) => toast(errorMessage(err), true))
      .finally(() => setReading(false))
  }

  if (!week) return null
  const app = week.app
  if (!app) return null
  const today = dayOf(now.toISOString())
  const todays = week.meetings.filter((m) => dayOf(m.start) === today)
  const later = week.meetings.filter((m) => dayOf(m.start) > today)
  const days = [...new Set(later.map((m) => dayOf(m.start)))]
  const count = (m: Meeting) => tasksForMeeting(m, tasks, people).length
  const selected = week.meetings.find((m) => m.id === open) ?? null

  return (
    <div className="card" data-meetings-card>
      <div className="row" style={{ marginBottom: 4 }}>
        <span className="label">Meetings today</span>
        {todays.length > 0 && <span className="faint mono" style={{ fontSize: 'var(--fs-xs)' }}>{todays.length}</span>}
        <div className="spacer" />
        {week.readAt && !week.problem && (
          <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
            Read {clock(week.readAt)}
          </span>
        )}
      </div>
      {week.needsSetup ? (
        <div className="muted">
          Choose calendars to read in{' '}
          <button className="btn ghost" style={{ padding: '0 4px', fontSize: 'inherit' }} onClick={() => go('settings')}>
            Settings
          </button>
        </div>
      ) : (
        <>
          {week.problem && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ color: 'var(--danger)' }}>{week.problem}</div>
              <button className="btn" style={{ marginTop: 6, fontSize: 'var(--fs-sm)' }} disabled={reading} onClick={readNow}>
                {reading ? 'Reading…' : 'Try again'}
              </button>
            </div>
          )}
          {todays.map((m) => (
            <MeetingRow key={m.id} m={m} now={now} count={count(m)} selected={open === m.id} onClick={() => setOpen(m.id)} />
          ))}
          {todays.length === 0 && week.readAt && <div className="faint">No meetings today</div>}
          {later.length > 0 && (
            <>
              <button className="mt-fold" onClick={() => setRestOpen(!restOpen)}>
                {restOpen ? '▾' : '▸'} Rest of the week <span className="mono faint">{later.length}</span>
              </button>
              {restOpen &&
                days.map((d) => {
                  const ms = later.filter((m) => dayOf(m.start) === d)
                  return (
                    <div key={d}>
                      <div className="mt-day">
                        {new Date(ms[0]!.start).toLocaleDateString(undefined, { weekday: 'short' })}{' '}
                        <span className="mono">{new Date(ms[0]!.start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                      </div>
                      {ms.map((m) => (
                        <MeetingRow key={m.id} m={m} now={now} count={count(m)} selected={open === m.id} onClick={() => setOpen(m.id)} />
                      ))}
                    </div>
                  )
                })}
            </>
          )}
        </>
      )}
      {selected && <MeetingPanel meeting={selected} app={app} onClose={() => setOpen(null)} />}
    </div>
  )
}
