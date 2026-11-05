import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { logged, type AiCallLog, type AiCallRecord, type AiProvider } from '../src/main/ai/provider'
import { MIGRATIONS, openDatabase } from '../src/main/db'
import { BriefingService } from '../src/main/services/briefings'
import { SourceService } from '../src/main/services/sources'
import { TaskService } from '../src/main/services/tasks'
import { paidModelOf, UsageService } from '../src/main/services/usage'
import { CLAUDE_PRICES, estimateCost, formatCost, priceLabel } from '@shared/pricing'
import { CLAUDE_MODELS, DEFAULT_SETTINGS } from '@shared/types'

const call = (o: Partial<AiCallRecord>): AiCallRecord => ({
  purpose: 'Find suggestions', endpoint: 'Anthropic Messages API', request: {}, response: {}, error: null,
  startedAt: new Date().toISOString(), durationMs: 10, inputTokens: 10_000, outputTokens: 1_000, paidModel: 'claude-opus-5-5', ...o,
})

/** An AI that makes one logged request per call, reporting `paidModel` like Claude does (or not, like Ollama). */
class Fake implements AiProvider {
  readonly label = 'Fake'
  readonly sendsDataExternally = false
  constructor(private readonly paidModel: string | null) {}
  private one<T>(log: AiCallLog | undefined, out: T) {
    return logged(log, { purpose: 'x', endpoint: 'fake', request: {} }, async () => out, () => ({ response: {}, inputTokens: 10_000, outputTokens: 1_000, paidModel: this.paidModel }))
  }
  extract(_c: unknown, _s: unknown, log?: AiCallLog) {
    return this.one(log, { suggestions: [], next_actions: [], priority_changes: [] })
  }
  writePersonBrief(_i: unknown, log?: AiCallLog) {
    return this.one(log, 'brief')
  }
  writeProjectBrief(_i: unknown, log?: AiCallLog) {
    return this.one(log, 'brief')
  }
  writeBriefing(_i: unknown, log?: AiCallLog) {
    return this.one(log, { summary: 'A quiet day.', priorities: [], nudges: [], new_items: [], priority_changes: [] })
  }
  writeWeeklyReflection(_i: unknown, log?: AiCallLog) {
    return this.one(log, { summary: 'A quiet week.', went_well: [], slipped: [], focus_next: [] })
  }
  async test() {
    return 'ok'
  }
}

describe('cost estimates', () => {
  it('prices input and output per million tokens', () => {
    expect(estimateCost('claude-opus-5-5', 1_000_000, 0)).toBe(4)
    expect(estimateCost('claude-opus-5-5', 10_000, 1_000)).toBeCloseTo(0.06)
    expect(estimateCost('claude-sonnet-5-5', 10_000, 1_000)).toBeCloseTo(0.03)
  })

  it('uses Haiku 5.5’s higher price only for prompts over 100,000 tokens', () => {
    expect(estimateCost('claude-haiku-5-5', 100_000, 1_000)).toBeCloseTo(0.0105)
    expect(estimateCost('claude-haiku-5-5', 100_001, 1_000)).toBeCloseTo(0.0525)
  })

  it('returns null for a model it has no price for', () => {
    expect(estimateCost('claude-opus-4-8', 1000, 100)).toBeNull()
    expect(estimateCost(null, 1000, 100)).toBeNull()
  })

  it('formats small amounts with three decimals', () => {
    expect(formatCost(0)).toBe('$0.00')
    expect(formatCost(0.0672)).toBe('$0.067')
    expect(formatCost(2.5412)).toBe('$2.54')
    expect(formatCost(0.0004)).toBe('under $0.001')
  })

  it('has a price for every Claude model in the picker, and the picker shows it', () => {
    for (const m of CLAUDE_MODELS) {
      expect(CLAUDE_PRICES[m.id]).toBeDefined()
      expect(m.price).toBe(priceLabel(m.id))
    }
    expect(priceLabel('claude-haiku-5-5')).toBe('$0.10 / $0.50 per million tokens')
  })

  it('reads the paid model from a logged request, preferring the one that answered', () => {
    expect(paidModelOf('Anthropic Messages API', '{"model":"claude-opus-5-5"}', '{"model":"claude-sonnet-5-5"}')).toBe('claude-sonnet-5-5')
    expect(paidModelOf('Anthropic Messages API', '{"model":"claude-opus-5-5"}', null)).toBe('claude-opus-5-5')
    expect(paidModelOf('Ollama http://127.0.0.1:11434/api/chat', '{"model":"gpt-oss:20b"}', null)).toBeNull()
  })
})

