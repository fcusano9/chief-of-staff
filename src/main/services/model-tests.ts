import type { DatabaseSync } from 'node:sqlite'
import { estimateCost } from '@shared/pricing'
import {
  MODEL_TEST_MAX_IMPORTS,
  MODEL_TEST_MAX_MODELS,
  type AiCall,
  type ModelTest,
  type ModelTestEstimate,
  type ModelTestJob,
  type ModelTestModel,
  type ModelTestRun,
  type ModelTestRunStatus,
  type ModelTestSource,
  type ModelTestSuggestion,
  type ModelTestSummary,
  type SourceKind,
  type SuggestionKind,
} from '@shared/types'
import { buildExtractionContext, buildSystemPrompt, buildUserPrompt, itemDateOf, type ExtractionContext, type SourceForExtraction } from '../ai/context'
import { estimateTokens } from '../ai/ollama'
import type { AiCallLog, AiCallRecord, AiProvider, ProviderSpec } from '../ai/provider'
import { validateSuggestions, type DroppedSuggestion, type SuggestionDraft } from '../ai/schema'
import { nowIso, transaction } from '../db'
import { applyMailRules, type MailMeta } from './sources'
import { paidModelOf, UsageService } from './usage'

/** Claude runs at once. Ollama runs one at a time, after them, grouped by model so each loads once. */
const CLAUDE_AT_ONCE = 3

const pretty = (value: unknown) => JSON.stringify(value, null, 2)

/**
 * Model tests (Settings → Developer Tools): past imports re-run on several models and effort
 * levels so the user can compare what each finds, at what cost and speed. Each import's input is
 * rebuilt as it was when it was imported (buildExtractionContext with asOf), once per test, so
 * every model gets exactly the same input. Nothing goes to Review and nothing in the user's data
 * changes; the only things saved are the test itself, its AI requests, and the user's marks.
 */
export class ModelTestService {
  private readonly usage: UsageService
  private job: { testId: number; done: number; total: number; stop: boolean } | null = null

  constructor(
    private readonly db: DatabaseSync,
    private readonly providerFor: (spec: ProviderSpec) => AiProvider,
    private readonly userName: () => string,
  ) {
    this.usage = new UsageService(db)
    // A test still "running" was cut off when the app closed.
    this.db.exec(`UPDATE model_test_runs SET status = 'skipped' WHERE status IN ('pending', 'running'); UPDATE model_tests SET status = 'stopped' WHERE status = 'running';`)
  }

  /** Imports to pick from, newest first, including mail conversations. */
  sources(limit = 200): ModelTestSource[] {
    return (
      this.db
        .prepare(
          `SELECT s.id, s.title, s.kind, s.imported_at,
                  (SELECT COUNT(*) FROM suggestions g WHERE g.source_id = s.id AND g.status = 'accepted') AS accepted
           FROM source_items s ORDER BY s.imported_at DESC, s.id DESC LIMIT ?`,
        )
        .all(limit) as Record<string, unknown>[]
    ).map((r) => ({ id: Number(r.id), title: String(r.title), kind: r.kind as SourceKind, importedAt: String(r.imported_at), accepted: Number(r.accepted) }))
  }

  /** An import's text, for "Show text". */
  sourceText(sourceId: number): string {
    const row = this.db.prepare('SELECT content FROM source_items WHERE id = ?').get(sourceId) as { content: string } | undefined
    if (!row) throw new Error('That import no longer exists.')
    return row.content
  }

  /**
   * What a test would cost: each Claude run's prompt, plus the output that model has averaged on
   * past imports and tests. A model with no past answers adds only its prompt, so the total is then
   * a lower bound (`partial`). Effort isn't taken into account beyond that history.
   */
  estimate(sourceIds: number[], models: ModelTestModel[]): ModelTestEstimate {
    const claude = models.filter((m) => m.provider === 'claude')
    let cost = 0
    let partial = false
    const avgOut = new Map<string, number | null>()
    for (const m of claude) {
      if (avgOut.has(m.model)) continue
      const row = this.db.prepare(`SELECT AVG(output_tokens) AS avg FROM ai_usage WHERE model = ? AND purpose IN ('import', 'model_test')`).get(m.model) as { avg: number | null }
      avgOut.set(m.model, row.avg == null ? null : Number(row.avg))
    }
    for (const id of sourceIds) {
      const prompt = this.promptTokens(id)
      for (const m of claude) {
        const out = avgOut.get(m.model)
        if (out == null) partial = true
        cost += estimateCost(m.model, prompt, out ?? 0) ?? 0
      }
    }
    return { runs: sourceIds.length * models.length, cost, partial }
  }

