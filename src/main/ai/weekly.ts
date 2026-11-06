import { z } from 'zod'
import { MAX_POINTS, WEEKLY_ITEMS_SENT } from './limits'
import { AiError } from './provider'
import { WEEKLY_ASK, WEEKLY_FIELDS as F, weeklySystem } from './prompts'

/** Everything the AI knows when it writes a weekly reflection. Built by WeeklyService from the week's lists. */
export interface WeeklyInput {
  userName: string
  /** e.g. "Nov 1 – 7". */
  weekLabel: string
  /** 'YYYY-MM-DD'. */
  today: string
  /** e.g. "Thursday". */
  weekday: string
  /** True on Saturday, the last day of the week. */
  lastDay: boolean
  completed: { title: string; project: string | null; day: string }[]
  added: { title: string; project: string | null; source: string }[]
  /** Overdue tasks, and tasks whose due date was pushed later this week (pushedDays, with the moves in pushed). */
  slipping: { title: string; project: string | null; due: string; overdueDays: number; pushedDays?: number | null; pushed?: string | null }[]
  waiting: { title: string; project: string | null; waitingOn: string; days: number | null }[]
}

export const WeeklySchema = z.object({
  summary: z.string().describe(F.summary),
  went_well: z.array(z.string()).describe(F.went_well),
  slipped: z.array(z.string()).describe(F.slipped),
  focus_next: z.array(z.string()).describe(F.focus_next),
})
export type RawReflection = z.infer<typeof WeeklySchema>

/** Points per list in the reflection; lives in limits.ts, re-exported here for callers. */
export { MAX_POINTS }

export function buildWeeklyPrompt(input: WeeklyInput): { system: string; user: string } {
  const me = input.userName
  const first = me.split(/\s+/)[0]
  const system = weeklySystem({ me, first, weekLabel: input.weekLabel, weekday: input.weekday, today: input.today, lastDay: input.lastDay })

  const fence = (tag: string, text: string) => text.replace(new RegExp(`</?${tag}`, 'gi'), `[${tag}`)
  const section = <T>(tag: string, items: T[], line: (x: T) => string) => {
    const shown = items.slice(0, WEEKLY_ITEMS_SENT).map(line)
    if (items.length > WEEKLY_ITEMS_SENT) shown.push(`(and ${items.length - WEEKLY_ITEMS_SENT} more)`)
    return `<${tag} count="${items.length}">\n${fence(tag, shown.length ? shown.join('\n') : '(none)')}\n</${tag}>`
  }
  const proj = (p: string | null) => (p ? ` · project: ${p}` : '')
  const user = [
    section('completed', input.completed, (c) => `- ${c.title}${proj(c.project)} · done ${c.day}`),
    section('added', input.added, (a) => `- ${a.title}${proj(a.project)} · ${a.source}`),
    section('slipping', input.slipping, (s) => {
      const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`
      const pushed = s.pushedDays ? `, due date pushed back ${days(s.pushedDays)} this week${s.pushed ? ` (${s.pushed})` : ''}` : ''
      return `- ${s.title}${proj(s.project)} · due ${s.due}, ${s.overdueDays > 0 ? `overdue by ${days(s.overdueDays)}` : 'not overdue'}${pushed}`
    }),
    section('waiting_on', input.waiting, (w) => `- ${w.title}${proj(w.project)} · waiting on ${w.waitingOn}${w.days != null ? ` for ${w.days} day${w.days === 1 ? '' : 's'}` : ''}`),
    WEEKLY_ASK,
  ].join('\n\n')
  return { system, user }
}

const tidy = (s: string, max = 300) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}
const points = (items: string[]) => items.map((p) => tidy(p.replace(/^\s*[-*•]\s*/, ''))).filter(Boolean).slice(0, MAX_POINTS)

/** Tidies the AI's answer: trimmed text, at most MAX_POINTS per list. An empty summary is an error. */
export function assembleReflection(raw: RawReflection): { summary: string; wentWell: string[]; slipped: string[]; focusNext: string[] } {
  const summary = tidy(raw.summary, 500)
  if (!summary) throw new AiError("The AI didn't write a reflection. Try again.")
  return { summary, wentWell: points(raw.went_well), slipped: points(raw.slipped), focusNext: points(raw.focus_next) }
}

/** A rule-based reflection for Basic: counts, the oldest overdue tasks, and the longest waits. */
export function demoReflection(input: WeeklyInput): RawReflection {
  const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`
  const { completed, added, slipping, waiting } = input
  if (!completed.length && !added.length && !slipping.length && !waiting.length) {
    return { summary: 'A quiet week so far: nothing finished, nothing new, and nothing overdue or waiting.', went_well: [], slipped: [], focus_next: [] }
  }
  const overdue = slipping.filter((s) => s.overdueDays > 0).sort((a, b) => b.overdueDays - a.overdueDays)
  const pushed = slipping.filter((s) => !s.overdueDays && s.pushedDays)
  const longWaits = [...waiting].filter((w) => (w.days ?? 0) >= 5).sort((a, b) => (b.days ?? 0) - (a.days ?? 0))
  const summary = `${n(completed.length, 'task')} completed and ${n(added.length, 'new task')} added this week${overdue.length ? `; ${n(overdue.length, 'task is', 'tasks are')} overdue` : ''}.`
  return {
    summary,
    went_well: completed.slice(0, MAX_POINTS).map((c) => `Finished ${c.title}.`),
    slipped: [...overdue.map((s) => `${s.title} is ${n(s.overdueDays, 'day')} overdue.`), ...pushed.map((s) => `${s.title} was pushed back ${n(s.pushedDays!, 'day')}.`)].slice(0, MAX_POINTS),
    focus_next: [
      ...overdue.slice(0, 2).map((s) => `Finish ${s.title}.`),
      ...longWaits.slice(0, 1).map((w) => `Follow up with ${w.waitingOn} on ${w.title}.`),
    ].slice(0, MAX_POINTS),
  }
}
