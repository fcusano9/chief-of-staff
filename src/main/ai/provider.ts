import type { PersonBriefInput } from './brief'
import type { RawStatus, StatusInput } from './status'
import type { BriefingInput, RawBriefing } from './briefing'
import type { RawReflection, WeeklyInput } from './weekly'
import type { ExtractionContext, SourceForExtraction } from './context'
import type { RawExtraction } from './schema'

/**
 * Anything that can read an imported item and propose suggestions. Claude is the first real
 * provider; Microsoft 365 Copilot, OpenAI, or a local model can implement this later.
 */
export interface AiProvider {
  /** Shown to the user, e.g. "Claude Opus 5.5" or "Basic". */
  readonly label: string
  /** True when calling extract() sends content off this computer. */
  readonly sendsDataExternally: boolean
  /**
   * Suggestions for Review, plus next actions for open tasks the item is about (shown on their
   * cards). `log` receives every request sent to the AI and its raw response, for the import's AI log.
   */
  extract(ctx: ExtractionContext, source: SourceForExtraction, log?: AiCallLog): Promise<RawExtraction>
  /** One or two sentences on who a person is and what they do. Proposed only; the caller saves it if kept. */
  writePersonBrief(input: PersonBriefInput, log?: AiCallLog): Promise<string>
  /** A task's or project's card: "Where this stands" bullets and the next step. The caller tidies and saves it (cleanStatusCard). */
  writeStatus(input: StatusInput, log?: AiCallLog): Promise<RawStatus>
  /** The daily briefing's summary and picks from the tasks given. The caller checks the ids (assembleBriefing). */
  writeBriefing(input: BriefingInput, log?: AiCallLog): Promise<RawBriefing>
  /** The weekly review's reflection: a summary and short points. Text only; the caller tidies it (assembleReflection). */
  writeWeeklyReflection(input: WeeklyInput, log?: AiCallLog): Promise<RawReflection>
  /** Cheap check that the provider is reachable and configured. Throws a readable error if not. */
  test(): Promise<string>
}

/** Errors with a message that is safe and useful to show the user as-is. */
export class AiError extends Error {}

/** One request to an AI and what came back, exactly as sent and received (never the API key). */
export interface AiCallRecord {
  /** What this request was for, e.g. "Find suggestions" or "Link tasks to new projects and people". */
  purpose: string
  /** Where it went, e.g. "Anthropic Messages API" or "Ollama /api/chat". */
  endpoint: string
  request: unknown
  response: unknown | null
  error: string | null
  startedAt: string
  durationMs: number
  inputTokens: number | null
  outputTokens: number | null
  /** Set only by providers that charge per token (Claude): the model that answered, for cost estimates. */
  paidModel?: string | null
}

export interface AiCallLog {
  record(call: AiCallRecord): void
}

/** Times one AI call and records it, whether it succeeds or fails. */
export async function logged<T>(
  log: AiCallLog | undefined,
  meta: { purpose: string; endpoint: string; request: unknown },
  run: () => Promise<T>,
  describe: (result: T) => { response: unknown; inputTokens?: number | null; outputTokens?: number | null; paidModel?: string | null },
  errorResponse: (err: unknown) => unknown = () => null,
): Promise<T> {
  const startedAt = new Date().toISOString()
  const t0 = Date.now()
  try {
    const result = await run()
    const d = describe(result)
    log?.record({ ...meta, startedAt, durationMs: Date.now() - t0, response: d.response, error: null, inputTokens: d.inputTokens ?? null, outputTokens: d.outputTokens ?? null, paidModel: d.paidModel ?? null })
    return result
  } catch (err) {
    log?.record({ ...meta, startedAt, durationMs: Date.now() - t0, response: errorResponse(err), error: err instanceof Error ? err.message : String(err), inputTokens: null, outputTokens: null })
    throw err
  }
}

/** A plain-data copy of a request: functions (like a schema's parse helper) are dropped, as on the wire. */
export const asSent = (request: unknown): unknown => JSON.parse(JSON.stringify(request))
