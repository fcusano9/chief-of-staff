import { z } from 'zod'
import { buildSystemPrompt, buildUserPrompt, type ExtractionContext, type SourceForExtraction } from './context'
import { AiError, type AiProvider } from './provider'
import { ExtractionSchema, type RawSuggestion } from './schema'

/** Context window bounds. Ollama's default is small and it silently drops the start of longer prompts. */
const MIN_CONTEXT = 8192
const MAX_CONTEXT = 32768
/** Room left for the JSON answer (and any thinking) after the prompt. */
const OUTPUT_HEADROOM = 4096
/** A local model on a laptop can be slow on long transcripts; give up after this long. */
const TIMEOUT_MS = 5 * 60_000

/** True for addresses on this computer, so the UI can say truthfully whether data leaves it. */
export function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '')
    return host === 'localhost' || host === '::1' || /^127\./.test(host)
  } catch {
    return false
  }
}

/** Rough token count (about 3.5 characters per token for English) used to size the context window. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3.5)

/** Smallest power-of-two context, between the bounds, that fits the prompt plus room for the answer. */
export function contextSizeFor(promptTokens: number): number {
  let size = MIN_CONTEXT
  while (size < promptTokens + OUTPUT_HEADROOM && size < MAX_CONTEXT) size *= 2
  return size
}

/**
 * The extraction schema as plain JSON Schema for Ollama's constrained output. Zod adds huge
 * integer bounds that only slow the grammar down, so they're dropped.
 */
export function extractionJsonSchema(): Record<string, unknown> {
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip)
    if (!node || typeof node !== 'object') return node
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node)) if (k !== 'minimum' && k !== 'maximum' && k !== '$schema') out[k] = strip(v)
    return out
  }
  return strip(z.toJSONSchema(ExtractionSchema)) as Record<string, unknown>
}

/**
 * Thinking adds a lot of time on a laptop, and extraction is careful reading, not deep reasoning.
 * gpt-oss can't turn thinking off and ignores false (it then thinks at length), so it gets "low".
 */
export const thinkSetting = (model: string): false | 'low' => (/^gpt-oss/i.test(model) ? 'low' : false)

/** The request sent for one extraction. Exported so tests can check it without a running server. */
export function buildOllamaRequest(model: string, ctx: ExtractionContext, source: SourceForExtraction) {
  const system = buildSystemPrompt(ctx)
  const user = buildUserPrompt(ctx, source)
  const promptTokens = estimateTokens(system + user)
  if (promptTokens + OUTPUT_HEADROOM > MAX_CONTEXT) {
    throw new AiError('This item is too long for the local model. Import a shorter section, or use Claude for long transcripts.')
  }
  return {
    model,
    stream: false,
    think: thinkSetting(model),
    format: extractionJsonSchema(),
    options: { temperature: 0, num_ctx: contextSizeFor(promptTokens) },
    messages: [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: user },
    ],
  }
}

interface OllamaChatResponse {
  message?: { content?: string }
  done_reason?: string
  prompt_eval_count?: number
  error?: string
}

/**
 * A model running on this computer through Ollama (https://ollama.com). Nothing is sent
 * anywhere unless the server address points at another machine.
 */
export class OllamaProvider implements AiProvider {
  readonly label: string
  readonly sendsDataExternally: boolean

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
  ) {
    this.label = `${model} (local)`
    this.sendsDataExternally = !isLoopbackUrl(baseUrl)
  }

  async extract(ctx: ExtractionContext, source: SourceForExtraction): Promise<RawSuggestion[]> {
    const request = buildOllamaRequest(this.model, ctx, source)
    const body = await this.call<OllamaChatResponse>('/api/chat', request)
    if (body.prompt_eval_count != null && body.prompt_eval_count >= request.options.num_ctx) {
      throw new AiError('The item was cut off because it is too long for the local model. Import a shorter section.')
    }
    if (body.done_reason === 'length') {
      throw new AiError('The response was cut off because the item produced too many suggestions. Try importing a shorter section.')
    }
    try {
      return ExtractionSchema.parse(JSON.parse(body.message?.content ?? '')).suggestions
    } catch {
      throw new AiError(`${this.model}'s response couldn't be read. Try again, or try a different model.`)
    }
  }

  async test(): Promise<string> {
    const installed = await this.listModels()
    if (!installed.includes(this.model)) {
      throw new AiError(
        installed.length
          ? `${this.model} isn't installed. Run "ollama pull ${this.model}", or pick one of: ${installed.join(', ')}.`
          : `No models are installed. Run "ollama pull ${this.model}" in Terminal.`,
      )
    }
    return `Connected. ${this.model} is installed and runs on this computer.`
  }

  /** Names of the models pulled into this Ollama server. */
  async listModels(): Promise<string[]> {
    const body = await this.call<{ models?: { name: string }[] }>('/api/tags')
    return (body.models ?? []).map((m) => m.name).sort()
  }

  private async call<T>(path: string, payload?: unknown): Promise<T> {
    let response: Response
    try {
      response = await fetch(new URL(path, this.baseUrl), {
        method: payload ? 'POST' : 'GET',
        headers: payload ? { 'content-type': 'application/json' } : undefined,
        body: payload ? JSON.stringify(payload) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') throw new AiError('The local model took too long to answer. Try a shorter item or a smaller model.')
      throw new AiError(`Couldn't reach Ollama at ${this.baseUrl}. Make sure the Ollama app is running.`)
    }
    const body = (await response.json().catch(() => ({}))) as T & { error?: string }
    if (!response.ok) {
      if (response.status === 404) throw new AiError(`${this.model} isn't installed. Run "ollama pull ${this.model}" in Terminal.`)
      throw new AiError(`Ollama error ${response.status}: ${body.error ?? response.statusText}`)
    }
    return body
  }
}
