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
}

export interface ProjectSummary extends Project {
  openCount: number
}

export interface Person {
  id: number
  name: string
  role: string | null
  email: string | null
  /** 1 (low) to 5 (highest). Requests from higher-weight people rank higher. */
  priorityWeight: number
}

export interface PersonSummary extends Person {
  openCount: number
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
  project: Project | null
  requester: Person | null
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

export interface AppSettings {
  priorityWeights: PriorityWeights
  theme: ThemeSetting
  /** Left pane width of split views, as a percentage. */
  splitPercent: number
  dailyBriefingTime: string
  /** Null means the default OneDrive backup folder. */
  backupFolder: string | null
  backupsToKeep: number
  lastBackupAt: string | null
}

export const DEFAULT_SETTINGS: AppSettings = {
  priorityWeights: { dueDate: 8, requester: 7, staleness: 5 },
  theme: 'system',
  splitPercent: 50,
  dailyBriefingTime: '07:30',
  backupFolder: null,
  backupsToKeep: 30,
  lastBackupAt: null,
}

export interface AppInfo {
  version: string
  databasePath: string
  defaultBackupFolder: string
  platform: string
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
