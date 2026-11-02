import { useEffect, useState } from 'react'
import type { Task } from '@shared/types'
import { cos, errorMessage } from '../api'
import { Avatar, ConfirmButton, Stars, TaskRow } from '../components/bits'
import { SplitView } from '../components/SplitView'
import { useApp } from '../context'

interface Draft {
  id: number
  name: string
  role: string
  email: string
  priorityWeight: number
  summary: string
  standingInstructions: string
}

export function PeopleScreen() {
  const { people, openTask, refresh, toast, version } = useApp()
  const [selected, setSelected] = useState<number | 'new' | null>(people[0]?.id ?? null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])

  useEffect(() => {
    if (selected === null) return setDraft(null)
    if (selected === 'new') {
      setTasks([])
      return setDraft({ id: 0, name: '', role: '', email: '', priorityWeight: 3, summary: '', standingInstructions: '' })
    }
    const p = people.find((x) => x.id === selected)
    if (!p) return setDraft(null) // just created: wait for the refreshed list
    void cos['briefs.get']('person', p.id).then((b) =>
      setDraft({ id: p.id, name: p.name, role: p.role ?? '', email: p.email ?? '', priorityWeight: p.priorityWeight, summary: b.summary, standingInstructions: b.standingInstructions }),
    )
    void cos['tasks.listForPerson'](p.id).then(setTasks)
  }, [selected, people, version])

  const save = async () => {
    if (!draft) return
    try {
      const saved = await cos['people.save']({ id: draft.id, name: draft.name, role: draft.role, email: draft.email, priorityWeight: draft.priorityWeight })
      await cos['briefs.save']({ scope: 'person', ownerId: saved.id, summary: draft.summary, standingInstructions: draft.standingInstructions, updatedAt: null })
      toast('Saved. Priorities updated.')
      setSelected(saved.id)
      refresh()
    } catch (err) {
      toast(errorMessage(err), true)
    }
  }

  const left = (
    <>
      <div className="head">
        <h1>People</h1>
        <span className="muted">most important first</span>
        <div className="spacer" />
        <button className="btn primary" onClick={() => setSelected('new')}>
          Add person
        </button>
      </div>
      <div className="list">
        {people.map((p) => (
          <div key={p.id} className={`r ${selected === p.id ? 'sel' : ''}`} style={{ gridTemplateColumns: '40px minmax(0, 1fr) auto auto', paddingLeft: 10 }} onClick={() => setSelected(p.id)}>
            <Avatar person={p} />
            <div className="ttl">
              {p.name}
              <div className="faint" style={{ fontSize: 11 }}>{p.role}</div>
            </div>
            <Stars value={p.priorityWeight} />
            <span className="mono muted" title="Open asks" style={{ width: 22, textAlign: 'right' }}>{p.openCount}</span>
          </div>
        ))}
        {people.length === 0 && <div className="empty">Add the people who ask you for things. Their weight raises the priority of their requests.</div>}
      </div>
    </>
  )

  const right = draft ? (
    <div className="editor">
      <div className="row" style={{ gap: 10, marginBottom: 12 }}>
        <Avatar person={{ name: draft.name || '?' }} />
        <input className="inp title-inp" value={draft.name} placeholder="Name" autoFocus={draft.id === 0} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </div>
      <label className="field">
        <span>Role</span>
        <input className="inp" value={draft.role} placeholder="e.g. VP, Product" onChange={(e) => setDraft({ ...draft, role: e.target.value })} />
      </label>
      <label className="field">
        <span>Email</span>
        <input className="inp" value={draft.email} placeholder="name@company.com" onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
      </label>
      <div className="field">
        <span>Weight</span>
        <span className="row">
          <Stars value={draft.priorityWeight} onChange={(v) => setDraft({ ...draft, priorityWeight: v })} />
          <span className="faint" style={{ fontSize: 12 }}>Higher weight raises the priority of their requests</span>
        </span>
      </div>
      <div className="label" style={{ marginTop: 12 }}>Person brief · what the AI knows about them</div>
      <textarea className="inp" style={{ margin: '4px 0 10px', minHeight: 80 }} value={draft.summary} placeholder="How they like to work, what they care about, history" onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
      <div className="label">Standing instructions</div>
      <textarea className="inp" style={{ margin: '4px 0 12px', minHeight: 44 }} value={draft.standingInstructions} placeholder="e.g. Lead with the ask; keep it to three bullets" onChange={(e) => setDraft({ ...draft, standingInstructions: e.target.value })} />
      <div className="row" style={{ marginBottom: 18 }}>
        {draft.id !== 0 && (
          <ConfirmButton
            label="Delete person"
            confirmLabel="Click again: their tasks stay, with no requester"
            onConfirm={() =>
              void cos['people.delete'](draft.id).then(() => {
                toast('Person deleted')
                setSelected(null)
                refresh()
              })
            }
          />
        )}
        <div className="spacer" />
        <button className="btn primary" onClick={() => void save()}>
          Save
        </button>
      </div>
      {draft.id !== 0 && (
        <>
          <div className="label" style={{ marginBottom: 4 }}>Their open asks</div>
          <div className="list">
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} showWhy={false} onClick={() => openTask({ id: t.id })} />
            ))}
            {tasks.length === 0 && <div className="empty">Nothing open for them.</div>}
          </div>
        </>
      )}
    </div>
  ) : (
    <div className="empty" style={{ marginTop: 80 }}>Select a person, or add one.</div>
  )

  return <SplitView left={left} right={right} />
}
