import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSystemPrompt, calendar, type ExtractionContext, type SourceForExtraction } from '../src/main/ai/context'
import { buildOllamaRequest, contextSizeFor, extractionJsonSchema, isLoopbackUrl, OllamaProvider } from '../src/main/ai/ollama'
import { SettingsStore } from '../src/main/services/settings'
import { DEFAULT_SETTINGS } from '@shared/types'

const ctx: ExtractionContext = { today: '2026-11-02', userName: 'Frank Cusano', tasks: [], projects: [], people: [] }
const source = (content: string): SourceForExtraction => ({ kind: 'note', title: 'n', fromName: null, occurredAt: '2026-11-02T00:00:00Z', content })

/** Replaces fetch with a canned Ollama server and records what was sent. */
function fakeOllama(reply: (path: string, body: unknown) => { status?: number; body: unknown } | Error) {
  const sent: { path: string; body: unknown }[] = []
  vi.stubGlobal('fetch', async (url: URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    sent.push({ path: url.pathname, body })
    const r = reply(url.pathname, body)
    if (r instanceof Error) throw r
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 })
  })
  return sent
}

describe('local AI through Ollama', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('only treats this computer as local', () => {
    expect(['http://127.0.0.1:11434', 'http://localhost:11434', 'http://[::1]:11434'].map(isLoopbackUrl)).toEqual([true, true, true])
    expect(['http://192.168.1.20:11434', 'https://ollama.example.com', 'not a url'].map(isLoopbackUrl)).toEqual([false, false, false])
    expect(new OllamaProvider('http://localhost:11434', 'm').sendsDataExternally).toBe(false)
    expect(new OllamaProvider('http://10.0.0.5:11434', 'm').sendsDataExternally).toBe(true)
  })

  it('sizes the context window to the prompt so nothing is silently cut off', () => {
    expect(contextSizeFor(500)).toBe(8192)
    expect(contextSizeFor(6000)).toBe(16384)
    expect(contextSizeFor(20000)).toBe(32768)
    expect(buildOllamaRequest('m', ctx, source('short')).options.num_ctx).toBe(8192)
    expect(buildOllamaRequest('m', ctx, source('word '.repeat(12000))).options.num_ctx).toBe(32768)
    expect(() => buildOllamaRequest('m', ctx, source('word '.repeat(60000)))).toThrow(/too long for the local model/)
  })

  it('asks for the extraction schema as constrained JSON, with as little thinking as the model allows', () => {
    const req = buildOllamaRequest('qwen3:8b', ctx, source('Frank to send the deck'))
    expect(req).toMatchObject({ model: 'qwen3:8b', stream: false, think: false, options: { temperature: 0 } })
    // gpt-oss ignores false and thinks at length, so it gets the lowest level instead.
    expect(buildOllamaRequest('gpt-oss:20b', ctx, source('x')).think).toBe('low')
    expect(req.messages.map((m) => m.role)).toEqual(['system', 'user'])
    const schema = JSON.stringify(extractionJsonSchema())
    expect(schema).toContain('"suggestions"')
    expect(schema).not.toMatch(/minimum|maximum|\$schema/)
  })

  it('gives the model a calendar so relative dates are looked up, not counted', () => {
    const cal = calendar('2026-11-02')
    expect(cal).toContain('Today is Monday 2026-11-02')
    expect(cal).toContain('Tuesday 2026-11-03 (tomorrow)')
    expect(cal).toContain('Friday 2026-11-06')
    expect(cal).toContain('Sunday 2026-11-22')
    expect(buildSystemPrompt(ctx)).toContain('Friday 2026-11-06')
  })

  it('asks for more thinking, with more room for it, at higher reasoning levels', () => {
    expect(buildOllamaRequest('gpt-oss:20b', ctx, source('x'), 'medium').think).toBe('medium')
    expect(buildOllamaRequest('qwen3:30b', ctx, source('x'), 'medium').think).toBe(true)
    expect(contextSizeFor(6000, 'high')).toBe(32768)
    expect(contextSizeFor(6000, 'low')).toBe(16384)
  })

  it('can limit a pass to some kinds of suggestion', () => {
    const req = buildOllamaRequest('m', ctx, source('x'), 'low', ['new_project', 'new_person'])
    expect(JSON.stringify(req.format)).toContain('"enum":["new_project","new_person"]')
    expect(req.messages[0]!.content).toContain('- new_project:')
    expect(req.messages[0]!.content).not.toContain('- new_task:')
  })

  it('split passes find tasks and projects separately, then link them', async () => {
    const base = { task_id: null, details: '', due_date: null, project_id: null, project_name: null, requester_name: null, waiting_on: null, brief_scope: null, brief_owner_id: null, role: null, company: null, email: null, evidence: 'q' }
    const sent = fakeOllama((_path, body) => {
      const system = (body as { messages: { content: string }[] }).messages[0]!.content
      const reply = system.startsWith('You link')
        ? { links: [{ task: 0, project_name: 'Dealer training', requester_name: 'Alex Rivera' }, { task: 1, project_name: 'Made up', requester_name: null }] }
        : system.includes('- new_task:')
          ? { suggestions: [{ ...base, kind: 'new_task', title: 'Send outline' }, { ...base, kind: 'new_task', title: 'Pick dealers' }] }
          : { suggestions: [{ ...base, kind: 'new_project', title: 'Dealer training' }, { ...base, kind: 'new_person', title: 'Alex Rivera' }] }
      return { body: { message: { content: JSON.stringify(reply) }, done_reason: 'stop', prompt_eval_count: 100, eval_count: 50 } }
    })
    const provider = new OllamaProvider('http://127.0.0.1:11434', 'gpt-oss:20b', { passes: 'split', reasoning: 'medium' })
    const { suggestions: out } = await provider.extract(ctx, source('kickoff'))
    expect(sent).toHaveLength(3)
    expect(out.map((s) => s.kind)).toEqual(['new_project', 'new_person', 'new_task', 'new_task'])
    expect(out[2]).toMatchObject({ project_name: 'Dealer training', requester_name: 'Alex Rivera' })
    expect(out[3]!.project_name).toBeNull() // names that weren't proposed are ignored
    expect(provider.lastStats).toMatchObject({ requests: 3, promptTokens: 300, outputTokens: 150 })
  })

  it('returns parsed suggestions from the model', async () => {
    const suggestion = { kind: 'new_task', task_id: null, title: 'Send the deck', details: '', due_date: null, project_id: null, requester_name: null, waiting_on: null, brief_scope: null, brief_owner_id: null, project_name: null, role: null, company: null, email: null, evidence: 'Frank to send the deck' }
    const sent = fakeOllama(() => ({ body: { message: { content: JSON.stringify({ suggestions: [suggestion] }) }, done_reason: 'stop', prompt_eval_count: 900 } }))
    const out = await new OllamaProvider('http://127.0.0.1:11434', 'qwen3:8b', { passes: 'single' }).extract(ctx, source('Frank to send the deck'))
    expect(out).toEqual({ suggestions: [suggestion], next_actions: [], priority_changes: [] })
    expect(sent[0]!.path).toBe('/api/chat')
  })

  it('turns server problems into readable errors', async () => {
    const p = new OllamaProvider('http://127.0.0.1:11434', 'qwen3:8b')
    fakeOllama(() => new TypeError('fetch failed'))
    await expect(p.extract(ctx, source('x'))).rejects.toThrow(/Couldn't reach Ollama at http:\/\/127.0.0.1:11434/)
    fakeOllama(() => ({ status: 404, body: { error: 'model not found' } }))
    await expect(p.extract(ctx, source('x'))).rejects.toThrow(/qwen3:8b isn't downloaded/)
    fakeOllama(() => ({ status: 501, body: { error: 'structured output is unavailable' } }))
    await expect(p.extract(ctx, source('x'))).rejects.toThrow(/can't give the fixed-format answers/)
    fakeOllama(() => ({ body: { message: { content: 'not json' }, done_reason: 'stop' } }))
    await expect(p.extract(ctx, source('x'))).rejects.toThrow(/couldn't be read/)
    fakeOllama(() => ({ body: { message: { content: '{}' }, prompt_eval_count: 8192 } }))
    await expect(p.extract(ctx, source('x'))).rejects.toThrow(/cut off because it is too long/)
  })

  it('checks that the chosen model is installed', async () => {
    fakeOllama(() => ({ body: { models: [{ name: 'qwen3:8b' }, { name: 'gpt-oss:20b' }] } }))
    await expect(new OllamaProvider('http://127.0.0.1:11434', 'gpt-oss:20b').test()).resolves.toMatch(/downloaded and ready/)
    await expect(new OllamaProvider('http://127.0.0.1:11434', 'qwen3:30b').test()).rejects.toThrow(/qwen3:30b isn't downloaded/)
  })

  it('keeps the local provider in settings and rejects a bad server address', () => {
    const folder = mkdtempSync(join(tmpdir(), 'cos-settings-'))
    try {
      const store = new SettingsStore(join(folder, 'settings.json'))
      const saved = store.save({ ...DEFAULT_SETTINGS, aiProvider: 'local', localModel: ' qwen3:8b ', localUrl: 'http://localhost:11434/' })
      expect(saved).toMatchObject({ aiProvider: 'local', localModel: 'qwen3:8b', localUrl: 'http://localhost:11434' })
      expect(store.save({ ...saved, localUrl: 'ftp://nope', localModel: '' })).toMatchObject({ localUrl: DEFAULT_SETTINGS.localUrl, localModel: DEFAULT_SETTINGS.localModel })
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})
