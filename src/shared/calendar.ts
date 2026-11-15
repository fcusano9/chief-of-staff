// Helpers for meetings shared by the main process and the UI: matching names, and finding the
// tasks and meetings that involve the same people.
import type { Meeting, Person, Task } from './types'

/** "Dana Lee", "Lee, Dana" and "dana  lee" all give "dana lee". Anything in brackets, like "(Finance)", is dropped. */
export function nameKey(name: string): string {
  let s = name.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').trim()
  const comma = /^([^,]+),\s*([^,]+)$/.exec(s)
  if (comma) s = `${comma[2]} ${comma[1]}`
  return s.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** The person ids a task involves: who asked for it, and who it waits on (matched by name). */
export function taskPeople(task: Task, people: Pick<Person, 'id' | 'name'>[]): number[] {
  const ids: number[] = []
  if (task.requesterId != null) ids.push(task.requesterId)
  if (task.waitingOn) {
    const key = nameKey(task.waitingOn)
    const p = people.filter((x) => nameKey(x.name) === key)
    if (p.length === 1 && !ids.includes(p[0]!.id)) ids.push(p[0]!.id)
  }
  return ids
}

/** The person ids among a meeting's attendees. */
export const meetingPeople = (m: Meeting): number[] => m.attendees.flatMap((a) => (a.personId != null ? [a.personId] : []))

/** Open tasks and waiting-on items that involve someone in the meeting. */
export function tasksForMeeting(m: Meeting, tasks: Task[], people: Pick<Person, 'id' | 'name'>[]): Task[] {
  const inMeeting = new Set(meetingPeople(m))
  if (!inMeeting.size) return []
  return tasks.filter((t) => (t.status === 'open' || t.status === 'waiting_on') && taskPeople(t, people).some((id) => inMeeting.has(id)))
}

/** The next meeting (not yet ended) with any of these people, and which of them is in it, or null. */
export function nextMeetingWith(personIds: number[], meetings: Meeting[], now: Date): { meeting: Meeting; personId: number } | null {
  for (const m of meetings) {
    if (Date.parse(m.end) <= now.getTime()) continue
    const ids = meetingPeople(m)
    const hit = personIds.find((id) => ids.includes(id))
    if (hit != null) return { meeting: m, personId: hit }
  }
  return null
}
