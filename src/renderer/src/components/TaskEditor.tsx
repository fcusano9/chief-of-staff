import { useEffect, useRef, useState } from 'react'
import type { Subtask, Task, TaskInput, TaskStatus } from '@shared/types'
import { effectivePriority, NO_PROJECT_COLOR, STATUS_LABELS } from '@shared/types'
import { cos, errorMessage } from '../api'
import { useApp } from '../context'
import { ConfirmButton, scoreClass } from './bits'
import { ActivityLog } from './ActivityLog'
import { ReplyCard } from './ReplyCard'
import { StatusCard } from './StatusCard'
import { LatestUpdate, UpdatesButton, UpdatesWindow } from './UpdatesWindow'

const EDITABLE_STATUSES: TaskStatus[] = ['open', 'waiting_on', 'done']

/** The editable part of a task. Its Updates are saved on their own, from the Updates window. */
interface Form {
  input: TaskInput
}

const emptyInput = (projectId: number | null = null, waiting = false): TaskInput => ({
  id: 0,
  title: '',
  notes: null,
  status: waiting ? 'waiting_on' : 'open',
  dueDate: null,
  projectId,
  requesterId: null,
  priorityOverride: null,
  followUpCount: 0,
  waitingOn: null,
  subtasks: [],
})

const toInput = (t: Task): TaskInput => ({
  id: t.id,
  title: t.title,
  notes: t.notes,
  status: t.status,
  dueDate: t.dueDate,
  projectId: t.projectId,
  requesterId: t.requesterId,
  priorityOverride: t.priorityOverride,
  followUpCount: t.followUpCount,
  waitingOn: t.waitingOn,
  subtasks: t.subtasks,
})

/** Saves a task. Returns the saved task. */
const persist = (form: Form): Promise<Task> => cos['tasks.save'](form.input)

interface Props {
  taskId: number | 'new'
  defaultProjectId?: number | null
  /** A new item from the Waiting tab starts as Waiting on. */
  defaultWaiting?: boolean
  onClose: () => void
  /** Called after an explicit save (also when a new task gets its id). */
  onSaved: (task: Task) => void
  onDone: (task: Task) => void
  onDeleted: (id: number) => void
}

/**
 * The right-hand task view. Edits are kept locally until saved. Switching to another task saves
 * pending edits automatically, so moving through the list never loses work.
 */
