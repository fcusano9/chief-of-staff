// Domain model shared by the main process (database, services) and the renderer (UI).
// Dates: due dates are local calendar dates 'YYYY-MM-DD'; timestamps are ISO-8601 UTC strings.

export type TaskStatus = 'proposed' | 'open' | 'in_progress' | 'waiting_on' | 'done' | 'dismissed'
export const ACTIVE_STATUSES: readonly TaskStatus[] = ['open', 'in_progress', 'waiting_on']
export const STATUS_LABELS: Record<TaskStatus, string> = {
  proposed: 'Proposed',
  open: 'Open',
  in_progress: 'In progress',
  waiting_on: 'Waiting on',
  done: 'Done',
  dismissed: 'Dismissed',
}

export type ProjectStatus = 'active' | 'on_hold' | 'completed' | 'archived'
export type BriefScope = 'project' | 'task' | 'person'
export type SourceKind = 'email' | 'teams_chat' | 'meeting_transcript' | 'copilot_summary' | 'note'

export interface Project {
  id: number
  name: string
  color: string
  status: ProjectStatus
  createdAt: string
  /** One or two sentences on what the project is, written by hand. */
  overview: string | null
  /** A short status: where it stands, recent decisions, what's next, what's open. Written by the AI on request or by hand. */
  brief: string | null
  briefBy: 'ai' | 'user' | null
  briefAt: string | null
}

/** What the UI sends to create (id 0) or update a project. The overview and brief are saved separately. */
export type ProjectInput = Pick<Project, 'id' | 'name' | 'color' | 'status'>

export interface ProjectSummary extends Project {
  openCount: number
  /** Notes added to the project's history since the brief was written. */
  newNotes: number
}

export interface Person {
  id: number
  name: string
  role: string | null
  company: string | null
  email: string | null
  /** 1 (low) to 5 (highest). Requests from higher-weight people rank higher. */
  priorityWeight: number
  /** One or two sentences on who they are and what they do, written by the AI on request or by hand. */
  brief: string | null
  briefBy: 'ai' | 'user' | null
  briefAt: string | null
}

/** What the UI sends to create (id 0) or update a person. The brief is saved separately. */
export type PersonInput = Pick<Person, 'id' | 'name' | 'role' | 'company' | 'email' | 'priorityWeight'>

export interface PersonSummary extends Person {
  /** Open tasks they asked for. */
  openCount: number
  /** Open tasks waiting on them (matched by name) that they didn't also ask for. */
  waitingCount: number
  /** Lines added to their context history since the brief was written. */
  newNotes: number
}

/** A brief the AI proposed. Nothing is saved until the user keeps it. */
export interface BriefSuggestion {
  text: string
  /** The AI that wrote it, e.g. "Demo AI" or "Claude Opus 5.5". */
  writtenBy: string
}

export interface Subtask {
  id: number
  title: string
  isDone: boolean
}

export interface StatusUpdate {
  id: number
  text: string
  isAiGenerated: boolean
  createdAt: string
}

export interface Task {
  id: number
  title: string
  notes: string | null
  status: TaskStatus
  dueDate: string | null
  /** Optional: one-off tasks have no project. */
  projectId: number | null
  requesterId: number | null
  /** Computed 0-100 score; see priority.ts. */
  priorityScore: number
  priorityRationale: string | null
  /** When set, replaces the computed score. */
  priorityOverride: number | null
  followUpCount: number
  waitingOn: string | null
  waitingSince: string | null
  createdAt: string
  lastActivityAt: string
  completedAt: string | null
  subtasks: Subtask[]
  statusUpdates: StatusUpdate[]
  /** Imported emails, chats, transcripts, or summaries this task came from or was updated by. */
  linkedSources: SourceRef[]
  project: Project | null
  requester: Person | null
}

export interface SourceRef {
  id: number
  kind: SourceKind
  title: string
  occurredAt: string
}

export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  copilot_summary: 'Copilot summary',
  email: 'Email',
  teams_chat: 'Teams chat',
  meeting_transcript: 'Meeting transcript',
  note: 'Notes',
}

export interface SourceItem extends SourceRef {
  fromName: string | null
  importedAt: string
  extractedAt: string | null
  extractedBy: string | null
  extractError: string | null
  /** Characters of content (the content itself is loaded only when needed). */
  length: number
  pendingCount: number
  totalSuggestions: number
}

