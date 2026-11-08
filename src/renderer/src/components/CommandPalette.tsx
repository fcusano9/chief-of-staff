import { useEffect, useMemo, useRef, useState } from 'react'
import { DENSITIES, type Task } from '@shared/types'
import { cos } from '../api'
import { useApp, type View } from '../context'
import { startReflection } from '../screens/WeeklyScreen'
import { startBriefing } from './Briefing'

interface Command {
  group: string
  label: string
  keys?: string
  run: () => void
}

/** The top bar's main tabs, in groups split by a thin divider: the day's screens, then the reference lists. */
export const MAIN_TABS: [View, string][][] = [
  [
    ['today', 'Today'],
    ['tasks', 'Tasks'],
    ['waiting', 'Waiting'],
    ['weekly', 'Weekly'],
  ],
  [
    ['projects', 'Projects'],
    ['people', 'People'],
  ],
]
/** The daily intake group on the right of the top bar. Review shows only while it has items (or is open). */
export const DAILY_TABS: [View, string][] = [
  ['import', 'Import'],
  ['review', 'Review'],
]
/** Every tab, left to right: the order ← and → step through. Prep and Archive stay hidden until they're built. */
export const TABS: [View, string][] = [...MAIN_TABS.flat(), ...DAILY_TABS]

/** Ctrl+K: jump to any screen, task, project, or person, or run an action. */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { go, openTask, projects, people, toggleTheme, toast, saveSettings } = useApp()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [tasks, setTasks] = useState<Task[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    void cos['tasks.listActive']().then(setTasks)
  }, [])

  const commands = useMemo<Command[]>(() => {
    const all: Command[] = [
      ...TABS.map(([v, l]) => ({ group: 'Go to', label: l, run: () => go(v) })),
      { group: 'Go to', label: 'Settings', run: () => go('settings') },
      { group: 'Actions', label: 'New task', keys: 'N', run: () => openTask({ id: 'new' }) },
      {
        group: 'Actions',
        label: 'Write briefing',
        run: () => {
          go('today')
          startBriefing()
        },
      },
      {
        group: 'Actions',
        label: 'Write weekly reflection',
        run: () => {
          go('weekly')
          startReflection()
        },
      },
      { group: 'Actions', label: 'New project', run: () => go('projects') },
      { group: 'Actions', label: 'Add person', run: () => go('people') },
      { group: 'Actions', label: 'Toggle light / dark', run: toggleTheme },
      ...DENSITIES.map((d) => ({ group: 'Actions', label: `Density: ${d.label}`, run: () => void saveSettings({ density: d.id }) })),
      { group: 'Actions', label: 'Back up now', run: () => void cos['backup.now']().then((p) => toast(`Backed up to ${p}`)) },
      ...tasks.map((t) => ({ group: 'Tasks', label: t.title, run: () => openTask({ id: t.id, waiting: t.status === 'waiting_on' }) })),
      ...projects.map((p) => ({ group: 'Projects', label: p.name, run: () => go('projects') })),
      ...people.map((p) => ({ group: 'People', label: p.name, run: () => go('people') })),
    ]
    const q = query.trim().toLowerCase()
    return (q ? all.filter((c) => c.label.toLowerCase().includes(q)) : all).slice(0, 40)
  }, [query, tasks, projects, people])

  useEffect(() => setCursor(0), [query])
  useEffect(() => {
    document.querySelector('.palette .pi.cur')?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const run = (c: Command | undefined) => {
    if (!c) return
    onClose()
    c.run()
  }

  let lastGroup = ''
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <input
          ref={inputRef}
          value={query}
          placeholder="Type a command, task, project, or person…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Keys the palette handles stop here, so the screen underneath never sees them
            // (an Enter that runs a command would otherwise also focus the open task's title).
            if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(e.key)) e.stopPropagation()
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setCursor((c) => Math.min(c + 1, commands.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setCursor((c) => Math.max(c - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              run(commands[cursor])
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
        />
        <div style={{ maxHeight: 380, overflow: 'auto', paddingBottom: 6 }}>
          {commands.map((c, i) => {
            const header = c.group !== lastGroup ? <div className="pg">{(lastGroup = c.group)}</div> : null
            return (
              <div key={`${c.group}-${c.label}-${i}`}>
                {header}
                <div className={`pi ${i === cursor ? 'cur' : ''}`} onMouseEnter={() => setCursor(i)} onClick={() => run(c)}>
                  <span className="ttl" style={{ flex: 1 }}>{c.label}</span>
                  {c.keys && <span className="kbd">{c.keys}</span>}
                </div>
              </div>
            )
          })}
          {commands.length === 0 && <div className="pi faint">No matches</div>}
        </div>
      </div>
    </div>
  )
}
