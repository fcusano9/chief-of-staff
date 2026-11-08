import { useEffect, useState } from 'react'
import type { ReplyDraft, ReplyTarget } from '@shared/types'
import { cos, errorMessage } from '../api'
import { useApp } from '../context'
import { mailAppName } from './mailApp'

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

type Phase = { kind: 'idle' } | { kind: 'writing' } | { kind: 'draft'; draft: ReplyDraft; replyAll: boolean; body: string; retry: boolean; note: string } | { kind: 'saved'; ids: { entryId: string; storeId: string } } | { kind: 'opened' }

/**
 * The Reply card on a task linked to an email (Outlook, or Apple Mail on the Mac). Draft reply asks
 * the AI for a reply (its own first draft); the user checks the recipients and text, can Try again
 * with a note, then either opens it in a reply window of the mail app to finish, or saves it to the
 * mail app's Drafts. Nothing is ever sent. Hidden on tasks with no linked email.
 */
export function ReplyCard({ taskId, onSaved }: { taskId: number | null; onSaved?: () => void }) {
  const { toast, ai, go } = useApp()
  const [target, setTarget] = useState<ReplyTarget | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  useEffect(() => {
    setTarget(null)
    setPhase({ kind: 'idle' })
    if (taskId == null) return
    let cancelled = false
    void cos['replies.target'](taskId).then((t) => !cancelled && setTarget(t))
    return () => {
      cancelled = true
    }
  }, [taskId])

  if (taskId == null || !target) return null

  const basic = ai.provider === 'demo'
  const write = (revision: { note: string; previous: string } | null) => {
    const back = phase
    setPhase({ kind: 'writing' })
    cos['replies.draft'](taskId, revision)
      .then((draft) => setPhase({ kind: 'draft', draft, replyAll: draft.replyAll, body: draft.body, retry: false, note: '' }))
      .catch((err) => {
        toast(errorMessage(err), true)
        setPhase(back.kind === 'draft' ? { ...back, retry: false } : { kind: 'idle' })
      })
  }
  const appName = mailAppName(target.app)
  const save = (p: Extract<Phase, { kind: 'draft' }>) => {
    cos['replies.save'](taskId, { replyAll: p.replyAll, body: p.body })
      .then((ids) => {
        setPhase({ kind: 'saved', ids })
        toast(`Saved to ${appName} Drafts`)
        onSaved?.()
      })
      .catch((err) => toast(errorMessage(err), true))
  }
  const openInApp = (p: Extract<Phase, { kind: 'draft' }>) => {
    cos['replies.open'](taskId, { replyAll: p.replyAll, body: p.body })
      .then(() => {
        setPhase({ kind: 'opened' })
        onSaved?.()
      })
      .catch((err) => toast(errorMessage(err), true))
  }
  const openSettings = () => {
    go('settings')
    window.setTimeout(() => document.getElementById('ai-providers')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  // After drafting, the line shows the email Outlook found (it may be newer than the app knew).
  const email = phase.kind === 'draft' ? phase.draft.email : target
  const head = (
    <>
      <div className="row rp-head">
        <b>✉ Reply</b>
        <span className="spacer" />
        {target.supported && (
          <button type="button" className="btn ghost sm" onClick={() => cos['mail.open'](target.sourceId).catch((err) => toast(errorMessage(err), true))}>
            Open email
          </button>
        )}
      </div>
      <div className="rp-mail">
        {email.followUp ? `Follow-up to your email “${target.subject}” to ${email.from}` : `To the email “${target.subject}” from ${email.from}`} · {day(email.at)}
      </div>
    </>
  )

  if (!target.supported) {
    return (
      <div className="rp" data-testid="reply-card">
        {head}
        <div className="next-hint">Draft replies only work with Classic Outlook on Windows.</div>
      </div>
    )
  }

  if (phase.kind === 'idle' || phase.kind === 'writing') {
    return (
      <div className="rp" data-testid="reply-card">
        {head}
        <div className="row" style={{ marginTop: 6 }}>
          {basic ? (
            <span className="next-hint" style={{ margin: 0 }}>
              Select an AI model in{' '}
              <button type="button" className="link-btn" onClick={openSettings}>
                Settings
              </button>{' '}
              to use this feature.
            </span>
          ) : (
            <span className="next-hint" style={{ margin: 0 }}>
              Click Draft reply for a {target.followUp ? 'follow-up' : 'reply'} written from the email and this task.
            </span>
          )}
          <span className="spacer" />
          <button type="button" className="btn sm" disabled={basic || phase.kind === 'writing'} onClick={() => write(null)}>
            {phase.kind === 'writing' ? 'Writing…' : '✦ Draft reply'}
          </button>
        </div>
      </div>
    )
  }

  if (phase.kind === 'saved') {
    return (
      <div className="rp" data-testid="reply-card">
        {head}
        <div className="row" style={{ marginTop: 6 }}>
          <span className="rp-ok">Saved to {appName} Drafts</span>
          <span className="spacer" />
          <button type="button" className="btn ghost sm" onClick={() => setPhase({ kind: 'idle' })}>
            Write another
          </button>
          <button type="button" className="btn sm" onClick={() => cos['replies.openDraft'](phase.ids.entryId, phase.ids.storeId).catch((err) => toast(errorMessage(err), true))}>
            Open in {appName}
          </button>
        </div>
      </div>
    )
  }

  if (phase.kind === 'opened') {
    return (
      <div className="rp" data-testid="reply-card">
        {head}
        <div className="row" style={{ marginTop: 6 }}>
          <span className="rp-ok">Opened in {appName}</span>
          <span className="spacer" />
          <button type="button" className="btn ghost sm" onClick={() => setPhase({ kind: 'idle' })}>
            Write another
          </button>
        </div>
      </div>
    )
  }

  const p = phase
  const to = p.replyAll ? p.draft.replyAllTo : p.draft.reply
  return (
    <div className="rp" data-testid="reply-card">
      {head}
      <div className="rp-sec">
        <div className="rp-who">
          <span className="rp-k">Send to</span>
          <span className="seg rp-seg">
            <button type="button" className={p.replyAll ? 'on' : ''} onClick={() => setPhase({ ...p, replyAll: true })}>
              Reply all
            </button>
            <button type="button" className={p.replyAll ? '' : 'on'} onClick={() => setPhase({ ...p, replyAll: false })}>
              Reply
            </button>
          </span>
          {p.replyAll === p.draft.replyAll && <span className="faint rp-pick">AI pick</span>}
        </div>
        <div className="rp-who">
          <span className="rp-k">To</span>
          <span>{to.to || target.from}</span>
        </div>
        {to.cc && (
          <div className="rp-who">
            <span className="rp-k">Cc</span>
            <span>{to.cc}</span>
          </div>
        )}
        <div className="rp-who">
          <span className="rp-k">Subject</span>
          <span>{p.draft.subject}</span>
        </div>
      </div>
      <textarea className="inp rp-body" aria-label="Draft reply" value={p.body} onChange={(e) => setPhase({ ...p, body: e.target.value })} />
      <div className="row" style={{ marginTop: 8 }}>
        {p.retry ? (
          <>
            <input
              className="inp"
              aria-label="What should change"
              autoFocus
              placeholder="What should change? (optional) e.g. Say yes, but push to Friday"
              value={p.note}
              onChange={(e) => setPhase({ ...p, note: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') write({ note: p.note, previous: p.body })
                else if (e.key === 'Escape') setPhase({ ...p, retry: false })
              }}
            />
            <button type="button" className="btn ghost sm" onClick={() => setPhase({ ...p, retry: false })}>
              Cancel
            </button>
            <button type="button" className="btn sm" onClick={() => write({ note: p.note, previous: p.body })}>
              ✦ Rewrite
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn ghost sm" onClick={() => setPhase({ kind: 'idle' })}>
              Discard
            </button>
            <button type="button" className="btn ghost sm" onClick={() => setPhase({ ...p, retry: true })}>
              ✦ Try again
            </button>
            <span className="spacer" />
            <button type="button" className="btn sm" disabled={!p.body.trim()} onClick={() => openInApp(p)}>
              Open in {appName}
            </button>
            <button type="button" className="btn primary sm" disabled={!p.body.trim()} onClick={() => save(p)}>
              Save to {appName} Drafts
            </button>
          </>
        )}
      </div>
    </div>
  )
}
