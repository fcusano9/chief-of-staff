import { readFileSync } from 'node:fs'
import type { CalendarApp, CalendarInfo, Meeting, MeetingAttendee, MeetingResponse } from '@shared/types'

/** The most attendees kept per meeting (company-wide meetings can invite hundreds). */
export const MAX_ATTENDEES = 50
/** The most invite text kept per meeting, in characters. */
export const MAX_INVITE = 4000

/** One calendar entry as a reader script reports it, before anything is left out. */
export interface RawMeeting {
  id: string
  title: string
  /** ISO times. */
  start: string
  end: string
  location: string
  allDay: boolean
  /** How the entry shows the user's time. */
  busy: 'free' | 'tentative' | 'busy' | 'away' | 'unknown'
  private: boolean
  cancelled: boolean
  /** The user's own answer ('organizer' when they set it up). */
  myResponse: MeetingResponse
  organizer: { name: string; email: string; isMe: boolean } | null
  /** Everyone invited, the user included, up to MAX_ATTENDEES. */
  attendees: { name: string; email: string; response: MeetingResponse; isMe: boolean }[]
  /** Everyone invited, the user included. */
  attendeeCount: number
  invite: string
}

/**
 * Where meetings come from: classic Outlook on Windows (outlook.ts), Apple Calendar on the Mac
 * (applecalendar.ts), or a fixture file in tests. Every reader only reads; `open` shows the meeting
 * (or its day) in the calendar app.
 */
export interface CalendarReader {
  readonly app: CalendarApp
  /** Entries that overlap [from, to). */
  list(from: Date, to: Date): Promise<RawMeeting[]>
  /** Shows the meeting in the calendar app (Apple Calendar: its day). */
  open(meeting: { id: string; start: string }): Promise<void>
  /** Apple Calendar only: every calendar, for Settings. */
  calendars?(): Promise<CalendarInfo[]>
}

/** A meeting before its attendees are matched to People. */
export type ReadMeeting = Omit<Meeting, 'attendees'> & { attendees: Omit<MeetingAttendee, 'personId'>[] }

/** Errors with a message that is safe to show as-is. */
export class CalendarError extends Error {}

/**
 * Keeps what belongs on Today: leaves out declined, cancelled, all-day, free and private entries,
 * drops the user from the attendees, and sorts by start time.
 */
export function toMeetings(raw: RawMeeting[]): ReadMeeting[] {
  return raw
    .filter((m) => !m.allDay && !m.cancelled && !m.private && m.busy !== 'free' && m.myResponse !== 'declined')
    .map((m) => {
      const others = m.attendees.filter((a) => !a.isMe)
      const meListed = others.length < m.attendees.length
      return {
        id: m.id,
        title: m.title.trim() || '(No title)',
        start: m.start,
        end: m.end,
        location: m.location.trim(),
        organizer: m.organizer && !m.organizer.isMe ? m.organizer.name || m.organizer.email : '',
        attendees: others.slice(0, MAX_ATTENDEES).map((a) => ({ name: a.name.trim() || a.email, email: a.email.trim().toLowerCase(), response: a.response })),
        attendeeCount: Math.max(others.length, m.attendeeCount - (meListed ? 1 : 0)),
        myResponse: m.myResponse,
        invite: tidyInvite(m.invite),
      }
    })
    .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title))
}

/** The invite text without Teams join boilerplate and runs of blank lines, shortened to MAX_INVITE. */
export function tidyInvite(text: string): string {
  let s = text.replace(/\r\n?/g, '\n')
  // Teams and Zoom join blocks start with a line of underscores or "Microsoft Teams meeting" and carry no agenda.
  const join = s.search(/\n?_{10,}\n|^\s*Microsoft Teams (meeting|Need help\?)/im)
  if (join >= 0) s = s.slice(0, join)
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return s.length > MAX_INVITE ? `${s.slice(0, MAX_INVITE).trimEnd()}…` : s
}

/** Test data instead of a calendar (COS_CALENDAR_FIXTURE, only for test data folders). Opening does nothing. */
export class FixtureCalendar implements CalendarReader {
  readonly opened: string[] = []

  constructor(
    private readonly path: string,
    readonly app: CalendarApp = 'outlook',
  ) {}

  async list(from: Date, to: Date): Promise<RawMeeting[]> {
    const all = JSON.parse(readFileSync(this.path, 'utf8')) as RawMeeting[]
    return all.filter((m) => Date.parse(m.end) > from.getTime() && Date.parse(m.start) < to.getTime())
  }

  async open(meeting: { id: string }): Promise<void> {
    this.opened.push(meeting.id)
  }

  async calendars(): Promise<CalendarInfo[]> {
    return this.app === 'apple-calendar' ? [{ id: 'fixture-calendar', title: 'Calendar', account: 'Exchange' }] : []
  }
}
