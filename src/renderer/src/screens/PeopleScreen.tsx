import { useEffect, useRef, useState } from 'react'
import type { BriefSuggestion, PeopleFilter, PersonSummary, Task } from '@shared/types'
import { NO_COMPANY } from '@shared/types'
import { cos, errorMessage } from '../api'
import { Avatar, ConfirmButton, SearchBox, Stars, TaskRow } from '../components/bits'
import { HistoryWindow } from '../components/HistoryWindow'
import { SplitView } from '../components/SplitView'
import { useAutosave } from '../components/useAutosave'
import { useListKeys } from '../components/listKeys'
import { useApp } from '../context'

interface Draft {
  id: number
  name: string
  role: string
  company: string
  email: string
  priorityWeight: number
  standingInstructions: string
}

const dayLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

export function PeopleScreen() {
  const { people, openTask, refresh, toast, version, settings, saveSettings } = useApp()
  const [selected, setSelected] = useState<number | 'new' | null>(people[0]?.id ?? null)
  const [draft, setDraft] = useState<Draft | null>(null)
  // The context history (their brief's summary). It's edited in the History window, not the form.
  const [history, setHistory] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [search, setSearch] = useState('')
  const [tasks, setTasks] = useState<Task[]>([])
  // The person the draft was loaded for, so a refresh (e.g. after keeping a brief) keeps unsaved edits.
  const loadedFor = useRef<number | null>(null)
  const filter = settings.peopleFilter
  const setFilter = (patch: Partial<PeopleFilter>) => void saveSettings({ peopleFilter: { ...filter, ...patch } })

  /** Saves the form: the person, then their standing instructions (history read fresh, so it isn't overwritten). */
  const persist = async (d: Draft) => {
    const saved = await cos['people.save']({ id: d.id, name: d.name, role: d.role, company: d.company, email: d.email, priorityWeight: d.priorityWeight })
    const current = await cos['briefs.get']('person', saved.id)
    await cos['briefs.save']({ ...current, standingInstructions: d.standingInstructions })
    return saved
  }
  const { markClean, flush } = useAutosave(draft, persist)

  useEffect(() => {
    if (selected === null) {
      loadedFor.current = null
      markClean(null)
      return setDraft(null)
    }
    if (selected === 'new') {
      loadedFor.current = null
      setTasks([])
      setHistory('')
      // New people start at 1 star; raise it for people whose requests matter more.
      const fresh: Draft = { id: 0, name: '', role: '', company: '', email: '', priorityWeight: 1, standingInstructions: '' }
      markClean(fresh)
      return setDraft(fresh)
    }
    const p = people.find((x) => x.id === selected)
    if (!p) return setDraft(null) // just created: wait for the refreshed list
    void cos['tasks.listForPerson'](p.id).then(setTasks)
    const first = loadedFor.current !== p.id
    loadedFor.current = p.id
    void cos['briefs.get']('person', p.id).then((b) => {
      setHistory(b.summary)
      if (!first) return
      const loaded: Draft = { id: p.id, name: p.name, role: p.role ?? '', company: p.company ?? '', email: p.email ?? '', priorityWeight: p.priorityWeight, standingInstructions: b.standingInstructions }
      markClean(loaded)
      setDraft(loaded)
    })
  }, [selected, people, version])

  const save = async () => {
    if (!draft) return
    try {
      const saved = await persist(draft)
      markClean(draft)
      toast('Saved. Priorities updated.')
      if (draft.id === 0) select(saved.id)
      refresh()
    } catch (err) {
      toast(errorMessage(err), true)
    }
  }

  /** Switches the form to another person, saving pending edits first. */
  const select = (id: number | 'new' | null) => {
    if (id !== selected) flush()
    setShowHistory(false)
    setSelected(id)
  }


  const q = search.trim().toLowerCase()
  const companies = [...new Set(people.map((p) => p.company).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b))
  const shown = people.filter(
    (p) =>
      (!filter.company || (filter.company === NO_COMPANY ? !p.company : p.company === filter.company)) &&
      (!filter.openOnly || p.openCount + p.waitingCount > 0) &&
      (!q || [p.name, p.role, p.company, p.brief].some((f) => f?.toLowerCase().includes(q))),
  )
  useListKeys(shown.map((p) => p.id), selected, select)
  const filtering = !!filter.company || filter.openOnly
  const clearFilters = () => setFilter({ company: '', openOnly: false })

  const left = (
    <>
      <div className="head">
        <h1>People</h1>
        <span className="muted">most important first</span>
        <div className="spacer" />
        <button className="btn primary" onClick={() => select('new')}>
          Add person
        </button>
      </div>
      {people.length > 0 && (
        <div className="toolbar">
          <SearchBox value={search} onChange={setSearch} placeholder="Search name, role, company" />
        </div>
      )}
      {people.length > 0 && (
        <div className="row" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
          <select className="inp" style={{ width: 'auto', padding: '3px 8px' }} aria-label="Company" value={filter.company} onChange={(e) => setFilter({ company: e.target.value })}>
            <option value="">All companies</option>
            {[...companies, ...(filter.company && filter.company !== NO_COMPANY && !companies.includes(filter.company) ? [filter.company] : [])].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value={NO_COMPANY}>No company</option>
          </select>
          <button
            className={`pill ${filter.openOnly ? 'on' : ''}`}
            title="People with open tasks they asked you for, or tasks you're waiting on them for"
            aria-pressed={filter.openOnly}
            onClick={() => setFilter({ openOnly: !filter.openOnly })}
          >
            Open asks
          </button>
          {filtering && (
            <>
              <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
                {shown.length} of {people.length}
              </span>
              <button className="btn ghost" style={{ fontSize: 'var(--fs-sm)', padding: '2px 6px' }} onClick={clearFilters}>
                Clear
              </button>
            </>
          )}
        </div>
      )}
      <div className="list">
        {shown.map((p) => (
          <div key={p.id} className={`r ${selected === p.id ? 'sel' : ''}`} style={{ gridTemplateColumns: '40px minmax(0, 1fr) auto auto', paddingLeft: 10 }} onClick={() => select(p.id)}>
            <Avatar person={p} />
            <div className="ttl">
              {p.name}
              <div className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{[p.role, p.company].filter(Boolean).join(' · ')}</div>
            </div>
            <Stars value={p.priorityWeight} />
            <span className="mono muted" title="Open asks and waiting on" style={{ width: 22, textAlign: 'right' }}>
              {p.openCount + p.waitingCount}
            </span>
          </div>
        ))}
        {people.length === 0 && <div className="empty">Add the people who ask you for things. Their weight raises the priority of their requests.</div>}
        {people.length > 0 && shown.length === 0 && (
          <div className="empty">
            Nobody matches {q ? `“${search}”` : 'these filters'}.{' '}
            <button className="btn ghost" onClick={() => (clearFilters(), setSearch(''))}>
              Clear {q && filtering ? 'search and filters' : q ? 'search' : 'filters'}
            </button>
          </div>
        )}
      </div>
    </>
  )

  const person = typeof selected === 'number' ? (people.find((p) => p.id === selected) ?? null) : null
  const right = draft ? (
    <div className="editor">
      <div className="row" style={{ gap: 10, marginBottom: person && draft.id !== 0 ? 0 : 12 }}>
        <Avatar person={{ name: draft.name || '?' }} />
        <input className="inp title-inp" value={draft.name} placeholder="Name" autoFocus={draft.id === 0} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </div>
      {person && draft.id !== 0 && <PersonBrief key={person.id} person={person} hasContext={!!history.trim()} />}
      <label className="field">
        <span>Company</span>
        <input className="inp" list="company-options" value={draft.company} placeholder="e.g. Crestron" onChange={(e) => setDraft({ ...draft, company: e.target.value })} />
      </label>
      <datalist id="company-options">
        {companies.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
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
          <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>Higher weight raises the priority of their requests</span>
        </span>
      </div>
      <div className="label" style={{ marginTop: 12 }}>Standing instructions</div>
      <textarea className="inp" style={{ margin: '4px 0 10px', minHeight: 44 }} value={draft.standingInstructions} placeholder="e.g. Lead with the ask; keep it to three bullets" onChange={(e) => setDraft({ ...draft, standingInstructions: e.target.value })} />
      {draft.id !== 0 && (
        <div className="row" style={{ marginBottom: 12 }}>
          <button className="btn sm" onClick={() => setShowHistory(true)}>
            History <span className="mono muted">{history.split('\n').filter((l) => l.trim()).length}</span>
          </button>
          <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
            everything the AI has learned about them, newest first
          </span>
        </div>
      )}
      <div className="row" style={{ marginBottom: 18 }}>
        {draft.id !== 0 && (
          <ConfirmButton
            label="Delete person"
            confirmLabel="Click again: their tasks stay, with no requester"
            onConfirm={() =>
              void (markClean(draft), cos['people.delete'](draft.id)).then(() => {
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
              <TaskRow key={t.id} task={t} showWhy={false} onClick={() => openTask({ id: t.id, waiting: t.status === 'waiting_on' })} />
            ))}
            {tasks.length === 0 && <div className="empty">Nothing open for them.</div>}
          </div>
        </>
      )}
      {person && showHistory && (
        <HistoryWindow
          scope="person"
          ownerId={person.id}
          title={<b>{person.name}</b>}
          history={history}
          newCount={person.brief ? person.newNotes : 0}
          hint="One note per line. The AI reads this when it writes their brief, and on imports when they have no brief."
          empty={'No history yet. Accepted "Person context" suggestions from imports land here, newest first.'}
          placeholder="Add a note, e.g. Prefers Teams over email"
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  ) : (
    <div className="empty" style={{ marginTop: 80 }}>Select a person, or add one.</div>
  )

  return <SplitView left={left} right={right} />
}

/**
 * The one-line brief under a person's name. Regenerate asks the AI for a new one, shown as a
 * suggestion to keep or discard; Edit rewrites it by hand. Either saves on its own, apart from
 * the person's Save button.
 */
function PersonBrief({ person, hasContext }: { person: PersonSummary; hasContext: boolean }) {
  const { refresh, toast } = useApp()
  const [editing, setEditing] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<BriefSuggestion | null>(null)
  const [writing, setWriting] = useState(false)

  const write = async () => {
    setWriting(true)
    setSuggestion(null)
    setEditing(null)
    try {
      setSuggestion(await cos['people.suggestBrief'](person.id))
    } catch (err) {
      toast(errorMessage(err), true)
    } finally {
      setWriting(false)
    }
  }
  const keep = async (text: string, by: 'ai' | 'user') => {
    try {
      await cos['people.saveBrief'](person.id, text, by)
      setEditing(null)
      setSuggestion(null)
      toast('Brief updated')
      refresh()
    } catch (err) {
      toast(errorMessage(err), true)
    }
  }
  const byline = person.brief && person.briefAt ? `${person.briefBy === 'ai' ? 'Written by AI' : 'Edited by you'} on ${dayLabel(person.briefAt)}` : null

  return (
    <div style={{ margin: '2px 0 14px 38px' }}>
      {editing !== null ? (
        <>
          <textarea
            className="inp"
            aria-label="Brief"
            autoFocus
            rows={3}
            style={{ fontSize: 'calc(var(--fs) + 1px)', minHeight: 74 }}
            value={editing}
            placeholder="One sentence about who they are and what they do"
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
          <div data-brief style={{ fontSize: 'calc(var(--fs) + 1px)' }}>
            {person.brief ?? (
              <span className="faint">No brief yet. {hasContext ? 'Click Write brief, or Edit to write one yourself.' : 'Add some context below, or Edit to write one yourself.'}</span>
            )}
          </div>
          <div className="row" style={{ marginTop: 4, flexWrap: 'wrap' }}>
            {byline && <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{byline}</span>}
            {person.brief && person.newNotes > 0 && (
              <span className="note">
                {person.newNotes} new note{person.newNotes === 1 ? '' : 's'} since this brief
              </span>
            )}
            <div className="spacer" />
            <button
              className="btn ghost sm"
              onClick={() => {
                setSuggestion(null)
                setEditing(person.brief ?? '')
              }}
            >
              Edit
            </button>
            {hasContext && (
              <button className="btn sm" disabled={writing} onClick={() => void write()}>
                {writing ? 'Writing…' : person.brief ? '✦ Regenerate' : '✦ Write brief'}
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
            <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{suggestion.writtenBy}</span>
          </div>
          <div style={{ fontSize: 'calc(var(--fs) + 1px)' }}>{suggestion.text}</div>
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
