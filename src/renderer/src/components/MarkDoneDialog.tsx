import { useState } from 'react'
import { useShortcutHints } from './hints'

/**
 * Asks for an optional resolution before a task is marked done. Mark done (or Ctrl+Enter) passes
 * the text, which may be empty; Cancel, Esc, or a click outside leaves the task as it is.
 */
export function MarkDoneDialog({
  title,
  initial = '',
  onDone,
  onCancel,
}: {
  title: string
  /** A resolution the task already has (it was done before and reopened). */
  initial?: string
  onDone: (resolution: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(initial)
  useShortcutHints([['Ctrl ↵', 'mark done'], ['Esc', 'cancel']], 3)
  const done = () => onDone(text.trim())

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        className="dialog"
        role="dialog"
        aria-label="Mark done"
        data-dialog="mark-done"
        style={{ width: 480 }}
        onKeyDown={(e) => {
          // Stopped here so the task editor around it doesn't also save or close.
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault()
            e.stopPropagation()
            done()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onCancel()
          }
        }}
      >
        <div className="dialog-head" style={{ minWidth: 0 }}>
          <b style={{ fontWeight: 600, flex: 'none' }}>Mark done</b>
          <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </span>
        </div>
        <div className="dialog-body">
          <textarea
            className="inp"
            aria-label="Resolution"
            autoFocus
            style={{ minHeight: 110, marginTop: 12 }}
            value={text}
            placeholder="Resolution (optional)"
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <div className="dialog-foot">
          <div className="spacer" />
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" data-action="confirm-done" onClick={done}>
            Mark done
          </button>
        </div>
      </div>
    </div>
  )
}
