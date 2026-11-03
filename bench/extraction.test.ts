import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { it } from 'vitest'
import { ClaudeProvider } from '../src/main/ai/claude'
import { buildSystemPrompt, buildUserPrompt } from '../src/main/ai/context'
import { DemoProvider } from '../src/main/ai/demo'
import { buildOllamaRequest, thinkSetting } from '../src/main/ai/ollama'
import { ExtractionSchema, validateSuggestions, type RawSuggestion } from '../src/main/ai/schema'
import { CASES, CONTEXT } from './cases'
import { scoreCase, type CaseScore } from './score'

/**
 * Runs every case through each model and writes a report to bench/results/.
 *
 *   npm run bench:ai                                   demo, every installed Ollama model, Claude if a key is set
 *   BENCH_MODELS=gpt-oss:20b,claude-haiku-5-5 npm run bench:ai
 *
 * Claude needs ANTHROPIC_API_KEY in the environment. Only these made-up cases are sent.
 */
const OLLAMA = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434'
const CLAUDE = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']

interface Run {
  model: string
  case: string
  seconds: number
  score: CaseScore | null
  error: string | null
  promptTokens?: number
  outputTokens?: number
  outputPerSecond?: number
  promptPerSecond?: number
}

interface ModelInfo {
  loadSeconds?: number
  memoryGb?: number
}

async function ollama<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(new URL(path, OLLAMA), body ? { method: 'POST', body: JSON.stringify(body) } : undefined)
  const json = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new Error(json.error ?? res.statusText)
  return json
}

async function installedOllamaModels(): Promise<string[]> {
  try {
    return (await ollama<{ models: { name: string }[] }>('/api/tags')).models.map((m) => m.name).sort()
  } catch {
    return []
  }
}

/** Loads the model once so the first case isn't charged for it, and reports load time and memory. */
async function warmUp(model: string): Promise<ModelInfo> {
  const start = performance.now()
  await ollama('/api/chat', { model, stream: false, think: thinkSetting(model), messages: [{ role: 'user', content: 'Reply with OK.' }], options: { num_ctx: 8192 } })
  const loadSeconds = (performance.now() - start) / 1000
  const ps = await ollama<{ models: { name: string; size: number }[] }>('/api/ps')
  const size = ps.models.find((m) => m.name === model)?.size
  return { loadSeconds, memoryGb: size ? size / 1e9 : undefined }
}

async function extractWithOllama(model: string, c: (typeof CASES)[number]) {
  const request = buildOllamaRequest(model, CONTEXT, c.source)
  const body = await ollama<{
    message: { content: string }
    prompt_eval_count: number
    prompt_eval_duration: number
    eval_count: number
    eval_duration: number
  }>('/api/chat', request)
  return {
    raw: ExtractionSchema.parse(JSON.parse(body.message.content)).suggestions,
    promptTokens: body.prompt_eval_count,
    outputTokens: body.eval_count,
    promptPerSecond: body.prompt_eval_count / (body.prompt_eval_duration / 1e9),
    outputPerSecond: body.eval_count / (body.eval_duration / 1e9),
  }
}

async function benchModel(model: string): Promise<{ runs: Run[]; info: ModelInfo; rawOutputs: Record<string, RawSuggestion[]> }> {
  const isClaude = CLAUDE.includes(model)
  const isDemo = model === 'demo'
  const info = isClaude || isDemo ? {} : await warmUp(model)
  const claude = isClaude ? new ClaudeProvider(process.env.ANTHROPIC_API_KEY ?? '', model) : null
  const runs: Run[] = []
  const rawOutputs: Record<string, RawSuggestion[]> = {}

  for (const c of CASES) {
    const start = performance.now()
    try {
      let raw: RawSuggestion[]
      let stats: Partial<Run> = {}
      if (isDemo) raw = await new DemoProvider().extract(CONTEXT, c.source)
      else if (claude) raw = await claude.extract(CONTEXT, c.source)
      else ({ raw, ...stats } = await extractWithOllama(model, c))
      const seconds = (performance.now() - start) / 1000
      rawOutputs[c.name] = raw
      runs.push({ model, case: c.name, seconds, score: scoreCase(c, validateSuggestions(raw, CONTEXT)), error: null, ...stats })
    } catch (err) {
      runs.push({ model, case: c.name, seconds: (performance.now() - start) / 1000, score: null, error: err instanceof Error ? err.message : String(err) })
    }
    console.log(`${model.padEnd(20)} ${c.name.padEnd(38)} ${runs.at(-1)!.seconds.toFixed(1).padStart(6)}s ${runs.at(-1)!.error ?? ''}`)
  }
  // Free the memory before the next model loads.
  if (!isClaude && !isDemo) await ollama('/api/generate', { model, keep_alive: 0 }).catch(() => {})
  return { runs, info, rawOutputs }
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '–')

