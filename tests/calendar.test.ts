import { describe, expect, it } from 'vitest'
import { AppleCalendarReader } from '../src/main/calendar/applecalendar'
import { OutlookCalendar } from '../src/main/calendar/outlook'
import { CalendarError, MAX_ATTENDEES, MAX_INVITE, tidyInvite, toMeetings, type CalendarReader, type RawMeeting } from '../src/main/calendar/reader'
import { CalendarService, matcher } from '../src/main/services/calendar'
import { meetingPeople, nameKey, nextMeetingWith, tasksForMeeting } from '@shared/calendar'
import type { Meeting, Person, Task } from '@shared/types'

// Tuesday, November 17, 2026, 11:10 local time. Its week runs Sunday Nov 15 to Saturday Nov 21.
const NOW = new Date(2026, 10, 17, 11, 10)
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).toISOString()

const me = { name: 'Frank Cusano', email: 'frank@example.com', response: 'accepted' as const, isMe: true }
const raw = (o: Partial<RawMeeting> = {}): RawMeeting => ({
  id: `m-${Math.random()}`,
  title: 'Pricing sync',
  start: at(17, 15),
  end: at(17, 16),
  location: 'Teams',
  allDay: false,
  busy: 'busy',
  private: false,
  cancelled: false,
  myResponse: 'accepted',
  organizer: { name: 'Priya Natarajan', email: 'priya@example.com', isMe: false },
  attendees: [me, { name: 'Priya Natarajan', email: 'Priya@Example.com', response: 'accepted', isMe: false }],
  attendeeCount: 2,
  invite: '',
  ...o,
})

const person = (id: number, name: string, email: string | null = null): Person => ({ id, name, email, role: null, company: null, priorityWeight: 1, brief: null, briefBy: null, briefAt: null })
const PEOPLE = [person(1, 'Priya Natarajan', 'priya@example.com'), person(2, 'Dana Kim'), person(3, 'Sam Okafor')]

class FakeReader implements CalendarReader {
  readonly app = 'outlook' as const
  calls: { from: Date; to: Date }[] = []
  opened: string[] = []
  constructor(public events: RawMeeting[] | Error) {}
  async list(from: Date, to: Date) {
    this.calls.push({ from, to })
    if (this.events instanceof Error) throw this.events
    return this.events
  }
  async open(m: { id: string }) {
    this.opened.push(m.id)
  }
}

describe('toMeetings', () => {
  it('leaves out declined, cancelled, all-day, free and private entries', () => {
    const kept = toMeetings([
      raw({ id: 'keep', title: 'Keep' }),
      raw({ id: 'tentative', busy: 'tentative', myResponse: 'none' }),
      raw({ myResponse: 'declined' }),
      raw({ cancelled: true }),
      raw({ allDay: true }),
      raw({ busy: 'free' }),
      raw({ private: true }),
    ])
    expect(kept.map((m) => m.id)).toEqual(['keep', 'tentative'])
  })

  it('drops the user from attendees, lower-cases emails, and counts the others', () => {
    const [m] = toMeetings([raw({ attendeeCount: 30 })])
    expect(m!.attendees).toEqual([{ name: 'Priya Natarajan', email: 'priya@example.com', response: 'accepted' }])
    expect(m!.attendeeCount).toBe(29)
    expect(m!.organizer).toBe('Priya Natarajan')
  })

  it('keeps no organizer name when the user organized it, and names untitled entries', () => {
    const [m] = toMeetings([raw({ title: '  ', organizer: { name: 'Frank Cusano', email: '', isMe: true }, myResponse: 'organizer' })])
    expect(m!.organizer).toBe('')
    expect(m!.title).toBe('(No title)')
  })

  it(`keeps at most ${MAX_ATTENDEES} attendees and sorts by start`, () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ name: `P${i}`, email: `p${i}@x.com`, response: 'none' as const, isMe: false }))
    const out = toMeetings([raw({ id: 'late', start: at(18, 9) }), raw({ id: 'early', start: at(16, 9), attendees: many, attendeeCount: 660 })])
    expect(out.map((m) => m.id)).toEqual(['early', 'late'])
    expect(out[0]!.attendees).toHaveLength(MAX_ATTENDEES)
    expect(out[0]!.attendeeCount).toBe(660)
  })
})

