import { describe, expect, it } from 'vitest'
import { scorePriority, type PriorityInput } from '@shared/priority'
import { DEFAULT_SETTINGS, effectivePriority } from '@shared/types'

const now = new Date(2026, 10, 2, 9, 0, 0) // Nov 2, 2026, 9:00 local
const weights = DEFAULT_SETTINGS.priorityWeights
const ymd = (offsetDays: number) => {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const item = (o: Partial<PriorityInput> & { idleDays?: number } = {}): PriorityInput => ({
  dueDate: o.dueDate ?? null,
  requester: o.requester ?? null,
  followUpCount: o.followUpCount ?? 0,
  lastActivityAt: new Date(now.getTime() - (o.idleDays ?? 0) * 86_400_000).toISOString(),
})

describe('priority engine', () => {
  it('ranks overdue above due next week', () => {
    const overdue = scorePriority(item({ dueDate: ymd(-2) }), weights, now)
    const nextWeek = scorePriority(item({ dueDate: ymd(7) }), weights, now)
    expect(overdue.score).toBeGreaterThan(nextWeek.score)
    expect(overdue.rationale.toLowerCase()).toContain('overdue by 2 days')
  })

  it('raises the score for a high-weight requester', () => {
    const vip = scorePriority(item({ requester: { name: 'VP', priorityWeight: 5 } }), weights, now)
    const peer = scorePriority(item({ requester: { name: 'Peer', priorityWeight: 1 } }), weights, now)
    expect(vip.score).toBeGreaterThan(peer.score)
    expect(vip.rationale.toLowerCase()).toContain('requested by vp')
  })

  it('raises the score for follow-ups and staleness', () => {
    const pinged = scorePriority(item({ followUpCount: 2, idleDays: 5 }), weights, now)
    const fresh = scorePriority(item(), weights, now)
    expect(pinged.score).toBeGreaterThan(fresh.score)
    expect(pinged.rationale.toLowerCase()).toContain('2 follow-ups')
  })

  it('stays within 0 to 100', () => {
    const max = scorePriority(item({ dueDate: ymd(-30), requester: { name: 'X', priorityWeight: 5 }, followUpCount: 10, idleDays: 90 }), weights, now)
    expect(max.score).toBe(100)
    expect(scorePriority(item(), { dueDate: 0, requester: 0, staleness: 0 }, now).score).toBe(0)
  })

  it('lets an override win over the computed score', () => {
    expect(effectivePriority({ priorityScore: 95, priorityOverride: 10 })).toBe(10)
    expect(effectivePriority({ priorityScore: 95, priorityOverride: null })).toBe(95)
  })

  it('explains when there are no signals', () => {
    expect(scorePriority(item(), weights, now).rationale).toBe('No deadline or urgency signals')
  })
})
