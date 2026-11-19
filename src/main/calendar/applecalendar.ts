import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CalendarInfo } from '@shared/types'
import { CalendarError, type CalendarReader, type RawMeeting } from './reader'
import script from './applecalendar.jxa?raw'

/** Runs applecalendar.jxa and returns its result, or throws a CalendarError with a message that's safe to show. */
export type AppleCalendarRunner = (request: Record<string, unknown>) => Promise<Record<string, unknown>>

/** Apple Calendar on the Mac, through EventKit. Reads only the calendars chosen in Settings. */
export class AppleCalendarReader implements CalendarReader {
  readonly app = 'apple-calendar' as const

  constructor(
    private readonly chosen: () => string[],
    private readonly run: AppleCalendarRunner = runAppleCalendar,
  ) {}

  async list(from: Date, to: Date): Promise<RawMeeting[]> {
    const ids = this.chosen()
    if (!ids.length) return []
    const r = await this.run({ action: 'list', calendars: ids, from: from.toISOString(), to: to.toISOString() })
    return (r.events as RawMeeting[] | undefined) ?? []
  }

  async open(meeting: { id: string; start: string }): Promise<void> {
    await this.run({ action: 'show', start: meeting.start })
  }

  async calendars(): Promise<CalendarInfo[]> {
    const r = await this.run({ action: 'calendars' })
    return ((r.calendars as CalendarInfo[] | undefined) ?? []).sort((a, b) => a.account.localeCompare(b.account) || a.title.localeCompare(b.title))
  }
}

export const runAppleCalendar: AppleCalendarRunner = async (request) => {
  const id = randomUUID()
  const scriptPath = join(tmpdir(), `cos-calendar-${id}.js`)
  const requestPath = join(tmpdir(), `cos-calendar-${id}.json`)
  writeFileSync(scriptPath, script, { encoding: 'utf8', mode: 0o600 })
  writeFileSync(requestPath, JSON.stringify(request), { encoding: 'utf8', mode: 0o600 })
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile('osascript', ['-l', 'JavaScript', scriptPath, requestPath], { timeout: 2 * 60_000, maxBuffer: 64 * 1024 * 1024 }, (err, out, stderr) => {
        if (err) reject(new CalendarError(`Couldn't run the Apple Calendar reader: ${stderr.trim() || err.message}`))
        else resolve(out)
      })
    })
    let result: Record<string, unknown>
    try {
      result = JSON.parse(stdout) as Record<string, unknown>
    } catch {
      throw new CalendarError("The Apple Calendar reader didn't return a result.")
    }
    if (!result.ok) throw new CalendarError(String(result.error ?? 'Apple Calendar could not be read.'))
    return result
  } finally {
    rmSync(scriptPath, { force: true })
    rmSync(requestPath, { force: true })
  }
}
