import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildExtractionRequest } from '../src/main/ai/claude'
import { buildExtractionContext } from '../src/main/ai/context'
import { DemoProvider } from '../src/main/ai/demo'
import { OllamaProvider } from '../src/main/ai/ollama'
import { asSent, logged, type AiCallLog, type AiCallRecord, type AiProvider } from '../src/main/ai/provider'
import type { RawSuggestion } from '../src/main/ai/schema'
import { openDatabase } from '../src/main/db'
import { RUNS_KEPT } from '../src/main/services/ai-log'
import { SourceService } from '../src/main/services/sources'

const raw = (o: Partial<RawSuggestion>): RawSuggestion => ({
  kind: 'new_task', task_id: null, title: '', details: '', due_date: null, project_id: null, project_name: null, requester_name: null,
  waiting_on: null, brief_scope: null, brief_owner_id: null, role: null, company: null, email: null, evidence: 'quote', ...o,
})

/** Stands in for an AI that makes one logged request and returns canned suggestions. */
class LoggingFake implements AiProvider {
  readonly label = 'Fake AI'
  readonly sendsDataExternally = false
  constructor(private readonly out: RawSuggestion[] | Error) {}
  async extract(_ctx: unknown, source: { content: string }, log?: AiCallLog) {
    return logged(log, { purpose: 'Find suggestions', endpoint: 'fake', request: { system: 'rules', user: source.content } },
      async () => {
        if (this.out instanceof Error) throw this.out
        return { suggestions: this.out, next_actions: [] }
      },
      (r) => ({ response: r, inputTokens: 120, outputTokens: 30 }),
    )
  }
  async writePersonBrief() {
    return ''
  }
  async writeProjectBrief() {
    return ''
  }
  async writeBriefing() {
    return { summary: '', priorities: [], nudges: [], new_items: [] }
  }
  async writeWeeklyReflection() {
    return { summary: '', went_well: [], slipped: [], focus_next: [] }
  }
  async test() {
    return 'ok'
  }
}

