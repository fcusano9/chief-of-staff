import type { DatabaseSync } from 'node:sqlite'
import type { AiCall, AiRun } from '@shared/types'
import type { AiCallLog, AiCallRecord } from '../ai/provider'
import type { DroppedSuggestion } from '../ai/schema'
import { nowIso } from '../db'
import { paidModelOf, UsageService } from './usage'

/** Runs kept per import. Older runs (and their requests) are deleted. */
export const RUNS_KEPT = 5

const pretty = (value: unknown) => JSON.stringify(value, null, 2)
const count = (json: string | null) => {
  if (!json) return null
  try {
    const v = JSON.parse(json) as unknown
    return Array.isArray(v) ? v.length : null
  } catch {
    return null
  }
}

/**
 * The AI log behind "See what was sent": every extraction run of an import, each request sent
 * to the AI with its raw response, and what passed the app's checks. Stored in the local
 * database next to the import itself, never anywhere else.
 */
export class AiLogService {
  private readonly usage: UsageService

  constructor(private readonly db: DatabaseSync) {
    this.usage = new UsageService(db)
  }

  startRun(sourceId: number, provider: string): number {
    return Number(this.db.prepare('INSERT INTO extraction_runs (source_id, provider, started_at) VALUES (?, ?, ?)').run(sourceId, provider, nowIso()).lastInsertRowid)
  }

  /** A log the provider writes each request and response into. */
  logFor(runId: number): AiCallLog {
    const insert = this.db.prepare(
      `INSERT INTO ai_calls (run_id, purpose, endpoint, request, response, error, started_at, duration_ms, input_tokens, output_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    return {
      record: (c: AiCallRecord) => {
        insert.run(runId, c.purpose, c.endpoint, pretty(c.request), c.response == null ? null : pretty(c.response), c.error, c.startedAt, c.durationMs, c.inputTokens, c.outputTokens)
        this.usage.record(c, 'import')
      },
    }
  }

  finishRun(runId: number, result: { raw?: unknown; kept?: unknown; dropped?: DroppedSuggestion[]; error?: string | null }): void {
    this.db
      .prepare('UPDATE extraction_runs SET finished_at = ?, raw_output = ?, kept_output = ?, dropped_output = ?, error = ? WHERE id = ?')
      .run(nowIso(), result.raw === undefined ? null : pretty(result.raw), result.kept === undefined ? null : pretty(result.kept), result.dropped ? JSON.stringify(result.dropped) : null, result.error ?? null, runId)
    const sourceId = (this.db.prepare('SELECT source_id FROM extraction_runs WHERE id = ?').get(runId) as { source_id: number }).source_id
    this.db
      .prepare(`DELETE FROM extraction_runs WHERE source_id = ? AND id NOT IN (SELECT id FROM extraction_runs WHERE source_id = ? ORDER BY id DESC LIMIT ${RUNS_KEPT})`)
      .run(sourceId, sourceId)
  }

  /** An import's runs, newest first, each with its requests in the order they were sent. */
  runsFor(sourceId: number): AiRun[] {
    const runs = this.db.prepare('SELECT * FROM extraction_runs WHERE source_id = ? ORDER BY id DESC').all(sourceId) as Record<string, unknown>[]
    const calls = this.db
      .prepare('SELECT c.* FROM ai_calls c JOIN extraction_runs r ON r.id = c.run_id WHERE r.source_id = ? ORDER BY c.id')
      .all(sourceId) as Record<string, unknown>[]
    return runs.map((r) => {
      const rawOutput = (r.raw_output as string) ?? null
      const keptOutput = (r.kept_output as string) ?? null
      return {
        id: Number(r.id),
        sourceId: Number(r.source_id),
        provider: String(r.provider),
        startedAt: String(r.started_at),
        finishedAt: (r.finished_at as string) ?? null,
        rawOutput,
        keptOutput,
        rawCount: count(rawOutput),
        keptCount: count(keptOutput),
        dropped: r.dropped_output ? (JSON.parse(String(r.dropped_output)) as AiRun['dropped']) : [],
        error: (r.error as string) ?? null,
        calls: calls
          .filter((c) => Number(c.run_id) === Number(r.id))
          .map(
            (c): AiCall => ({
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
            }),
          ),
      }
    })
  }
}
