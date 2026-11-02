import type {
  AiStatus,
  ImportRequest,
  ImportResult,
  SourceItem,
  Suggestion,
  SuggestionPayload,
  AppInfo,
  AppSettings,
  BriefScope,
  ContextBrief,
  Person,
  PersonSummary,
  Project,
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
  'tasks.listForPerson': (personId: number) => Task[]
  'tasks.get': (id: number) => Task | null
  'tasks.save': (input: TaskInput) => Task
  'tasks.setStatus': (id: number, status: TaskStatus) => Task
  'tasks.delete': (id: number) => void
  'tasks.summary': () => TodaySummary
  'projects.list': () => ProjectSummary[]
  'projects.save': (project: Pick<Project, 'id' | 'name' | 'color' | 'status'>) => Project
  'projects.delete': (id: number) => void
  'people.list': () => PersonSummary[]
  'people.save': (person: Omit<Person, 'id'> & { id: number }) => Person
  'people.delete': (id: number) => void
  'briefs.get': (scope: BriefScope, ownerId: number) => ContextBrief
  'briefs.save': (brief: ContextBrief) => ContextBrief
  'settings.get': () => AppSettings
  'settings.save': (settings: AppSettings) => AppSettings
  'backup.now': () => string
  'backup.openFolder': () => void
  'app.info': () => AppInfo
  'app.setTitleBarTheme': (dark: boolean) => void
  'sources.importAndExtract': (req: ImportRequest) => ImportResult
  'sources.extract': (sourceId: number) => ImportResult
  'sources.list': () => SourceItem[]
  'sources.delete': (id: number) => void
  'suggestions.listPending': () => Suggestion[]
  'suggestions.count': () => number
  'suggestions.accept': (id: number, edits?: Partial<SuggestionPayload>) => number | null
  'suggestions.reject': (id: number) => void
  'ai.status': () => AiStatus
  /** Stores (or with null, removes) the Anthropic API key. The key is never returned to the UI. */
  'ai.setKey': (key: string | null) => AiStatus
  'ai.test': () => string
}

export type ApiChannel = keyof Api

export const API_CHANNELS: ApiChannel[] = [
  'tasks.listActive',
  'tasks.listWaiting',
  'tasks.listForPerson',
  'tasks.get',
  'tasks.save',
  'tasks.setStatus',
  'tasks.delete',
  'tasks.summary',
  'projects.list',
  'projects.save',
  'projects.delete',
  'people.list',
  'people.save',
  'people.delete',
  'briefs.get',
  'briefs.save',
  'settings.get',
  'settings.save',
  'backup.now',
  'backup.openFolder',
  'app.info',
  'app.setTitleBarTheme',
  'sources.importAndExtract',
  'sources.extract',
  'sources.list',
  'sources.delete',
  'suggestions.listPending',
  'suggestions.count',
  'suggestions.accept',
  'suggestions.reject',
  'ai.status',
  'ai.setKey',
  'ai.test',
]

/** The renderer sees every call as async. */
export type AsyncApi = { [K in ApiChannel]: (...args: Parameters<Api[K]>) => Promise<Awaited<ReturnType<Api[K]>>> }