export interface ImportRequest {
  kind: SourceKind
  title: string
  content: string
  fromName?: string | null
  /** 'YYYY-MM-DD' the content is from; defaults to today. */
  occurredOn?: string | null
}

export interface ImportResult {
  source: SourceItem
  /** True when identical content was imported before; nothing new was created or sent. */
  duplicate: boolean
  suggestionsCreated: number
  error: string | null
}

export type SuggestionKind = 'new_task' | 'status_update' | 'mark_done' | 'waiting_on' | 'brief_update' | 'new_project' | 'new_person'
export const SUGGESTION_LABELS: Record<SuggestionKind, string> = {
  new_task: 'New task',
  status_update: 'Status update',
  mark_done: 'Looks done',
  waiting_on: 'Waiting on',
  brief_update: 'Context',
  new_project: 'New project',
  new_person: 'New person',
}
/** Brief updates are labeled by what they add context to. */
export const BRIEF_UPDATE_LABELS: Record<BriefScope, string> = { project: 'Project context', person: 'Person context', task: 'Task context' }
export const suggestionLabel = (kind: SuggestionKind, briefScope: BriefScope | null): string =>
  kind === 'brief_update' && briefScope ? BRIEF_UPDATE_LABELS[briefScope] : SUGGESTION_LABELS[kind]

/** What the AI proposed. All references are validated against the database before saving. */
export interface SuggestionPayload {
  /** Existing task this is about (status_update, mark_done, waiting_on; optional for brief_update). */
  taskId: number | null
  /** Task title for new tasks; a short headline otherwise. */
  title: string
  /** Status update text, brief text, or extra detail for a new task. */
  details: string
  dueDate: string | null
  projectId: number | null
  /** Person id when the requester matched someone in People. */
  requesterId: number | null
  /** The requester's name as written in the source (kept even when nobody matched). */
  requesterName: string | null
  waitingOn: string | null
  briefScope: BriefScope | null
  briefOwnerId: number | null
  /** new_project: the color the project gets. */
  color?: string | null
  /** new_person: as written in the source. New people always start at 3 stars. */
  role?: string | null
  company?: string | null
  email?: string | null
  /**
   * Links to a new_project or new_person suggestion from the same import that isn't decided yet.
   * Accepting this suggestion creates that project or person too; rejecting it clears the link.
   */
  projectSuggestionId?: number | null
  requesterSuggestionId?: number | null
  waitingOnSuggestionId?: number | null
}

export interface Suggestion {
  id: number
  kind: SuggestionKind
  status: 'pending' | 'accepted' | 'rejected'
  payload: SuggestionPayload
  /** Quote from the source that supports the suggestion. */
  evidence: string
  createdAt: string
  source: SourceRef
  /** Title of the existing task referenced by payload.taskId, for display. */
  taskTitle: string | null
}

export type AiProviderId = 'demo' | 'claude' | 'local'

export interface AiModelOption {
  id: string
  label: string
  note: string
}

/** Claude models offered in Settings. Prices are Anthropic list prices per million tokens (input / output). */
export const CLAUDE_MODELS: AiModelOption[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Most capable · $4 / $20' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Balanced · $2 / $10' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'Fastest, cheapest · $0.10 / $0.50' },
]

export interface AiStatus {
  provider: AiProviderId
  model: string
  hasKey: boolean
  /** Whether the OS can encrypt the stored key (Windows DPAPI / macOS Keychain). */
  encryptionAvailable: boolean
  /** Short label for the status bar. */
  label: string
  /** True when imports will be sent to an outside service. */
  sendsDataExternally: boolean
}

/** What the UI sends to create (id 0) or update a task. Subtasks with id 0 are new. */
export interface TaskInput {
  id: number
  title: string
  notes: string | null
  status: TaskStatus
  dueDate: string | null
  projectId: number | null
  requesterId: number | null
  priorityOverride: number | null
  followUpCount: number
  waitingOn: string | null
  subtasks: Subtask[]
}

export interface ContextBrief {
  scope: BriefScope
  ownerId: number
  summary: string
  standingInstructions: string
  updatedAt: string | null
}

export interface TodaySummary {
  urgent: number
  waitingOn: number
  overdue: number
  open: number
}

