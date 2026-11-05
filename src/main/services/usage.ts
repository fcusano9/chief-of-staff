import type { DatabaseSync } from 'node:sqlite'
import { estimateCost } from '@shared/pricing'
import type { AiSpending, UsageGroup, UsagePeriod, UsagePurpose } from '@shared/types'
import type { AiCallLog, AiCallRecord } from '../ai/provider'

const DAY = 86_400_000

/**
 * What paid AI requests (Claude) are estimated to cost. Every Claude request is recorded in
 * ai_usage, which is never pruned (unlike the AI logs), so totals stay complete. Basic and Ollama
 * requests are free and never recorded.
 */
export class UsageService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Records one request if it was paid and succeeded. */
  record(call: AiCallRecord, purpose: UsagePurpose, briefingId: number | null = null): void {
    if (!call.paidModel || call.inputTokens == null) return
    this.db
      .prepare('INSERT INTO ai_usage (at, purpose, model, input_tokens, output_tokens, briefing_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(call.startedAt, purpose, call.paidModel, call.inputTokens, call.outputTokens ?? 0, briefingId)
  }

  /** A log that only records usage, for requests that have no AI log of their own (person and project briefs). */
  logFor(purpose: UsagePurpose): AiCallLog {
    return { record: (c) => this.record(c, purpose) }
  }

  /** Estimated cost of the Claude requests behind a briefing, or null if none (or none priced). */
  briefingCost(briefingId: number): number | null {
    const rows = this.db.prepare('SELECT model, input_tokens, output_tokens FROM ai_usage WHERE briefing_id = ?').all(briefingId) as unknown as Row[]
    const costs = rows.map((r) => estimateCost(r.model, Number(r.input_tokens), Number(r.output_tokens))).filter((c): c is number => c != null)
    return costs.length ? costs.reduce((a, b) => a + b, 0) : null
  }

  /** This calendar month (local time) and the last 30 days. */
  spending(): AiSpending {
    const now = this.now()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    return { month: this.period(monthStart), last30: this.period(new Date(now.getTime() - 30 * DAY)) }
  }

  private period(from: Date): UsagePeriod {
    const rows = this.db.prepare('SELECT purpose, model, input_tokens, output_tokens FROM ai_usage WHERE at >= ?').all(from.toISOString()) as unknown as Row[]
    return { from: from.toISOString(), total: sum('total', rows), byPurpose: groupBy(rows, (r) => r.purpose), byModel: groupBy(rows, (r) => r.model) }
  }
}

interface Row {
  purpose: string
  model: string
  input_tokens: number
  output_tokens: number
}

function sum(key: string, rows: Row[]): UsageGroup {
  const g: UsageGroup = { key, requests: 0, inputTokens: 0, outputTokens: 0, cost: 0, unpriced: 0 }
  for (const r of rows) {
    const cost = estimateCost(r.model, Number(r.input_tokens), Number(r.output_tokens))
    g.requests++
    g.inputTokens += Number(r.input_tokens)
    g.outputTokens += Number(r.output_tokens)
    if (cost == null) g.unpriced++
    else g.cost += cost
  }
  return g
}

/** Groups, most expensive first. */
function groupBy(rows: Row[], keyOf: (r: Row) => string): UsageGroup[] {
  const keys = [...new Set(rows.map(keyOf))]
  return keys.map((k) => sum(k, rows.filter((r) => keyOf(r) === k))).sort((a, b) => b.cost - a.cost || b.requests - a.requests)
}

/**
 * The paid model behind a logged request, worked out from what the AI log stored: the model that
 * answered (response), else the one asked for (request). Null for Basic and Ollama requests.
 */
export function paidModelOf(endpoint: string, request: string, response: string | null): string | null {
  if (!endpoint.startsWith('Anthropic')) return null
  const model = (json: string | null): string | null => {
    if (!json) return null
    try {
      const v = (JSON.parse(json) as { model?: unknown }).model
      return typeof v === 'string' ? v : null
    } catch {
      return null
    }
  }
  return model(response) ?? model(request)
}
