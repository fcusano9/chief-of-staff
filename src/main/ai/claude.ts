import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { CLAUDE_MODELS } from '@shared/types'
import { buildSystemPrompt, buildUserPrompt, type ExtractionContext, type SourceForExtraction } from './context'
import { AiError, type AiProvider } from './provider'
import { ExtractionSchema, type RawSuggestion } from './schema'

/** Models that accept the server-side refusal fallback in its "default" form. */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5'])
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

/** The request sent for one extraction. Exported so tests can check it without calling the API. */
export function buildExtractionRequest(model: string, ctx: ExtractionContext, source: SourceForExtraction) {
  const withFallback = FALLBACK_MODELS.has(model)
  return {
    model,
    max_tokens: 16000,
    // Medium effort: extraction is careful reading, not deep reasoning.
    output_config: { effort: 'medium' as const, format: betaZodOutputFormat(ExtractionSchema) },
    system: buildSystemPrompt(ctx),
    messages: [{ role: 'user' as const, content: buildUserPrompt(ctx, source) }],
    // If a safety classifier declines, the API retries on a fallback model instead of failing.
    ...(withFallback ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
  }
}

export class ClaudeProvider implements AiProvider {
  readonly sendsDataExternally = true
  readonly label: string
  private readonly client: Anthropic

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 2 })
    this.label = CLAUDE_MODELS.find((m) => m.id === model)?.label ?? model
  }

  async extract(ctx: ExtractionContext, source: SourceForExtraction): Promise<RawSuggestion[]> {
    try {
      const response = await this.client.beta.messages.parse(buildExtractionRequest(this.model, ctx, source))
      if (response.stop_reason === 'refusal') {
        throw new AiError('Claude declined to process this item. Nothing was changed.')
      }
      if (response.stop_reason === 'max_tokens') {
        throw new AiError('The response was cut off because the item produced too many suggestions. Try importing a shorter section.')
      }
      if (!response.parsed_output) throw new AiError("Claude's response couldn't be read. Try again.")
      return response.parsed_output.suggestions
    } catch (err) {
      throw toAiError(err)
    }
  }

  async test(): Promise<string> {
    try {
      // Validates the key and model without generating tokens.
      const model = await this.client.models.retrieve(this.model)
      return `Connected. ${model.display_name} is available.`
    } catch (err) {
      throw toAiError(err)
    }
  }
}

function toAiError(err: unknown): Error {
  if (err instanceof AiError) return err
  if (err instanceof Anthropic.AuthenticationError) return new AiError('Anthropic rejected the API key. Check it in Settings.')
  if (err instanceof Anthropic.PermissionDeniedError) return new AiError("This API key doesn't have access to that model.")
  if (err instanceof Anthropic.NotFoundError) return new AiError('That Claude model was not found. Pick another model in Settings.')
  if (err instanceof Anthropic.RateLimitError) return new AiError('Anthropic is rate-limiting requests right now. Try again in a minute.')
  if (err instanceof Anthropic.BadRequestError) return new AiError(`Anthropic rejected the request: ${err.message}`)
  if (err instanceof Anthropic.APIConnectionError) return new AiError("Couldn't reach Anthropic. Check your internet connection.")
  if (err instanceof Anthropic.APIError) return new AiError(`Anthropic error ${err.status ?? ''}: ${err.message}`.trim())
  return err instanceof Error ? err : new Error(String(err))
}
