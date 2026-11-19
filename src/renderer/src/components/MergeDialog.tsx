import { type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { shortDate } from '@shared/events'
import { earlier, type MergeChoices, type MergeField, mergeFields, type MergePick } from '@shared/merge'
import { noteLines } from '@shared/notes'
import { NO_PROJECT_COLOR, type Task } from '@shared/types'
import { cos, errorMessage } from '../api'
import { useApp } from '../context'
import { activityCount } from './ActivityLog'
import { daysSince, dueLabel } from './bits'
import { useShortcutHints } from './hints'

/** Ctrl+K "Merge with…": asks the open task editor to start a merge. */
const MERGE_REQUESTED = 'cos:merge-requested'
export const requestMerge = (): void => void window.dispatchEvent(new Event(MERGE_REQUESTED))
/** Runs `start` whenever Ctrl+K asks for a merge. */
export function useMergeRequests(start: () => void): void {
  const ref = useRef(start)
  ref.current = start
  useEffect(() => {
    const on = () => ref.current()
    window.addEventListener(MERGE_REQUESTED, on)
    return () => window.removeEventListener(MERGE_REQUESTED, on)
  }, [])
}

/** What the dialog counts for each item, besides what the task itself carries. */
interface Extra {
  updates: number
  activity: number
  statusCard: boolean
}

async function extraFor(task: Task): Promise<Extra> {
  const [brief, activity, card] = await Promise.all([cos['briefs.get']('task', task.id), cos['tasks.activity'](task.id), cos['tasks.nextAction'](task.id)])
  return { updates: noteLines(brief.summary).length, activity: activityCount(task, activity), statusCard: card != null }
}

const Bar = ({ color }: { color: string }) => <span style={{ width: 3, height: 16, borderRadius: 2, background: color, flex: 'none' }} />

/** A field's value as the dialog shows it. */
function show(task: Task, field: MergeField): ReactNode {
  switch (field) {
    case 'title':
      return task.title
    case 'waitingOn':
      return task.waitingOn
    case 'projectId':
      return (
        <span className="row" style={{ gap: 6, display: 'inline-flex' }}>
          <span className="dot" style={{ background: task.project?.color ?? NO_PROJECT_COLOR }} />
          {task.project?.name}
        </span>
      )
    case 'dueDate':
      return task.dueDate ? shortDate(task.dueDate) : null
    case 'requesterId':
      return task.requester?.name
    case 'priorityOverride':
      return <span className="mono">{task.priorityOverride}</span>
  }
}

const sinceText = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null)

/**
 * Merge, from the task editor (or Ctrl+K while it's open): pick another item from the same list,
 * then settle the fields where the two differ. The item the editor shows is kept; the other is
 * removed once everything has moved into it (TaskMergeService).
 */