export function TaskEditor({ taskId, defaultProjectId = null, defaultWaiting = false, onClose, onSaved, onDone, onDeleted }: Props) {
  const { projects, people, toast, refresh } = useApp()
  const [activityKey, setActivityKey] = useState(0)
  const [task, setTask] = useState<Task | null>(null)
  const [form, setForm] = useState<Form | null>(taskId === 'new' ? { input: emptyInput(defaultProjectId, defaultWaiting) } : null)
  const [snapshot, setSnapshot] = useState(() => (form ? JSON.stringify(form) : ''))
  const [updates, setUpdates] = useState('')
  const [showUpdates, setShowUpdates] = useState(false)
  const [adjust, setAdjust] = useState(false)
  const [newSubtask, setNewSubtask] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)

  const dirty = form != null && JSON.stringify(form) !== snapshot
  const latest = useRef({ form, dirty })
  latest.current = { form, dirty }

  useEffect(() => {
    if (taskId === 'new') {
      titleRef.current?.focus()
      return
    }
    let cancelled = false
    void Promise.all([cos['tasks.get'](taskId), cos['briefs.get']('task', taskId)]).then(([t, brief]) => {
      if (cancelled || !t) return
      const loaded: Form = { input: toInput(t) }
      setUpdates(brief.summary)
      setTask(t)
      setForm(loaded)
      setSnapshot(JSON.stringify(loaded))
    })
    return () => {
      cancelled = true
    }
  }, [taskId])

  // Autosave pending edits when this editor goes away (another task selected, or closed).
  useEffect(
    () => () => {
      const { form: f, dirty: d } = latest.current
      if (!f || !d) return
      if (!f.input.title.trim()) {
        if (f.input.id) toast('Title was empty, so those edits were not saved', true)
        return
      }
      persist(f)
        .then((saved) => {
          toast(`Saved changes to “${saved.title}”`)
          refresh()
        })
        .catch((err) => toast(errorMessage(err), true))
    },
    [],
  )

  const projectId = form?.input.projectId ?? null
  const requesterId = form?.input.requesterId ?? null

  if (!form) return <div className="empty">Loading…</div>

  const set = (patch: Partial<TaskInput>) => setForm((f) => (f ? { ...f, input: { ...f.input, ...patch } } : f))
  const setSubtask = (i: number, patch: Partial<Subtask>) => set({ subtasks: form.input.subtasks.map((s, j) => (j === i ? { ...s, ...patch } : s)) })

  const project = projects.find((p) => p.id === projectId) ?? null
  const isNew = form.input.id === 0
  const score = task ? effectivePriority({ priorityScore: task.priorityScore, priorityOverride: form.input.priorityOverride, aiAdjustment: task.aiAdjustment }) : null
  const ai = task?.aiAdjustment ?? null
  const byHand = form.input.priorityOverride != null

  const save = async (patch: Partial<TaskInput> = {}) => {
    const next: Form = { ...form, input: { ...form.input, ...patch } }
    if (!next.input.title.trim()) {
      toast('Give the task a title first', true)
      titleRef.current?.focus()
      return null
    }
    try {
      const saved = await persist(next)
      const savedForm: Form = { input: toInput(saved) }
      // Mark clean right away: the parent may unmount this editor before React re-renders,
      // and the unmount autosave must not save (or create) the task a second time.
      latest.current = { form: savedForm, dirty: false }
      setTask(saved)
      setForm(savedForm)
      setSnapshot(JSON.stringify(savedForm))
      return saved
    } catch (err) {
      toast(errorMessage(err), true)
      return null
    }
  }

  // Takes the AI's adjustment off without touching unsaved edits.
  const removeAi = async () => {
    if (!task) return
    try {
      const updated = await cos['tasks.removeAiAdjustment'](task.id)
      setTask(updated)
      toast('Removed')
      refresh()
    } catch (err) {
      toast(errorMessage(err), true)
    }
  }

  const addSubtask = () => {
    if (!newSubtask.trim()) return
    set({ subtasks: [...form.input.subtasks, { id: 0, title: newSubtask.trim(), isDone: false }] })
    setNewSubtask('')
  }


  return (
    <div
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault()
          void save().then((t) => t && (toast('Saved'), onSaved(t)))
        }
      }}
    >
      <div className="editor-stripe" style={{ background: project?.color ?? NO_PROJECT_COLOR }} />
      <div className="editor">
        <div className="row" style={{ gap: 10, marginBottom: 12 }}>
          <span className={`score ${score == null ? 's-lo' : scoreClass(score)}`} style={{ fontSize: 'calc(var(--fs) + 3px)', minWidth: 26 }}>
            {score ?? '—'}
          </span>
          <input ref={titleRef} className="inp title-inp" value={form.input.title} placeholder="Task title" onChange={(e) => set({ title: e.target.value })} />
          <button className="iconbtn" title="Close (Esc)" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="dgrid">
          <div>
            <StatusCard scope="task" id={isNew ? null : form.input.id} done={form.input.status === 'done'} />
            <ReplyCard taskId={isNew ? null : form.input.id} onSaved={() => setActivityKey((k) => k + 1)} />

            <div className="label" style={{ marginBottom: 4 }}>Subtasks</div>
            {form.input.subtasks.map((s, i) => (
              <div className="check" key={s.id || `new-${i}`}>
                <button type="button" className={`box ${s.isDone ? 'on' : ''}`} onClick={() => setSubtask(i, { isDone: !s.isDone })} aria-label={s.isDone ? 'Mark not done' : 'Mark done'}>
                  {s.isDone ? '✓' : ''}
                </button>
                <input type="text" className={s.isDone ? 'done-ttl' : ''} value={s.title} onChange={(e) => setSubtask(i, { title: e.target.value })} />
                <button type="button" className="x" title="Remove subtask" onClick={() => set({ subtasks: form.input.subtasks.filter((_, j) => j !== i) })}>
                  ✕
                </button>
              </div>
            ))}
            <div className="check">
              <span className="box" style={{ cursor: 'default' }} />
              <input
                type="text"
                placeholder="Add subtask…"
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
                    e.preventDefault()
                    addSubtask()
                  }
                }}
                onBlur={addSubtask}
              />
            </div>

            <div className="label" style={{ margin: '14px 0 4px' }}>Notes</div>
            <textarea
              className="inp notes-inp"
              aria-label="Notes"
              value={form.input.notes ?? ''}
              onChange={(e) => set({ notes: e.target.value })}
              placeholder="Your own notes. The AI never changes these."
            />

            {!isNew && (
              <>
                <div className="row" style={{ margin: '14px 0 4px' }}>
                  <span className="label">Updates</span>
                  <div className="spacer" />
                  <UpdatesButton updates={updates} onOpen={() => setShowUpdates(true)} />
                </div>
                <LatestUpdate updates={updates} onOpen={() => setShowUpdates(true)} />
                {!updates.trim() && <div className="faint" style={{ fontSize: 'var(--fs-sm)' }}>No updates yet. What you accept from imports in Review lands here.</div>}
              </>
            )}

            <div className="label" style={{ margin: '14px 0 4px' }}>Activity</div>
            <ActivityLog task={task} reloadKey={activityKey} />
          </div>

          <div className="meta">
            <label className="field">
              <span>Project</span>
              <select className="inp" value={projectId ?? ''} onChange={(e) => set({ projectId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Status</span>
              <select className="inp" value={form.input.status} onChange={(e) => set({ status: e.target.value as TaskStatus })}>
                {EDITABLE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            {form.input.status === 'waiting_on' && (
              <label className="field">
                <span>Waiting on</span>
                <input className="inp" value={form.input.waitingOn ?? ''} placeholder="Who or what" onChange={(e) => set({ waitingOn: e.target.value })} />
              </label>
            )}
            <label className="field">
              <span>Due</span>
              <input className="inp" type="date" value={form.input.dueDate ?? ''} onChange={(e) => set({ dueDate: e.target.value || null })} />
            </label>
            <label className="field">
              <span>Asked by</span>
              <select className="inp" value={requesterId ?? ''} onChange={(e) => set({ requesterId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Nobody</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="card" style={{ marginTop: 10, padding: '8px 10px' }}>
              <div className="row">
                <span className="label">
                  Priority {score ?? ''}
                  {byHand ? ' (set by you)' : ''}
                </span>
                <div className="spacer" />
                <button type="button" className="link-btn" onClick={() => setAdjust(!adjust)}>
                  {adjust ? 'Done' : 'Adjust'}
                </button>
              </div>
              <div style={{ fontSize: 'var(--fs-sm)' }}>
                {byHand ? 'Set by hand' : (task?.priorityRationale ?? 'Calculated when you save')}
                {ai && !byHand && (
                  <span className="faint mono">
                    {' '}
                    · {task!.priorityScore} {ai.delta > 0 ? '+' : '−'} {Math.abs(ai.delta)}
                  </span>
                )}
              </div>
              {ai && (
                <div className={`ai-adj ${byHand ? 'off' : ''}`} data-testid="ai-adjustment">
                  <div className="row">
                    <span className="ai-adj-h">
                      ✦ AI <span className="mono">{ai.delta > 0 ? `+${ai.delta}` : `−${Math.abs(ai.delta)}`}</span>
                    </span>
                    <div className="spacer" />
                    {!byHand && (
                      <button type="button" className="link-btn" onClick={() => void removeAi()}>
                        Remove
                      </button>
                    )}
                  </div>
                  <div>{ai.reason}</div>
                  <div className="ai-adj-meta">
                    {ai.origin === 'briefing' ? 'From the daily briefing' : `From the import “${ai.originLabel ?? 'Imported item'}”`} · {new Date(ai.writtenAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                    {byHand ? ' · Not used: your score wins' : ''}
                  </div>
                </div>
              )}
              {adjust && (
              <>
              <div className="row" style={{ marginTop: 6, fontSize: 'var(--fs-sm)' }}>
                <label className="row muted" style={{ gap: 6 }}>
                  <input type="checkbox" checked={form.input.priorityOverride != null} onChange={(e) => set({ priorityOverride: e.target.checked ? (task ? effectivePriority({ ...task, priorityOverride: null }) : 50) : null })} />
                  Set by hand
                </label>
                {form.input.priorityOverride != null && (
                  <input
                    className="inp"
                    type="number"
                    min={0}
                    max={100}
                    style={{ width: 64 }}
                    value={form.input.priorityOverride}
                    onChange={(e) => set({ priorityOverride: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                  />
                )}
              </div>
              <div className="row muted" style={{ marginTop: 6, fontSize: 'var(--fs-sm)' }}>
                Follow-ups: <span className="mono" style={{ color: 'var(--text)' }}>{form.input.followUpCount}</span>
                <button className="btn ghost" style={{ padding: '0 6px' }} title="Someone followed up again" onClick={() => set({ followUpCount: form.input.followUpCount + 1 })}>
                  +1
                </button>
                {form.input.followUpCount > 0 && (
                  <button className="btn ghost" style={{ padding: '0 6px' }} onClick={() => set({ followUpCount: 0 })}>
                    Reset
                  </button>
                )}
              </div>
              </>
              )}
            </div>
          </div>
        </div>

        <div className="row" style={{ marginTop: 18, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          {!isNew && (
            <ConfirmButton
              label="Delete"
              confirmLabel="Click again to delete"
              onConfirm={() => {
                latest.current.dirty = false
                void cos['tasks.delete'](form.input.id).then(() => onDeleted(form.input.id))
              }}
            />
          )}
          <div className="spacer" />
          {dirty && !isNew && (
            <button className="btn ghost" onClick={() => setForm(JSON.parse(snapshot) as Form)}>
              Discard changes
            </button>
          )}
          {!isNew && form.input.status !== 'done' && (
            <button className="btn" data-action="done" onClick={() => void save({ status: 'done' }).then((t) => t && onDone(t))}>
              Mark done
            </button>
          )}
          {!isNew && form.input.status === 'done' && (
            <button
              className="btn"
              title={task?.waitedOn ? `Back to Waiting, waiting on ${task.waitedOn}` : 'Back to Tasks'}
              onClick={() =>
                void save()
                  .then((t) => (t ? cos['tasks.reopen'](t.id) : null))
                  .then((t) => t && (toast(t.status === 'waiting_on' ? 'Reopened on Waiting' : 'Reopened on Tasks'), onSaved(t)))
                  .catch((err) => toast(errorMessage(err), true))
              }
            >
              Reopen
            </button>
          )}
          <button className="btn primary" onClick={() => void save().then((t) => t && (toast('Saved'), onSaved(t)))}>
            Save
          </button>
        </div>
      </div>
      {showUpdates && task && (
        <UpdatesWindow
          scope="task"
          ownerId={task.id}
          title={
            <>
              <span style={{ width: 3, height: 18, borderRadius: 2, background: project?.color ?? NO_PROJECT_COLOR }} />
              <b>{form.input.title || task.title}</b>
            </>
          }
          updates={updates}
          newCount={0}
          hint="One update per line. The AI reads the latest ones on imports and in the daily briefing."
          empty="No updates yet. Status updates and context you accept from imports in Review land here, newest first."
          placeholder="Add an update, e.g. Kenji wants it by Friday"
          onChange={setUpdates}
          onClose={() => setShowUpdates(false)}
        />
      )}
    </div>
  )
}
