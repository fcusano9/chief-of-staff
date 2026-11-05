import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { CLAUDE_MODELS } from '@shared/types'
import { buildBriefPrompt, buildProjectBriefPrompt, PersonBriefSchema, ProjectBriefSchema, type PersonBriefInput, type ProjectBriefInput } from './brief'
import { BriefingSchema, buildBriefingPrompt, type BriefingInput, type RawBriefing } from './briefing'
import { buildWeeklyPrompt, WeeklySchema, type RawReflection, type WeeklyInput } from './weekly'
import { buildSystemPrompt, buildUserPrompt, type ExtractionContext, type SourceForExtraction } from './context'
import { AiError, asSent, logged, type AiCallLog, type AiProvider } from './provider'
import { ExtractionSchema, type RawSuggestion } from './schema'

const ENDPOINT = 'Anthropic Messages API (POST /v1/messages; the beta flag is sent as a header)'

/** Models that accept the server-side refusal fallback in its "default" form. */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5'])
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

/** If a safety classifier declines, the API retries on a fallback model instead of failing. */
const fallbackFor = (model: string) => (FALLBACK_MODELS.has(model) ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {})

/** The request sent for one extraction. Exported so tests can check it without calling the API. */
export function buildExtractionRequest(model: string, ctx: ExtractionContext, source: SourceForExtraction) {
  return {
    model,
    max_tokens: 16000,
    // Medium effort: extraction is careful reading, not deep reasoning.
    output_config: { effort: 'medium' as const, format: betaZodOutputFormat(ExtractionSchema) },
    system: buildSystemPrompt(ctx),
    messages: [{ role: 'user' as const, content: buildUserPrompt(ctx, source) }],
    ...fallbackFor(model),
  }
}

/** The request for a person's one-line brief. */
export function buildBriefRequest(model: string, input: PersonBriefInput) {
  const { system, user } = buildBriefPrompt(input)
  return {
    model,
    // Room for a short answer plus the model's thinking, which counts toward the limit.
    max_tokens: 4000,
    // Low effort: summarizing a few notes needs little reasoning.
    output_config: { effort: 'low' as const, format: betaZodOutputFormat(PersonBriefSchema) },
    system,
    messages: [{ role: 'user' as const, content: user }],
    ...fallbackFor(model),
  }
}

/** The request for a project's status brief. */
export function buildProjectBriefRequest(model: string, input: ProjectBriefInput) {
  const { system, user } = buildProjectBriefPrompt(input)
  return {
    model,
    max_tokens: 6000,
    // Low effort: condensing notes into a few lines needs little reasoning.
    output_config: { effort: 'low' as const, format: betaZodOutputFormat(ProjectBriefSchema) },
    system,
    messages: [{ role: 'user' as const, content: user }],
    ...fallbackFor(model),
  }
}

/** The request for the daily briefing. */
export function buildBriefingRequest(model: string, input: BriefingInput) {
  const { system, user } = buildBriefingPrompt(input)
  return {
    model,
    max_tokens: 8000,
    // Low effort: picking and explaining a handful of tasks needs little reasoning.
    output_config: { effort: 'low' as const, format: betaZodOutputFormat(BriefingSchema) },
    system,
    messages: [{ role: 'user' as const, content: user }],
    ...fallbackFor(model),
  }
}

