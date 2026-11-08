// Domain model shared by the main process (database, services) and the renderer (UI).
// Dates: due dates are local calendar dates 'YYYY-MM-DD'; timestamps are ISO-8601 UTC strings.

import { priceLabel } from './pricing'

export type TaskStatus = 'proposed' | 'open' | 'waiting_on' | 'done' | 'dismissed'
export const ACTIVE_STATUSES: readonly TaskStatus[] = ['open', 'waiting_on']
export const STATUS_LABELS: Record<TaskStatus, string> = {
  proposed: 'Proposed',
  open: 'Open',
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
}

/** What the UI sends to create (id 0) or update a project. The overview is saved separately. */
export type ProjectInput = Pick<Project, 'id' | 'name' | 'color' | 'status'>

export interface ProjectSummary extends Project {
  openCount: number
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
  /** The AI that wrote it, e.g. "Basic" or "Claude Opus 5.5". */
  writtenBy: string
}

export interface Subtask {
  id: number
  title: string
  isDone: boolean
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
  /** The AI's adjustment to the computed score (±15), or null. A score set by hand still wins. */
  aiAdjustment: PriorityAdjustment | null
  followUpCount: number
  waitingOn: string | null
  waitingSince: string | null
  /** For a done task that was waiting on someone: who. Reopening puts it back on Waiting. */
  waitedOn: string | null
  createdAt: string
  lastActivityAt: string
  completedAt: string | null
  subtasks: Subtask[]
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
  /** True for conversations read from Outlook, which can be opened there. */
  fromOutlook?: boolean
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
  /** Estimated cost in US dollars of its latest AI run; null when it cost nothing, wasn't read, or the price isn't known. */
  estimatedCost: number | null
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

export type SuggestionKind = 'new_task' | 'needs_reply' | 'status_update' | 'mark_done' | 'waiting_on' | 'brief_update' | 'new_project' | 'new_person'
export const SUGGESTION_LABELS: Record<SuggestionKind, string> = {
  new_task: 'New task',
  needs_reply: 'Needs reply',
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
  /** new_person: as written in the source. New people always start at 1 star. */
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
  /** waiting_on from email: when the user sent the ask, so the wait counts from then rather than from accepting. */
  waitingSince?: string | null
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
  /** Title and status of the existing task referenced by payload.taskId, for display. */
  taskTitle: string | null
  taskStatus: TaskStatus | null
}

export type AiProviderId = 'demo' | 'claude' | 'local'

export interface AiModelOption {
  id: string
  label: string
  note: string
  /** Anthropic list price per million tokens (input / output), shown as a tooltip. */
  price: string
}

/** Claude models offered in the model picker. */
export const CLAUDE_MODELS: AiModelOption[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Most capable', price: priceLabel('claude-opus-5-5') },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Balanced', price: priceLabel('claude-sonnet-5-5') },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'Fastest, cheapest', price: priceLabel('claude-haiku-5-5') },
]

/** The rule-based reader built into the app (provider id 'demo'). It isn't actually AI. */
export const BASIC_LABEL = 'Basic'

/** Local models tested with this app. Only these are offered for download. */
export const TESTED_LOCAL_MODELS: { name: string; size: string; note: string }[] = [
  { name: 'gpt-oss:20b', size: '14 GB', note: 'Uses about 13 GB of memory while it runs.' },
  // The q4_K_M tag on purpose: on a Mac the plain qwen3.8:27b tag is an MLX build, and Ollama's MLX engine can't give the fixed-format answers the app needs.
  {
    name: 'qwen3.8:27b-q4_K_M',
    size: '17 GB',
    note: 'More accurate than gpt-oss:20b, but slow: about 2½ minutes per item on a 32 GB MacBook Pro. Best on a more powerful computer. Uses about 16 GB of memory.',
  },
]
export const isTestedLocalModel = (name: string) => TESTED_LOCAL_MODELS.some((m) => m.name === name)
export const localModelLabel = (name: string) => `Ollama ${name}`

