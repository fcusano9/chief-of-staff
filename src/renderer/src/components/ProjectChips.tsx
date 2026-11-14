import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Project, Task } from '@shared/types'
import { useApp } from '../context'

export type ProjectFilter = 'all' | 'none' | number

interface Chip {
  project: Project
  count: number
}

/**
 * The project filter above a task list: one line, with All pinned on the left and a chip for each
 * project that has items in the list, busiest first, then No project. The chips scroll sideways
 * (wheel, trackpad, or the arrows that show on a side with more), and the selected chip is kept in view.
 */
export function ProjectChips({ tasks, value, onChange }: { tasks: Task[]; value: ProjectFilter; onChange: (f: ProjectFilter) => void }) {
  const { projects } = useApp()
  const trackRef = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState({ left: false, right: false })

  const byId = new Map<number, Chip>()
  for (const t of tasks) {
    if (!t.project) continue
    const c = byId.get(t.project.id)
    if (c) c.count++
    else byId.set(t.project.id, { project: t.project, count: 1 })
  }
  const chips = [...byId.values()].sort((a, b) => b.count - a.count || a.project.name.localeCompare(b.project.name))
  // A selected project with nothing in the list (after a search, say) keeps its chip, so the filter stays visible.
  if (typeof value === 'number' && !byId.has(value)) {
    const p = projects.find((x) => x.id === value)
    if (p) chips.push({ project: p, count: 0 })
  }
  const noProject = tasks.filter((t) => !t.project).length

  const sync = () => {
    const t = trackRef.current
    if (!t) return
    const left = t.scrollLeft > 1
    const right = t.scrollLeft + t.clientWidth < t.scrollWidth - 1
    setMore((m) => (m.left === left && m.right === right ? m : { left, right }))
  }

  // A plain mouse wheel scrolls the row sideways.
  useEffect(() => {
    const t = trackRef.current
    if (!t) return
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || t.scrollWidth <= t.clientWidth) return
      e.preventDefault()
      t.scrollLeft += e.deltaY
    }
    t.addEventListener('wheel', onWheel, { passive: false })
    const ro = new ResizeObserver(sync)
    ro.observe(t)
    return () => {
      t.removeEventListener('wheel', onWheel)
      ro.disconnect()
    }
  }, [])

  // Keep the selected chip in view when the filter changes.
  useLayoutEffect(() => {
    const t = trackRef.current
    const on = t?.querySelector<HTMLElement>('.pill.on')
    if (t && on && (on.offsetLeft < t.scrollLeft || on.offsetLeft + on.offsetWidth > t.scrollLeft + t.clientWidth)) {
      t.scrollLeft = on.offsetLeft - 40
    }
  }, [value])
  // Refresh the arrows whenever the chips change.
  useLayoutEffect(sync)

  const page = (dir: 1 | -1) => trackRef.current?.scrollBy({ left: dir * trackRef.current.clientWidth * 0.7, behavior: 'smooth' })

  return (
    <div className="chip-row" data-project-chips>
      <button className={`pill ${value === 'all' ? 'on' : ''}`} onClick={() => onChange('all')}>
        All <span className="n">{tasks.length}</span>
      </button>
      <span className="chip-sep" />
      <div className="chip-scroller">
        <div className="chip-track" ref={trackRef} onScroll={sync}>
          {chips.map(({ project, count }) => (
            <button key={project.id} className={`pill ${value === project.id ? 'on' : ''}`} onClick={() => onChange(project.id)}>
              <span className="dot" style={{ background: project.color }} />
              {project.name} <span className="n">{count}</span>
            </button>
          ))}
          {(noProject > 0 || value === 'none') && (
            <button className={`pill ${value === 'none' ? 'on' : ''}`} onClick={() => onChange('none')}>
              No project <span className="n">{noProject}</span>
            </button>
          )}
        </div>
        <div className={`chip-fade l ${more.left ? 'on' : ''}`}>
          <button className="chip-arrow" aria-label="Scroll projects left" tabIndex={-1} onClick={() => page(-1)}>
            ‹
          </button>
        </div>
        <div className={`chip-fade r ${more.right ? 'on' : ''}`}>
          <button className="chip-arrow" aria-label="Scroll projects right" tabIndex={-1} onClick={() => page(1)}>
            ›
          </button>
        </div>
      </div>
    </div>
  )
}
