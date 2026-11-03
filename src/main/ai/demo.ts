import type { PersonBriefInput } from './brief'
import type { ExtractionContext, SourceForExtraction } from './context'
import type { AiProvider } from './provider'
import type { RawSuggestion } from './schema'

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'that', 'this', 'about', 'review', 'send', 'draft', 'update', 'new'])
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g)?.filter((w) => w.length > 3 && !STOP.has(w)) ?? []
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Resolves "by Friday", "by tomorrow", "by Nov 9", "by 11/9" against today. */
export function findDueDate(text: string, today: string): string | null {
  const [y, m, d] = today.split('-').map(Number)
  const base = new Date(y!, m! - 1, d!)
  const t = text.toLowerCase()
  const by = t.match(/\b(?:by|before|due|on)\s+(today|tomorrow|eod|end of day|(?:next\s+)?(?:sun|mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?)(?:day)?|[a-z]{3,9}\.?\s+\d{1,2}|\d{1,2}\/\d{1,2})\b/)
  if (!by) return null
  const phrase = by[1]!
  if (phrase === 'today' || phrase === 'eod' || phrase === 'end of day') return ymd(base)
  if (phrase === 'tomorrow') return ymd(new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1))
  const wd = WEEKDAYS.findIndex((w) => phrase.replace('next ', '').startsWith(w.slice(0, 3)))
  if (wd >= 0) {
    let diff = (wd - base.getDay() + 7) % 7 || 7
    if (phrase.startsWith('next ')) diff += 7
    return ymd(new Date(base.getFullYear(), base.getMonth(), base.getDate() + diff))
  }
  const md = phrase.match(/^([a-z]{3})[a-z]*\.?\s+(\d{1,2})$/)
  if (md && MONTHS.includes(md[1]!)) {
    const month = MONTHS.indexOf(md[1]!)
    const date = new Date(base.getFullYear(), month, Number(md[2]))
    if (date < base) date.setFullYear(date.getFullYear() + 1)
    return ymd(date)
  }
  const slash = phrase.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (slash) {
    const date = new Date(base.getFullYear(), Number(slash[1]) - 1, Number(slash[2]))
    if (date < base) date.setFullYear(date.getFullYear() + 1)
    return ymd(date)
  }
  return null
}

/**
 * A rule-based stand-in for a real AI. It runs entirely on this computer, so the import and
 * review flow can be used and tested before a Claude API key is set up. It's deliberately
 * simple: it looks for action-item lines, "waiting on", "done", and dates.
 */
export class DemoProvider implements AiProvider {
  readonly label = 'Demo AI'
  readonly sendsDataExternally = false

  async extract(ctx: ExtractionContext, source: SourceForExtraction): Promise<RawSuggestion[]> {
    const first = ctx.userName.split(/\s+/)[0]!.toLowerCase()
    const lines = source.content
      .split(/\r?\n|(?<=[.!?])\s+(?=[A-Z])/)
      .map((l) => l.trim())
      .filter((l) => l.length > 6 && !/^\d{2}:\d{2}/.test(l) && !/^webvtt/i.test(l))

    const out: RawSuggestion[] = []
    for (const raw of lines) {
      const line = raw.replace(/^([-*•]|\d+[.)]|\[ ?\])\s+/, '')
      const lower = line.toLowerCase()
      const isBullet = line !== raw
      const mentionsMe = new RegExp(`\\b(${first}|i|i'll|me)\\b`).test(lower)
      const actiony = /\b(action item|todo|to do|follow up|follow-up|need to|needs to|will send|will share|please|owner:|assigned to)\b/.test(lower)
      const task = this.matchTask(line, ctx)
      const base = { task_id: null, due_date: findDueDate(line, ctx.today), project_id: null, project_name: null, requester_name: findRequester(line), waiting_on: null, brief_scope: null, brief_owner_id: null, role: null, company: null, email: null, evidence: line.slice(0, 300) }

      const waiting = line.match(/\bwaiting (?:on|for) ([^.,;:]+)/i)
      if (waiting) {
        out.push({ ...base, kind: 'waiting_on', task_id: task?.id ?? null, title: task?.title ?? toTitle(line), details: line, waiting_on: waiting[1]!.trim() })
      } else if (task && /\b(done|completed|complete|finished|shipped|signed off|approved|sent)\b/.test(lower)) {
        out.push({ ...base, kind: 'mark_done', task_id: task.id, title: task.title, details: line })
      } else if (task) {
        out.push({ ...base, kind: 'status_update', task_id: task.id, title: task.title, details: line })
      } else if ((isBullet && (actiony || mentionsMe)) || (actiony && mentionsMe) || new RegExp(`\\b${first} (to|will|needs to)\\b`).test(lower)) {
        out.push({ ...base, kind: 'new_task', title: toTitle(line), details: '', project_id: this.matchProject(line, ctx) })
      }
    }
    return out
  }

  /** "Alex Rivera, Training manager at Crestron. Owns the Q2 certification courses." from role, company and the newest note. */
  async writePersonBrief(input: PersonBriefInput): Promise<string> {
    const who = [input.role, input.company ? `${input.role ? 'at ' : ''}${input.company}` : null].filter(Boolean).join(' ')
    const newest = input.history.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? ''
    // Notes from Review look like 'Nov 2, 2026: text (from “Title”)'.
    const fact = newest.replace(/^[^:]{0,24}\d{4}:\s*/, '').replace(/\s*\(from “[^”]*”\)$/, '').replace(/[.!]*$/, '')
    return `${input.name}${who ? `, ${who}` : ''}.${fact ? ` ${fact[0]!.toUpperCase()}${fact.slice(1)}.` : ''}`
  }

  async test(): Promise<string> {
    return 'The demo AI runs on this computer. Nothing is sent anywhere.'
  }

  private matchTask(line: string, ctx: ExtractionContext) {
    const lw = new Set(words(line))
    let best: { id: number; title: string; score: number } | null = null
    for (const t of ctx.tasks) {
      const tw = words(t.title)
      if (tw.length === 0) continue
      const score = tw.filter((w) => lw.has(w)).length / tw.length
      if (score >= 0.6 && (!best || score > best.score)) best = { id: t.id, title: t.title, score }
    }
    return best
  }

  private matchProject(line: string, ctx: ExtractionContext): number | null {
    const lower = line.toLowerCase()
    return ctx.projects.find((p) => lower.includes(p.name.toLowerCase()))?.id ?? null
  }
}

function findRequester(line: string): string | null {
  const m = line.match(/\b(?:requested|asked) by ([A-Z][a-z]+(?: [A-Z][a-z]+)?)/) ?? line.match(/\b([A-Z][a-z]+(?: [A-Z][a-z]+)?) (?:asked|requested|wants)\b/)
  return m ? m[1]! : null
}

/** "- Action item: Frank to send the deck to EMEA by Friday." -> "Send the deck to EMEA" */
function toTitle(line: string): string {
  let t = line
    .replace(/^([-*•]|\d+[.)]|\[ ?\])\s+/, '')
    .replace(/^(action items?|todo|to do|next steps?|follow[- ]up)\s*[:\-–]\s*/i, '')
    .replace(/^[A-Z][a-z]+(?: [A-Z][a-z]+)?\s+(to|will|needs to|should)\s+/, '')
    .replace(/\s+(by|before|due)\s+.*$/i, '')
    .replace(/[.!]+$/, '')
    .trim()
  if (t.length > 80) t = `${t.slice(0, 77).trimEnd()}…`
  return t ? t[0]!.toUpperCase() + t.slice(1) : line.slice(0, 80)
}