/** The request for the weekly reflection. */
export function buildWeeklyRequest(model: string, input: WeeklyInput) {
  const { system, user } = buildWeeklyPrompt(input)
  return {
    model,
    max_tokens: 8000,
    // Low effort: a short look back at lists that are already worked out.
    output_config: { effort: 'low' as const, format: betaZodOutputFormat(WeeklySchema) },
    system,
    messages: [{ role: 'user' as const, content: user }],
    ...fallbackFor(model),
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

  async extract(ctx: ExtractionContext, source: SourceForExtraction, log?: AiCallLog): Promise<RawSuggestion[]> {
    try {
      const request = buildExtractionRequest(this.model, ctx, source)
      const response = await logged(
        log,
        { purpose: 'Find suggestions', endpoint: 'Anthropic Messages API (POST /v1/messages; the beta flag is sent as a header)', request: asSent(request) },
        () => this.client.beta.messages.parse(request),
        (r) => {
          // parsed_output is added by the SDK; drop it so this is the API's response as received.
          const { parsed_output: _parsed, ...raw } = r
          return { response: raw, inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens, paidModel: r.model }
        },
        (err) => (err instanceof Anthropic.APIError ? (err.error ?? null) : null),
      )
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

  async writePersonBrief(input: PersonBriefInput, log?: AiCallLog): Promise<string> {
    try {
      const response = await this.send(log, 'Write a person brief', buildBriefRequest(this.model, input))
      if (response.stop_reason === 'refusal') throw new AiError('Claude declined to write this brief. Nothing was changed.')
      if (response.stop_reason === 'max_tokens') throw new AiError('The brief was cut off. Try again.')
      if (!response.parsed_output) throw new AiError("Claude's response couldn't be read. Try again.")
      return response.parsed_output.brief
    } catch (err) {
      throw toAiError(err)
    }
  }

  async writeProjectBrief(input: ProjectBriefInput, log?: AiCallLog): Promise<string> {
    try {
      const response = await this.send(log, 'Write a project brief', buildProjectBriefRequest(this.model, input))
      if (response.stop_reason === 'refusal') throw new AiError('Claude declined to write this brief. Nothing was changed.')
      if (response.stop_reason === 'max_tokens') throw new AiError('The brief was cut off. Try again.')
      if (!response.parsed_output) throw new AiError("Claude's response couldn't be read. Try again.")
      return response.parsed_output.brief
    } catch (err) {
      throw toAiError(err)
    }
  }

  async writeBriefing(input: BriefingInput, log?: AiCallLog): Promise<RawBriefing> {
    try {
      const request = buildBriefingRequest(this.model, input)
      const response = await logged(
        log,
        { purpose: 'Write the briefing', endpoint: 'Anthropic Messages API (POST /v1/messages; the beta flag is sent as a header)', request: asSent(request) },
        () => this.client.beta.messages.parse(request),
        (r) => {
          const { parsed_output: _parsed, ...raw } = r
          return { response: raw, inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens, paidModel: r.model }
        },
        (err) => (err instanceof Anthropic.APIError ? (err.error ?? null) : null),
      )
      if (response.stop_reason === 'refusal') throw new AiError('Claude declined to write the briefing.')
      if (response.stop_reason === 'max_tokens') throw new AiError('The briefing was cut off. Try again.')
      if (!response.parsed_output) throw new AiError("Claude's response couldn't be read. Try again.")
      return response.parsed_output
    } catch (err) {
      throw toAiError(err)
    }
  }

  async writeWeeklyReflection(input: WeeklyInput, log?: AiCallLog): Promise<RawReflection> {
    try {
      const response = await this.send(log, 'Write the weekly reflection', buildWeeklyRequest(this.model, input))
      if (response.stop_reason === 'refusal') throw new AiError('Claude declined to write the reflection.')
      if (response.stop_reason === 'max_tokens') throw new AiError('The reflection was cut off. Try again.')
      if (!response.parsed_output) throw new AiError("Claude's response couldn't be read. Try again.")
      return response.parsed_output
    } catch (err) {
      throw toAiError(err)
    }
  }

  /** Sends a structured-output request, recording it (with tokens and the model that answered) in `log`. */
  private send<R extends Parameters<Anthropic['beta']['messages']['parse']>[0]>(log: AiCallLog | undefined, purpose: string, request: R) {
    return logged(
      log,
      { purpose, endpoint: ENDPOINT, request: asSent(request) },
      () => this.client.beta.messages.parse(request),
      (r) => {
        const { parsed_output: _parsed, ...raw } = r
        return { response: raw, inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens, paidModel: r.model }
      },
      (err) => (err instanceof Anthropic.APIError ? (err.error ?? null) : null),
    )
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
