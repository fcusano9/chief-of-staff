import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, modelTestLabel, type ModelTestModel } from '@shared/types'
import { buildBriefRequest, buildExtractionRequest } from '../src/main/ai/claude'
import { buildExtractionContext, type ExtractionContext } from '../src/main/ai/context'
import { claudeTimeoutMs } from '../src/main/ai/limits'
import { effortOf, logged, type AiCallLog, type AiProvider, type ProviderSpec } from '../src/main/ai/provider'
import type { RawSuggestion } from '../src/main/ai/schema'
import { openDatabase } from '../src/main/db'
import { ModelTestService } from '../src/main/services/model-tests'
import { SettingsStore } from '../src/main/services/settings'

const raw = (o: Partial<RawSuggestion>): RawSuggestion => ({
  kind: 'new_task', task_id: null, title: '', details: '', due_date: null, project_id: null, project_name: null, requester_name: null,
  waiting_on: null, brief_scope: null, brief_owner_id: null, role: null, company: null, email: null, evidence: 'quote', ...o,
})

/** An AI that answers with canned suggestions (or fails), recording what it was given. */
class Fake implements AiProvider {
  readonly sendsDataExternally = false
  constructor(
    readonly label: string,
    private readonly out: RawSuggestion[] | Error,
    private readonly seen: ExtractionContext[],
    private readonly paidModel: string | null = null,
  ) {}
  async extract(ctx: ExtractionContext, source: { content: string }, log?: AiCallLog) {
    this.seen.push(ctx)
    return logged(
      log,
      { purpose: 'Find suggestions', endpoint: this.paidModel ? 'Anthropic Messages API' : 'fake', request: { model: this.paidModel, user: source.content } },
      async () => {
        if (this.out instanceof Error) throw this.out
        return { suggestions: this.out, next_actions: [], priority_changes: [] }
      },
      (r) => ({ response: { ...r, model: this.paidModel }, inputTokens: 1000, outputTokens: 200, paidModel: this.paidModel }),
    )
  }
  async writePersonBrief() {
    return ''
  }
  async writeStatus() {
    return { status: [], action: '' }
  }
  async writeReply() {
    return { reply_all: false, body: '' }
  }
  async writeBriefing() {
    return { summary: '', priorities: [], nudges: [], new_items: [], priority_changes: [] }
  }
  async writeWeeklyReflection() {
    return { summary: '', went_well: [], slipped: [], focus_next: [] }
  }
  async test() {
    return 'ok'
  }
}

const HAIKU: ModelTestModel = { provider: 'claude', model: 'claude-haiku-5-5', effort: 'low' }
const OPUS: ModelTestModel = { provider: 'claude', model: 'claude-opus-5-5', effort: 'max' }
const LOCAL: ModelTestModel = { provider: 'local', model: 'gpt-oss:20b', effort: 'medium', passes: 'single' }

