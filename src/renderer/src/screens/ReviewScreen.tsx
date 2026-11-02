import { useEffect, useState } from 'react'
import type { Suggestion, SuggestionPayload } from '@shared/types'
import { SOURCE_KIND_LABELS, SUGGESTION_LABELS } from '@shared/types'
import { cos, errorMessage } from '../api'
import { dueLabel, ProjectChip } from '../components/bits'
import { useApp } from '../context'

const isTyping = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')

/** AI suggestions waiting for a decision. Nothing changes until one is accepted. */
export function ReviewScreen() {
  const { version, refresh, toast, go, openTask } = useApp()
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
      toast(s.kind === 'new_task' ? 'Task created' : s.kind === 'brief_update' ? 'Brief updated' : 'Task updated', false)
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
      if (document.querySelector('.scrim') || isTyping() || e.ctrlKey || e.metaKey || e.altKey) return
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
      } else if (s && e.key === 'Enter') {
        e.preventDefault()
        startEdit(s)
      } else if (e.key === 'Escape') {
        setEditing(null)
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
                    <span className="chip" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                      {SUGGESTION_LABELS[s.kind]}
                    </span>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    {isEditing ? <Editor kind={s.kind} draft={draft} setDraft={setDraft} /> : <Summary s={s} onOpenTask={(id) => openTask({ id })} />}
                    {s.evidence && (
                      <div className="faint" style={{ fontSize: 12, marginTop: 4, fontStyle: 'italic', overflowWrap: 'anywhere' }}>
                        “{s.evidence}”
                      </div>
                    )}
                  </div>
                  <div className="row" style={{ gap: 4 }}>
                    <button className="btn" onClick={() => void accept(s, isEditing ? draft! : undefined)}>
                      Accept <span className="kbd">A</span>
                    </button>
                    {isEditing ? (
                      <button className="btn ghost" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    ) : (
                      <button className="btn ghost" onClick={() => startEdit(s)}>
                        Edit
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

function Summary({ s, onOpenTask }: { s: Suggestion; onOpenTask: (id: number) => void }) {
  const { projects, people } = useApp()
  const p = s.payload
  const project = projects.find((x) => x.id === p.projectId) ?? null
  const requester = people.find((x) => x.id === p.requesterId)?.name ?? p.requesterName
  const taskLink = p.taskId ? (
    <button className="btn ghost" style={{ padding: 0, fontWeight: 500 }} onClick={() => onOpenTask(p.taskId!)}>
      {s.taskTitle ?? p.title}
    </button>
  ) : null
  const meta = [
    p.dueDate ? `Due ${dueLabel(p.dueDate).text}` : null,
    requester ? `Asked by ${requester}${p.requesterId ? '' : ' (not in People)'}` : null,
    p.waitingOn ? `Waiting on ${p.waitingOn}` : null,
  ].filter(Boolean)

  return (
    <div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {s.kind === 'new_task' || (s.kind === 'waiting_on' && !p.taskId) ? <span style={{ fontWeight: 500 }}>{p.title}</span> : taskLink}
        {s.kind === 'brief_update' && <span className="muted">{p.briefScope} brief</span>}
        <ProjectChip project={project} />
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

function Editor({ kind, draft, setDraft }: { kind: Suggestion['kind']; draft: SuggestionPayload; setDraft: (d: SuggestionPayload) => void }) {
  const { projects, people } = useApp()
  const set = (patch: Partial<SuggestionPayload>) => setDraft({ ...draft, ...patch })
  const creates = kind === 'new_task' || (kind === 'waiting_on' && !draft.taskId)
  return (
    <div className="grid" style={{ gap: 6 }}>
      {creates && <input className="inp" autoFocus value={draft.title} placeholder="Task title" onChange={(e) => set({ title: e.target.value })} />}
      <textarea className="inp" style={{ minHeight: 48 }} value={draft.details} placeholder={kind === 'new_task' ? 'Notes (optional)' : 'Text'} onChange={(e) => set({ details: e.target.value })} />
      {(creates || kind === 'status_update') && (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input className="inp" style={{ width: 150 }} type="date" value={draft.dueDate ?? ''} onChange={(e) => set({ dueDate: e.target.value || null })} />
          {creates && (
            <>
              <select className="inp" style={{ width: 'auto' }} value={draft.projectId ?? ''} onChange={(e) => set({ projectId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select className="inp" style={{ width: 'auto' }} value={draft.requesterId ?? ''} onChange={(e) => set({ requesterId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Asked by nobody</option>
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
