import { useEffect, useRef, useState } from 'react'
import type { BriefSuggestion, ProjectStatus, ProjectSummary, Task } from '@shared/types'
import { PROJECT_COLORS } from '@shared/types'
import { cos, errorMessage } from '../api'
import { ConfirmButton, SearchBox, TaskRow } from '../components/bits'
import { HistoryWindow } from '../components/HistoryWindow'
import { SplitView } from '../components/SplitView'
import { useApp } from '../context'

const STATUSES: [ProjectStatus, string][] = [
  ['active', 'Active'],
  ['on_hold', 'On hold'],
  ['completed', 'Completed'],
  ['archived', 'Archived (hidden)'],
]

interface Draft {
  id: number
  name: string
  color: string
  status: ProjectStatus
  standingInstructions: string
}

const dayLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

export function ProjectsScreen() {
  const { projects, openTask, refresh, toast, version } = useApp()
  const [selected, setSelected] = useState<number | 'new' | null>(projects[0]?.id ?? null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [history, setHistory] = useState('')
  const [tasks, setTasks] = useState<Task[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [search, setSearch] = useState('')
  // The project the draft was loaded for, so a refresh (e.g. after keeping a brief) keeps unsaved edits.
  const loadedFor = useRef<number | null>(null)

  useEffect(() => {
    if (selected === null) {
      loadedFor.current = null
      return setDraft(null)
    }
    if (selected === 'new') {
      loadedFor.current = null
      setTasks([])
      setHistory('')
      return setDraft({ id: 0, name: '', color: PROJECT_COLORS[projects.length % PROJECT_COLORS.length]!, status: 'active', standingInstructions: '' })
    }
    const p = projects.find((x) => x.id === selected)
    if (!p) return setDraft(null) // just created: wait for the refreshed list
    void cos['tasks.listActive']({ projectId: p.id }).then(setTasks)
    const first = loadedFor.current !== p.id
    loadedFor.current = p.id
    void cos['briefs.get']('project', p.id).then((b) => {
      setHistory(b.summary)
      if (first) setDraft({ id: p.id, name: p.name, color: p.color, status: p.status, standingInstructions: b.standingInstructions })
    })
  }, [selected, projects, version])

  const select = (id: number | 'new' | null) => {
    setShowHistory(false)
    setSelected(id)
  }

  const save = async () => {
    if (!draft) return
    try {
      const saved = await cos['projects.save']({ id: draft.id, name: draft.name, color: draft.color, status: draft.status })
      // Read the history fresh, so notes added from Review or the History window aren't overwritten.
      const current = await cos['briefs.get']('project', saved.id)
      await cos['briefs.save']({ ...current, standingInstructions: draft.standingInstructions })
      toast('Project saved')
      if (saved.status === 'archived') select(null)
      else if (draft.id === 0) select(saved.id)
      refresh()
    } catch (err) {
      toast(errorMessage(err), true)
    }
  }

  const project = draft && draft.id !== 0 ? projects.find((p) => p.id === draft.id) : undefined
  const q = search.trim().toLowerCase()
  const shown = q ? projects.filter((p) => [p.name, p.overview].some((f) => f?.toLowerCase().includes(q))) : projects

  // "/" jumps to the search box, as on Tasks.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || document.querySelector('.scrim') || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')) return
      e.preventDefault()
      document.querySelector<HTMLInputElement>('#list-search')?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const noteCount = history.split('\n').filter((l) => l.trim()).length

  const left = (
    <>
      <div className="head">
        <h1>Projects</h1>
        <span className="muted">{projects.length}</span>
        <div className="spacer" />
        <button className="btn primary" onClick={() => select('new')}>
          New project
        </button>
      </div>
      {projects.length > 0 && (
        <div className="toolbar">
          <SearchBox value={search} onChange={setSearch} placeholder="Search projects" />
        </div>
      )}
      <div className="list">
        {shown.map((p) => (
          <div key={p.id} className={`r ${selected === p.id ? 'sel' : ''}`} style={{ gridTemplateColumns: '3px minmax(0, 1fr) auto auto' }} onClick={() => select(p.id)}>
            <div className="stripe" style={{ background: p.color }} />
            <div className="ttl">
              {p.name}
              {p.overview && (
                <div className="faint ttl" style={{ fontSize: 11 }}>
                  {p.overview}
                </div>
              )}
            </div>
            <span className="faint" style={{ fontSize: 12 }}>{p.status === 'active' ? '' : STATUSES.find(([s]) => s === p.status)?.[1]}</span>
            <span className="mono muted" title="Open tasks">{p.openCount}</span>
          </div>
        ))}
        {projects.length === 0 && <div className="empty">No projects yet. Tasks don't need one, but projects keep shared context for the AI.</div>}
        {projects.length > 0 && shown.length === 0 && <div className="empty">Nothing matches “{search}”.</div>}
      </div>
    </>
  )

  const right = draft ? (
    <div>
      <div className="editor-stripe" style={{ background: draft.color }} />
      <div className="editor">
        <input className="inp title-inp big" value={draft.name} placeholder="Project name" autoFocus={draft.id === 0} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        {project && <ProjectOverview key={project.id} project={project} />}
        <div className="row" style={{ gap: 16, margin: '0 0 14px', flexWrap: 'wrap' }}>
          <label className="row">
            <span className="muted">Status</span>
            <select className="inp" style={{ width: 'auto' }} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as ProjectStatus })}>
              {STATUSES.map(([s, l]) => (
                <option key={s} value={s}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <div className="swatches" role="radiogroup" aria-label="Project color">
            {PROJECT_COLORS.map((c) => (
              <button key={c} className={`swatch ${draft.color === c ? 'on' : ''}`} style={{ background: c }} aria-label={c} onClick={() => setDraft({ ...draft, color: c })} />
            ))}
          </div>
        </div>
        {project && (
          <>
            <div className="row" style={{ marginBottom: 4 }}>
              <span className="label">Project brief</span>
              <div className="spacer" />
              <button className="btn sm" onClick={() => setShowHistory(true)}>
                History <span className="mono muted">{noteCount}</span>
              </button>
            </div>
            <ProjectBrief key={project.id} project={project} hasHistory={noteCount > 0} />
          </>
        )}
        <div className="label">Standing instructions</div>
        <textarea className="inp" style={{ margin: '4px 0 12px', minHeight: 48 }} value={draft.standingInstructions} placeholder="e.g. Always cc Marcus on engineering dates" onChange={(e) => setDraft({ ...draft, standingInstructions: e.target.value })} />
        <div className="row" style={{ marginBottom: 18 }}>
          {draft.id !== 0 && (
            <ConfirmButton
              label="Delete project"
              confirmLabel="Click again: its tasks keep going with no project"
              onConfirm={() =>
                void cos['projects.delete'](draft.id).then(() => {
                  toast('Project deleted. Its tasks now have no project.')
                  select(null)
                  refresh()
                })
              }
            />
          )}
          <div className="spacer" />
          {draft.id !== 0 && (
            <button className="btn" onClick={() => openTask({ id: 'new', projectId: draft.id })}>
              New task in this project
            </button>
          )}
          <button className="btn primary" onClick={() => void save()}>
            Save
          </button>
        </div>
        {draft.id !== 0 && (
          <>
            <div className="label" style={{ marginBottom: 4 }}>Open tasks</div>
            <div className="list">
              {tasks.map((t) => (
                <TaskRow key={t.id} task={t} showWhy={false} onClick={() => openTask({ id: t.id, waiting: t.status === 'waiting_on' })} />
              ))}
              {tasks.length === 0 && <div className="empty">No open tasks in this project.</div>}
            </div>
          </>
        )}
      </div>
      {project && showHistory && (
        <HistoryWindow
          scope="project"
          ownerId={project.id}
          title={
            <>
              <span style={{ width: 3, height: 18, borderRadius: 2, background: project.color }} />
              <b>{project.name}</b>
            </>
          }
          history={history}
          newCount={project.brief ? project.newNotes : 0}
          hint="One note per line. The AI reads this when it writes the brief."
          empty={'No history yet. Accepted "Project context" suggestions from imports land here, newest first.'}
          placeholder="Add a note, e.g. Launch moved to April"
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  ) : (
    <div className="empty" style={{ marginTop: 80 }}>Select a project, or create one.</div>
  )

  return <SplitView left={left} right={right} />
}

/** The one-line overview under the project name. Written by hand only; saves on its own. */
function ProjectOverview({ project }: { project: ProjectSummary }) {
  const { refresh, toast } = useApp()
  const [editing, setEditing] = useState<string | null>(null)

  const save = async (text: string) => {
    try {
      await cos['projects.saveOverview'](project.id, text)
      setEditing(null)
      toast('Overview updated')
      refresh()
    } catch (err) {
      toast(errorMessage(err), true)
    }
  }

  if (editing !== null) {
    return (
      <div style={{ margin: '0 0 14px' }}>
        <textarea
          className="inp"
          aria-label="Overview"
          autoFocus
          rows={2}
          style={{ fontSize: 14, minHeight: 52 }}
          value={editing}
          placeholder="One sentence on what this project is"
          onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
          onChange={(e) => setEditing(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault()
              void save(editing)
            } else if (e.key === 'Escape') {
              setEditing(null)
            }
          }}
        />
        <div className="row" style={{ marginTop: 6 }}>
          <button className="btn primary" onClick={() => void save(editing)}>
            Save <span className="kbd">Ctrl ↵</span>
          </button>
          <button className="btn ghost" onClick={() => setEditing(null)}>
            Cancel <span className="kbd">Esc</span>
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="ov-line">
      <span data-overview className="ov-text" onClick={() => setEditing(project.overview ?? '')}>
        {project.overview ?? <span className="faint">Add a one-line overview</span>}
      </span>
      <button className="pencil" title="Edit overview" aria-label="Edit overview" onClick={() => setEditing(project.overview ?? '')}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
          <path d="M11.2 2.3l2.5 2.5-8.4 8.4-3.2.7.7-3.2 8.4-8.4z" />
          <path d="M9.8 3.7l2.5 2.5" />
        </svg>
      </button>
    </div>
  )
}

/**
 * The project's status brief. Regenerate asks the AI for a new one from the history, shown as a
 * suggestion to keep or discard; Edit rewrites it by hand. Either saves on its own, apart from
 * the project's Save button.
 */
function ProjectBrief({ project, hasHistory }: { project: ProjectSummary; hasHistory: boolean }) {
  const { refresh, toast } = useApp()
  const [editing, setEditing] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<BriefSuggestion | null>(null)
  const [writing, setWriting] = useState(false)

  const write = async () => {
    setWriting(true)
    setSuggestion(null)
    setEditing(null)
    try {
      setSuggestion(await cos['projects.suggestBrief'](project.id))
    } catch (err) {
      toast(errorMessage(err), true)
    } finally {
      setWriting(false)
    }
  }
  const keep = async (text: string, by: 'ai' | 'user') => {
    try {
      await cos['projects.saveBrief'](project.id, text, by)
      setEditing(null)
      setSuggestion(null)
      toast('Brief updated')
      refresh()
    } catch (err) {
      toast(errorMessage(err), true)
    }
  }
  const byline = project.brief && project.briefAt ? `${project.briefBy === 'ai' ? 'Written by AI' : 'Edited by you'} on ${dayLabel(project.briefAt)}` : null

  return (
    <div style={{ marginBottom: 14 }}>
      {editing !== null ? (
        <>
          <textarea
            className="inp"
            aria-label="Project brief"
            autoFocus
            rows={6}
            style={{ fontSize: 13, minHeight: 130 }}
            value={editing}
            placeholder="Where the project stands, recent decisions, what's next, what's open"
            onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
            onChange={(e) => setEditing(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault()
                void keep(editing, 'user')
              } else if (e.key === 'Escape') {
                setEditing(null)
              }
            }}
          />
          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn primary" onClick={() => void keep(editing, 'user')}>
              Save <span className="kbd">Ctrl ↵</span>
            </button>
            <button className="btn ghost" onClick={() => setEditing(null)}>
              Cancel <span className="kbd">Esc</span>
            </button>
          </div>
        </>
      ) : (
        <>
          <div data-brief className="brief-box">
            {project.brief ?? (
              <span className="faint">
                No brief yet.{' '}
                {hasHistory ? 'Click Write brief, or Edit to write one yourself.' : 'Imports add history here as you accept them in Review. You can also Edit to write one yourself.'}
              </span>
            )}
          </div>
          <div className="row" style={{ marginTop: 4, flexWrap: 'wrap' }}>
            {byline && <span className="faint" style={{ fontSize: 11 }}>{byline}</span>}
            {project.brief && project.newNotes > 0 && (
              <span className="note">
                {project.newNotes} new note{project.newNotes === 1 ? '' : 's'} since this brief
              </span>
            )}
            <div className="spacer" />
            <button
              className="btn ghost sm"
              onClick={() => {
                setSuggestion(null)
                setEditing(project.brief ?? '')
              }}
            >
              Edit
            </button>
            {hasHistory && (
              <button className="btn sm" disabled={writing} onClick={() => void write()}>
                {writing ? 'Writing…' : project.brief ? '✦ Regenerate' : '✦ Write brief'}
              </button>
            )}
          </div>
        </>
      )}
      {suggestion && (
        <div className="ai" style={{ marginTop: 8 }}>
          <div className="row" style={{ marginBottom: 4 }}>
            <span className="label">Suggested brief</span>
            <div className="spacer" />
            <span className="faint" style={{ fontSize: 11 }}>{suggestion.writtenBy}</span>
          </div>
          <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{suggestion.text}</div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn primary" onClick={() => void keep(suggestion.text, 'ai')}>
              Keep
            </button>
            <button className="btn ghost" onClick={() => setSuggestion(null)}>
              Discard
            </button>
            <div className="spacer" />
            <button className="btn ghost" disabled={writing} onClick={() => void write()}>
              Try again
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
