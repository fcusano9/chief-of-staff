import { useEffect, useState } from 'react'
import type { NextAction, ProjectCard } from '@shared/types'
import { cos, errorMessage } from '../api'
import { useApp } from '../context'

type Card = NextAction | ProjectCard

/**
 * "Where this stands" (2–3 bullets to share) and the suggested next action, always written
 * together. Write asks the selected AI for both. For tasks, a daily briefing or an import that
 * includes the task writes them too; projects are written only on Write. It changes nothing;
 * Dismiss folds it to one line with Show, and a newer card replaces the whole thing.
 */
export function StatusCard({ scope, id, done = false }: { scope: 'task' | 'project'; id: number | null; done?: boolean }) {
  const { toast, ai, go } = useApp()
  const [card, setCard] = useState<Card | null>(null)
  const [writing, setWriting] = useState(false)

  useEffect(() => {
    setCard(null)
    if (id == null) return
    let cancelled = false
    const load = scope === 'task' ? cos['tasks.nextAction'](id) : cos['projects.card'](id)
    void load.then((c) => !cancelled && setCard(c))
    return () => {
      cancelled = true
    }
  }, [scope, id])

  if (id == null) return null

  const basic = ai.provider === 'demo'
  const write = () => {
    setWriting(true)
    const run = scope === 'task' ? cos['tasks.writeStatus'](id) : cos['projects.writeStatus'](id)
    run
      .then(setCard)
      .catch((err) => toast(errorMessage(err), true))
      .finally(() => setWriting(false))
  }
  const dismiss = (dismissed: boolean) => {
    const run = scope === 'task' ? cos['tasks.dismissNextAction'](id, dismissed) : cos['projects.dismissCard'](id, dismissed)
    run.then(setCard).catch((err) => toast(errorMessage(err), true))
  }
  const copy = (text: string) => void navigator.clipboard.writeText(text).then(() => toast('Copied'))
  const openSettings = () => {
    go('settings')
    window.setTimeout(() => document.getElementById('ai-providers')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  if (card?.dismissed) {
    return (
      <div className="row next-dismissed" data-testid="status-card">
        <span>✦ Where this stands and next step dismissed</span>
        <button type="button" className="link-btn" onClick={() => dismiss(false)}>
          Show
        </button>
      </div>
    )
  }

  const canWrite = !basic && !writing && !done
  return (
    <div className={`next-action ${card ? 'ai' : 'empty-next'}`} data-testid="status-card">
      <div className="row next-head">
        <span>✦ Where this stands and next step</span>
        <span className="spacer" />
        {card && (
          <button type="button" className="btn ghost sm" onClick={() => dismiss(true)}>
            Dismiss
          </button>
        )}
        <button type="button" className="btn sm next-write" disabled={!canWrite} onClick={write} title={done ? 'Reopen the task to write where it stands.' : basic ? 'Select an AI model in Settings to use this feature.' : undefined}>
          {writing ? 'Writing…' : card ? '✦ Refresh' : '✦ Write'}
        </button>
      </div>
      {card ? null : basic ? (
        <div className="next-hint">
          Select an AI model in{' '}
          <button type="button" className="link-btn" onClick={openSettings}>
            Settings
          </button>{' '}
          to use this feature.
        </div>
      ) : (
        <div className="next-hint">Click Write to see where this stands and the next step.</div>
      )}
      {card && card.status.length > 0 && (
        <div className="next-sec">
          <div className="row next-sh">
            <span>Where this stands</span>
            <span className="spacer" />
            <button type="button" className="btn ghost sm" onClick={() => copy(card.status.map((b) => `• ${b}`).join('\n'))}>
              Copy
            </button>
          </div>
          <ul className="next-bullets">
            {card.status.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      )}
      {card && (
        <div className="next-sec">
          <div className="row next-sh">
            <span>Suggested next action</span>
            <span className="spacer" />
            <button type="button" className="btn ghost sm" onClick={() => copy(card.action)}>
              Copy
            </button>
          </div>
          <div className="next-text">{card.action}</div>
        </div>
      )}
      {card?.staleSince && <div className="next-meta stale">Out of date: a newer update arrived on {card.staleSince}. Click Refresh to rewrite.</div>}
    </div>
  )
}