/** One model you can pick in Settings or the status bar. */
export interface AiChoice {
  provider: AiProviderId
  /** Claude model id or Ollama model name; empty for Basic. */
  model: string
  label: string
  note: string
  /** Extra detail for a tooltip. */
  detail?: string
}

export interface AiChoiceGroup {
  provider: AiProviderId
  title: string
  choices: AiChoice[]
}

export interface AiStatus {
  provider: AiProviderId
  model: string
  hasKey: boolean
  /** Whether the OS can encrypt the stored key (Windows DPAPI / macOS Keychain). */
  encryptionAvailable: boolean
  /** Short label for the status bar, e.g. "Claude Opus 5.5" or "Ollama gpt-oss:20b". */
  label: string
  /** True when imports will be sent to an outside service. */
  sendsDataExternally: boolean
  /** False when the chosen model can't be used right now (no key, Ollama stopped, model not downloaded). */
  available: boolean
  /** Why it can't be used, in plain words. Null when available. */
  problem: string | null
}

export type OllamaState = 'missing' | 'stopped' | 'ready'

export interface OllamaSetupStatus {
  /** missing: not installed here; stopped: installed (or a remote address) but not answering; ready: answering. */
  state: OllamaState
  url: string
  /** True when the address is another machine, so the app can't install or start it. */
  remote: boolean
  /** Whether this app can install Ollama on this computer (Windows and Mac). */
  canInstall: boolean
  /** Models downloaded into Ollama, by name. */
  models: { name: string; sizeBytes: number }[]
  install: { phase: 'downloading' | 'installing' | 'failed'; percent: number | null; error: string | null } | null
  /** Downloads in progress, or ones that failed. */
  pulls: { name: string; percent: number | null; error: string | null }[]
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
  /** When entering Waiting on, the time the wait started (defaults to now). */
  waitingSince?: string | null
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
  /** "tasks": open and in progress; "waiting": waiting on someone. Omitted: both. */
  list?: 'tasks' | 'waiting'
}

export interface PriorityWeights {
  dueDate: number
  requester: number
  staleness: number
}

export type ThemeSetting = 'system' | 'light' | 'dark'

/** How much fits on screen: Compact is the original look; Comfortable and Spacious add room and slightly larger text. */
export type DensitySetting = 'compact' | 'comfortable' | 'spacious'
export const DENSITIES: { id: DensitySetting; label: string; description: string }[] = [
  { id: 'compact', label: 'Compact', description: 'The most on screen.' },
  { id: 'comfortable', label: 'Comfortable', description: 'More room between rows, slightly larger text.' },
  { id: 'spacious', label: 'Spacious', description: 'The most room. Priority reasons sit under each task title.' },
]

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
  priorityWeights: PriorityWeights
  theme: ThemeSetting
  density: DensitySetting
  /** Left pane width of split views, as a percentage. */
  splitPercent: number
  /** People list filters, remembered between visits. */
  peopleFilter: PeopleFilter
  dailyBriefingTime: string
  /** How the user writes, sent with every draft reply (Settings → AI). Empty means plain, professional replies. */
  replyStyle: string
  /** Apple Mail accounts to read (Mail's account ids), chosen in Settings. Empty reads nothing. */
  mailAccounts: string[]
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
  priorityWeights: { dueDate: 8, requester: 7, staleness: 5 },
  theme: 'system',
  density: 'comfortable',
  splitPercent: 50,
  peopleFilter: { company: '', openOnly: false },
  dailyBriefingTime: '07:30',
  replyStyle: '',
  mailAccounts: [],
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
  /** The Claude model that answered, for paid requests only (null for Basic and Ollama). */
  paidModel: string | null
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

/** How a briefing was started. Only 'manual' exists in the UI today; a scheduler would use 'scheduled'. */
export type BriefingTrigger = 'manual' | 'scheduled'

