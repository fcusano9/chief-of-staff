// Weeks for the weekly review run Sunday to Saturday in local time. A week is named by its
// Sunday, as 'YYYY-MM-DD'.

const pad = (n: number) => String(n).padStart(2, '0')

/** A local date as 'YYYY-MM-DD'. */
export const ymd = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Local midnight at the start of a 'YYYY-MM-DD' day. */
export const dayStart = (day: string): Date => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}

/** 'YYYY-MM-DD' plus whole days (negative goes back). Safe across daylight-saving changes. */
export const addDays = (day: string, days: number): string => {
  const d = dayStart(day)
  d.setDate(d.getDate() + days)
  return ymd(d)
}

/** The Sunday that starts the week containing `date`. */
export const weekStartOf = (date: Date): string => {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  d.setDate(d.getDate() - d.getDay())
  return ymd(d)
}

/** The week's start and end (the next Sunday's local midnight) as ISO timestamps, for comparing with stored times. */
export const weekBounds = (weekStart: string): { from: string; to: string } => ({
  from: dayStart(weekStart).toISOString(),
  to: dayStart(addDays(weekStart, 7)).toISOString(),
})

/** "Nov 1 – 7", "Oct 29 – Nov 4", or "Dec 27, 2026 – Jan 2, 2027" across a new year. */
export const weekLabel = (weekStart: string): string => {
  const a = dayStart(weekStart)
  const b = dayStart(addDays(weekStart, 6))
  const month = (d: Date) => d.toLocaleDateString('en-US', { month: 'short' })
  if (a.getFullYear() !== b.getFullYear()) {
    const full = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    return `${full(a)} – ${full(b)}`
  }
  return a.getMonth() === b.getMonth() ? `${month(a)} ${a.getDate()} – ${b.getDate()}` : `${month(a)} ${a.getDate()} – ${month(b)} ${b.getDate()}`
}
