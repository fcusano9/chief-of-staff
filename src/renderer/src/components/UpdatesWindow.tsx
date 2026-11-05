import { useEffect, useState, type ReactNode } from 'react'
import { useShortcutHints } from './hints'
import type { BriefScope } from '@shared/types'
import { latestNote, noteLines, noteStamp, parseNote } from '@shared/notes'
import { cos, errorMessage } from '../api'
import { useApp } from '../context'

const year = () => String(new Date().getFullYear())
/** "Nov 3" for this year, "Nov 3, 2025" otherwise. */
const shortDate = (date: string) => (date.endsWith(`, ${year()}`) ? date.slice(0, -(year().length + 2)) : date)

/**
 * The latest update under a project's, person's or task's Updates button. Clicking it opens the
 * Updates window. Nothing is shown when there are no updates yet.
 */
export function LatestUpdate({ updates, onOpen }: { updates: string; onOpen: () => void }) {
  const note = latestNote(updates)
  if (!note) return null
  return (
    <button type="button" className="card latest" data-latest onClick={onOpen} title="Open all updates">
      <div className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
        Latest{note.date ? ` · ${shortDate(note.date)}` : ''}
        {note.source ? ` · from “${note.source}”` : ''}
      </div>
      <div>{note.text}</div>
    </button>
  )
}

/** The Updates button with its count. */
export function UpdatesButton({ updates, onOpen }: { updates: string; onOpen: () => void }) {
  return (
    <button className="btn sm" onClick={onOpen}>
      Updates <span className="mono muted">{noteLines(updates).length}</span>
    </button>
  )
}

/**
 * Every update about a project, person or task (their context brief's summary), newest first, in
 * a window over the page. The last `newCount` are marked new. Add appends one; Edit changes them
 * all as text.
 */
export function UpdatesWindow({
  scope,
  ownerId,
  title,
  updates,
  newCount,
  hint,
  empty,
  placeholder,
  onChange,
  onClose,
}: {
  scope: BriefScope
  ownerId: number
  /** The window's heading, e.g. the project's color bar and name. */
  title: ReactNode
  updates: string
  newCount: number
  /** Shown under the text while editing, e.g. what reads these updates. */
  hint: string
  empty: string
  placeholder: string
  /** Called with the new text after Add or Edit saves, so the page can show it. */
  onChange?: (updates: string) => void
  onClose: () => void
}) {
  const { refresh, toast } = useApp()
  const [adding, setAdding] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  useShortcutHints(editing !== null ? [['Ctrl ↵', 'save'], ['Esc', 'cancel']] : [['Esc', 'close']], 2)
  const lines = noteLines(updates)
  // Notes arrive at the end, so the new ones are the last few.
  const firstNew = lines.length - newCount

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && editing === null) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, onClose])

  const write = async (summary: string, message: string) => {
    try {
      const current = await cos['briefs.get'](scope, ownerId)
      await cos['briefs.save']({ ...current, summary })
      onChange?.(summary)
      toast(message)
      refresh()
      return true
    } catch (err) {
      toast(errorMessage(err), true)
      return false
    }
  }
  const add = async () => {
    const text = adding.replace(/\s+/g, ' ').trim()
    if (!text) return
    if (await write([...lines, `${noteStamp()}: ${text}`].join('\n'), 'Update added')) setAdding('')
  }
  const saveEdit = async () => {
    if (editing !== null && (await write(editing.trim(), 'Updates saved'))) setEditing(null)
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label="Updates">
        <div className="dialog-head">
          {title}
          <span className="muted">
            updates · {lines.length}
          </span>
          <div className="spacer" />
          {editing === null && (
            <button className="btn ghost sm" onClick={() => setEditing(lines.join('\n'))}>
              Edit
            </button>
          )}
          <button className="btn ghost sm" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="dialog-body">
          {editing !== null ? (
            <textarea
              className="inp"
              aria-label="Updates"
              autoFocus
              style={{ minHeight: 320, marginTop: 10, fontSize: 'var(--fs-sm)' }}
              value={editing}
              onChange={(e) => setEditing(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault()
                  e.stopPropagation() // the task editor around it saves on Ctrl+Enter too
                  void saveEdit()
                } else if (e.key === 'Escape') {
                  e.stopPropagation()
                  setEditing(null)
                }
              }}
            />
          ) : (
            <>
              <div className="row" style={{ margin: '10px 0 6px' }}>
                <input
                  className="inp"
                  aria-label="New update"
                  autoFocus
                  value={adding}
                  placeholder={placeholder}
                  onChange={(e) => setAdding(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void add()}
                />
                <button className="btn" disabled={!adding.trim()} onClick={() => void add()}>
                  Add
                </button>
              </div>
              {lines.length === 0 && <div className="empty">{empty}</div>}
              {lines
                .map((line, i) => ({ note: parseNote(line), isNew: i >= firstNew, i }))
                .reverse()
                .map(({ note, isNew, i }) => (
                  <div key={i} className="hist" data-note>
                    <span className="mono muted" style={{ fontSize: 'var(--fs-xs)', paddingTop: 2 }}>
                      {shortDate(note.date)}
                      {isNew && <span className="hist-new"> new</span>}
                    </span>
                    <div>
                      {note.text}
                      {note.source && <div className="faint" style={{ fontSize: 'var(--fs-xs)' }}>from “{note.source}”</div>}
                    </div>
                  </div>
                ))}
            </>
          )}
        </div>
        {editing !== null && (
          <div className="dialog-foot">
            <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>{hint}</span>
            <div className="spacer" />
            <button className="btn ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button className="btn primary" onClick={() => void saveEdit()}>
              Save
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
