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
  NextAction,
  ProjectCard,
  ReplyDraft,
  ReplyTarget,
  WeekListItem,
  WeeklyReview,
  ImportRequest,
  ImportResult,
  MailCheck,
  MailImportRun,
  CopilotCoverage,
  CopilotPrompt,
  CopilotPromptKind,
  MailAccount,
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
  TaskActivity,
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
  /** The task's card (where it stands and the next step), or null if none has been written. */
  'tasks.nextAction': (taskId: number) => NextAction | null
  /** Asks the selected AI for a new card for an open task, and saves it. Fails with a readable error for Basic. */
  'tasks.writeStatus': (taskId: number) => NextAction
  /** Hides (true) or shows again (false) a task's card. */
  'tasks.dismissNextAction': (taskId: number, dismissed: boolean) => NextAction | null
  /** Takes the AI's priority adjustment off a task. Returns the task with its score as it now is. */
  'tasks.removeAiAdjustment': (taskId: number) => Task
  /** The task's recorded changes for its Activity log, newest first. */
  'tasks.activity': (taskId: number) => TaskActivity
  'projects.list': () => ProjectSummary[]
  /** Archived projects, which projects.list leaves out. */
  'projects.listArchived': () => ProjectSummary[]
  'projects.save': (project: ProjectInput) => Project
  'projects.saveOverview': (id: number, text: string) => Project
  /** The project's card (where it stands and one next step), or null if none has been written. */
  'projects.card': (id: number) => ProjectCard | null
  /** Asks the selected AI for a new card for the project, and saves it. Fails with a readable error for Basic. */
  'projects.writeStatus': (id: number) => ProjectCard
  /** Hides (true) or shows again (false) a project's card. */
  'projects.dismissCard': (id: number, dismissed: boolean) => ProjectCard | null
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
  /** Renames an import; the AI won't rename it after this. */
  'sources.rename': (id: number, title: string) => SourceItem
  /** Where each Copilot Prompt Generator prompt's last imported answer ended. */
  'copilot.coverage': () => CopilotCoverage
  /** A Copilot prompt from `from` (local "YYYY-MM-DD HH:MM"; default: where the last imported answer ended, or 7 days ago) to now. */
  'copilot.prompt': (kind: CopilotPromptKind, from: string | null) => CopilotPrompt
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
  /** The mailbox addresses shown on the Import card (Outlook's, or the Apple Mail accounts chosen in Settings). */
  'mail.addresses': () => string[]
  /** Apple Mail's accounts, for Settings; refresh asks Mail again. Empty on other computers. */
  'mail.accounts': (refresh: boolean) => MailAccount[]
  /** The Outlook email a task's Reply card answers, or null when the task isn't linked to one. */
  'replies.target': (taskId: number) => ReplyTarget | null
  /** Asks the selected AI for a draft reply (with a revision: rewrites the previous draft following the user's note). Saves nothing. */
  'replies.draft': (taskId: number, revision: { note: string; previous: string } | null) => ReplyDraft
  /** Saves the reply to Outlook Drafts (never sends) and notes it in the task's Activity. Returns the draft's Outlook ids. */
  'replies.save': (taskId: number, reply: { replyAll: boolean; body: string }) => { entryId: string; storeId: string }
  /** Shows a saved draft in Outlook. */
  'replies.openDraft': (entryId: string, storeId: string) => void
  /** Opens the reply in a window of the mail app for the user to finish. Never saves or sends it. */
  'replies.open': (taskId: number, reply: { replyAll: boolean; body: string }) => void
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
  /** Every week from the first task to this one, newest first. Saves weeks that have ended first. */
  'weekly.list': () => WeekListItem[]
  /** One week's review, by its Sunday ('YYYY-MM-DD'). The current week is rebuilt each time. */
  'weekly.get': (weekStart: string) => WeeklyReview
  /** Asks the AI for this week's reflection and saves it. Reads only; changes nothing else. */
  'weekly.writeReflection': () => WeeklyReview
  /** True while a reflection is being written. */
  'weekly.isWriting': () => boolean
  /** The requests behind a week's reflection (kept for the newest few weeks). */
  'weekly.aiCalls': (weekStart: string) => AiCall[]
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
  'tasks.nextAction',
  'tasks.writeStatus',
  'tasks.dismissNextAction',
  'tasks.removeAiAdjustment',
  'tasks.activity',
  'projects.list',
  'projects.listArchived',
  'projects.save',
  'projects.saveOverview',
  'projects.card',
  'projects.writeStatus',
  'projects.dismissCard',
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
  'sources.rename',
  'copilot.coverage',
  'copilot.prompt',
  'sources.aiRuns',
  'mail.info',
  'mail.check',
  'mail.read',
  'mail.status',
  'mail.stop',
  'mail.imports',
  'mail.open',
  'mail.addresses',
  'mail.accounts',
  'replies.target',
  'replies.draft',
  'replies.save',
  'replies.openDraft',
  'replies.open',
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
  'weekly.list',
  'weekly.get',
  'weekly.writeReflection',
  'weekly.isWriting',
  'weekly.aiCalls',
  'usage.spending',
]

/** The renderer sees every call as async. */
export type AsyncApi = { [K in ApiChannel]: (...args: Parameters<Api[K]>) => Promise<Awaited<ReturnType<Api[K]>>> }
