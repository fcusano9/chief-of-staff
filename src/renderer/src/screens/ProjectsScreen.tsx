import { useEffect, useState } from 'react'
import type { ProjectStatus, Task } from '@shared/types'
import { PROJECT_COLORS } from '@shared/types'
import { cos, errorMessage } from '../api'
import { ConfirmButton, TaskRow } from '../components/bits'
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
  summary: string
  standingInstructions: string
}

export function ProjectsScreen() {
  const { projects, openTask, refresh, toast, version } = useApp()
  const [selected, setSelected] = useState<number | 'new' | null>(projects[0]?.id ?? null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])

  useEffect(() => {
    if (selected === null) return setDraft(null)
    if (selected === 'new') {
      setTasks([])
      return setDraft({ id: 0, name: '', color: PROJECT_COLORS[projects.length % PROJECT_COLORS.length]!, status: 'active', summary: '', standingInstructions: '' })
    }
    const p = projects.find((x) => x.id === selected)
    if (!p) return setDraft(null) // just created: wait for the refreshed list
    void cos['briefs.get']('project', p.id).then((b) =>
      setDraft({ id: p.id, name: p.name, color: p.color, status: p.status, summary: b.summary, standingInstructions: b.standingInstructions }),
    )
    void cos['tasks.listActive']({ projectId: p.id }).then(setTasks)
  }, [selected, projects, version])

  const save = async () => {
    if (!draft) return
    try {
      const saved = await cos['projects.save']({ id: draft.id, name: draft.name, color: draft.color, status: draft.status })
      await cos['briefs.save']({ scope: 'project', ownerId: saved.id, summary: draft.summary, standingInstructions: draft.standingInstructions, updatedAt: null })
      toast('Project saved')
      setSelected(saved.status === 'archived' ? null : saved.id)
      refresh()
    } catch (err) {
      toast(errorMessage(err), true)
    }
  }

  const left = (
    <>
      <div className="head">
        <h1>Projects</h1>
        <span className="muted">{projects.length}</span>
        <div className="spacer" />
        <button className="btn primary" onClick={() => setSelected('new')}>
          New project
        </button>
      </div>
      <div className="list">
        {projects.map((p) => (
          <div key={p.id} className={`r ${selected === p.id ? 'sel' : ''}`} style={{ gridTemplateColumns: '3px minmax(0, 1fr) auto auto' }} onClick={() => setSelected(p.id)}>
            <div className="stripe" style={{ background: p.color }} />
            <div className="ttl">{p.name}</div>
            <span className="faint" style={{ fontSize: 12 }}>{p.status === 'active' ? '' : STATUSES.find(([s]) => s === p.status)?.[1]}</span>
            <span className="mono muted" title="Open tasks">{p.openCount}</span>
          </div>
        ))}
        {projects.length === 0 && <div className="empty">No projects yet. Tasks don't need one, but projects keep shared context for the AI.</div>}
      </div>
    </>
  )

  const right = draft ? (
    <div>
      <div className="editor-stripe" style={{ background: draft.color }} />
      <div className="editor">
        <div className="row" style={{ marginBottom: 12 }}>
          <input className="inp title-inp" value={draft.name} placeholder="Project name" autoFocus={draft.id === 0} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </div>
        <div className="row" style={{ gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
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
        <div className="label">Project brief · what the AI always knows about this project</div>
        <textarea className="inp" style={{ margin: '4px 0 10px', minHeight: 96 }} value={draft.summary} placeholder="Goals, background, key decisions with dates, stakeholders, timeline, open questions" onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
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
                  setSelected(null)
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
                <TaskRow key={t.id} task={t} showWhy={false} onClick={() => openTask({ id: t.id })} />
              ))}
              {tasks.length === 0 && <div className="empty">No open tasks in this project.</div>}
            </div>
          </>
        )}
      </div>
    </div>
  ) : (
    <div className="empty" style={{ marginTop: 80 }}>Select a project, or create one.</div>
  )

  return <SplitView left={left} right={right} />
}