describe('tidyInvite', () => {
  it('cuts the Teams join block and extra blank lines', () => {
    const text = 'Agenda\r\n1. Copy\r\n\r\n\r\n\r\n2. Launch\r\n________________________________________________________________________________\r\nMicrosoft Teams meeting\r\nJoin: https://teams.example/x'
    expect(tidyInvite(text)).toBe('Agenda\n1. Copy\n\n2. Launch')
  })

  it(`shortens long text to ${MAX_INVITE} characters`, () => {
    const out = tidyInvite('a'.repeat(MAX_INVITE + 500))
    expect(out.length).toBe(MAX_INVITE + 1)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('matching attendees to People', () => {
  it('matches by email first, then by name in either order', () => {
    const match = matcher(PEOPLE)
    expect(match('Someone Else', 'PRIYA@example.com')).toBe(1)
    expect(match('Kim, Dana', '')).toBe(2)
    expect(match('Sam Okafor (Finance)', 'sam@other.com')).toBe(3)
    expect(match('Riley Park', 'riley@example.com')).toBeNull()
  })

  it('matches no one when two people share the name', () => {
    expect(matcher([...PEOPLE, person(4, 'Dana Kim')])('Dana Kim', '')).toBeNull()
  })

  it('normalizes names', () => {
    expect(nameKey('  Lee,  Dana ')).toBe('dana lee')
    expect(nameKey('Dana   Lee [EXT]')).toBe('dana lee')
  })
})

describe('CalendarService', () => {
  it('reads the current week, Sunday to Saturday, and matches attendees', async () => {
    const reader = new FakeReader([raw({ id: 'a' }), raw({ id: 'next-week', start: at(23, 9), end: at(23, 10) })])
    const service = new CalendarService(reader, () => PEOPLE, () => false, () => NOW)
    const week = await service.refresh()
    expect(reader.calls[0]!.from).toEqual(new Date(2026, 10, 15))
    expect(reader.calls[0]!.to).toEqual(new Date(2026, 10, 22))
    expect(week.weekStart).toBe('2026-11-15')
    expect(week.readAt).toBe(NOW.toISOString())
    expect(week.meetings.map((m) => m.id)).toEqual(['a'])
    expect(week.meetings[0]!.attendees[0]!.personId).toBe(1)
  })

  it('keeps the last good read and shows the problem when a read fails', async () => {
    const reader = new FakeReader([raw({ id: 'a' })])
    const service = new CalendarService(reader, () => PEOPLE, () => false, () => NOW)
    await service.refresh()
    reader.events = new CalendarError("Outlook isn't running. Open Outlook, then try again.")
    const week = await service.refresh()
    expect(week.problem).toMatch(/isn't running/)
    expect(week.meetings).toHaveLength(1)
    reader.events = []
    expect((await service.refresh()).problem).toBeNull()
  })

  it('matches people added after the read', async () => {
    const people = [person(2, 'Dana Kim')]
    const service = new CalendarService(new FakeReader([raw()]), () => people, () => false, () => NOW)
    await service.refresh()
    expect(service.week().meetings[0]!.attendees[0]!.personId).toBeNull()
    people.push(person(9, 'Priya Natarajan'))
    expect(service.week().meetings[0]!.attendees[0]!.personId).toBe(9)
  })

  it("shows nothing from last week's read once a new week starts", async () => {
    let now = NOW
    const service = new CalendarService(new FakeReader([raw()]), () => PEOPLE, () => false, () => now)
    await service.refresh()
    now = new Date(2026, 10, 22, 8)
    const week = service.week()
    expect(week.weekStart).toBe('2026-11-22')
    expect(week.meetings).toEqual([])
    expect(week.readAt).toBeNull()
  })

  it('reads nothing while Apple Calendar has no calendars chosen', async () => {
    const reader = new FakeReader([raw()])
    const service = new CalendarService(reader, () => PEOPLE, () => true, () => NOW)
    const week = await service.refresh()
    expect(reader.calls).toHaveLength(0)
    expect(week.needsSetup).toBe(true)
    expect(week.meetings).toEqual([])
  })

  it('shares a read already under way', async () => {
    const reader = new FakeReader([raw()])
    const service = new CalendarService(reader, () => PEOPLE, () => false, () => NOW)
    await Promise.all([service.refresh(), service.refresh()])
    expect(reader.calls).toHaveLength(1)
  })

  it('opens a meeting from the last read', async () => {
    const reader = new FakeReader([raw({ id: 'a' })])
    const service = new CalendarService(reader, () => PEOPLE, () => false, () => NOW)
    await service.refresh()
    await service.open('a')
    await service.open('missing')
    expect(reader.opened).toEqual(['a'])
  })

  it('has no app and reads nothing on a computer without a calendar', async () => {
    const week = await new CalendarService(null, () => PEOPLE, () => false, () => NOW).refresh()
    expect(week.app).toBeNull()
    expect(week.meetings).toEqual([])
  })
})

describe('readers', () => {
  it('Apple Calendar asks only for the chosen calendars, and nothing when none are chosen', async () => {
    const requests: Record<string, unknown>[] = []
    let ids: string[] = []
    const reader = new AppleCalendarReader(
      () => ids,
      async (r) => {
        requests.push(r)
        return { ok: true, events: [raw()] }
      },
    )
    expect(await reader.list(new Date(0), new Date(1))).toEqual([])
    expect(requests).toHaveLength(0)
    ids = ['CAL-1']
    expect(await reader.list(new Date(0), new Date(1))).toHaveLength(1)
    expect(requests[0]).toMatchObject({ action: 'list', calendars: ['CAL-1'] })
    await reader.open({ id: 'x', start: at(17, 9) })
    expect(requests[1]).toEqual({ action: 'show', start: at(17, 9) })
  })

  it("Outlook copes with PowerShell's lone objects and opens the occurrence it read", async () => {
    const calls: string[][] = []
    const event = { ...raw({ id: 'E1|t' }), entryId: 'E1', storeId: 'S1', attendees: me }
    const reader = new OutlookCalendar(async (args) => {
      calls.push(args)
      return args[1] === 'calendar' ? { ok: true, events: event } : { ok: true }
    })
    const list = await reader.list(new Date(2026, 10, 15), new Date(2026, 10, 22))
    expect(list).toHaveLength(1)
    expect(list[0]!.attendees).toEqual([me])
    expect(calls[0]!.slice(0, 2)).toEqual(['-Action', 'calendar'])
    await reader.open({ id: 'E1|t', start: at(17, 15) })
    expect(calls[1]).toEqual(['-Action', 'openevent', '-EntryId', 'E1', '-StoreId', 'S1', '-Start', at(17, 15)])
  })
})

describe('meetings and tasks', () => {
  const meeting = (id: string, start: string, end: string, people: number[]): Meeting => ({
    id,
    title: id,
    start,
    end,
    location: '',
    organizer: '',
    attendees: people.map((p) => ({ name: `P${p}`, email: '', response: 'accepted', personId: p })),
    attendeeCount: people.length,
    myResponse: 'accepted',
    invite: '',
  })
  const task = (o: Partial<Task>): Task => ({ id: 1, title: 't', status: 'open', requesterId: null, waitingOn: null, ...o }) as Task

  it('finds open tasks and waiting items that involve an attendee', () => {
    const m = meeting('m', at(17, 15), at(17, 16), [1, 2])
    const tasks = [
      task({ id: 1, requesterId: 1 }),
      task({ id: 2, status: 'waiting_on', waitingOn: 'Dana Kim' }),
      task({ id: 3, requesterId: 3 }),
      task({ id: 4, requesterId: 1, status: 'done' }),
    ]
    expect(tasksForMeeting(m, tasks, PEOPLE).map((t) => t.id)).toEqual([1, 2])
    expect(meetingPeople(m)).toEqual([1, 2])
  })

  it('finds the next meeting with someone, skipping ones that have ended', () => {
    const ms = [meeting('past', at(17, 9), at(17, 9, 30), [1]), meeting('soon', at(17, 15), at(17, 16), [2, 1]), meeting('later', at(19, 9), at(19, 10), [1])]
    expect(nextMeetingWith([1], ms, NOW)).toEqual({ meeting: ms[1], personId: 1 })
    expect(nextMeetingWith([3], ms, NOW)).toBeNull()
  })
})
