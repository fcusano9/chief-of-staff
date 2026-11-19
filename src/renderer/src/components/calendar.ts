import { useEffect, useState } from 'react'
import type { CalendarWeek, Meeting } from '@shared/types'
import { cos } from '../api'
import { useApp } from '../context'

/**
 * The current week's meetings, asked of the main process (which reads the calendar at startup and
 * every 30 minutes) when the screen opens, after any change, and once a minute so "now" and past
 * meetings stay right.
 */
export function useCalendarWeek(): { week: CalendarWeek | null; now: Date; setWeek: (w: CalendarWeek) => void } {
  const { version } = useApp()
  const [week, setWeek] = useState<CalendarWeek | null>(null)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    void cos['calendar.week']().then(setWeek)
  }, [version])
  useEffect(() => {
    const t = setInterval(() => {
      setNow(new Date())
      void cos['calendar.week']().then(setWeek)
    }, 60_000)
    return () => clearInterval(t)
  }, [])
  return { week, now, setWeek }
}

/** "09:30" in 24-hour time. */
export const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

/** The local day, 'YYYY-MM-DD', for grouping. */
export const dayOf = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "Today", "Tomorrow", or "Thu". */
export function dayName(iso: string, now: Date): string {
  const day = dayOf(iso)
  if (day === dayOf(now.toISOString())) return 'Today'
  const t = new Date(now)
  t.setDate(t.getDate() + 1)
  if (day === dayOf(t.toISOString())) return 'Tomorrow'
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short' })
}

export const isPast = (m: Meeting, now: Date) => Date.parse(m.end) <= now.getTime()
export const isNow = (m: Meeting, now: Date) => Date.parse(m.start) <= now.getTime() && Date.parse(m.end) > now.getTime()

/** "Dana, Sam, Riley" (first names), or "Dana, Sam and 23 others". */
export function whoLine(m: Meeting): string {
  const first = (n: string) => (n.includes(',') ? n.split(',')[1]!.trim() : n).split(/\s+/)[0] ?? n
  const names = m.attendees.slice(0, 3).map((a) => first(a.name))
  const more = m.attendeeCount - names.length
  return more > 0 ? `${names.join(', ')} and ${more} other${more === 1 ? '' : 's'}` : names.join(', ')
}