  private promptTokens(sourceId: number): number {
    const ctx = buildExtractionContext(this.db, this.userName(), undefined, { sourceId })
    const src = this.source(sourceId)
    return estimateTokens(buildSystemPrompt(ctx, undefined, itemDateOf(src)) + buildUserPrompt(ctx, src))
  }

  /** Starts a test in the background and returns its id. Only one runs at a time. */
  start(sourceIds: number[], models: ModelTestModel[]): number {
    if (this.job) throw new Error('A model test is already running. Wait for it to finish, or stop it.')
    const ids = [...new Set(sourceIds)]
    if (!ids.length) throw new Error('Pick at least one import.')
    if (!models.length) throw new Error('Pick at least one model.')
    if (ids.length > MODEL_TEST_MAX_IMPORTS) throw new Error(`A test can use up to ${MODEL_TEST_MAX_IMPORTS} imports.`)
    if (models.length > MODEL_TEST_MAX_MODELS) throw new Error(`A test can compare up to ${MODEL_TEST_MAX_MODELS} models.`)
    for (const id of ids) this.source(id) // throws if an import was deleted
    const testId = transaction(this.db, () => {
      const testId = Number(this.db.prepare('INSERT INTO model_tests (created_at, models) VALUES (?, ?)').run(nowIso(), JSON.stringify(models)).lastInsertRowid)
      const insert = this.db.prepare('INSERT INTO model_test_runs (test_id, source_id, model_index) VALUES (?, ?, ?)')
      for (const id of ids) models.forEach((_, i) => insert.run(testId, id, i))
      return testId
    })
    this.job = { testId, done: 0, total: ids.length * models.length, stop: false }
    void this.runAll(testId, ids, models)
    return testId
  }

  status(): ModelTestJob | null {
    return this.job ? { testId: this.job.testId, done: this.job.done, total: this.job.total } : null
  }

  /** Stops after the requests already sent. Finished runs are kept; the rest are skipped. */
  stop(): void {
    if (this.job) this.job.stop = true
  }

  private async runAll(testId: number, sourceIds: number[], models: ModelTestModel[]): Promise<void> {
    const job = this.job!
    try {
      // Built once per import, so every model gets exactly the same input.
      const inputs = new Map(sourceIds.map((id) => [id, { ctx: buildExtractionContext(this.db, this.userName(), undefined, { sourceId: id }), source: this.source(id), meta: this.mailMeta(id) }]))
      const runs = this.db.prepare('SELECT id, source_id, model_index FROM model_test_runs WHERE test_id = ? ORDER BY id').all(testId) as Record<string, unknown>[]
      const work = runs.map((r) => ({ runId: Number(r.id), sourceId: Number(r.source_id), model: models[Number(r.model_index)]! }))
      const one = async (w: (typeof work)[number]) => {
        if (job.stop) return
        const input = inputs.get(w.sourceId)!
        await this.runOne(w.runId, w.model, input.ctx, input.source, input.meta)
        job.done++
      }
      const claude = work.filter((w) => w.model.provider === 'claude')
      const local = work.filter((w) => w.model.provider === 'local').sort((a, b) => a.model.model.localeCompare(b.model.model))
      let next = 0
      await Promise.all(
        Array.from({ length: Math.min(CLAUDE_AT_ONCE, claude.length) }, async () => {
          while (next < claude.length) await one(claude[next++]!)
        }),
      )
      for (const w of local) await one(w)
    } catch (err) {
      console.error('Model test failed', err)
    } finally {
      this.db.prepare(`UPDATE model_test_runs SET status = 'skipped' WHERE test_id = ? AND status IN ('pending', 'running')`).run(testId)
      this.db.prepare('UPDATE model_tests SET status = ? WHERE id = ?').run(job.stop ? 'stopped' : 'done', testId)
      this.job = null
    }
  }