/** One line in a briefing. Items always come from real tasks; only `note` is written by the AI. */
export interface BriefingItem {
  /** The task it's about, or null for the Review line. */
  taskId: number | null
  /** The task's title when the briefing was written, so History reads the same later. */
  title: string
  /** Who a waiting-on item is waiting on. */
  who: string | null
  note: string
  /** Days past its due date when the briefing was written, or null if not overdue. */
  overdueDays: number | null
  /** 'review' opens Review instead of a task. */
  kind: 'task' | 'waiting' | 'review'
  /** Top priorities only: the next action the AI suggested for the task (also saved on its card). */
  nextAction?: string | null
  /** The task's due date ('YYYY-MM-DD') when the briefing was written, for its tag. Missing on older briefings. */
  due?: string | null
  /** Waiting-on items: days waited when the briefing was written. */
  waitingDays?: number | null
  /** The task's project color when the briefing was written; null for no project. Missing on older briefings. */
  projectColor?: string | null
}

/** Where a suggested next action or priority adjustment came from. */
/** What wrote a next action or priority change: a daily briefing, an import, or the user clicking Write (cards only). */
export type NextActionOrigin = 'briefing' | 'import' | 'manual'

/** Who made a change to a task, for its Activity log. */
export type ChangeBy =
  | { by: 'user' }
  /** Accepting a Review suggestion; label is the import's title. */
  | { by: 'review'; label: string }
  /** The AI itself (priority changes); label says where, e.g. "daily briefing" or 'import “Team sync”'. */
  | { by: 'ai'; label: string }

export type TaskEventKind = 'created' | 'status' | 'due' | 'project' | 'requester' | 'title' | 'override' | 'followups' | 'ai_priority' | 'reply_draft' | 'reply_opened'

/** One recorded change to a task. Values are as they were then (names, not ids). */
export interface TaskEvent {
  id: number
  taskId: number
  at: string
  kind: TaskEventKind
  from: string | null
  to: string | null
  /** Extra detail: who a task waits on, or the AI's reason. */
  note: string | null
  by: ChangeBy['by']
  byLabel: string | null
}

/** A task's Activity: its recorded changes, newest first, and when recording started. */
export interface TaskActivity {
  events: TaskEvent[]
  /** When the event log started; changes to older tasks before this weren't recorded. */
  loggedSince: string
}


/**
 * The AI's adjustment to a task's priority score: written as part of a daily briefing or an
 * import, applied at once and shown on the priority card with its reason. Remove takes it off.
 */
export interface PriorityAdjustment {
  /** Added to the computed score, -15 to 15 (never 0). */
  delta: number
  reason: string
  writtenAt: string
  writtenBy: string
  origin: NextActionOrigin
  /** For imports: the import's title. */
  originLabel: string | null
}

/**
 * A task's "Where this stands" and suggested next action, always written together by the AI: on
 * Write, as part of a daily briefing, or as part of an import. Shown on the task's card only; it
 * changes nothing. A newer one replaces the whole card.
 */
export interface NextAction {
  taskId: number
  /** 2–3 short bullets on where the task stands, written so they can be shared. Empty for cards written before bullets existed. */
  status: string[]
  action: string
  writtenAt: string
  /** The AI that wrote it, e.g. "Claude Opus 5.5". */
  writtenBy: string
  origin: NextActionOrigin
  /** For imports: the import's title. */
  originLabel: string | null
  dismissed: boolean
  /** Set when the task got an update dated after this was written, e.g. "Nov 15, 2026". */
  staleSince: string | null
}

/** The email a task's Reply card replies to: the newest email, sent or received, in its linked Outlook conversation. */
export interface ReplyTarget {
  sourceId: number
  subject: string
  /** The other person: who sent the newest email, or for a follow-up, who the user's email went to. */
  from: string
  /** ISO time of the newest email. */
  at: string
  /** The newest email in the conversation is the user's own, so the draft is a follow-up to it. */
  followUp: boolean
  /** False when this computer has no mail app the app can use. */
  supported: boolean
  /** The mail app replies go through, for the button words ("Open in Mail"). */
  app: MailApp | null
}

