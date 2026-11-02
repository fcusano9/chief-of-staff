import { createContext, useContext } from 'react'
import type { AppInfo, AppSettings, PersonSummary, ProjectSummary } from '@shared/types'

export type View = 'today' | 'tasks' | 'review' | 'waiting' | 'projects' | 'people' | 'prep' | 'weekly' | 'archive' | 'import' | 'settings'

/** Which task the Tasks screen shows on the right: an id, a new task (with optional defaults), or none. */
export type TaskSelection = { id: number } | { id: 'new'; projectId?: number | null } | null

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
}

export const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside <App>')
  return ctx
}
