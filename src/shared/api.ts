import type {
  AiRun,
  AiSpending,
  AiCall,
  AiStatus,
  AiChoiceGroup,
  AiProviderId,
  OllamaSetupStatus,
  Briefing,
  BriefingListItem,
  ImportRequest,
  ImportResult,
  MailCheck,
  MailImportRun,
  MailInfo,
  MailJobStatus,
  SourceItem,
  Suggestion,
  SuggestionPayload,
  AppInfo,
  BackupInfo,
  AppSettings,
  BriefScope,
  BriefSuggestion,
  ContextBrief,
  Person,
  PersonInput,
  PersonSummary,
  Project,
  ProjectInput,
  ProjectSummary,
  Task,
  TaskFilter,
  TaskInput,
  TaskStatus,
  TodaySummary,
} from './types'

/**
 * Everything the UI can ask the main process to do. Each key is also the IPC channel name.
 * The preload script exposes this as `window.cos`.
 */
export interface Api {
  'tasks.listActive': (filter?: TaskFilter) => Task[]
  'tasks.listWaiting': () => Task[]
  /** Finished tasks, newest first; list "waiting" for ones that were waiting on someone. */
  'tasks.listDone': (filter?: TaskFilter) => Task[]
  /** Puts a finished task back on Tasks, or on Waiting if it was waiting on someone. */
  'tasks.reopen': (id: number) => Task
  'tasks.listForPerson': (personId: number) => Task[]
  'tasks.get': (id: number) => Task | null
  'tasks.save': (input: TaskInput) => Task
  'tasks.setStatus': (id: number, status: TaskStatus) => Task
  'tasks.delete': (id: number) => void
  'tasks.summary': () => TodaySummary
  'projects.list': () => ProjectSummary[]
  /** Archived projects, which projects.list leaves out. */
  'projects.listArchived': () => ProjectSummary[]
  'projects.save': (project: ProjectInput) => Project
  'projects.saveOverview': (id: number, text: string) => Project
  /** Asks the AI for a new status brief from the project's history. Changes nothing; the UI saves it with projects.saveBrief if kept. */
  'projects.suggestBrief': (id: number) => BriefSuggestion
  'projects.saveBrief': (id: number, text: string, by: 'ai' | 'user') => Project
  'projects.delete': (id: number) => void
  'people.list': () => PersonSummary[]
  'people.save': (person: PersonInput) => Person
  'people.delete': (id: number) => void
  /** Asks the AI for a new one-line brief. Changes nothing; the UI saves it with people.saveBrief if kept. */
  'people.suggestBrief': (id: number) => BriefSuggestion
  'people.saveBrief': (id: number, text: string, by: 'ai' | 'user') => Person
  'briefs.get': (scope: BriefScope, ownerId: number) => ContextBrief
  'briefs.save': (brief: ContextBrief) => ContextBrief
  'settings.get': () => AppSettings
  'settings.save': (settings: AppSettings) => AppSettings
  'backup.now': () => string
  'backup.openFolder': () => void
  /** Backups in the backup folder and the local fallback folder, newest first. */
  'backup.list': () => BackupInfo[]
  /** Saves current data as a safety copy, then restarts the app with the chosen backup. */
  'backup.restore': (path: string) => void
  'app.info': () => AppInfo
  'app.setTitleBarTheme': (dark: boolean) => void
  'sources.importAndExtract': (req: ImportRequest) => ImportResult
  'sources.extract': (sourceId: number) => ImportResult
  'sources.list': () => SourceItem[]
  'sources.delete': (id: number) => void
  /** Every time the AI read this import: the exact requests sent and responses received. */
  'sources.aiRuns': (sourceId: number) => AiRun[]
  'mail.info': () => MailInfo
  /** Looks through Outlook for mail since an ISO time. Nothing is sent to the AI. */
  'mail.check': (since: string) => MailCheck
  /** Starts reading the chosen conversations from a check, in the background. */
  'mail.read': (checkId: number, keys: string[]) => MailJobStatus
  'mail.status': () => MailJobStatus
  'mail.stop': () => void
  'mail.imports': () => MailImportRun[]
  /** Shows an imported conversation's newest message in Outlook. */
  'mail.open': (sourceId: number) => void
  'suggestions.listPending': () => Suggestion[]
  'suggestions.count': () => number
  'suggestions.accept': (id: number, edits?: Partial<SuggestionPayload>) => number | null
  'suggestions.reject': (id: number) => void
  'ai.status': () => AiStatus
  /** Stores (or with null, removes) the Anthropic API key. The key is never returned to the UI. */
  'ai.setKey': (key: string | null) => AiStatus
  /** Checks a provider works (the chosen one when omitted). */
  'ai.test': (provider?: AiProviderId) => string
  /** Every model that can be picked now, grouped by provider: Basic, Claude (with a key), and each model in Ollama. */
  'ai.choices': () => AiChoiceGroup[]
  /** Whether Ollama is installed and running, its models, and any install or download in progress. */
  'ollama.status': () => OllamaSetupStatus
  /** Downloads the official installer from ollama.com, checks its signature and opens it. Returns at once. */
  'ollama.install': () => OllamaSetupStatus
  /** Forgets an install the app is waiting on (e.g. the installer was closed). */
  'ollama.cancelInstall': () => OllamaSetupStatus
  /** Starts an installed Ollama on this computer. */
  'ollama.start': () => OllamaSetupStatus
  /** Starts downloading a tested model in the background. */
  'ollama.pull': (name: string) => OllamaSetupStatus
  'ollama.cancelPull': (name: string) => OllamaSetupStatus
  /** Deletes a downloaded model from Ollama. */
  'ollama.delete': (name: string) => OllamaSetupStatus
  /** The newest saved briefing, or null if none has been written. */
  'briefing.latest': () => Briefing | null
  /** Every saved briefing, newest first. */
  'briefing.list': () => BriefingListItem[]
  'briefing.get': (id: number) => Briefing | null
  /** Asks the AI for a new briefing and saves it. Reads only; changes nothing else. */
  'briefing.write': () => Briefing
  /** True while a briefing is being written. */
  'briefing.isWriting': () => boolean
  /** The requests sent to the AI for a briefing and what came back (kept for the newest few). */
  'briefing.aiCalls': (id: number) => AiCall[]
  /** Estimated Claude costs this month and over the last 30 days, by purpose and by model. */
  'usage.spending': () => AiSpending
}