/** A draft reply shown in the app before it's saved to Outlook Drafts. */
export interface ReplyDraft {
  replyAll: boolean
  body: string
  subject: string
  /** Who each choice would go to, as Outlook shows them. */
  reply: { to: string; cc: string }
  replyAllTo: { to: string; cc: string }
  writtenBy: string
  /** The email the draft replies to, as Outlook found it when drafting (it may be newer than the target's). */
  email: { from: string; at: string; followUp: boolean }
}

/** A project's "Where this stands" and one next step for the project as a whole. Written only when the user clicks Write. */
export interface ProjectCard {
  projectId: number
  status: string[]
  action: string
  writtenAt: string
  writtenBy: string
  dismissed: boolean
  /** Set when the project got an update dated after this was written. */
  staleSince: string | null
}

/** A saved daily briefing. Every one is kept. */
export interface Briefing {
  id: number
  createdAt: string
  trigger: BriefingTrigger
  /** The AI that wrote it, e.g. "Claude Opus 5.5" or "Basic". */
  writtenBy: string
  /** Start of the "New since last briefing" window (the previous briefing, or a day back). */
  since: string
  summary: string
  priorities: BriefingItem[]
  nudges: BriefingItem[]
  newItems: BriefingItem[]
}

/** A briefing in the History list. */
export interface BriefingListItem {
  id: number
  createdAt: string
  trigger: BriefingTrigger
  /** Estimated cost in US dollars of the Claude requests behind it; null when it cost nothing or the price isn't known. */
  estimatedCost: number | null
}

/**
 * How much of a week is known. 'live' is the current week, rebuilt each time it's shown. 'saved'
 * weeks were saved after they ended and never change. 'partial' weeks only know what was completed
 * and added: weeks before the weekly review started, and weeks the app wasn't opened after.
 */
export type WeekRecord = 'live' | 'saved' | 'partial'

/** One line in a weekly review. Titles and details are kept as they were, so saved weeks read the same later. */
export interface WeeklyItem {
  taskId: number
  title: string
  project: string | null
  projectColor: string | null
  /** The line under the title: the project, where a new task came from, its due date, or who it's waiting on. */
  detail: string
  /** When it was completed or added (ISO), for the day shown on the right. */
  at: string | null
  /** Slipping: days past due (at the end of a saved week). */
  overdueDays: number | null
  /** Slipping: net days the due date was pushed later during the week (missing in weeks saved before the event log). */
  pushedDays?: number | null
  /** Waiting on: days waited so far, when known. */
  days: number | null
}

/** The four lists. Slipping and waiting are null when not recorded (partial weeks). */
export interface WeeklyLists {
  completed: WeeklyItem[]
  added: WeeklyItem[]
  slipping: WeeklyItem[] | null
  waiting: WeeklyItem[] | null
}

/** The AI's short look back at a week, for Frank only. Written only when he clicks. */
export interface WeeklyReflection {
  summary: string
  wentWell: string[]
  slipped: string[]
  focusNext: string[]
  writtenAt: string
  /** The AI that wrote it, e.g. "Claude Opus 5.5" or "Basic". */
  writtenBy: string
}

export interface WeeklyReview {
  /** The week's Sunday, 'YYYY-MM-DD'. */
  weekStart: string
  record: WeekRecord
  /** When an ended week was saved. Null for the live week and for weeks before the weekly review started. */
  savedAt: string | null
  lists: WeeklyLists
  reflection: WeeklyReflection | null
  /** Live week only: tasks completed and added since the reflection was written. */
  changedSince: { completed: number; added: number } | null
}

/** A week in the list on the left of the Weekly tab. */
export interface WeekListItem {
  weekStart: string
  record: WeekRecord
  completed: number
  added: number
  hasReflection: boolean
}

/** What a paid AI request was for. */
/** project_brief is kept for spending recorded before project briefs were replaced by the status card. */
export type UsagePurpose = 'import' | 'briefing' | 'weekly' | 'person_brief' | 'project_brief' | 'status' | 'reply'

