import { useEffect, useState } from 'react'
import type { BriefScope, Suggestion, SuggestionKind, SuggestionPayload } from '@shared/types'
import { PROJECT_COLORS, SOURCE_KIND_LABELS, suggestionLabel } from '@shared/types'
import { cos, errorMessage } from '../api'
import { Avatar, dueLabel, ProjectChip, Stars } from '../components/bits'
import { useApp } from '../context'

const isTyping = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')

/** Each type of suggestion has its own chip color: projects, people, tasks and their context. */
const chipColor = (kind: SuggestionKind, briefScope: BriefScope | null, replyArrived = false) =>
  replyArrived ? 'var(--ok)'
  : kind === 'needs_reply' ? 'var(--k-reply)'
  : kind === 'new_project' ? 'var(--k-project)'
  : kind === 'new_person' ? 'var(--k-person)'
  : kind === 'brief_update' ? (briefScope === 'project' ? 'var(--k-project-ctx)' : briefScope === 'person' ? 'var(--k-person-ctx)' : 'var(--k-task-ctx)')
  : 'var(--k-task)'

/** "Looks done" on something waiting on someone, from an email: their answer came in. */
const isReplyArrived = (s: Suggestion) => s.kind === 'mark_done' && s.source.kind === 'email' && s.taskStatus === 'waiting_on'
/** New tasks of any kind: plain, "Reply to …", or a new waiting-on item. */
const createsTask = (kind: SuggestionKind, p: SuggestionPayload) => kind === 'new_task' || kind === 'needs_reply' || (kind === 'waiting_on' && !p.taskId)

const ACCEPTED: Record<SuggestionKind, string> = {
  new_task: 'Task created',
  needs_reply: 'Reply task created',
  waiting_on: 'Task updated',
  status_update: 'Task updated',
  mark_done: 'Task updated',
  brief_update: 'Context added',
  new_project: 'Project created',
  new_person: 'Added to People',
}

/** What accepting a task also creates, e.g. "with its new project and person". */
function alsoCreates(s: Suggestion, p: SuggestionPayload): string {
  const made = [
    !p.projectId && p.projectSuggestionId ? 'project' : null,
    (!p.requesterId && p.requesterSuggestionId) || p.waitingOnSuggestionId ? 'person' : null,
  ].filter(Boolean)
  return createsTask(s.kind, p) ? (made.length ? `, with its new ${made.join(' and ')}` : '') : ''
}

