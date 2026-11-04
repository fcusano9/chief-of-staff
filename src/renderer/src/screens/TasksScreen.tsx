import { useEffect, useRef, useState } from 'react'
import type { Task, TaskFilter } from '@shared/types'
import { cos, errorMessage } from '../api'
import { DoneRow, SearchBox, TaskRow } from '../components/bits'
import { SplitView } from '../components/SplitView'
import { TaskEditor } from '../components/TaskEditor'
import { useApp } from '../context'

type ProjectFilter = 'all' | 'none' | number
type Mode = 'open' | 'done'

const isTyping = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')

/**
 * Task list on the left, the selected task on the right, with a resizable divider. The Waiting tab
 * is the same screen showing only waiting-on items. Open / Done switches to finished ones.
 */
export function TasksScreen({ list = 'tasks' }: { list?: 'tasks' | 'waiting' }) {
  const { selection, openTask, projects, version, refresh, toast } = useApp()
  const waiting = list === 'waiting'
  const [tasks, setTasks] = useState<Task[]>([])
  const [filter, setFilter] = useState<ProjectFilter>('all')
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState<Mode>('open')
  const [cursor, setCursor] = useState(0)
  const rightRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const f: TaskFilter = { search, list }
    if (filter === 'none') f.noProjectOnly = true
    else if (filter !== 'all') f.projectId = filter
    void cos[mode === 'done' ? 'tasks.listDone' : 'tasks.listActive'](f).then(setTasks)
  }, [version, filter, search, mode, list])

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
          New {noun} <span className="kbd">N</span>
        </button>
      </div>
      <div className="row" style={{ gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <button className={`pill ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>
          All
        </button>
        {projects.map((p) => (
          <button key={p.id} className={`pill ${filter === p.id ? 'on' : ''}`} onClick={() => setFilter(p.id)}>
            <span className="dot" style={{ background: p.color }} />
            {p.name}
          </button>
        ))}
        <button className={`pill ${filter === 'none' ? 'on' : ''}`} onClick={() => setFilter('none')}>
          No project
        </button>
      </div>
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
      <div className="list">
        {tasks.map((t, i) =>
          mode === 'done' ? (
            <DoneRow key={t.id} task={t} selected={t.id === selectedId} current={i === cursor && t.id !== selectedId} onClick={() => openTask({ id: t.id })} />
          ) : (
            <TaskRow key={t.id} task={t} selected={t.id === selectedId} current={i === cursor && t.id !== selectedId} onClick={() => openTask({ id: t.id })} />
          ),
        )}
        {tasks.length === 0 && (
          <div className="empty">
            {search ? `Nothing matches “${search}”.`
            : filter !== 'all' ? `No ${mode === 'done' ? 'finished ' : ''}${noun}s in this filter.`
            : mode === 'done' ? `Nothing finished yet. Done ${noun}s show up here, newest first.`
            : waiting ? 'Nothing is waiting on anyone right now.'
            : 'No open tasks. Press N to add one.'}
          </div>
        )}
      </div>
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
        <div style={{ color: 'var(--text)', fontWeight: 500, marginTop: 6 }}>Select {waiting ? 'an item' : 'a task'} to see it here</div>
        <div style={{ marginTop: 4 }}>
          Use <span className="kbd">↑</span> <span className="kbd">↓</span> to move through the list, or <span className="kbd">N</span> for a new {noun}.
        </div>
      </div>
    </div>
  )

  return <SplitView left={left} right={right} rightRef={rightRef} />
}