export function MergeDialog({ keep, onClose, onMerged }: { keep: Task; onClose: () => void; onMerged: (task: Task) => void }) {
  const { toast } = useApp()
  const waiting = keep.status === 'waiting_on'
  const [items, setItems] = useState<Task[] | null>(null)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [other, setOther] = useState<Task | null>(null)
  const [extra, setExtra] = useState<[Extra, Extra] | null>(null)
  const [choices, setChoices] = useState<MergeChoices>({})
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useShortcutHints(other ? [['Ctrl ↵', 'merge'], ['Esc', 'back']] : [['↑ ↓', 'move'], ['↵', 'pick'], ['Esc', 'cancel']], 2)

  useEffect(() => {
    void cos['tasks.listActive']({ list: waiting ? 'waiting' : 'tasks' }).then((list) => setItems(list.filter((t) => t.id !== keep.id)))
  }, [keep.id, waiting])

  useEffect(() => {
    if (!other) {
      inputRef.current?.focus()
      return
    }
    setExtra(null)
    dialogRef.current?.focus()
    let cancelled = false
    void Promise.all([extraFor(keep), extraFor(other)]).then(([a, b]) => !cancelled && setExtra([a, b]))
    return () => {
      cancelled = true
    }
  }, [other, keep])

  const q = query.trim().toLowerCase()
  const shown = (items ?? []).filter((t) => !q || t.title.toLowerCase().includes(q) || (t.waitingOn ?? '').toLowerCase().includes(q))
  useEffect(() => setCursor(0), [query])
  useEffect(() => {
    document.querySelector('.merge-picker .pi.cur')?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const pickOther = (t: Task | undefined) => {
    if (!t) return
    setChoices({})
    setOther(t)
  }

  const merge = async () => {
    if (!other || busy) return
    setBusy(true)
    try {
      onMerged(await cos['tasks.merge'](keep.id, other.id, choices))
    } catch (err) {
      toast(errorMessage(err), true)
      setBusy(false)
    }
  }

  // Keys stop here, so the editor underneath (Ctrl+Enter saves) never sees them.
  const onKeyDown = (e: ReactKeyboardEvent) => {
    e.stopPropagation()
    if (!other) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setCursor((c) => Math.max(0, Math.min(shown.length - 1, c + (e.key === 'ArrowDown' ? 1 : -1))))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        pickOther(shown[cursor])
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      void merge()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOther(null)
    }
  }

  const close = (e: ReactMouseEvent) => e.target === e.currentTarget && onClose()

  if (!other) {
    return (
      <div className="scrim" onMouseDown={close} onKeyDown={onKeyDown}>
        <div className="palette merge-picker" role="dialog" aria-label="Merge with">
          <input ref={inputRef} value={query} placeholder={`Merge “${keep.title}” with…`} onChange={(e) => setQuery(e.target.value)} />
          <div style={{ maxHeight: 380, overflow: 'auto', paddingBottom: 6 }}>
            <div className="pg">{waiting ? 'Waiting' : 'Tasks'}</div>
            {shown.map((t, i) => (
              <div key={t.id} className={`pi ${i === cursor ? 'cur' : ''}`} data-merge-id={t.id} onMouseEnter={() => setCursor(i)} onClick={() => pickOther(t)}>
                <Bar color={t.project?.color ?? NO_PROJECT_COLOR} />
                <span className="ttl" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.title}
                </span>
                <span className="faint" style={{ fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' }}>
                  {waiting
                    ? [t.waitingOn, `${daysSince(t.waitingSince)}d`].filter(Boolean).join(' · ')
                    : [t.project?.name, t.dueDate ? dueLabel(t.dueDate).text : null].filter(Boolean).join(' · ')}
                </span>
              </div>
            ))}
            {items && shown.length === 0 && <div className="pi faint">{q ? 'No matches' : `No other ${waiting ? 'waiting items' : 'open tasks'}`}</div>}
          </div>
        </div>
      </div>
    )
  }

  const rows = mergeFields(keep, other).filter((r) => r.state !== 'empty')
  const pickOf = (field: MergeField): MergePick => choices[field] ?? 'keep'
  const value = (task: Task, field: MergeField) => show(task, field) ?? <span className="faint">—</span>
  const pair = (a: number, b: number) => (
    <>
      <span className="mono">{a}</span> <span className="faint">+</span> <span className="mono">{b}</span>
    </>
  )
  const [ka, kb] = extra ?? [null, null]
  // A Combined row only when the item merged in has some of it.
  const combined: [string, ReactNode][] = [
    ...(other.notes?.trim() ? [['Notes', keep.notes?.trim() ? 'Both' : 'Moved over'] as [string, ReactNode]] : []),
    ...(other.subtasks.length ? [['Subtasks', pair(keep.subtasks.length, other.subtasks.length)] as [string, ReactNode]] : []),
    ...(ka && kb && kb.updates ? [['Updates', pair(ka.updates, kb.updates)] as [string, ReactNode]] : []),
    ...(ka && kb && kb.activity ? [['Activity', pair(ka.activity, kb.activity)] as [string, ReactNode]] : []),
    ...(other.linkedSources.length ? [['Linked imports', pair(keep.linkedSources.length, other.linkedSources.length)] as [string, ReactNode]] : []),
    ...(other.followUpCount
      ? [['Follow-ups', <>{pair(keep.followUpCount, other.followUpCount)} <span className="faint">=</span> <span className="mono">{keep.followUpCount + other.followUpCount}</span></>] as [string, ReactNode]]
      : []),
  ]
  const cleared = [ka?.statusCard || kb?.statusCard ? 'Status card' : null, keep.aiAdjustment || other.aiAdjustment ? 'AI priority change' : null].filter(Boolean)
  const since = earlier(keep.waitingSince, other.waitingSince)

  return (
    <div className="scrim" onMouseDown={close} onKeyDown={onKeyDown}>
      <div className="dialog merge-dialog" role="dialog" aria-label={`Merge ${waiting ? 'waiting items' : 'tasks'}`} tabIndex={-1} ref={dialogRef}>
        <div className="dialog-head">
          <b style={{ fontWeight: 600 }}>Merge {waiting ? 'waiting items' : 'tasks'}</b>
          <div className="spacer" />
          <button className="btn ghost sm" onClick={onClose}>
            Cancel
          </button>
        </div>
        <div className="dialog-body">
          <table className="merge-grid">
            <thead>
              <tr>
                <th />
                {[['Keep', keep], ['Merge in', other]].map(([label, t]) => (
                  <th key={label as string}>
                    <span className="muted">{label as string}</span>
                    <div className="row" style={{ gap: 6 }}>
                      <Bar color={(t as Task).project?.color ?? NO_PROJECT_COLOR} />
                      <b style={{ fontWeight: 600 }}>{(t as Task).title}</b>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.field} data-field={r.field}>
                  <td className="k">{r.label}</td>
                  {r.state === 'choose' ? (
                    (['keep', 'other'] as MergePick[]).map((side) => (
                      <td key={side}>
                        <label className="pick">
                          <input type="radio" name={`merge-${r.field}`} checked={pickOf(r.field) === side} onChange={() => setChoices((c) => ({ ...c, [r.field]: side }))} />
                          <span>{value(side === 'keep' ? keep : other, r.field)}</span>
                        </label>
                      </td>
                    ))
                  ) : r.state === 'same' ? (
                    <td colSpan={2}>
                      {value(keep, r.field)}
                      <span className="faint" style={{ fontSize: 'var(--fs-xs)', marginLeft: 6 }}>both</span>
                    </td>
                  ) : (
                    <>
                      <td>{value(keep, r.field)}</td>
                      <td>{value(other, r.field)}</td>
                    </>
                  )}
                </tr>
              ))}
              {waiting && (
                <tr>
                  <td className="k">Waiting since</td>
                  {[keep, other].map((t) => (
                    <td key={t.id} className={t.waitingSince === since ? '' : 'faint'}>
                      {sinceText(t.waitingSince) ?? '—'}
                    </td>
                  ))}
                </tr>
              )}
              {combined.length > 0 && (
                <tr className="sub-h">
                  <td colSpan={3}>Combined</td>
                </tr>
              )}
              {combined.map(([label, v]) => (
                <tr key={label}>
                  <td className="k">{label}</td>
                  <td colSpan={2}>{v}</td>
                </tr>
              ))}
              {cleared.length > 0 && (
                <tr>
                  <td className="k">Cleared</td>
                  <td colSpan={2} style={{ color: 'var(--warn)' }}>
                    {cleared.join(', ')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="dialog-foot">
          <button className="btn ghost" onClick={() => setOther(null)}>
            Back
          </button>
          <div className="spacer" />
          <button className="btn primary" data-action="merge-confirm" disabled={busy || !extra} onClick={() => void merge()}>
            Merge
          </button>
        </div>
      </div>
    </div>
  )
}