/** AI suggestions waiting for a decision. Nothing changes until one is accepted. */
export function ReviewScreen() {
  const { version, refresh, toast, go, openTask, openAiLog } = useApp()
  const [items, setItems] = useState<Suggestion[]>([])
  const [cursor, setCursor] = useState(0)
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState<SuggestionPayload | null>(null)

  useEffect(() => void cos['suggestions.listPending']().then(setItems), [version])
  useEffect(() => setCursor((c) => Math.min(c, Math.max(0, items.length - 1))), [items])
  useEffect(() => {
    document.querySelector(`[data-suggestion="${items[cursor]?.id}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor, items])

  const accept = async (s: Suggestion, edits?: SuggestionPayload) => {
    try {
      const taskId = await cos['suggestions.accept'](s.id, edits)
      setEditing(null)
      const what = isReplyArrived(s) ? 'Waiting item cleared' : s.kind === 'waiting_on' && !s.payload.taskId ? 'Added to Waiting' : ACCEPTED[s.kind]
      toast(`${what}${alsoCreates(s, edits ?? s.payload)}`, false)
      refresh()
      return taskId
    } catch (err) {
      toast(errorMessage(err), true)
      refresh()
      return null
    }
  }
  const reject = async (s: Suggestion) => {
    await cos['suggestions.reject'](s.id)
    if (editing === s.id) setEditing(null)
    refresh()
  }
  const startEdit = (s: Suggestion) => {
    setEditing(s.id)
    setDraft(s.payload)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.scrim')) return
      // While editing, Ctrl+Enter accepts the edits and Esc cancels, even from inside a field.
      const edited = items.find((x) => x.id === editing)
      if (edited && draft && (e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        void accept(edited, draft)
        return
      }
      if (e.key === 'Escape') return setEditing(null)
      if (isTyping() || e.ctrlKey || e.metaKey || e.altKey) return
      const s = items[cursor]
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault()
        setCursor((c) => Math.min(c + 1, items.length - 1))
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault()
        setCursor((c) => Math.max(c - 1, 0))
      } else if (s && e.key === 'a') {
        void accept(s, editing === s.id && draft ? draft : undefined)
      } else if (s && e.key === 'r') {
        void reject(s)
      } else if (s && (e.key === 'e' || e.key === 'Enter')) {
        e.preventDefault() // keeps the "e" out of the field the editor focuses
        startEdit(s)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items, cursor, editing, draft])

  const groups = items.reduce<{ source: Suggestion['source']; items: Suggestion[] }[]>((acc, s) => {
    const g = acc.find((x) => x.source.id === s.source.id)
    if (g) g.items.push(s)
    else acc.push({ source: s.source, items: [s] })
    return acc
  }, [])

  return (
    <div className="page">
      <div className="head">
        <h1>Review queue</h1>
        <span className="muted">
          {items.length} suggestion{items.length === 1 ? '' : 's'} · nothing changes until you accept
        </span>
        <div className="spacer" />
        <button className="btn" onClick={() => go('import')}>
          Import more
        </button>
      </div>

      {items.length === 0 && (
        <div className="card empty" style={{ padding: 40 }}>
          <div style={{ color: 'var(--text)', fontWeight: 500, marginBottom: 4 }}>You're all caught up</div>
          Import a Copilot summary, meeting transcript, chat, or notes, and the AI's suggestions will wait here for you.
          <div style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={() => go('import')}>
              Import something
            </button>
          </div>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.source.id} style={{ marginBottom: 18 }}>
          <div className="row" style={{ marginBottom: 6 }}>
            <span className="label">
              From {SOURCE_KIND_LABELS[g.source.kind].toLowerCase()} · <b style={{ fontWeight: 500, color: 'var(--text)' }}>{g.source.title}</b> ·{' '}
              {new Date(g.source.occurredAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
            <div className="spacer" />
            {g.source.fromOutlook && (
              <button className="btn ghost" style={{ fontSize: 12 }} title="Show this conversation's newest message in Outlook" onClick={() => void cos['mail.open'](g.source.id).catch((err) => toast(errorMessage(err), true))}>
                Open in Outlook
              </button>
            )}
            <button className="btn ghost" style={{ fontSize: 12 }} title="See exactly what was sent to the AI and what came back" onClick={() => openAiLog(g.source.id, 'review')}>
              AI log
            </button>
            {g.items.length > 1 && (
              <button
                className="btn ghost"
                style={{ fontSize: 12 }}
                onClick={() =>
                  void (async () => {
                    for (const s of g.items) await cos['suggestions.reject'](s.id)
                    refresh()
                  })()
                }
              >
                Reject all {g.items.length}
              </button>
            )}
          </div>
          <div className="list">
            {g.items.map((s) => {
              const index = items.indexOf(s)
              const isEditing = editing === s.id && draft
              return (
                <div
                  key={s.id}
                  data-suggestion={s.id}
                  className={`r ${index === cursor ? 'sel' : ''}`}
                  style={{ gridTemplateColumns: '104px minmax(0, 1fr) auto', alignItems: 'start', padding: '10px 12px', cursor: 'default' }}
                  onClick={() => setCursor(index)}
                >
                  <div>
                    <span
                      className="chip"
                      style={{
                        background: `color-mix(in srgb, ${chipColor(s.kind, s.payload.briefScope, isReplyArrived(s))} 14%, transparent)`,
                        color: chipColor(s.kind, s.payload.briefScope, isReplyArrived(s)),
                      }}
                    >
                      {isReplyArrived(s) ? 'Reply arrived' : suggestionLabel(s.kind, s.payload.briefScope)}
                    </span>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    {isEditing ? (
                      <Editor kind={s.kind} draft={draft} setDraft={setDraft} pending={items} />
                    ) : (
                      <Summary s={s} pending={items} onOpenTask={(id) => openTask({ id })} />
                    )}
                    {s.evidence && (
                      <div className="faint" style={{ fontSize: 12, marginTop: 4, fontStyle: 'italic', overflowWrap: 'anywhere' }}>
                        “{s.evidence}”
                      </div>
                    )}
                  </div>
                  <div className="row" style={{ gap: 4 }}>
                    <button className="btn" onClick={() => void accept(s, isEditing ? draft! : undefined)}>
                      {isReplyArrived(s) ? 'Clear it' : 'Accept'} <span className="kbd">{isEditing ? 'Ctrl ↵' : 'A'}</span>
                    </button>
                    {isEditing ? (
                      <button className="btn ghost" onClick={() => setEditing(null)}>
                        Cancel <span className="kbd">Esc</span>
                      </button>
                    ) : (
                      <button className="btn ghost" onClick={() => startEdit(s)}>
                        Edit <span className="kbd">E</span>
                      </button>
                    )}
                    <button className="btn ghost" onClick={() => void reject(s)}>
                      Reject <span className="kbd">R</span>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

/** A new project or person from the same import that isn't decided yet, shown with a dashed "(new)" chip. */
function linked(pending: Suggestion[], id: number | null | undefined): Suggestion | null {
  return id ? (pending.find((x) => x.id === id) ?? null) : null
}

function NewProjectChip({ s }: { s: Suggestion }) {
  const color = s.payload.color ?? PROJECT_COLORS[0]!
  return (
    <span className="chip" style={{ border: '1px dashed currentColor', color: `color-mix(in srgb, ${color} 65%, var(--text))` }}>
      {s.payload.title} (new)
    </span>
  )
}

function Summary({ s, pending, onOpenTask }: { s: Suggestion; pending: Suggestion[]; onOpenTask: (id: number) => void }) {
  const { projects, people } = useApp()
  const p = s.payload
  const project = projects.find((x) => x.id === p.projectId) ?? null
  const newProject = linked(pending, p.projectSuggestionId)
  const newRequester = linked(pending, p.requesterSuggestionId)
  const requester = people.find((x) => x.id === p.requesterId)?.name ?? (newRequester ? `${newRequester.payload.title} (new)` : p.requesterName)
  const taskLink = p.taskId ? (
    <button className="btn ghost" style={{ padding: 0, fontWeight: 500 }} onClick={() => onOpenTask(p.taskId!)}>
      {s.taskTitle ?? p.title}
    </button>
  ) : null

  if (s.kind === 'new_project') {
    const links = pending.filter((x) => x.payload.projectSuggestionId === s.id).length
    return (
      <div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="dot" style={{ background: p.color ?? PROJECT_COLORS[0] }} />
          <span style={{ fontWeight: 500 }}>{p.title}</span>
        </div>
        {p.details && <div style={{ marginTop: 2 }}>{p.details}</div>}
        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
          Summary goes into the project's brief{links ? ` · ${links} suggestion${links === 1 ? '' : 's'} below link to it` : ''}
        </div>
      </div>
    )
  }
  if (s.kind === 'new_person') {
    const links = pending.filter((x) => x.payload.requesterSuggestionId === s.id || x.payload.waitingOnSuggestionId === s.id).length
    return (
      <div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Avatar person={{ name: p.title, color: 'var(--k-person)' }} />
          <span style={{ fontWeight: 500 }}>{p.title}</span>
          <span className="muted">{[p.role || 'No role', p.company, p.email].filter(Boolean).join(' · ')}</span>
        </div>
        {p.details && <div style={{ marginTop: 2 }}>{p.details}</div>}
        <div className="muted row" style={{ fontSize: 12, marginTop: 2, gap: 4, flexWrap: 'wrap' }}>
          Starts at <Stars value={3} /> · context goes into their brief{links ? ` · ${links} suggestion${links === 1 ? '' : 's'} below involve them` : ''}
        </div>
      </div>
    )
  }
  if (s.kind === 'brief_update') {
    const owner =
      p.briefScope === 'project' ? <ProjectChip project={projects.find((x) => x.id === p.briefOwnerId) ?? null} />
      : p.briefScope === 'person' ? <span style={{ fontWeight: 500 }}>{people.find((x) => x.id === p.briefOwnerId)?.name}</span>
      : taskLink
    return (
      <div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {owner}
          <span className="muted">add to context</span>
        </div>
        {p.details && <div style={{ marginTop: 2 }}>{p.details}</div>}
      </div>
    )
  }

  const meta = [
    p.dueDate ? `Due ${dueLabel(p.dueDate).text}` : null,
    requester ? `Asked by ${requester}${p.requesterId || newRequester ? '' : ' (not in People)'}` : null,
    p.waitingOn ? `Waiting on ${p.waitingOn}${linked(pending, p.waitingOnSuggestionId) ? ' (new)' : ''}` : null,
  ].filter(Boolean)

  return (
    <div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {createsTask(s.kind, p) ? <span style={{ fontWeight: 500 }}>{p.title}</span> : taskLink}
        {newProject && !project ? <NewProjectChip s={newProject} /> : <ProjectChip project={project} />}
      </div>
      {p.details && <div style={{ marginTop: 2 }}>{p.details}</div>}
      {meta.length > 0 && (
        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
          {meta.join(' · ')}
        </div>
      )}
    </div>
  )
}

function Editor({ kind, draft, setDraft, pending }: { kind: Suggestion['kind']; draft: SuggestionPayload; setDraft: (d: SuggestionPayload) => void; pending: Suggestion[] }) {
  const { projects, people } = useApp()
  const set = (patch: Partial<SuggestionPayload>) => setDraft({ ...draft, ...patch })

  if (kind === 'new_project') {
    return (
      <div className="grid" style={{ gap: 6 }}>
        <input className="inp" autoFocus value={draft.title} placeholder="Project name" onChange={(e) => set({ title: e.target.value })} />
        <div className="swatches" role="radiogroup" aria-label="Project color">
          {PROJECT_COLORS.map((c) => (
            <button key={c} className={`swatch ${draft.color === c ? 'on' : ''}`} style={{ background: c }} aria-label={c} onClick={() => set({ color: c })} />
          ))}
        </div>
        <textarea className="inp" style={{ minHeight: 48 }} value={draft.details} placeholder="Summary for the project's brief" onChange={(e) => set({ details: e.target.value })} />
      </div>
    )
  }
  if (kind === 'new_person') {
    return (
      <div className="grid" style={{ gap: 6 }}>
        <div className="row">
          <input className="inp" autoFocus value={draft.title} placeholder="Name" onChange={(e) => set({ title: e.target.value })} />
          <input className="inp" value={draft.role ?? ''} placeholder="Role" onChange={(e) => set({ role: e.target.value || null })} />
        </div>
        <div className="row">
          <input className="inp" value={draft.company ?? ''} placeholder="Company" onChange={(e) => set({ company: e.target.value || null })} />
          <input className="inp" value={draft.email ?? ''} placeholder="Email (optional)" onChange={(e) => set({ email: e.target.value || null })} />
        </div>
        <textarea className="inp" style={{ minHeight: 48 }} value={draft.details} placeholder="What to remember about them" onChange={(e) => set({ details: e.target.value })} />
      </div>
    )
  }

  const creates = createsTask(kind, draft)
  // Projects and people proposed in the same import can be picked before they exist; "s:" marks a suggestion id.
  const newProjects = pending.filter((x) => x.kind === 'new_project')
  const newPeople = pending.filter((x) => x.kind === 'new_person')
  const projectValue = draft.projectId ?? (draft.projectSuggestionId && newProjects.some((x) => x.id === draft.projectSuggestionId) ? `s:${draft.projectSuggestionId}` : '')
  const requesterValue = draft.requesterId ?? (draft.requesterSuggestionId && newPeople.some((x) => x.id === draft.requesterSuggestionId) ? `s:${draft.requesterSuggestionId}` : '')
  const pick = (value: string, existing: 'projectId' | 'requesterId', link: 'projectSuggestionId' | 'requesterSuggestionId') =>
    set({ [existing]: value && !value.startsWith('s:') ? Number(value) : null, [link]: value.startsWith('s:') ? Number(value.slice(2)) : null })
  return (
    <div className="grid" style={{ gap: 6 }}>
      {creates && <input className="inp" autoFocus value={draft.title} placeholder="Task title" onChange={(e) => set({ title: e.target.value })} />}
      <textarea className="inp" style={{ minHeight: 48 }} value={draft.details} placeholder={kind === 'new_task' || kind === 'needs_reply' ? 'Notes (optional)' : 'Text'} onChange={(e) => set({ details: e.target.value })} />
      {(creates || kind === 'status_update') && (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input className="inp" style={{ width: 150 }} type="date" value={draft.dueDate ?? ''} onChange={(e) => set({ dueDate: e.target.value || null })} />
          {creates && (
            <>
              <select className="inp" style={{ width: 'auto' }} value={projectValue} onChange={(e) => pick(e.target.value, 'projectId', 'projectSuggestionId')}>
                <option value="">No project</option>
                {newProjects.map((x) => (
                  <option key={`s${x.id}`} value={`s:${x.id}`}>
                    {x.payload.title} (new)
                  </option>
                ))}
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select className="inp" style={{ width: 'auto' }} value={requesterValue} onChange={(e) => pick(e.target.value, 'requesterId', 'requesterSuggestionId')}>
                <option value="">Asked by nobody</option>
                {newPeople.map((x) => (
                  <option key={`s${x.id}`} value={`s:${x.id}`}>
                    {x.payload.title} (new)
                  </option>
                ))}
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      )}
      {kind === 'waiting_on' && <input className="inp" value={draft.waitingOn ?? ''} placeholder="Waiting on whom" onChange={(e) => set({ waitingOn: e.target.value })} />}
    </div>
  )
}