describe('model tests', () => {
  let folder: string
  let db: DatabaseSync
  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'cos-modeltest-'))
    db = openDatabase(join(folder, 'test.db'))
  })
  afterEach(() => {
    db.close()
    rmSync(folder, { recursive: true, force: true })
  })

  const addSource = (title: string, importedAt: string) =>
    Number(
      db
        .prepare(`INSERT INTO source_items (kind, title, from_name, occurred_at, content, content_hash, imported_at) VALUES ('note', ?, NULL, ?, ?, ?, ?)`)
        .run(title, importedAt, `Text of ${title}`, title, importedAt).lastInsertRowid,
    )
  const addTask = (title: string, createdAt: string, status = 'open', completedAt: string | null = null) =>
    Number(
      db
        .prepare('INSERT INTO work_items (title, status, created_at, last_activity_at, completed_at) VALUES (?, ?, ?, ?, ?)')
        .run(title, status, createdAt, createdAt, completedAt).lastInsertRowid,
    )
  const waitFor = async (svc: ModelTestService) => {
    for (let i = 0; i < 200 && svc.status(); i++) await new Promise((r) => setTimeout(r, 5))
    expect(svc.status()).toBeNull()
  }

  describe("rebuilding an import's input as it was", () => {
    it('leaves out what came later, reopens what was finished since, and drops later updates', () => {
      const before = addTask('Draft the pricing memo', '2026-11-01T10:00:00.000Z')
      const finishedSince = addTask('Book the venue', '2026-11-02T10:00:00.000Z', 'done', '2026-11-12T10:00:00.000Z')
      addTask('Done before', '2026-11-01T10:00:00.000Z', 'done', '2026-11-05T10:00:00.000Z')
      const source = addSource('Pricing email', '2026-11-10T15:00:00.000Z')
      addTask('Reply to Dana', '2026-11-10T15:05:00.000Z') // accepted from this import
      db.prepare(`INSERT INTO context_briefs (scope, owner_id, summary, standing_instructions, updated_at) VALUES ('task', ?, ?, '', '')`).run(
        before,
        ['Nov 3, 2026: First draft shared', 'Nov 10, 2026: Dana wants final numbers (from “Pricing email”)', 'Nov 14, 2026: Sent to finance'].join('\n'),
      )
      db.prepare(`INSERT INTO priority_adjustments (work_item_id, delta, reason, written_by, origin, written_at) VALUES (?, 10, 'Board review', 'Claude', 'import', '2026-11-10T15:01:00.000Z')`).run(before)
      // A person this import created when its suggestion was accepted, and one the user already had.
      const dana = Number(db.prepare(`INSERT INTO people (name) VALUES ('Dana Ruiz')`).run().lastInsertRowid)
      db.prepare(`INSERT INTO people (name) VALUES ('Priya Shah')`).run()
      db.prepare(`INSERT INTO suggestions (source_id, kind, payload, evidence, created_at, status, result_ref_id) VALUES (?, 'new_person', '{}', '', '', 'accepted', ?)`).run(source, dana)

      const ctx = buildExtractionContext(db, 'Frank', new Date('2026-11-19T12:00:00Z'), { sourceId: source })
      expect(ctx.tasks.map((t) => t.title)).toEqual(['Draft the pricing memo', 'Book the venue'])
      expect(ctx.tasks.find((t) => t.id === finishedSince)!.status).toBe('open')
      const memo = ctx.tasks.find((t) => t.id === before)!
      expect(memo.updates).toEqual(['Nov 3, 2026: First draft shared'])
      expect(memo.aiChange).toBeNull()
      expect(ctx.people.map((p) => p.name)).toEqual(['Priya Shah'])
      expect(ctx.today).toBe(buildExtractionContext(db, 'Frank', new Date('2026-11-10T15:00:00.000Z')).today)

      // Without asOf nothing changes: today's open work, as an import sees it now.
      const now = buildExtractionContext(db, 'Frank', new Date('2026-11-19T12:00:00Z'))
      expect(now.tasks.map((t) => t.title)).toEqual(['Draft the pricing memo', 'Reply to Dana'])
      expect(now.tasks[0]!.aiChange).not.toBeNull()
    })
  })

  describe('running a test', () => {
    it('gives every model the same input, saves what each found, and records Claude spending', async () => {
      addTask('Draft the pricing memo', '2026-11-01T10:00:00.000Z')
      const a = addSource('Pricing email', '2026-11-10T15:00:00.000Z')
      const seen: ExtractionContext[] = []
      const specs: ProviderSpec[] = []
      const svc = new ModelTestService(
        db,
        (spec) => {
          specs.push(spec)
          return spec.provider === 'claude'
            ? new Fake('Claude', [raw({ title: 'Send Dana the price list', due_date: '2026-11-21' }), raw({ title: 'Book a review' })], seen, spec.model)
            : new Fake('Local', [raw({ title: 'Send the price list' })], seen)
        },
        () => 'Frank',
      )
      const id = svc.start([a], [HAIKU, LOCAL])
      expect(() => svc.start([a], [HAIKU])).toThrow(/already running/)
      await waitFor(svc)

      expect(seen).toHaveLength(2)
      expect(seen[0]).toBe(seen[1]) // built once per import
      expect(specs).toEqual([
        { provider: 'claude', model: 'claude-haiku-5-5', claudeEffort: 'low' },
        { provider: 'local', model: 'gpt-oss:20b', localReasoning: 'medium', localPasses: 'single' },
      ])
      const test = svc.get(id)!
      expect(test.status).toBe('done')
      expect(test.imports.map((i) => i.title)).toEqual(['Pricing email'])
      const [claude, local] = test.runs
      expect(claude!.suggestions.map((s) => s.title)).toEqual(['Send Dana the price list', 'Book a review'])
      expect(claude!.suggestions[0]!.dueDate).toBe('2026-11-21')
      expect(claude!.cost).toBeGreaterThan(0)
      expect(local!.cost).toBeNull()
      expect(local!.suggestions).toHaveLength(1)
      expect(db.prepare(`SELECT purpose, model FROM ai_usage`).all()).toEqual([{ purpose: 'model_test', model: 'claude-haiku-5-5' }])
      // Nothing reaches Review.
      expect(db.prepare('SELECT COUNT(*) AS n FROM suggestions').get()).toEqual({ n: 0 })

      // Marks are saved, and the list shows the leader and what's left to mark.
      svc.mark(claude!.suggestions[0]!.id, 'accepted')
      svc.mark(claude!.suggestions[1]!.id, 'rejected')
      expect(svc.get(id)!.runs[0]!.suggestions.map((s) => s.mark)).toEqual(['accepted', 'rejected'])
      expect(svc.list()).toMatchObject([{ id, imports: 1, unmarked: 1, best: 0 }])
      expect(svc.aiLog(claude!.id).calls).toHaveLength(1)
    })

    it('keeps going when one model fails, and shows its error', async () => {
      const a = addSource('Pricing email', '2026-11-10T15:00:00.000Z')
      const seen: ExtractionContext[] = []
      const svc = new ModelTestService(
        db,
        (spec) => (spec.model === 'claude-opus-5-5' ? new Fake('Opus', new Error('Rate limited'), seen) : new Fake('Haiku', [raw({ title: 'One' })], seen)),
        () => 'Frank',
      )
      const id = svc.start([a], [OPUS, HAIKU])
      await waitFor(svc)
      const runs = svc.get(id)!.runs
      expect(runs.map((r) => r.status)).toEqual(['failed', 'done'])
      expect(runs[0]!.error).toBe('Rate limited')
    })

    it('limits models and imports, and deleting an import removes its runs', async () => {
      const a = addSource('One', '2026-11-10T15:00:00.000Z')
      const b = addSource('Two', '2026-11-11T15:00:00.000Z')
      const svc = new ModelTestService(db, () => new Fake('Fake', [raw({ title: 'x' })], []), () => 'Frank')
      expect(() => svc.start([a], Array(7).fill(HAIKU))).toThrow(/up to 6/)
      expect(() => svc.start([], [HAIKU])).toThrow(/at least one import/)
      const id = svc.start([a, b], [HAIKU])
      await waitFor(svc)
      expect(svc.get(id)!.runs).toHaveLength(2)
      db.prepare('DELETE FROM source_items WHERE id = ?').run(a)
      expect(svc.get(id)!.runs.map((r) => r.sourceId)).toEqual([b])
      svc.delete(id)
      expect(svc.list()).toEqual([])
    })

    it('marks a test cut off by closing the app as stopped', () => {
      const a = addSource('One', '2026-11-10T15:00:00.000Z')
      const id = Number(db.prepare(`INSERT INTO model_tests (created_at, models, status) VALUES ('2026-11-19T10:00:00Z', ?, 'running')`).run(JSON.stringify([HAIKU])).lastInsertRowid)
      db.prepare(`INSERT INTO model_test_runs (test_id, source_id, model_index, status) VALUES (?, ?, 0, 'running')`).run(id, a)
      const svc = new ModelTestService(db, () => new Fake('Fake', [], []), () => 'Frank')
      const test = svc.get(id)!
      expect(test.status).toBe('stopped')
      expect(test.runs[0]!.status).toBe('skipped')
    })

    it('estimates from the prompt, plus past output for models that have some', () => {
      const a = addSource('One', '2026-11-10T15:00:00.000Z')
      const svc = new ModelTestService(db, () => new Fake('Fake', [], []), () => 'Frank')
      const first = svc.estimate([a], [HAIKU, LOCAL])
      expect(first).toMatchObject({ runs: 2, partial: true })
      expect(first.cost).toBeGreaterThan(0)
      db.prepare(`INSERT INTO ai_usage (at, purpose, model, input_tokens, output_tokens) VALUES ('2026-11-01', 'import', 'claude-haiku-5-5', 1000, 4000)`).run()
      const second = svc.estimate([a], [HAIKU, LOCAL])
      expect(second.partial).toBe(false)
      expect(second.cost).toBeGreaterThan(first.cost)
    })
  })

  it('labels models by name and effort', () => {
    expect(modelTestLabel(HAIKU)).toBe('Claude Haiku 5.5 · Low')
    expect(modelTestLabel(OPUS)).toBe('Claude Opus 5.5 · Max')
    expect(modelTestLabel({ ...OPUS, effort: 'xhigh' })).toBe('Claude Opus 5.5 · Extra')
    expect(modelTestLabel(LOCAL)).toBe('Ollama gpt-oss:20b · Medium · Single')
  })
})

