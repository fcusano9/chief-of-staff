import { createContext, useContext } from 'react'
import type { AiStatus, AppInfo, AppSettings, PersonSummary, ProjectSummary } from '@shared/types'

export type View = 'today' | 'tasks' | 'review' | 'waiting' | 'projects' | 'people' | 'prep' | 'weekly' | 'archive' | 'import' | 'settings' | 'ailog' | 'aispending'

/** Which task the Tasks screen shows on the right: an id, a new task (with optional defaults), or none. */
/** `waiting` picks the tab: Waiting for waiting-on items. Left out, Tasks and Waiting keep their own tab. */
export type TaskSelection = { id: number; waiting?: boolean } | { id: 'new'; projectId?: number | null; waiting?: boolean } | null

export interface AppContextValue {
  view: View
  go: (view: View) => void
  selection: TaskSelection
  openTask: (selection: TaskSelection) => void
  /** Bumped after any change so screens reload their data. */
  version: number
  refresh: () => void
  toast: (message: string, isError?: boolean) => void
  settings: AppSettings
  /** Saves a partial change merged onto the latest settings. */
  saveSettings: (patch: Partial<AppSettings>) => Promise<void>
  info: AppInfo
  projects: ProjectSummary[]
  people: PersonSummary[]
  dark: boolean
  toggleTheme: () => void
  ai: AiStatus
  setAi: (status: AiStatus) => void
  /** Suggestions waiting in the review queue. */
  reviewCount: number
  /** Opens the AI log (what was sent to the AI and what came back) for one import. */
  openAiLog: (sourceId: number, from: View) => void
  /** The import the AI log shows, and the screen to go back to. */
  aiLog: { sourceId: number; from: View } | null
  /** Registers (or with null, removes) shortcut hints for the bottom bar; see useShortcutHints. */
  setHints: (id: string, set: { level: number; hints: [string, string][] } | null) => void
}

export const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside <App>')
  return ctx
}
