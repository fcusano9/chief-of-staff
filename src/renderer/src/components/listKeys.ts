import { useEffect } from 'react'

const isTyping = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')

/**
 * Keys for a list with details (Projects, People), as on Tasks: "/" jumps to the search box,
 * Up and Down move through the shown list and open each item, Enter puts the cursor in its name.
 */
export function useListKeys(ids: number[], selected: number | 'new' | null, select: (id: number) => void) {
  // Re-registered every render so `select` saves the current edits, not stale ones.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.scrim') || isTyping() || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === '/') {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('#list-search')?.focus()
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!ids.length) return
        e.preventDefault()
        const down = e.key === 'ArrowDown'
        const i = typeof selected === 'number' ? ids.indexOf(selected) : -1
        const next = i < 0 ? (down ? 0 : ids.length - 1) : Math.max(0, Math.min(ids.length - 1, i + (down ? 1 : -1)))
        if (ids[next] === selected) return
        select(ids[next]!)
        requestAnimationFrame(() => document.querySelector('.pane.left .r.sel')?.scrollIntoView({ block: 'nearest' }))
      } else if (e.key === 'Enter' && typeof selected === 'number') {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('.pane.right .title-inp')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
}