describe('AI log for each import', () => {
  let folder: string
  let db: DatabaseSync
  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'cos-ailog-'))
    db = openDatabase(join(folder, 'test.db'))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    db.close()
    rmSync(folder, { recursive: true, force: true })
  })
  const sources = (p: () => AiProvider) => new SourceService(db, p, () => 'Frank Cusano')

  it('records the request, the raw response, and what passed the checks', async () => {
    const s = sources(() => new LoggingFake([raw({ title: 'Send the deck' }), raw({ kind: 'status_update', task_id: 999, details: 'unknown task' })]))
    const result = await s.importAndExtract({ kind: 'note', title: 'Notes', content: 'Frank to send the deck' })
    const [run] = s.aiRuns(result.source.id)
    expect(run).toMatchObject({ provider: 'Fake AI', rawCount: 2, keptCount: 1, error: null })
    expect(run!.calls).toHaveLength(1)
    const call = run!.calls[0]!
    expect(JSON.parse(call.request)).toEqual({ system: 'rules', user: 'Frank to send the deck' })
    expect(JSON.parse(call.response!).suggestions).toHaveLength(2)
    expect([call.inputTokens, call.outputTokens]).toEqual([120, 30])
  })

  it('says why each dropped suggestion was left out of Review', async () => {
    const s = sources(
      () =>
        new LoggingFake([
          raw({ kind: 'status_update', task_id: 42, details: 'x' }),
          raw({ kind: 'mark_done', task_id: null }),
          raw({ kind: 'new_task', title: '' }),
          raw({ kind: 'new_task', title: 'Send deck' }),
          raw({ kind: 'new_task', title: 'Send deck' }),
          raw({ kind: 'new_person', title: 'Frank Cusano' }),
          raw({ kind: 'brief_update', brief_scope: 'project', brief_owner_id: 9, details: 'Decided' }),
        ]),
    )
    const { source } = await s.importAndExtract({ kind: 'note', title: 'n', content: 'reasons' })
    const run = s.aiRuns(source.id)[0]!
    expect(run.keptCount).toBe(1)
    expect(run.dropped.map((d) => d.reason)).toEqual([
      "Task #42 doesn't exist",
      "Didn't say which task",
      'No task title',
      'Same as another suggestion',
      "That's you",
      "project #9 doesn't exist",
    ])
  })

  it('records a failed request with its error', async () => {
    const s = sources(() => new LoggingFake(new Error('Rate limited')))
    const result = await s.importAndExtract({ kind: 'note', title: 'n', content: 'x' })
    const [run] = s.aiRuns(result.source.id)
    expect(run!.error).toBe('Rate limited')
    expect(run!.calls[0]).toMatchObject({ error: 'Rate limited', response: null })
  })

  it('records a run even when the AI is not set up', async () => {
    const s = sources(() => {
      throw new Error('Claude is selected but no API key is set.')
    })
    const result = await s.importAndExtract({ kind: 'note', title: 'n', content: 'y' })
    const [run] = s.aiRuns(result.source.id)
    expect(run).toMatchObject({ provider: 'AI not set up', calls: [] })
    expect(run!.error).toMatch(/no API key/)
  })

  it('keeps the newest runs per import and removes them with the import', async () => {
    const s = sources(() => new LoggingFake([]))
    const { source } = await s.importAndExtract({ kind: 'note', title: 'n', content: 'z' })
    for (let i = 0; i < RUNS_KEPT + 2; i++) await s.extract(source.id)
    const runs = s.aiRuns(source.id)
    expect(runs).toHaveLength(RUNS_KEPT)
    expect(runs[0]!.id).toBeGreaterThan(runs[1]!.id) // newest first
    s.delete(source.id)
    expect(s.aiRuns(source.id)).toEqual([])
    expect((db.prepare('SELECT COUNT(*) AS n FROM ai_calls').get() as { n: number }).n).toBe(0)
  })

  it('shows that the demo AI sends no prompt, with its rule-based output', async () => {
    const s = sources(() => new DemoProvider())
    const { source } = await s.importAndExtract({ kind: 'note', title: 'n', content: '- Frank to send the deck by Friday' })
    const call = s.aiRuns(source.id)[0]!.calls[0]!
    expect(call.endpoint).toMatch(/no prompt/)
    expect(JSON.parse(call.request).importedItem).toBe('- Frank to send the deck by Friday')
  })

  it('records each local-model pass exactly as sent to Ollama', async () => {
    const replies = [{ suggestions: [raw({ title: 'Send the deck' })] }, { suggestions: [] }]
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ message: { content: JSON.stringify(replies.shift() ?? { suggestions: [] }) }, prompt_eval_count: 900, eval_count: 40 })))
    const s = sources(() => new OllamaProvider('http://127.0.0.1:11434', 'gpt-oss:20b'))
    const { source } = await s.importAndExtract({ kind: 'note', title: 'n', content: 'Frank to send the deck' })
    const calls = s.aiRuns(source.id)[0]!.calls
    expect(calls.map((c) => c.purpose)).toEqual(['Pass 1 of 3: tasks, updates, done, waiting on, next actions', 'Pass 2 of 3: projects, people, context'])
    const sent = JSON.parse(calls[0]!.request)
    expect(sent.model).toBe('gpt-oss:20b')
    expect(sent.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user'])
    expect(sent.messages[1].content).toContain('Frank to send the deck')
    expect(calls[0]!.inputTokens).toBe(900)
  })

  it('records the Claude request as it goes on the wire, never the API key', () => {
    const ctx = buildExtractionContext(db, 'Frank Cusano')
    const request = asSent(buildExtractionRequest('claude-opus-5-5', ctx, { kind: 'note', title: 't', fromName: null, occurredAt: '2026-11-03T00:00:00Z', content: 'c' })) as Record<string, any>
    expect(request.system).toContain('You help Frank Cusano keep a task list current')
    expect(request.messages[0].content).toContain('<imported_item')
    expect(request.output_config.format.type).toBe('json_schema')
    expect(request.output_config.format.schema.properties.suggestions).toBeDefined()
    expect(request.output_config.format).not.toHaveProperty('parse') // helper functions aren't sent
    expect(JSON.stringify(request)).not.toMatch(/sk-ant|api[_-]?key/i)
  })

  it('logged() records success and failure with timing', async () => {
    const records: AiCallRecord[] = []
    const log = { record: (c: AiCallRecord) => records.push(c) }
    await logged(log, { purpose: 'p', endpoint: 'e', request: { a: 1 } }, async () => 'ok', (r) => ({ response: r }))
    await expect(logged(log, { purpose: 'p', endpoint: 'e', request: {} }, async () => { throw new Error('boom') }, () => ({ response: null }))).rejects.toThrow('boom')
    expect(records.map((r) => [r.response, r.error])).toEqual([['ok', null], [null, 'boom']])
    expect(records.every((r) => r.durationMs >= 0 && !!r.startedAt)).toBe(true)
  })
})