describe('AI spending', () => {
  let folder: string
  let db: DatabaseSync
  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'cos-usage-'))
    db = openDatabase(join(folder, 'test.db'))
  })
  afterEach(() => {
    db.close()
    rmSync(folder, { recursive: true, force: true })
  })

  it('totals this month and the last 30 days, by purpose and by model', () => {
    const now = new Date(2026, 10, 15, 12) // 15 Nov 2026, local time
    const usage = new UsageService(db, () => now)
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString()
    usage.record(call({ startedAt: daysAgo(1) }), 'import')
    usage.record(call({ startedAt: daysAgo(2), paidModel: 'claude-sonnet-5-5' }), 'import')
    usage.record(call({ startedAt: daysAgo(3) }), 'briefing')
    usage.record(call({ startedAt: daysAgo(20) }), 'person_brief') // last month, within 30 days
    usage.record(call({ startedAt: daysAgo(40) }), 'import') // too old for either

    const { month, last30 } = usage.spending()
    expect(month.total.requests).toBe(3)
    expect(month.total.cost).toBeCloseTo(0.06 + 0.03 + 0.06)
    expect(last30.total.requests).toBe(4)
    expect(month.byPurpose.map((g) => [g.key, g.requests])).toEqual([
      ['import', 2],
      ['briefing', 1],
    ])
    expect(last30.byModel.map((g) => [g.key, g.requests])).toEqual([
      ['claude-opus-5-5', 3],
      ['claude-sonnet-5-5', 1],
    ])
  })

  it('counts requests to a model with no known price but leaves them out of the cost', () => {
    const usage = new UsageService(db)
    usage.record(call({ paidModel: 'claude-opus-4-8' }), 'import')
    usage.record(call({}), 'import')
    const { total } = usage.spending().month
    expect(total).toMatchObject({ requests: 2, unpriced: 1 })
    expect(total.cost).toBeCloseTo(0.06)
  })

  it('records paid imports and briefs, and nothing for free models or failed requests', async () => {
    const usage = new UsageService(db)
    await new SourceService(db, () => new Fake('claude-opus-5-5'), () => 'Frank').importAndExtract({ kind: 'note', title: 'A', content: 'Paid import' })
    await new SourceService(db, () => new Fake(null), () => 'Frank').importAndExtract({ kind: 'note', title: 'B', content: 'Free import' })
    await new Fake('claude-opus-5-5').writePersonBrief({}, usage.logFor('person_brief'))
    await new Fake('claude-opus-5-5').writeProjectBrief({}, usage.logFor('project_brief'))
    usage.record(call({ inputTokens: null, error: 'Rate limited' }), 'import')

    const { byPurpose, total } = usage.spending().month
    expect(total.requests).toBe(3)
    expect(byPurpose.map((g) => g.key).sort()).toEqual(['import', 'person_brief', 'project_brief'])
  })

  it('keeps usage after the import and its AI log are deleted', async () => {
    const sources = new SourceService(db, () => new Fake('claude-opus-5-5'), () => 'Frank')
    const { source } = await sources.importAndExtract({ kind: 'note', title: 'A', content: 'Paid import' })
    expect(sources.aiRuns(source.id)[0]!.calls[0]!.paidModel).toBeNull() // the fake's endpoint isn't Anthropic
    sources.delete(source.id)
    expect(new UsageService(db).spending().month.total.requests).toBe(1)
  })

  it('shows each briefing’s estimated cost in History', async () => {
    const tasks = new TaskService(db, () => DEFAULT_SETTINGS.priorityWeights)
    const paid = await new BriefingService(db, tasks, () => new Fake('claude-opus-5-5'), () => 'Frank').write()
    const free = await new BriefingService(db, tasks, () => new Fake(null), () => 'Frank').write()
    const list = new BriefingService(db, tasks, () => new Fake(null), () => 'Frank').list()
    expect(list.find((b) => b.id === paid.id)!.estimatedCost).toBeCloseTo(0.06)
    expect(list.find((b) => b.id === free.id)!.estimatedCost).toBeNull()
  })
})

describe('upgrading to the AI spending version', () => {
  it('counts the Claude requests already in the AI logs', () => {
    const folder = mkdtempSync(join(tmpdir(), 'cos-usage-up-'))
    const path = join(folder, 'test.db')
    try {
      const old = openDatabase(path, { migrations: MIGRATIONS.slice(0, MIGRATIONS.findIndex((m) => typeof m === 'string' && m.includes('CREATE TABLE ai_usage'))) })
      old.exec(`
        INSERT INTO source_items (id, kind, title, occurred_at, content, content_hash, imported_at) VALUES (1, 'note', 'A', '2026-11-01', 'x', 'h1', '2026-11-01');
        INSERT INTO extraction_runs (id, source_id, provider, started_at) VALUES (1, 1, 'Claude Opus 5.5', '2026-11-01T10:00:00Z');
        INSERT INTO ai_calls (run_id, purpose, endpoint, request, response, error, started_at, duration_ms, input_tokens, output_tokens) VALUES
          (1, 'Find suggestions', 'Anthropic Messages API', '{"model":"claude-opus-5-5"}', '{"model":"claude-opus-5-5"}', NULL, '2026-11-01T10:00:00Z', 900, 9000, 1200),
          (1, 'Find suggestions', 'Anthropic Messages API', '{"model":"claude-opus-5-5"}', NULL, 'Rate limited', '2026-11-01T10:01:00Z', 50, NULL, NULL),
          (1, 'Find suggestions', 'Ollama http://127.0.0.1:11434/api/chat', '{"model":"gpt-oss:20b"}', '{}', NULL, '2026-11-01T10:02:00Z', 40000, 8000, 900);
        INSERT INTO briefings (id, created_at, started_by, written_by, since, content) VALUES (7, '2026-11-02T08:00:00Z', 'manual', 'Claude Sonnet 5.5', '2026-11-01T08:00:00Z', '{}');
        INSERT INTO briefing_ai_calls (briefing_id, purpose, endpoint, request, response, error, started_at, duration_ms, input_tokens, output_tokens) VALUES
          (7, 'Write the briefing', 'Anthropic Messages API', '{"model":"claude-sonnet-5-5"}', '{"model":"claude-sonnet-5-5"}', NULL, '2026-11-02T08:00:00Z', 700, 6000, 900);
      `)
      old.close()

      const db = openDatabase(path)
      const rows = db.prepare('SELECT purpose, model, input_tokens, output_tokens, briefing_id FROM ai_usage ORDER BY at').all()
      expect(rows.map((r) => ({ ...r }))).toEqual([
        { purpose: 'import', model: 'claude-opus-5-5', input_tokens: 9000, output_tokens: 1200, briefing_id: null },
        { purpose: 'briefing', model: 'claude-sonnet-5-5', input_tokens: 6000, output_tokens: 900, briefing_id: 7 },
      ])
      db.close()
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})
