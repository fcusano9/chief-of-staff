import { useEffect, useState } from 'react'
import type { CalendarInfo } from '@shared/types'
import { cos, errorMessage } from '../api'
import { useApp } from '../context'

/**
 * Settings → Apple Calendar (Mac only): which calendars Today's meetings come from. Nothing is
 * ticked at first. The list is asked of Calendar when Settings opens; Refresh list asks again.
 * A change reads the calendar again at once.
 */
export function AppleCalendarSettings() {
  const { settings, saveSettings, toast, refresh } = useApp()
  const [calendars, setCalendars] = useState<CalendarInfo[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [mac, setMac] = useState(false)

  useEffect(() => {
    void cos['calendar.week']().then((w) => setMac(w.app === 'apple-calendar'))
  }, [])

  const load = () => {
    setProblem(null)
    cos['calendar.calendars']()
      .then(setCalendars)
      .catch((err) => setProblem(errorMessage(err)))
  }
  useEffect(() => {
    if (mac) load()
  }, [mac])

  if (!mac) return null

  const chosen = new Set(settings.calendarIds)
  const toggle = (id: string) => {
    const next = new Set(chosen)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    void saveSettings({ calendarIds: [...next] })
      .then(() => cos['calendar.refresh']())
      .then(() => refresh())
      .catch((err) => toast(errorMessage(err), true))
  }

  return (
    <div className="card" id="apple-calendar" data-apple-calendar-settings>
      <div className="row" style={{ marginBottom: 4 }}>
        <div style={{ fontWeight: 500 }}>Apple Calendar</div>
        <div className="spacer" />
        <button className="btn ghost" style={{ fontSize: 'var(--fs-sm)' }} onClick={load}>
          Refresh list
        </button>
      </div>
      <div className="muted" style={{ fontSize: 'var(--fs-sm)', marginBottom: 6 }}>
        Calendars to read
      </div>
      {problem && <div style={{ padding: '8px 10px', borderRadius: 6, fontSize: 'var(--fs-sm)', background: 'color-mix(in srgb, var(--warn) 12%, transparent)', color: 'var(--warn)' }}>{problem}</div>}
      {calendars == null && !problem && <span className="faint">Loading…</span>}
      {calendars?.length === 0 && <span className="faint">No calendars in Calendar</span>}
      {calendars?.map((c) => (
        <label key={c.id} className="row" style={{ padding: 'var(--row-py) 0', borderTop: '1px solid var(--border)', cursor: 'pointer' }}>
          <input type="checkbox" checked={chosen.has(c.id)} onChange={() => toggle(c.id)} />
          <span className="ttl">{c.title}</span>
          <div className="spacer" />
          <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
            {c.account}
          </span>
        </label>
      ))}
    </div>
  )
}
