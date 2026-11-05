import { useEffect, useState } from 'react'
import type { NextAction } from '@shared/types'
import { cos, errorMessage } from '../api'
import { useApp } from '../context'

const stamp = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

/**
 * The task's suggested next action: one sentence plus why, written by the AI as part of a daily
 * briefing or an import. Shown here only; it changes nothing. Dismiss folds it to one line with
 * a Show link, and a newer suggestion replaces it.
 */
export function NextActionCard({ taskId }: { taskId: number | null }) {
  const { toast } = useApp()
  const [next, setNext] = useState<NextAction | null>(null)

  useEffect(() => {
    setNext(null)
    if (taskId == null) return
    let cancelled = false
    void cos['tasks.nextAction'](taskId).then((n) => !cancelled && setNext(n))
    return () => {
      cancelled = true
    }
  }, [taskId])

  const dismiss = (dismissed: boolean) => {
    if (taskId == null) return
    cos['tasks.dismissNextAction'](taskId, dismissed)
      .then(setNext)
      .catch((err) => toast(errorMessage(err), true))
  }

  if (!next) {
    return (
      <div className="next-action empty-next" data-testid="next-action">
        <div className="next-head muted">✦ Suggested next action</div>
        <div className="next-why">None yet. One is written when a daily briefing or an import includes this task. It is never written on its own.</div>
      </div>
    )
  }

  if (next.dismissed) {
    return (
      <div className="row next-dismissed" data-testid="next-action">
        <span>✦ Suggestion dismissed</span>
        <button type="button" className="link-btn" onClick={() => dismiss(false)}>
          Show
        </button>
      </div>
    )
  }

  const from = next.origin === 'briefing' ? 'From the daily briefing' : `From the import “${next.originLabel ?? 'Imported item'}”`
  return (
    <div className="next-action ai" data-testid="next-action">
      <div className="row next-head">
        <span>✦ Suggested next action</span>
        <span className="spacer" />
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => void navigator.clipboard.writeText(next.why ? `${next.action} ${next.why}` : next.action).then(() => toast('Copied'))}
        >
          Copy
        </button>
        <button type="button" className="btn ghost sm" onClick={() => dismiss(true)}>
          Dismiss
        </button>
      </div>
      <div className="next-text">{next.action}</div>
      {next.why && <div className="next-why">{next.why}</div>}
      <div className="next-meta">
        {from} · {stamp(next.writtenAt)}
        {next.staleSince && <span className="stale"> · Written before the latest update ({next.staleSince}). Refreshes with the next briefing or import.</span>}
      </div>
    </div>
  )
}