function report(results: { model: string; runs: Run[]; info: ModelInfo }[]): string {
  const totalExpected = sum(CASES.map((c) => c.expect.length))
  const dated = sum(CASES.map((c) => c.expect.filter((e) => e.due).length))
  const longCase = CASES.find((c) => c.source.kind === 'meeting_transcript')!.name
  const lines = [
    `# Extraction benchmark, ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    '',
    `${CASES.length} cases, ${totalExpected} expected suggestions. Prompt for the long transcript is about ${Math.round((buildSystemPrompt(CONTEXT) + buildUserPrompt(CONTEXT, CASES.find((c) => c.name === longCase)!.source)).length / 3.5).toLocaleString()} tokens.`,
    '',
    '| Model | Found | Dates right | Extra | Rule breaks | Failed | Median time | Long transcript | Total time | Output tok/s | Prompt tok/s | Load | Memory |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ]
  for (const { model, runs, info } of results) {
    const ok = runs.filter((r) => r.score)
    const times = runs.map((r) => r.seconds).sort((a, b) => a - b)
    const ollamaRuns = runs.filter((r) => r.outputPerSecond)
    lines.push(
      [
        model,
        pct(sum(ok.map((r) => r.score!.found)), totalExpected),
        pct(sum(ok.map((r) => r.score!.datesRight)), dated),
        sum(ok.map((r) => r.score!.extras.length)),
        sum(ok.map((r) => r.score!.violations.length)),
        runs.length - ok.length,
        `${times[Math.floor(times.length / 2)]!.toFixed(1)}s`,
        `${runs.find((r) => r.case === longCase)!.seconds.toFixed(1)}s`,
        `${sum(times).toFixed(0)}s`,
        ollamaRuns.length ? (sum(ollamaRuns.map((r) => r.outputPerSecond!)) / ollamaRuns.length).toFixed(0) : '–',
        ollamaRuns.length ? (sum(ollamaRuns.map((r) => r.promptPerSecond!)) / ollamaRuns.length).toFixed(0) : '–',
        info.loadSeconds ? `${info.loadSeconds.toFixed(0)}s` : '–',
        info.memoryGb ? `${info.memoryGb.toFixed(1)} GB` : '–',
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'),
    )
  }
  lines.push('', '## Details', '')
  for (const { model, runs } of results) {
    lines.push(`### ${model}`, '')
    for (const r of runs) {
      if (r.error) {
        lines.push(`- **${r.case}** (${r.seconds.toFixed(1)}s): failed: ${r.error}`)
        continue
      }
      const s = r.score!
      const notes = [
        s.missed.length ? `missed ${s.missed.join('; ')}` : '',
        s.violations.length ? `rule breaks: ${s.violations.join('; ')}` : '',
        s.extras.length ? `extra: ${s.extras.join('; ')}` : '',
      ].filter(Boolean)
      lines.push(`- **${r.case}** (${r.seconds.toFixed(1)}s): ${s.found}/${s.expected} found${notes.length ? `. ${notes.join('. ')}` : ''}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

it('benchmarks extraction', { timeout: 0 }, async () => {
  const requested = process.env.BENCH_MODELS?.split(',').map((m) => m.trim()).filter(Boolean)
  const models = requested ?? ['demo', ...(await installedOllamaModels()), ...(process.env.ANTHROPIC_API_KEY ? CLAUDE : [])]
  const results: { model: string; runs: Run[]; info: ModelInfo }[] = []
  const raw: Record<string, Record<string, RawSuggestion[]>> = {}
  for (const model of models) {
    const { runs, info, rawOutputs } = await benchModel(model)
    results.push({ model, runs, info })
    raw[model] = rawOutputs
  }
  const folder = join(import.meta.dirname, 'results')
  mkdirSync(folder, { recursive: true })
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  const markdown = report(results)
  writeFileSync(join(folder, `${stamp}.md`), markdown)
  writeFileSync(join(folder, `${stamp}.json`), JSON.stringify({ results, raw }, null, 2))
  console.log(`\n${markdown}\n\nSaved to bench/results/${stamp}.md`)
})
