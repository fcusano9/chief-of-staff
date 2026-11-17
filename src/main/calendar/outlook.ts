import { runOutlookScript } from '../mail/outlook'
import type { CalendarReader, RawMeeting } from './reader'

type OutlookEvent = RawMeeting & { entryId: string; storeId: string }

/** The default calendar of classic Outlook on Windows, through outlook.ps1 (the same script that reads mail). */
export class OutlookCalendar implements CalendarReader {
  readonly app = 'outlook' as const
  /** Each meeting's Outlook ids from the last read, so `open` can find it. */
  private readonly ids = new Map<string, { entryId: string; storeId: string }>()

  constructor(private readonly run: (args: string[]) => Promise<Record<string, unknown>> = runOutlookScript) {}

  async list(from: Date, to: Date): Promise<RawMeeting[]> {
    const r = await this.run(['-Action', 'calendar', '-Since', from.toISOString(), '-Until', to.toISOString()])
    const events = asArray(r.events as OutlookEvent[] | OutlookEvent | null)
    this.ids.clear()
    return events.map((e) => {
      this.ids.set(e.id, { entryId: e.entryId, storeId: e.storeId })
      return { ...e, attendees: asArray(e.attendees) }
    })
  }

  async open(meeting: { id: string; start: string }): Promise<void> {
    const ids = this.ids.get(meeting.id)
    if (!ids) return
    await this.run(['-Action', 'openevent', '-EntryId', ids.entryId, '-StoreId', ids.storeId, '-Start', meeting.start])
  }
}

/** PowerShell 5.1 turns a one-item array into a lone object, and an empty one into null. */
function asArray<T>(value: T[] | T | null | undefined): T[] {
  return value == null ? [] : Array.isArray(value) ? value : [value]
}