describe('Effort setting', () => {
  it('counts only while Developer Tools is on', () => {
    const on = { devTools: true, claudeEffort: 'high', localReasoning: 'medium', localPasses: 'single' } as const
    expect(effortOf(on)).toEqual({ claude: 'high', reasoning: 'medium', passes: 'single' })
    expect(effortOf({ ...on, devTools: false })).toEqual({ claude: undefined, reasoning: 'low', passes: 'split' })
    expect(effortOf({ ...on, claudeEffort: 'default' }).claude).toBeUndefined()
  })

  it('replaces each request’s own level and gives higher levels more room', () => {
    const ctx: ExtractionContext = { today: '2026-11-19', userName: 'Frank', tasks: [], projects: [], people: [] }
    const src = { kind: 'note' as const, title: 't', fromName: null, occurredAt: '2026-11-19T12:00:00Z', content: 'x' }
    const plain = buildExtractionRequest('claude-opus-5-5', ctx, src)
    expect(plain.output_config.effort).toBe('medium')
    expect(plain.max_tokens).toBe(16000)
    const max = buildExtractionRequest('claude-opus-5-5', ctx, src, 'max')
    expect(max.output_config.effort).toBe('max')
    expect(max.max_tokens).toBe(64000)
    const brief = buildBriefRequest('claude-opus-5-5', { userName: 'Frank', name: 'Dana', role: null, company: null, history: '', asks: [], waitingOn: [] } as never, 'high')
    expect(brief.output_config.effort).toBe('high')
    expect(brief.max_tokens).toBe(16000)
    // Long requests get an explicit time-out, so the SDK doesn't refuse them.
    expect(claudeTimeoutMs(16000)).toBe(600_000)
    expect(claudeTimeoutMs(64000)).toBe(1_800_000)
  })

  it('keeps only known values when saved', () => {
    const folder = mkdtempSync(join(tmpdir(), 'cos-effort-'))
    try {
      const store = new SettingsStore(join(folder, 'settings.json'))
      expect(store.current).toMatchObject({ devTools: false, claudeEffort: 'default', localReasoning: 'low', localPasses: 'split' })
      const saved = store.save({ ...DEFAULT_SETTINGS, devTools: true, claudeEffort: 'huge' as never, localReasoning: 'high', localPasses: 'single' })
      expect(saved).toMatchObject({ devTools: true, claudeEffort: 'default', localReasoning: 'high', localPasses: 'single' })
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})
