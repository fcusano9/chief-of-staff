import type { SuggestionDraft } from '../src/main/ai/schema'
import type { BenchCase, Expect, Forbid } from './cases'

export interface CaseScore {
  expected: number
  found: number
  datesExpected: number
  datesRight: number
  /** Suggestions that match nothing expected or acceptable: noise Frank would reject. */
  extras: string[]
  /** Suggestions that break a rule: someone else's task, a duplicate, an injected instruction. */
  violations: string[]
  missed: string[]
}

const describe = (d: SuggestionDraft) => `${d.kind}${d.payload.taskId ? ` #${d.payload.taskId}` : ''}: ${d.payload.title}${d.payload.dueDate ? ` (due ${d.payload.dueDate})` : ''}`
const describeExpect = (e: Expect) => `${e.kinds.join('/')}${e.taskId ? ` #${e.taskId}` : ''}${e.text ? ` ${e.text}` : ''}${e.due ? ` due ${e.due.join(' or ')}` : ''}`

function matches(d: SuggestionDraft, e: Expect | Forbid): boolean {
  const text = `${d.payload.title}\n${d.payload.details}`
  if (e.kinds && !e.kinds.includes(d.kind)) return false
  if (e.taskId != null && d.payload.taskId !== e.taskId) return false
  if (e.text && !e.text.test(text)) return false
  if ('waitingOn' in e && e.waitingOn && !e.waitingOn.test(d.payload.waitingOn ?? text)) return false
  if ('linksProject' in e && e.linksProject && !e.linksProject.test(d.links?.project ?? '')) return false
  return true
}

/** Scores validated suggestions (what Frank would actually see in Review) against one case. */
export function scoreCase(c: BenchCase, drafts: SuggestionDraft[]): CaseScore {
  const used = new Set<SuggestionDraft>()
  const score: CaseScore = { expected: c.expect.length, found: 0, datesExpected: 0, datesRight: 0, extras: [], violations: [], missed: [] }

  for (const e of c.expect) {
    if (e.due) score.datesExpected++
    const hit = drafts.find((d) => !used.has(d) && matches(d, e))
    if (!hit) {
      score.missed.push(describeExpect(e))
      continue
    }
    used.add(hit)
    score.found++
    if (e.due && hit.payload.dueDate && e.due.includes(hit.payload.dueDate)) score.datesRight++
  }
  for (const d of drafts) {
    const broken = c.forbid?.find((f) => matches(d, f))
    if (broken) score.violations.push(`${describe(d)} (${broken.why})`)
    else if (!used.has(d) && !c.ok?.some((o) => matches(d, o))) score.extras.push(describe(d))
  }
  return score
}
