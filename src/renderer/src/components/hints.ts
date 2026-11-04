import { useEffect, useId } from 'react'
import { useApp } from '../context'

/** A shortcut shown in the bottom bar: keys (space-separated) and what they do, e.g. ['Ctrl ↵', 'save']. */
export type Hint = [keys: string, label: string]

/** Shown before every page's own keys. */
export const ALWAYS_HINTS: Hint[] = [
  ['Ctrl K', 'commands'],
  ['G', 'go to'],
]
/** For screens that register nothing. */
export const DEFAULT_HINTS: Hint[] = [['N', 'new task']]

/**
 * Shows these keys in the bottom bar while the component is mounted. Pages use level 0; an
 * editor that is open passes level 1 (and the History window 2), and the highest level wins.
 * Pass null to show nothing from this component.
 */
export function useShortcutHints(hints: Hint[] | null, level = 0) {
  const { setHints } = useApp()
  const id = useId()
  const key = hints ? JSON.stringify(hints) : ''
  useEffect(() => {
    setHints(id, hints ? { level, hints } : null)
    return () => setHints(id, null)
    // `key` stands in for `hints`, which is a new array on every render.
  }, [id, key, level, setHints])
}
