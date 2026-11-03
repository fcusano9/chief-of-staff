import { useCallback, useEffect, useRef } from 'react'
import { errorMessage } from '../api'
import { useApp } from '../context'

/**
 * Saves a Projects or People form's pending edits when you move away from it, the way the task
 * editor does: pick another item in the list, start a new one, or switch tabs.
 *
 * Call `markClean(draft)` whenever a draft is loaded or saved; that's the state with nothing to
 * save. Call `flush()` before switching to another item; leaving the screen flushes on its own.
 */
export function useAutosave<T extends { id: number; name: string }>(draft: T | null, persist: (d: T) => Promise<unknown>) {
  const { toast, refresh } = useApp()
  const clean = useRef('null')
  const latest = useRef({ draft, persist, toast, refresh })
  latest.current = { draft, persist, toast, refresh }

  const markClean = useCallback((d: T | null) => {
    clean.current = JSON.stringify(d)
  }, [])

  const flush = useCallback(() => {
    const { draft: d, persist: save, toast: say, refresh: reload } = latest.current
    if (!d || JSON.stringify(d) === clean.current) return
    clean.current = JSON.stringify(d) // so a second flush (switch, then unmount) doesn't save twice
    if (!d.name.trim()) {
      if (d.id) say('Name was empty, so those edits were not saved', true)
      return
    }
    save(d)
      .then(() => {
        say(`Saved changes to “${d.name.trim()}”`)
        reload()
      })
      .catch((err) => say(errorMessage(err), true))
  }, [])

  // Leaving the screen (another tab) saves too.
  useEffect(() => () => flush(), [flush])

  return { markClean, flush }
}
