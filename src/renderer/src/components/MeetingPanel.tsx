import { useEffect, useState } from 'react'
import { tasksForMeeting } from '@shared/calendar'
import type { CalendarApp, Meeting, MeetingResponse, Task } from '@shared/types'
import { ymd } from '@shared/week'
import { cos, errorMessage } from '../api'
import { useApp } from '../context'
import { clock, dayName } from './calendar'
import { useShortcutHints } from './hints'

const RESPONSE: Record<MeetingResponse, string> = { organizer: 'Organizer', accepted: 'Accepted', tentative: 'Tentative', declined: 'Declined', none: '' }

/** A task's tag: Overdue, Due today, Due Thu, or Waiting 6 days. */
function taskTag(t: Task): [cls: string, text: string] | null {
  if (t.status === 'waiting_on' && t.waitingSince) {
    const d = Math.max(0, Math.floor((Date.now() - Date.parse(t.waitingSince)) / 86_400_000))
    return ['wait', `Waiting ${d} day${d === 1 ? '' : 's'}`]
  }
  if (!t.dueDate) return null
  const today = ymd(new Date())
  const due = t.dueDate.slice(0, 10)
  if (due < today) return ['over', 'Overdue']
  if (due === today) return ['due', 'Due today']
  const [y, m, d] = due.split('-').map(Number)
  return ['wait', `Due ${new Date(y!, m! - 1, d!).toLocaleDateString(undefined, { weekday: 'short' })}`]
}

/**
 * The side panel for one meeting: when and where, the attendees (linked to People), the open tasks
 * and waiting-on items with them, and the invite. Nothing is saved from it. Esc or a click outside closes it.
 */
export function MeetingPanel({ meeting, app, onClose }: { meeting: Meeting; app: CalendarApp | null; onClose: () => void }) {
  const { people, openTask, openPerson, toast, version } = useApp()
  const [tasks, setTasks] = useState<Task[]>([])
  useShortcutHints([['Esc', 'close']], 2)

  useEffect(() => {
    void cos['tasks.listActive']().then(setTasks)
  }, [version])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Capture phase on window runs first; stopping here keeps the task editor's Esc from closing it too.
      e.preventDefault()
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const related = tasksForMeeting(meeting, tasks, people)
  const personName = (id: number | null) => people.find((p) => p.id === id)?.name
  const first = (n: string) => n.split(/\s+/)[0] ?? n
  const now = new Date()
  const more = meeting.attendeeCount - meeting.attendees.length

  const open = () => void cos['calendar.open'](meeting.id).catch((err) => toast(errorMessage(err), true))

  return (
    <>
      <div className="scrim clear" style={{ zIndex: 10 }} onClick={onClose} />
      <aside className="mt-panel" data-meeting-panel>
        <div className="row">
          <span className="muted mono" style={{ fontSize: 'var(--fs-xs)' }}>
            {dayName(meeting.start, now)} · {clock(meeting.start)}–{clock(meeting.end)}
          </span>
          <div className="spacer" />
          <button className="btn ghost" style={{ fontSize: 'var(--fs-sm)' }} onClick={onClose}>
            Close
          </button>
        </div>
        <h3>{meeting.title}</h3>
        {meeting.location && <div className="muted">{meeting.location}</div>}

        <div className="mt-sec">
          <div className="label">
            Attendees <span className="faint mono">{meeting.attendeeCount + 1}</span>
          </div>
          {meeting.attendees.map((a, i) => (
            <div key={`${a.email}-${i}`} className="mt-att">
              <span style={{ flex: 1, minWidth: 0 }} className="ttl">
                {a.personId != null ? (
                  <button className="link" onClick={() => openPerson({ id: a.personId! })}>
                    {personName(a.personId) ?? a.name}
                  </button>
                ) : (
                  a.name
                )}
              </span>
              {a.personId == null ? (
                <button className="btn ghost" style={{ fontSize: 'var(--fs-xs)', padding: '0 6px' }} onClick={() => openPerson({ name: a.name, email: a.email })}>
                  + Add to People
                </button>
              ) : (
                <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
                  {meeting.organizer && a.name === meeting.organizer ? 'Organizer' : RESPONSE[a.response]}
                </span>
              )}
            </div>
          ))}
          {more > 0 && <div className="faint">and {more} more</div>}
          <div className="mt-att">
            <span className="muted" style={{ flex: 1 }}>
              You
            </span>
            <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
              {RESPONSE[meeting.myResponse]}
            </span>
          </div>
        </div>

        <div className="mt-sec">
          <div className="label">
            Open with attendees <span className="faint mono">{related.length}</span>
          </div>
          {related.map((t) => {
            const tag = taskTag(t)
            const who = t.status === 'waiting_on' && t.waitingOn ? `waiting on ${first(t.waitingOn)}` : t.requester ? first(t.requester.name) : ''
            return (
              <div key={t.id} className="mt-task" onClick={() => openTask({ id: t.id, waiting: t.status === 'waiting_on' })}>
                <span className="dot" style={{ background: t.project?.color ?? 'var(--border-strong)' }} />
                <span className="ttl" style={{ flex: 1 }}>
                  {t.title}
                </span>
                {tag && <span className={`b-tag ${tag[0]}`}>{tag[1]}</span>}
                <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
                  {who}
                </span>
              </div>
            )
          })}
          {related.length === 0 && <div className="faint">Nothing open</div>}
        </div>

        {meeting.invite && (
          <div className="mt-sec">
            <div className="label">Invite</div>
            <div className="mt-invite">{meeting.invite}</div>
          </div>
        )}

        <div className="mt-sec">
          <button className="btn" onClick={open}>
            {app === 'apple-calendar' ? 'Open in Calendar' : 'Open in Outlook'}
          </button>
        </div>
      </aside>
    </>
  )
}