  private async runOne(runId: number, model: ModelTestModel, ctx: ExtractionContext, source: SourceForExtraction, meta: MailMeta | null): Promise<void> {
    const t0 = Date.now()
    this.db.prepare(`UPDATE model_test_runs SET status = 'running', started_at = ? WHERE id = ?`).run(nowIso(), runId)
    const insertCall = this.db.prepare(
      `INSERT INTO model_test_calls (run_id, purpose, endpoint, request, response, error, started_at, duration_ms, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const log: AiCallLog = {
      record: (c: AiCallRecord) => {
        insertCall.run(runId, c.purpose, c.endpoint, pretty(c.request), c.response == null ? null : pretty(c.response), c.error, c.startedAt, c.durationMs, c.inputTokens, c.outputTokens, c.cache?.write ?? 0, c.cache?.read ?? 0)
        this.usage.record(c, 'model_test')
      },
    }
    try {
      const provider = this.providerFor(
        model.provider === 'claude'
          ? { provider: 'claude', model: model.model, claudeEffort: model.effort }
          : { provider: 'local', model: model.model, localReasoning: model.effort === 'low' || model.effort === 'medium' || model.effort === 'high' ? model.effort : 'low', localPasses: model.passes ?? 'split' },
      )
      const raw = await provider.extract(ctx, source, log)
      const dropped: DroppedSuggestion[] = []
      const drafts = applyMailRules(validateSuggestions(raw.suggestions, ctx, dropped), meta, dropped)
      transaction(this.db, () => {
        const insert = this.db.prepare(
          'INSERT INTO model_test_suggestions (run_id, position, kind, title, details, due_date, project, person, evidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        drafts.forEach((d, i) => {
          const s = describe(d, ctx)
          insert.run(runId, i, d.kind, s.title, s.details, s.dueDate, s.project, s.person, d.evidence)
        })
        this.db
          .prepare(`UPDATE model_test_runs SET status = 'done', duration_ms = ?, raw_output = ?, dropped_output = ? WHERE id = ?`)
          .run(Date.now() - t0, pretty(raw), JSON.stringify(dropped), runId)
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.db.prepare(`UPDATE model_test_runs SET status = 'failed', duration_ms = ?, error = ? WHERE id = ?`).run(Date.now() - t0, message, runId)
    }
  }

  /** Marks one suggestion accepted, rejected, or (null) not marked. */
  mark(suggestionId: number, mark: 'accepted' | 'rejected' | null): void {
    this.db.prepare('UPDATE model_test_suggestions SET mark = ? WHERE id = ?').run(mark === 'accepted' || mark === 'rejected' ? mark : null, suggestionId)
  }

  delete(testId: number): void {
    if (this.job?.testId === testId) throw new Error('Stop the test before deleting it.')
    this.db.prepare('DELETE FROM model_tests WHERE id = ?').run(testId)
  }

  /** Past tests, newest first. */
  list(): ModelTestSummary[] {
    const tests = this.db.prepare('SELECT id FROM model_tests ORDER BY created_at DESC, id DESC').all() as { id: number }[]
    return tests.map(({ id }) => {
      const t = this.get(Number(id))!
      const suggestions = t.runs.flatMap((r) => r.suggestions)
      const accepted = t.models.map((_, i) => t.runs.filter((r) => r.modelIndex === i).reduce((n, r) => n + r.suggestions.filter((s) => s.mark === 'accepted').length, 0))
      const most = Math.max(0, ...accepted)
      const costs = t.runs.map((r) => r.cost).filter((c): c is number => c != null)
      return {
        id: t.id,
        createdAt: t.createdAt,
        status: t.status,
        models: t.models,
        imports: t.imports.length,
        cost: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
        unmarked: suggestions.filter((s) => s.mark == null).length,
        best: most > 0 ? accepted.indexOf(most) : null,
      }
    })
  }

  get(testId: number): ModelTest | null {
    const t = this.db.prepare('SELECT * FROM model_tests WHERE id = ?').get(testId) as Record<string, unknown> | undefined
    if (!t) return null
    const runs = this.db.prepare('SELECT * FROM model_test_runs WHERE test_id = ? ORDER BY source_id, model_index').all(testId) as Record<string, unknown>[]
    const suggestions = this.db
      .prepare('SELECT g.* FROM model_test_suggestions g JOIN model_test_runs r ON r.id = g.run_id WHERE r.test_id = ? ORDER BY g.run_id, g.position')
      .all(testId) as Record<string, unknown>[]
    const calls = this.db
      .prepare(
        'SELECT c.run_id, c.endpoint, c.request, c.response, c.input_tokens, c.output_tokens, c.cache_write_tokens, c.cache_read_tokens FROM model_test_calls c JOIN model_test_runs r ON r.id = c.run_id WHERE r.test_id = ?',
      )
      .all(testId) as Record<string, unknown>[]
    const imports = this.db
      .prepare(
        `SELECT s.id, s.title, s.kind, s.imported_at, (SELECT COUNT(*) FROM suggestions g WHERE g.source_id = s.id AND g.status = 'accepted') AS accepted
         FROM source_items s WHERE s.id IN (SELECT source_id FROM model_test_runs WHERE test_id = ?) ORDER BY s.imported_at DESC, s.id DESC`,
      )
      .all(testId) as Record<string, unknown>[]
    return {
      id: Number(t.id),
      createdAt: String(t.created_at),
      status: t.status as ModelTest['status'],
      models: JSON.parse(String(t.models)) as ModelTestModel[],
      imports: imports.map((s) => ({ sourceId: Number(s.id), title: String(s.title), kind: s.kind as SourceKind, importedAt: String(s.imported_at), accepted: Number(s.accepted) })),
      runs: runs.map((r): ModelTestRun => {
        const id = Number(r.id)
        const costs = calls
          .filter((c) => Number(c.run_id) === id && c.input_tokens != null)
          .map((c) => estimateCost(paidModelOf(String(c.endpoint), String(c.request), (c.response as string) ?? null), Number(c.input_tokens), Number(c.output_tokens ?? 0), cacheOf(c)))
          .filter((c): c is number => c != null)
        return {
          id,
          sourceId: Number(r.source_id),
          modelIndex: Number(r.model_index),
          status: r.status as ModelTestRunStatus,
          durationMs: r.duration_ms == null ? null : Number(r.duration_ms),
          cost: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
          error: (r.error as string) ?? null,
          dropped: r.dropped_output ? (JSON.parse(String(r.dropped_output)) as unknown[]).length : 0,
          suggestions: suggestions
            .filter((g) => Number(g.run_id) === id)
            .map((g) => ({
              id: Number(g.id),
              kind: g.kind as SuggestionKind,
              title: String(g.title),
              details: String(g.details),
              dueDate: (g.due_date as string) ?? null,
              project: (g.project as string) ?? null,
              person: (g.person as string) ?? null,
              evidence: String(g.evidence),
              mark: (g.mark as ModelTestSuggestion['mark']) ?? null,
            })),
        }
      }),
    }
  }

  /** One run's requests and what the app's checks dropped, for its AI log. */
  aiLog(runId: number): { calls: AiCall[]; dropped: DroppedSuggestion[]; rawOutput: string | null } {
    const run = this.db.prepare('SELECT raw_output, dropped_output FROM model_test_runs WHERE id = ?').get(runId) as Record<string, unknown> | undefined
    if (!run) throw new Error('That run no longer exists.')
    const calls = this.db.prepare('SELECT * FROM model_test_calls WHERE run_id = ? ORDER BY id').all(runId) as Record<string, unknown>[]
    return {
      rawOutput: (run.raw_output as string) ?? null,
      dropped: run.dropped_output ? (JSON.parse(String(run.dropped_output)) as DroppedSuggestion[]) : [],
      calls: calls.map((c) => ({
        id: Number(c.id),
        purpose: String(c.purpose),
        endpoint: String(c.endpoint),
        request: String(c.request),
        response: (c.response as string) ?? null,
        error: (c.error as string) ?? null,
        startedAt: String(c.started_at),
        durationMs: Number(c.duration_ms),
        inputTokens: c.input_tokens == null ? null : Number(c.input_tokens),
        outputTokens: c.output_tokens == null ? null : Number(c.output_tokens),
        paidModel: paidModelOf(String(c.endpoint), String(c.request), (c.response as string) ?? null),
        cache: cacheOf(c),
      })),
    }
  }

  private source(id: number): SourceForExtraction {
    const row = this.db.prepare('SELECT kind, title, from_name, occurred_at, content FROM source_items WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!row) throw new Error('One of the imports no longer exists.')
    return { kind: row.kind as SourceKind, title: String(row.title), fromName: (row.from_name as string) ?? null, occurredAt: String(row.occurred_at), content: String(row.content) }
  }

  private mailMeta(id: number): MailMeta | null {
    const row = this.db.prepare('SELECT mail_meta FROM source_items WHERE id = ?').get(id) as { mail_meta: string | null } | undefined
    return row?.mail_meta ? (JSON.parse(row.mail_meta) as MailMeta) : null
  }
}

/** A logged request's prompt-cache tokens. */
const cacheOf = (c: Record<string, unknown>) => ({ write: Number(c.cache_write_tokens ?? 0), read: Number(c.cache_read_tokens ?? 0) })

/** A suggestion as Review would show it: the task, project and person by name, new ones included. */
function describe(d: SuggestionDraft, ctx: ExtractionContext): Omit<ModelTestSuggestion, 'id' | 'kind' | 'evidence' | 'mark'> {
  const p = d.payload
  const task = p.taskId != null ? ctx.tasks.find((t) => t.id === p.taskId) : undefined
  const project = p.projectId != null ? (ctx.projects.find((x) => x.id === p.projectId)?.name ?? null) : (d.links?.project ?? null)
  const person = d.kind === 'waiting_on' ? (p.waitingOn ?? d.links?.waitingOn ?? null) : (p.requesterName ?? d.links?.requester ?? null)
  // Updates to an existing task name it, so the user can tell which task the model meant.
  const details = [task && task.title !== p.title ? `On “${task.title}”` : '', p.details].filter(Boolean).join('\n')
  return { title: p.title, details, dueDate: p.dueDate, project, person }
}
