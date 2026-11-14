import { useEffect, useMemo, useRef, useState } from 'react'
import type { Task, TaskFilter } from '@shared/types'
import { daysUntil, needsFollowUp } from '@shared/priority'
import { addDays, weekStartOf } from '@shared/week'
import { cos, errorMessage } from '../api'
import { DoneRow, SearchBox, TaskRow } from '../components/bits'
import { type ProjectFilter, ProjectChips } from '../components/ProjectChips'
import { SplitView } from '../components/SplitView'
import { TaskEditor } from '../components/TaskEditor'
import { type Hint, useShortcutHints } from '../components/hints'
import { useApp } from '../context'

type Mode = 'open' | 'done'
interface Section {
  name: string
  alert?: boolean
  tasks: Task[]
}

const isTyping = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')

/**
 * Open lists are grouped, each group keeping the list's order: Tasks into Overdue, This week (due by
 * Saturday) and Later (everything else, undated too); Waiting into Follow up and Waiting.
 * Done lists aren't grouped.
 */
function sections(tasks: Task[], waiting: boolean, mode: Mode, now = new Date()): Section[] {
  if (mode === 'done') return [{ name: '', tasks }]
  if (waiting) {
    return [
      { name: 'Follow up', alert: true, tasks: tasks.filter((t) => needsFollowUp(t, now)) },
      { name: 'Waiting', tasks: tasks.filter((t) => !needsFollowUp(t, now)) },
    ]
  }
  const nextSunday = addDays(weekStartOf(now), 7)
  const overdue = (t: Task) => t.dueDate != null && daysUntil(t.dueDate, now) < 0
  const thisWeek = (t: Task) => t.dueDate != null && !overdue(t) && t.dueDate < nextSunday
  return [
    { name: 'Overdue', alert: true, tasks: tasks.filter(overdue) },
    { name: 'This week', tasks: tasks.filter(thisWeek) },
    { name: 'Later', tasks: tasks.filter((t) => !overdue(t) && !thisWeek(t)) },
  ]
}

/**
 * Task list on the left, the selected task on the right, with a resizable divider. The Waiting tab
 * is the same screen showing only waiting-on items. Open / Done switches to finished ones. The
 * project chips filter the list here, so they can count every project's items.
 */