export interface TaskFilter {
  projectId?: number
  noProjectOnly?: boolean
  search?: string
}

export interface PriorityWeights {
  dueDate: number
  requester: number
  staleness: number
}

export type ThemeSetting = 'system' | 'light' | 'dark'
export type LocalThoroughness = 'standard' | 'thorough'

export interface PeopleFilter {
  /** A company name, NO_COMPANY for people with none, or '' for everyone. */
  company: string
  /** Only people with open asks or tasks waiting on them. */
  openOnly: boolean
}
export const NO_COMPANY = '(none)'

export interface AppSettings {
  /** Used in greetings and so the AI knows whose action items to pick out. */
  userName: string
  aiProvider: AiProviderId
  aiModel: string
  /** Ollama model name used when aiProvider is 'local', e.g. "gpt-oss:20b". */
  localModel: string
  /** Ollama server address. Anything other than this computer counts as sending data out. */
  localUrl: string
  /** "thorough" lets the local model reason more: a little more accurate, about three times slower. */
  localThoroughness: LocalThoroughness
  priorityWeights: PriorityWeights
  theme: ThemeSetting
  /** Left pane width of split views, as a percentage. */
  splitPercent: number
  /** People list filters, remembered between visits. */
  peopleFilter: PeopleFilter
  dailyBriefingTime: string
  /** Null means the default OneDrive backup folder. */
  backupFolder: string | null
  backupsToKeep: number
  lastBackupAt: string | null
}

export const DEFAULT_SETTINGS: AppSettings = {
  userName: 'Frank Cusano',
  aiProvider: 'demo',
  aiModel: 'claude-opus-5-5',
  localModel: 'gpt-oss:20b',
  localUrl: 'http://127.0.0.1:11434',
  localThoroughness: 'standard',
  priorityWeights: { dueDate: 8, requester: 7, staleness: 5 },
  theme: 'system',
  splitPercent: 50,
  peopleFilter: { company: '', openOnly: false },
  dailyBriefingTime: '07:30',
  backupFolder: null,
  backupsToKeep: 30,
  lastBackupAt: null,
}

export interface AppInfo {
  version: string
  databasePath: string
  dataFolder: string
  defaultBackupFolder: string
  platform: string
  /** True when running from source or a test folder: data and backups are kept apart from the real ones. */
  isSeparateData: boolean
  /** Set once after a restore, so the UI can confirm it: the backup file that was restored. */
  restoredFrom: string | null
}

/** One request to the AI during an import, exactly as sent and received. JSON is pretty-printed. */
export interface AiCall {
  id: number
  purpose: string
  endpoint: string
  request: string
  response: string | null
  error: string | null
  startedAt: string
  durationMs: number
  inputTokens: number | null
  outputTokens: number | null
}

/** One time the AI read an import ("Run again" makes another). The newest few are kept. */
export interface AiRun {
  id: number
  sourceId: number
  provider: string
  startedAt: string
  finishedAt: string | null
  /** Everything the AI proposed, before the app's checks (JSON). */
  rawOutput: string | null
  /** What passed the checks and went to Review (JSON). */
  keptOutput: string | null
  rawCount: number | null
  keptCount: number | null
  /** Suggestions the app's checks left out of Review, with the reason. */
  dropped: { kind: string; title: string; reason: string }[]
  error: string | null
  calls: AiCall[]
}

export type BackupKind = 'daily' | 'before-upgrade' | 'before-restore'

export interface BackupInfo {
  path: string
  fileName: string
  folder: string
  createdAt: string
  kind: BackupKind
  size: number
  /** False for backups this version can't use (the old Windows app, newer versions, unreadable files). */
  compatible: boolean
  reason: string | null
  schemaVersion: number | null
  openTasks: number | null
}

/** Project colors (tasks are themed with their project's color). */
export const PROJECT_COLORS = ['#7F77DD', '#1D9E75', '#D85A30', '#D4537E', '#378ADD', '#639922', '#BA7517', '#E24B4A']
export const NO_PROJECT_COLOR = '#B4B2A9'

export const effectivePriority = (t: Pick<Task, 'priorityScore' | 'priorityOverride'>): number =>
  t.priorityOverride ?? t.priorityScore

export const isActive = (s: TaskStatus): boolean => ACTIVE_STATUSES.includes(s)

export const initials = (name: string): string =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
