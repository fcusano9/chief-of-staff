import { useEffect, useState, type ReactNode } from 'react'
import { useShortcutHints } from './hints'
import type { BriefScope } from '@shared/types'
import { cos, errorMessage } from '../api'
import { useApp } from '../context'

interface Note {
  date: string
  text: string
  source: string | null
}

/** The date stamp history notes use, matching notes added from Review: "Nov 3, 2026". */
export const noteStamp = () => new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

/** Splits a history line from Review ('Nov 2, 2026: text (from “Title”)'); other lines are kept whole. */
function parseNote(line: string): Note {
  const m = line.match(/^([A-Z][a-z]{2,8}\.? \d{1,2}, \d{4}): ([\s\S]*?)(?: \(from “(.*)”\))?$/)
  return m ? { date: m[1]!, text: m[2]!, source: m[3] ?? null } : { date: '', text: line, source: null }
}

/**
 * Every dated note about a project or person (their context brief's summary), newest first, in a
 * window over the page. The last `newCount` notes are marked new. Add appends a note; Edit
 * changes the whole history as text.
 */
export function HistoryWindow({
  scope,
  ownerId,
  title,
  history,
  newCount,
  hint,
  empty,
  placeholder,
  onClose,
}: {
  scope: BriefScope
  ownerId: number
  /** The window's heading, e.g. the project's color bar and name. */
  title: ReactNode
  history: string
  newCount: number
  /** Shown under the text while editing, e.g. what reads this history. */
  hint: string
  empty: string
  placeholder: string
  onClose: () => void
}) {
  const { refresh, toast } = useApp()
  const [adding, setAdding] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  useShortcutHints(editing !== null ? [['Ctrl ↵', 'save'], ['Esc', 'cancel']] : [['Esc', 'close']], 2)
  const lines = history.split('\n').map((l) => l.trim()).filter(Boolean)
  // Notes arrive at the end, so the new ones are the last few.
  const firstNew = lines.length - newCount
  const year = String(new Date().getFullYear())

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
    if (await write([...lines, `${noteStamp()}: ${text}`].join('\n'), 'Note added')) setAdding('')
  }
  const saveEdit = async () => {
    if (editing !== null && (await write(editing.trim(), 'History saved'))) setEditing(null)
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label={`${scope === 'person' ? 'Context' : 'Project'} history`}>
        <div className="dialog-head">
          {title}
          <span className="muted">
            {scope === 'person' ? 'context history' : 'history'} · {lines.length} note{lines.length === 1 ? '' : 's'}
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
              aria-label="History"
              autoFocus
              style={{ minHeight: 320, marginTop: 10, fontSize: 'var(--fs-sm)' }}
              value={editing}
              onChange={(e) => setEditing(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault()
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
                  aria-label="New note"
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
                      {note.date.endsWith(`, ${year}`) ? note.date.slice(0, -(year.length + 2)) : note.date}
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