export function TasksScreen({ list = 'tasks' }: { list?: 'tasks' | 'waiting' }) {
  const { selection, openTask, version, refresh, toast } = useApp()
  const waiting = list === 'waiting'
  const [all, setAll] = useState<Task[]>([])
  const [filter, setFilter] = useState<ProjectFilter>('all')
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState<Mode>('open')
  const [cursor, setCursor] = useState(0)
  const rightRef = useRef<HTMLElement>(null)
  const done: Hint[] = mode === 'open' ? [['E', 'done']] : []
  useShortcutHints([['↑ ↓', 'move'], ['↵', 'open'], ...done, ['N', 'new'], ['/', 'search']])
  useShortcutHints(selection ? [['Ctrl ↵', 'save'], ...(selection.id === 'new' ? [] : done), ['Esc', 'close']] : null, 1)

  useEffect(() => {
    const f: TaskFilter = { search, list }
    void cos[mode === 'done' ? 'tasks.listDone' : 'tasks.listActive'](f).then(setAll)
  }, [version, search, mode, list])

  const { groups, tasks } = useMemo(() => {
    const filtered = all.filter((t) => filter === 'all' || (filter === 'none' ? t.projectId == null : t.projectId === filter))
    const groups = sections(filtered, waiting, mode).filter((g) => g.tasks.length > 0)
    // The list in the order it's shown, for the keyboard.
    return { groups, tasks: groups.flatMap((g) => g.tasks) }
  }, [all, filter, waiting, mode])

  const selectedId = selection?.id ?? null
  useEffect(() => {
    const i = tasks.findIndex((t) => t.id === selectedId)
    if (i >= 0) setCursor(i)
  }, [selectedId, tasks])
  useEffect(() => {
    document.querySelector(`.pane.left .r[data-id="${tasks[cursor]?.id}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor, tasks])
  useEffect(() => {
    rightRef.current?.scrollTo({ top: 0 })
  }, [selectedId])

  /** After a task leaves the list (done, deleted), select the one that took its place. */
  const selectNeighbor = (id: number) => {
    const i = tasks.findIndex((t) => t.id === id)
    const next = tasks[i + 1] ?? tasks[i - 1]
    openTask(next ? { id: next.id } : null)
    refresh()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.scrim')) return
      if (e.key === 'Escape') {
        if (isTyping()) (document.activeElement as HTMLElement).blur()
        else if (selection) openTask(null)
        return
      }
      if (isTyping() || e.ctrlKey || e.metaKey || e.altKey) return
      const current = tasks[cursor]
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!tasks.length) return
        e.preventDefault()
        const down = e.key === 'ArrowDown'
        const next = Math.max(0, Math.min(tasks.length - 1, cursor + (down ? 1 : -1)))
        setCursor(next)
        openTask({ id: tasks[next]!.id })
      } else if (e.key === 'Enter' && current) {
        e.preventDefault()
        if (selectedId !== current.id) openTask({ id: current.id })
        else rightRef.current?.querySelector<HTMLInputElement>('.title-inp')?.focus()
      } else if (e.key === 'e' && current && mode === 'open') {
        // The open task goes through its editor so pending edits are saved together with "done".
        const doneButton = selectedId === current.id ? rightRef.current?.querySelector<HTMLButtonElement>('[data-action="done"]') : null
        if (doneButton) return doneButton.click()
        cos['tasks.setStatus'](current.id, 'done')
          .then(() => {
            toast(`Done: ${current.title}`)
            selectNeighbor(current.id)
          })
          .catch((err) => toast(errorMessage(err), true))
      } else if (e.key === '/') {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('#list-search')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tasks, cursor, selection, selectedId, mode])

  const noun = waiting ? 'waiting item' : 'task'
  const subtitle = mode === 'done' ? `${tasks.length} done · newest first` : waiting ? `${tasks.length} waiting · longest first` : `${tasks.length} open · by priority`

  const left = (
    <>
      <div className="head">
        <h1>{waiting ? 'Waiting on' : 'Tasks'}</h1>
        <span className="muted">{subtitle}</span>
        <div className="spacer" />
        <button className="btn primary" onClick={() => openTask({ id: 'new', projectId: typeof filter === 'number' ? filter : null, waiting })}>
          New {noun}
        </button>
      </div>
      <ProjectChips tasks={all} value={filter} onChange={(f) => (setFilter(f), setCursor(0))} />
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Open or done">
          {(['open', 'done'] as Mode[]).map((m) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => (setMode(m), setCursor(0))}>
              {m === 'open' ? 'Open' : 'Done'}
            </button>
          ))}
        </div>
        <SearchBox value={search} onChange={setSearch} placeholder={waiting ? 'Search waiting items or people' : 'Search tasks'} />
      </div>
      {groups.map((g) => (
        <section key={g.name} data-section={g.name || undefined}>
          {g.name && (
            <div className={`sec ${g.alert ? 'alert' : ''}`}>
              {g.name}
              <span className="n">{g.tasks.length}</span>
            </div>
          )}
          <div className={`list ${mode === 'open' ? 'tips' : ''}`}>
            {g.tasks.map((t) => {
              const i = tasks.indexOf(t)
              const current = i === cursor && t.id !== selectedId
              return mode === 'done' ? (
                <DoneRow key={t.id} task={t} selected={t.id === selectedId} current={current} onClick={() => openTask({ id: t.id })} />
              ) : (
                <TaskRow key={t.id} task={t} list selected={t.id === selectedId} current={current} onClick={() => openTask({ id: t.id })} />
              )
            })}
          </div>
        </section>
      ))}
      {tasks.length === 0 && (
        <div className="list">
          <div className="empty">
            {search ? `Nothing matches “${search}”.`
            : filter !== 'all' ? `No ${mode === 'done' ? 'finished ' : ''}${noun}s in this filter.`
            : mode === 'done' ? `Nothing finished yet. Done ${noun}s show up here, newest first.`
            : waiting ? 'Nothing is waiting on anyone right now.'
            : 'No open tasks. Press N to add one.'}
          </div>
        </div>
      )}
    </>
  )

  const right = selection ? (
    <TaskEditor
      key={String(selection.id)}
      taskId={selection.id}
      defaultProjectId={selection.id === 'new' ? selection.projectId : null}
      defaultWaiting={selection.id === 'new' ? !!selection.waiting : false}
      onClose={() => openTask(null)}
      onSaved={(t) => {
        openTask({ id: t.id })
        refresh()
      }}
      onDone={(t) => {
        toast(`Done: ${t.title}`)
        selectNeighbor(t.id)
      }}
      onDeleted={(id) => {
        toast('Task deleted')
        selectNeighbor(id)
      }}
    />
  ) : (
    <div style={{ height: '100%', display: 'grid', placeItems: 'center', textAlign: 'center', color: 'var(--muted)', padding: 24 }}>
      <div>
        <div style={{ fontSize: 28, color: 'var(--faint)' }}>☰</div>
        <div style={{ color: 'var(--text)', fontWeight: 500, marginTop: 6 }}>No {waiting ? 'item' : 'task'} selected</div>
      </div>
    </div>
  )

  return <SplitView left={left} right={right} rightRef={rightRef} />
}
