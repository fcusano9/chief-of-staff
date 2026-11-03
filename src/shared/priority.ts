import type { PriorityWeights } from './types'

/** Days ahead at which a due date stops adding urgency. */
export const DUE_HORIZON_DAYS = 14
/** Days without activity at which staleness maxes out. */
export const STALE_HORIZON_DAYS = 14

/** Business days of waiting after which a waiting-on item is due a follow-up. */
export const FOLLOW_UP_BUSINESS_DAYS = 3

export interface PriorityInput {
  dueDate: string | null
  requester: { name: string; priorityWeight: number } | null
  followUpCount: number
  lastActivityAt: string
  status?: string
  waitingSince?: string | null
}

/** Weekdays (Monday to Friday) from the day after `fromIso` through `now`, in local time. */
export function businessDaysSince(fromIso: string, now: Date): number {
  const from = new Date(fromIso)
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1)
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let n = 0
  for (; day <= end; day.setDate(day.getDate() + 1)) if (day.getDay() !== 0 && day.getDay() !== 6) n++
  return n
}

/** True when a waiting-on item has gone FOLLOW_UP_BUSINESS_DAYS without an answer. */
export const needsFollowUp = (t: { status?: string; waitingSince?: string | null }, now: Date): boolean =>
  t.status === 'waiting_on' && !!t.waitingSince && businessDaysSince(t.waitingSince, now) >= FOLLOW_UP_BUSINESS_DAYS

export interface PriorityResult {
  score: number
  rationale: string
}

const DAY_MS = 86_400_000

/** Whole calendar days from local `now` to a 'YYYY-MM-DD' date (negative when past). */
export function daysUntil(date: string, now: Date): number {
  const [y, m, d] = date.split('-').map(Number)
  const due = Date.UTC(y!, m! - 1, d!)
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((due - today) / DAY_MS)
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * Deterministic 0-100 priority score from due date, who is asking, and staleness/follow-ups,
 * with a plain-language rationale. An AI adjustment can be layered on later; a user override
 * always wins (see effectivePriority).
 */
export function scorePriority(item: PriorityInput, weights: PriorityWeights, now: Date): PriorityResult {
  const reasons: { impact: number; text: string }[] = []

  let due = 0.2
  if (item.dueDate) {
    const days = daysUntil(item.dueDate, now)
    if (days < 0) {
      due = 1
      reasons.push({ impact: 1, text: `overdue by ${plural(-days, 'day')}` })
    } else if (days === 0) {
      due = 0.95
      reasons.push({ impact: 0.95, text: 'due today' })
    } else {
      due = Math.max(0, 1 - days / DUE_HORIZON_DAYS)
      if (due > 0) reasons.push({ impact: due, text: days === 1 ? 'due tomorrow' : `due in ${days} days` })
    }
  }

  let requester = 0.3
  if (item.requester) {
    requester = (clamp(item.requester.priorityWeight, 1, 5) - 1) / 4
    if (item.requester.priorityWeight >= 4) reasons.push({ impact: requester, text: `requested by ${item.requester.name}` })
  }

  const idleDays = Math.max(0, (now.getTime() - Date.parse(item.lastActivityAt)) / DAY_MS)
  let stale = Math.min(1, idleDays / STALE_HORIZON_DAYS + item.followUpCount * 0.25)
  if (item.followUpCount > 0) reasons.push({ impact: stale, text: plural(item.followUpCount, 'follow-up') })
  else if (idleDays >= 7) reasons.push({ impact: stale, text: `no activity for ${Math.round(idleDays)} days` })
  // A wait with no answer after a few business days is due a follow-up, and climbs from there.
  if (needsFollowUp(item, now)) {
    const days = businessDaysSince(item.waitingSince!, now)
    stale = Math.max(stale, Math.min(1, 0.6 + (days - FOLLOW_UP_BUSINESS_DAYS) * 0.1))
    reasons.push({ impact: stale, text: `no reply in ${plural(days, 'business day')}` })
  }

  const total = weights.dueDate + weights.requester + weights.staleness
  const score = total <= 0 ? 0 : (weights.dueDate * due + weights.requester * requester + weights.staleness * stale) / total

  const text = reasons
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 3)
    .map((r) => r.text)
    .join(', ')
  return {
    score: Math.round(clamp(score, 0, 1) * 100),
    rationale: text ? text[0]!.toUpperCase() + text.slice(1) : 'No deadline or urgency signals',
  }
}