export type ApiChannel = keyof Api

export const API_CHANNELS: ApiChannel[] = [
  'tasks.listActive',
  'tasks.listWaiting',
  'tasks.listDone',
  'tasks.reopen',
  'tasks.listForPerson',
  'tasks.get',
  'tasks.save',
  'tasks.setStatus',
  'tasks.delete',
  'tasks.summary',
  'projects.list',
  'projects.listArchived',
  'projects.save',
  'projects.saveOverview',
  'projects.suggestBrief',
  'projects.saveBrief',
  'projects.delete',
  'people.list',
  'people.save',
  'people.delete',
  'people.suggestBrief',
  'people.saveBrief',
  'briefs.get',
  'briefs.save',
  'settings.get',
  'settings.save',
  'backup.now',
  'backup.openFolder',
  'backup.list',
  'backup.restore',
  'app.info',
  'app.setTitleBarTheme',
  'sources.importAndExtract',
  'sources.extract',
  'sources.list',
  'sources.delete',
  'sources.aiRuns',
  'mail.info',
  'mail.check',
  'mail.read',
  'mail.status',
  'mail.stop',
  'mail.imports',
  'mail.open',
  'suggestions.listPending',
  'suggestions.count',
  'suggestions.accept',
  'suggestions.reject',
  'ai.status',
  'ai.setKey',
  'ai.test',
  'ai.choices',
  'ollama.status',
  'ollama.install',
  'ollama.cancelInstall',
  'ollama.start',
  'ollama.pull',
  'ollama.cancelPull',
  'ollama.delete',
  'briefing.latest',
  'briefing.list',
  'briefing.get',
  'briefing.write',
  'briefing.isWriting',
  'briefing.aiCalls',
  'usage.spending',
]

/** The renderer sees every call as async. */
export type AsyncApi = { [K in ApiChannel]: (...args: Parameters<Api[K]>) => Promise<Awaited<ReturnType<Api[K]>>> }