export const USAGE_PURPOSE_LABELS: Record<UsagePurpose, string> = {
  import: 'Imports',
  briefing: 'Daily briefings',
  weekly: 'Weekly reflections',
  person_brief: 'Person briefs',
  project_brief: 'Project briefs',
  status: 'Where this stands',
  reply: 'Draft replies',
}

/** Claude requests added up by purpose or by model. */
export interface UsageGroup {
  /** A UsagePurpose, or a model id. */
  key: string
  requests: number
  inputTokens: number
  outputTokens: number
  /** Estimated US dollars, at the list prices in pricing.ts. */
  cost: number
  /** Requests to a model with no known price, left out of `cost`. */
  unpriced: number
}

export interface UsagePeriod {
  /** Start of the period (ISO). */
  from: string
  total: UsageGroup
  byPurpose: UsageGroup[]
  byModel: UsageGroup[]
}

/** The AI spending screen: estimated Claude costs this calendar month and over the last 30 days. */
export interface AiSpending {
  month: UsagePeriod
  last30: UsagePeriod
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

/** One email conversation found in Outlook (only the messages not read before). */
export interface MailConversation {
  key: string
  subject: string
  /** The other people in it, e.g. "Dana Lee, Marcus Webb". */
  people: string
  messageCount: number
  lastAt: string
  /** Why it won't be read unless chosen with "Read anyway"; null when it will be read. */
  skipReason: string | null
}

/** What "Check Outlook" found. Nothing has been sent to the AI yet. */
export interface MailCheck {
  id: number
  since: string
  checkedAt: string
  received: number
  sent: number
  /** Messages found that an earlier import already read, so they're left out. */
  alreadyRead: number
  conversations: MailConversation[]
}

export interface MailJobStatus {
  state: 'idle' | 'reading' | 'done' | 'stopped'
  done: number
  total: number
  suggestions: number
  failed: number
  /** Estimated cost in US dollars of the conversations read so far; null while none has cost anything. */
  estimatedCost: number | null
  /** Subject of the conversation being read. */
  current: string | null
}

/** One "Read" of Outlook mail, shown as one row in Recent imports. */
export interface MailImportRun {
  id: number
  since: string
  startedAt: string
  finishedAt: string | null
  provider: string | null
  /** False when stopped early; the rest is offered again next time. */
  complete: boolean
  conversations: SourceItem[]
}

/** The mail app the app reads: classic Outlook on Windows, Apple Mail on the Mac. */
export type MailApp = 'outlook' | 'apple-mail'

/** An account in Apple Mail, for picking which ones to read (Settings). */
export interface MailAccount {
  id: string
  name: string
  /** Mail's account type: "imap", "iCloud", "pop", or "unknown" (Exchange). */
  type: string
  enabled: boolean
  addresses: string[]
}

export interface MailInfo {
  /** False when this computer has no mail app to read (Windows without classic Outlook is only found out on Check). */
  supported: boolean
  app: MailApp | null
  /** Apple Mail: no account is chosen in Settings yet, so there's nothing to read. */
  needsAccounts: boolean
  /** Where the next check starts by default: the last finished import, or 7 days ago. */
  defaultSince: string
  lastImportAt: string | null
}

/** Project colors (tasks are themed with their project's color). */
export const PROJECT_COLORS = ['#7F77DD', '#1D9E75', '#D85A30', '#D4537E', '#378ADD', '#639922', '#BA7517', '#E24B4A']
export const NO_PROJECT_COLOR = '#B4B2A9'

/** The score lists sort by: a score set by hand, else the computed score plus any AI adjustment (0 to 100). */
export const effectivePriority = (t: Pick<Task, 'priorityScore' | 'priorityOverride'> & { aiAdjustment?: Pick<PriorityAdjustment, 'delta'> | null }): number =>
  t.priorityOverride ?? Math.min(100, Math.max(0, t.priorityScore + (t.aiAdjustment?.delta ?? 0)))

export const isActive = (s: TaskStatus): boolean => ACTIVE_STATUSES.includes(s)

export const initials = (name: string): string =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
