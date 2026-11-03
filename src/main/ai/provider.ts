import type { PersonBriefInput, ProjectBriefInput } from './brief'
import type { ExtractionContext, SourceForExtraction } from './context'
import type { RawSuggestion } from './schema'

/**
 * Anything that can read an imported item and propose suggestions. Claude is the first real
 * provider; Microsoft 365 Copilot, OpenAI, or a local model can implement this later.
 */
export interface AiProvider {
  /** Shown to the user, e.g. "Claude Opus 5.5" or "Demo AI". */
  readonly label: string
  /** True when calling extract() sends content off this computer. */
  readonly sendsDataExternally: boolean
  extract(ctx: ExtractionContext, source: SourceForExtraction): Promise<RawSuggestion[]>
  /** One or two sentences on who a person is and what they do. Proposed only; the caller saves it if kept. */
  writePersonBrief(input: PersonBriefInput): Promise<string>
  /** A short status brief for a project, from its history and open tasks. Proposed only; the caller saves it if kept. */
  writeProjectBrief(input: ProjectBriefInput): Promise<string>
  /** Cheap check that the provider is reachable and configured. Throws a readable error if not. */
  test(): Promise<string>
}

/** Errors with a message that is safe and useful to show the user as-is. */
export class AiError extends Error {}
