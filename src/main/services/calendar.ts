import type { CalendarInfo, CalendarWeek, Meeting, Person } from '@shared/types'
import { nameKey } from '@shared/calendar'
import { addDays, dayStart, weekStartOf } from '@shared/week'
import { type CalendarReader, type ReadMeeting, toMeetings } from '../calendar/reader'

/**
 * The current week's meetings (Sunday to Saturday), read from the calendar at startup, on the
 * 30-minute timer and when the user asks. Kept in memory only: nothing is saved and nothing is sent
 * anywhere. Attendees are matched to People each time the week is asked for, so a person added
 * since the read is linked at once.
 */
export class CalendarService {
  private weekStart: string
  private meetings: ReadMeeting[] = []
  private readAt: string | null = null
  private problem: string | null = null
  private reading: Promise<CalendarWeek> | null = null

  constructor(
    private readonly reader: CalendarReader | null,
    private readonly people: () => Person[],
    private readonly needsSetup: () => boolean = () => false,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.weekStart = weekStartOf(this.now())
  }

  /** Reads the current week again. A read already under way is shared rather than started twice. */
  refresh(): Promise<CalendarWeek> {
    this.reading ??= this.read().finally(() => {
      this.reading = null
    })
    return this.reading
  }

  /** The meetings from the last read, with attendees matched to People. */
  week(): CalendarWeek {
    const weekStart = weekStartOf(this.now())
    // A read from last week shows nothing until this week is read.
    const current = weekStart === this.weekStart
    const match = matcher(this.people())
    return {
      app: this.reader?.app ?? null,
      weekStart,
      readAt: current ? this.readAt : null,
      problem: this.problem,
      needsSetup: !!this.reader && this.needsSetup(),
      meetings: current ? this.meetings.map((m): Meeting => ({ ...m, attendees: m.attendees.map((a) => ({ ...a, personId: match(a.name, a.email) })) })) : [],
    }
  }

  /** Shows a meeting from the last read in the calendar app (Apple Calendar: its day). */
  async open(id: string): Promise<void> {
    const m = this.meetings.find((x) => x.id === id)
    if (m && this.reader) await this.reader.open({ id: m.id, start: m.start })
  }

  /** Apple Calendar's calendars, for Settings; empty elsewhere. */
  async calendars(): Promise<CalendarInfo[]> {
    return (await this.reader?.calendars?.()) ?? []
  }

  private async read(): Promise<CalendarWeek> {
    const weekStart = weekStartOf(this.now())
    if (!this.reader || this.needsSetup()) {
      this.weekStart = weekStart
      this.meetings = []
      this.readAt = null
      this.problem = null
      return this.week()
    }
    const from = dayStart(weekStart)
    const to = dayStart(addDays(weekStart, 7))
    try {
      const raw = await this.reader.list(from, to)
      this.meetings = toMeetings(raw).filter((m) => Date.parse(m.end) > from.getTime() && Date.parse(m.start) < to.getTime())
      this.weekStart = weekStart
      this.readAt = this.now().toISOString()
      this.problem = null
    } catch (err) {
      // Keep the last good read on screen with the problem next to it.
      this.problem = err instanceof Error ? err.message : String(err)
    }
    return this.week()
  }
}

/**
 * Finds the person an attendee is: by email first, then by name ("Lee, Dana" also matches "Dana Lee").
 * A name two people share matches neither.
 */
export function matcher(people: Person[]): (name: string, email: string) => number | null {
  const byEmail = new Map<string, number>()
  const byName = new Map<string, number | null>()
  for (const p of people) {
    if (p.email) byEmail.set(p.email.trim().toLowerCase(), p.id)
    const key = nameKey(p.name)
    if (key) byName.set(key, byName.has(key) ? null : p.id)
  }
  return (name, email) => {
    if (email) {
      const id = byEmail.get(email.trim().toLowerCase())
      if (id != null) return id
    }
    return byName.get(nameKey(name)) ?? null
  }
}
