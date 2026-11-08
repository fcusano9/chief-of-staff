import { useEffect, useState } from 'react'
import type { MailCheck, MailInfo, MailJobStatus } from '@shared/types'
import { cos, errorMessage } from '../api'
import { CostNote } from './bits'
import { useApp } from '../context'

type Since = 'last' | '7' | '30' | 'custom'
type Stage = 'idle' | 'checking' | 'ready' | 'reading' | 'done'

const DAY = 86_400_000
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const stamp = (iso: string) => {
  const d = new Date(iso)
  const today = localDay(d) === localDay(new Date())
  return `${today ? 'today' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
}
/** Rough minutes to read n conversations, from the extraction benchmark (see docs/DECISIONS.md). */
const estimate = (provider: string, n: number) => (provider === 'demo' ? null : Math.max(1, Math.ceil((n * (provider === 'local' ? 40 : 8)) / 60)))

/**
 * The mail card on Import: "Outlook mail" on Windows, "Apple Mail" on the Mac. Check looks (nothing
 * is sent), then Read sends the chosen conversations to the AI one at a time. Progress comes from
 * polling mail.status. It shows the mailbox addresses being read; on the Mac, Change opens Settings.
 */
export function OutlookImport({ onFinished }: { onFinished: () => void }) {
  const { ai, toast, refresh, go } = useApp()
  const [info, setInfo] = useState<MailInfo | null>(null)
  const [since, setSince] = useState<Since>('last')
  const [customDate, setCustomDate] = useState(() => localDay(new Date(Date.now() - 14 * DAY)))
  const [stage, setStage] = useState<Stage>('idle')
  const [check, setCheck] = useState<MailCheck | null>(null)
  const [readAnyway, setReadAnyway] = useState<Set<string>>(new Set())
  const [showSkipped, setShowSkipped] = useState(false)
  const [job, setJob] = useState<MailJobStatus | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [addresses, setAddresses] = useState<string[]>([])

  useEffect(() => {
    void cos['mail.info']().then((i) => {
      setInfo(i)
      if (!i.lastImportAt) setSince('7')
      if (i.supported && !i.needsAccounts) void cos['mail.addresses']().then(setAddresses).catch(() => {})
    })
    // Reading carries on in the background if you leave Import; pick it back up.
    void cos['mail.status']().then((s) => {
      if (s.state === 'reading') {
        setJob(s)
        setStage('reading')
      }
    })
  }, [])

  useEffect(() => {
    if (stage !== 'reading') return
    let last = -1
    const timer = setInterval(() => {
      void cos['mail.status']().then((s) => {
        setJob(s)
        if (s.done !== last) {
          last = s.done
          refresh() // new suggestions show up in Review's count as each conversation finishes
        }
        if (s.state !== 'reading') {
          setStage('done')
          void cos['mail.info']().then(setInfo)
          onFinished()
        }
      })
    }, 700)
    return () => clearInterval(timer)
  }, [stage])

  if (!info) return null
  if (!info.supported) {
    return (
      <div className="card" style={{ marginBottom: 16, color: 'var(--muted)' }}>
        <b style={{ fontWeight: 500, color: 'var(--text)' }}>Outlook mail</b> · reading mail needs classic Outlook on Windows.
      </div>
    )
  }

  const apple = info.app === 'apple-mail'
  const title = apple ? 'Apple Mail' : 'Outlook mail'
  const appName = apple ? 'Apple Mail' : 'Outlook'
  const openMailSettings = () => {
    go('settings')
    window.setTimeout(() => document.getElementById('apple-mail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const sinceIso = () =>
    since === 'last' ? info.defaultSince
    : since === 'custom' ? new Date(`${customDate}T00:00:00`).toISOString()
    : new Date(Date.now() - Number(since) * DAY).toISOString()

  const runCheck = async () => {
    setNotice(null)
    setStage('checking')
    try {
      setCheck(await cos['mail.check'](sinceIso()))
      if (!addresses.length) void cos['mail.addresses']().then(setAddresses).catch(() => {})
      setReadAnyway(new Set())
      setShowSkipped(false)
      setStage('ready')
    } catch (err) {
      setNotice(errorMessage(err))
      setStage('idle')
    }
  }

  const toRead = check ? check.conversations.filter((c) => !c.skipReason || readAnyway.has(c.key)) : []
  const skipped = check ? check.conversations.filter((c) => c.skipReason) : []

  const startRead = async () => {
    if (!check) return
    try {
      setJob(await cos['mail.read'](check.id, toRead.map((c) => c.key)))
      setStage('reading')
    } catch (err) {
      toast(errorMessage(err), true)
    }
  }

  const reset = () => {
    setStage('idle')
    setCheck(null)
    setJob(null)
  }

  const minutes = estimate(ai.provider, toRead.length)
  const where = ai.sendsDataExternally ? `sent to ${ai.provider === 'claude' ? 'Anthropic' : 'your Ollama server'}` : 'nothing leaves this computer'

  return (
    <>
      <div className="card" data-outlook style={{ marginBottom: 12 }}>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <b style={{ fontWeight: 600 }}>{title}</b>
          <span className="muted">· {info.lastImportAt ? `last imported ${stamp(info.lastImportAt)}` : 'never imported'}</span>
        </div>

        {stage === 'idle' && info.needsAccounts && (
          <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
            <span className="muted">
              Choose which Apple Mail accounts to read in{' '}
              <button type="button" className="link-btn" onClick={openMailSettings}>
                Settings
              </button>
              .
            </span>
          </div>
        )}

        {stage === 'idle' && !info.needsAccounts && (
          <>
            <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
              <span className="muted">Read mail since</span>
              <select className="inp" style={{ width: 'auto' }} value={since} onChange={(e) => setSince(e.target.value as Since)}>
                {info.lastImportAt && <option value="last">Last import ({stamp(info.lastImportAt)})</option>}
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="custom">Pick a date…</option>
              </select>
              {since === 'custom' && <input className="inp" style={{ width: 150 }} type="date" value={customDate} max={localDay(new Date())} onChange={(e) => setCustomDate(e.target.value)} />}
              <div className="spacer" />
              {(addresses.length > 0 || apple) && (
                <span className="muted" style={{ fontSize: 'var(--fs-sm)' }} data-mail-addresses>
                  {addresses.join(', ')}
                  {apple && (
                    <>
                      {addresses.length > 0 && ' · '}
                      <button type="button" className="link-btn" onClick={openMailSettings}>
                        Change
                      </button>
                    </>
                  )}
                </span>
              )}
              <button className="btn primary" onClick={() => void runCheck()}>
                Check {appName}
              </button>
            </div>
            {notice && (
              <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 6, fontSize: 'var(--fs-sm)', background: 'color-mix(in srgb, var(--warn) 12%, transparent)', color: 'var(--warn)' }}>{notice}</div>
            )}
          </>
        )}

        {stage === 'checking' && (
          <>
            <div className="progress">
              <div className="indeterminate" />
            </div>
            <span className="muted">Looking through {appName}…</span>
          </>
        )}

        {stage === 'ready' && check && (
          <>
            <div className="stats">
              <Stat n={check.received} label="received" />
              <Stat n={check.sent} label="sent" />
              <Stat n={check.conversations.length} label="conversations" />
              <Stat n={skipped.length - readAnyway.size} label="skipped" />
              {check.alreadyRead > 0 && <Stat n={check.alreadyRead} label="read before" />}
              <Stat n={toRead.length} label="to read" accent />
            </div>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                {ai.label} · {where}
                {minutes ? ` · about ${minutes} min` : ''}
              </span>
              <div className="spacer" />
              <button className="btn ghost" onClick={reset}>
                Cancel
              </button>
              <button className="btn primary" disabled={toRead.length === 0} onClick={() => void startRead()}>
                {toRead.length === 0 ? 'Nothing new to read' : `Read ${toRead.length} conversation${toRead.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </>
        )}

        {stage === 'reading' && job && (
          <>
            <div className="progress">
              <div style={{ width: `${job.total ? (job.done / job.total) * 100 : 0}%` }} />
            </div>
            <div className="row">
              <span className="muted" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Reading conversation {Math.min(job.done + 1, job.total)} of {job.total}
                {job.current ? `: ${job.current}` : ''} · suggestions appear in Review as each one finishes
              </span>
              <div className="spacer" />
              <button className="btn" onClick={() => void cos['mail.stop']()}>
                Stop
              </button>
            </div>
          </>
        )}

        {stage === 'done' && job && (
          <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
            {job.state === 'stopped' ? (
              <span>
                Stopped. What was read so far is in Review; the rest will be offered next time.
                <span className="muted">
                  <CostNote cost={job.estimatedCost} what="the conversations read" />
                </span>
              </span>
            ) : (
              <span>
                <b style={{ fontWeight: 500 }}>
                  {job.done} conversation{job.done === 1 ? '' : 's'} read
                </b>
                <span className="muted">
                  {' '}
                  · {job.suggestions} suggestion{job.suggestions === 1 ? '' : 's'} to review
                  {job.failed ? ` · ${job.failed} failed (use Run again below)` : ''}
                  <CostNote cost={job.estimatedCost} what="the conversations read" />
                </span>
              </span>
            )}
            <div className="spacer" />
            <button className="btn" onClick={reset}>
              Check again
            </button>
            <button className="btn primary" onClick={() => go('review')}>
              Go to Review
            </button>
          </div>
        )}
      </div>

      {stage === 'ready' && skipped.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <button className="btn ghost" style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }} onClick={() => setShowSkipped(!showSkipped)}>
            {showSkipped ? '▾' : '▸'} Skipped conversations ({skipped.length})
          </button>
          {showSkipped && (
            <div className="list" style={{ marginTop: 6 }}>
              {skipped.map((c) => (
                <div key={c.key} className="r" style={{ gridTemplateColumns: 'minmax(0, 1fr) 190px auto', paddingLeft: 12, cursor: 'default' }}>
                  <div className="ttl">
                    {c.subject}
                    <span className="why">{c.people}</span>
                  </div>
                  <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                    {c.skipReason}
                  </span>
                  <button
                    className="btn ghost"
                    style={{ fontSize: 'var(--fs-sm)' }}
                    onClick={() => {
                      const next = new Set(readAnyway)
                      if (next.has(c.key)) next.delete(c.key)
                      else next.add(c.key)
                      setReadAnyway(next)
                    }}
                  >
                    {readAnyway.has(c.key) ? 'Will read · undo' : 'Read anyway'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}

function Stat({ n, label, accent }: { n: number; label: string; accent?: boolean }) {
  return (
    <div style={{ display: 'grid' }}>
      <b className="mono" style={{ fontWeight: 500, fontSize: 18, color: accent ? 'var(--accent)' : undefined }}>
        {n}
      </b>
      <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
        {label}
      </span>
    </div>
  )
}
