import { useCallback, useEffect, useState } from 'react'
import type { AiCall, WeekListItem, WeeklyItem, WeeklyReflection, WeeklyReview } from '@shared/types'
import { weekLabel } from '@shared/week'
import { cos, errorMessage } from '../api'
import { useShortcutHints } from '../components/hints'
import { useApp } from '../context'
import { CallCard } from './AiLogScreen'

/** Window event sent when a reflection is started from the command palette. */
export const REFLECTION_STARTED = 'cos:reflection-started'

/** Starts this week's reflection from anywhere; the Weekly tab shows its progress and result. */
export function startReflection(): void {
  void cos['weekly.writeReflection']().catch(() => {}) // the tab shows any error when it picks this up
  window.dispatchEvent(new Event(REFLECTION_STARTED))
}

const isTyping = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')
const weekday = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short' })
const stamp = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The reflection as plain text, for pasting anywhere. */
function asText(weekStart: string, r: WeeklyReflection): string {
  const list = (title: string, items: string[]) => (items.length ? [`${title}:`, ...items.map((i) => `- ${i}`), ''] : [])
  return [`Week of ${weekLabel(weekStart)}`, '', r.summary, '', ...list('Went well', r.wentWell), ...list('Slipped', r.slipped), ...list('Focus next', r.focusNext)].join('\n').trim()
}

/**
 * The Weekly tab: one Sunday-to-Saturday week at a time. The current week's lists update as you
 * work; ended weeks are saved and never change. The AI reflection is written only when you click.
 */
export function WeeklyScreen() {
  const { version, toast, openTask } = useApp()
  const [weeks, setWeeks] = useState<WeekListItem[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [review, setReview] = useState<WeeklyReview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [calls, setCalls] = useState<AiCall[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  useShortcutHints([['↑ ↓', 'week'], ['N', 'new task']])

  const current = weeks[0]?.weekStart ?? null
  const week = selected ?? current

  const loadWeeks = useCallback(() => {
    void cos['weekly.list']()
      .then((w) => {
        setWeeks(w)
        setLoadError(null)
      })
      .catch((err) => setLoadError(errorMessage(err)))
  }, [])
  useEffect(loadWeeks, [version, loadWeeks])
  useEffect(() => {
    if (!week) return
    setCalls(null)
    void cos['weekly.get'](week)
      .then(setReview)
      .catch((err) => setLoadError(errorMessage(err)))
  }, [week, version])

  const write = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await cos['weekly.writeReflection']()
      setSelected(null) // the reflection is always for this week
      setReview(r)
      setCalls(null)
      loadWeeks()
      toast('Reflection ready')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }, [toast, loadWeeks])

  // A reflection still being written (e.g. after switching tabs) is picked back up.
  useEffect(() => {
    void cos['weekly.isWriting']().then((writing) => writing && void write())
    const onStart = () => void write()
    window.addEventListener(REFLECTION_STARTED, onStart)
    return () => window.removeEventListener(REFLECTION_STARTED, onStart)
  }, [write])

  // Up and Down step through the weeks.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      if (isTyping() || document.querySelector('.scrim') || e.ctrlKey || e.altKey || e.metaKey) return
      const i = weeks.findIndex((w) => w.weekStart === week)
      const next = weeks[e.key === 'ArrowDown' ? i + 1 : i - 1]
      if (!next) return
      e.preventDefault()
      setSelected(next.weekStart)
      document.querySelector(`[data-week="${next.weekStart}"]`)?.scrollIntoView({ block: 'nearest' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [weeks, week])

  const open = useCallback(
    async (item: WeeklyItem) => {
      const task = await cos['tasks.get'](item.taskId)
      if (!task) return toast('That task no longer exists.')
      openTask({ id: task.id, waiting: task.status === 'waiting_on' || (task.status === 'done' && !!task.waitedOn) })
    },
    [openTask, toast],
  )

  const step = (by: number) => {
    const i = weeks.findIndex((w) => w.weekStart === week)
    const next = weeks[i + by]
    if (next) setSelected(next.weekStart)
  }

  const r = review && review.weekStart === week ? review : null
  const live = r?.record === 'live'
  const badge = !r ? null : live ? <span className="badge live">Live</span> : r.record === 'saved' ? <span className="badge saved">Saved</span> : <span className="badge part">Partly recorded</span>
  const sub = !r
    ? ''
    : live
      ? 'Sunday to today · updates as you go'
      : r.record === 'saved'
        ? `Saved ${stamp(r.savedAt!)} · as it stood Saturday night`
        : r.savedAt
          ? 'The app wasn’t opened the week after: only Completed and New are known'
          : 'Before weekly reviews: only Completed and New are known'
  const counts: [string, number | null, string][] = r
    ? [
        ['Completed', r.lists.completed.length, 'var(--ok)'],
        ['New', r.lists.added.length, 'var(--text)'],
        ['Slipping', r.lists.slipping?.length ?? null, 'var(--danger)'],
        ['Waiting on', r.lists.waiting?.length ?? null, 'var(--text)'],
      ]
    : []

  return (
    <div className="wk">
      <div className="wk-list" role="listbox" aria-label="Weeks">
        <div className="wk-list-head">Weeks</div>
        {weeks.map((w, i) => (
          <button key={w.weekStart} data-week={w.weekStart} className={`wk-row ${w.weekStart === week ? 'on' : ''}`} onClick={() => setSelected(w.weekStart)}>
            <div className="d">
              {weekLabel(w.weekStart)}
              {i === 0 && <span className="faint"> · This week</span>}
              {i === 1 && <span className="faint"> · Last week</span>}
            </div>
            <div className="s">
              <span>{w.completed} done</span>
              <span>{w.added} new</span>
              {w.record === 'partial' && <span>partly recorded</span>}
            </div>
          </button>
        ))}
      </div>

      <div className="wk-main">
        <div className="wk-page">
          {loadError && <div className="b-error">Couldn't load the weekly review: {loadError}</div>}
          {week && (
            <div className="head">
              <button className="btn ghost sm" title="Earlier week" disabled={weeks.at(-1)?.weekStart === week} onClick={() => step(1)}>
                ‹
              </button>
              <h1>Week of {weekLabel(week)}</h1>
              <button className="btn ghost sm" title="Later week" disabled={week === current} onClick={() => step(-1)}>
                ›
              </button>
              {badge}
              <span className="muted">{sub}</span>
              <div className="spacer" />
              {week !== current && (
                <button className="btn sm" onClick={() => setSelected(null)}>
                  This week
                </button>
              )}
            </div>
          )}

          {r && (
            <>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 14 }}>
                {counts.map(([label, n, color]) => (
                  <div key={label} className="card" data-count={label}>
                    <div className="label">{label}</div>
                    <div className="stat" style={{ color: n ? color : 'var(--text)' }}>{n ?? '–'}</div>
                  </div>
                ))}
              </div>

              <div style={{ marginBottom: 14 }}>
                <Reflection
                  review={r}
                  busy={busy}
                  error={live ? error : null}
                  calls={calls}
                  onWrite={() => void write()}
                  onCopy={() => r.reflection && void navigator.clipboard.writeText(asText(r.weekStart, r.reflection)).then(() => toast('Copied'))}
                  onLog={() => (calls ? setCalls(null) : void cos['weekly.aiCalls'](r.weekStart).then(setCalls))}
                />
              </div>

              <div className="wk-secs">
                <Section name="Completed" items={r.lists.completed} empty={live ? 'Nothing completed yet this week.' : 'Nothing was completed this week.'} onOpen={open}>
                  {(i) => (
                    <>
                      <span>
                        <span className="muted">✓</span> {i.title}
                        {i.detail && <div className="wk-sub">{i.detail}</div>}
                      </span>
                      <span className="wk-r">{i.at ? weekday(i.at) : ''}</span>
                    </>
                  )}
                </Section>
                <Section name="New" items={r.lists.added} empty={live ? 'Nothing new this week.' : 'Nothing was added this week.'} onOpen={open}>
                  {(i) => (
                    <>
                      <span>
                        {i.title}
                        <div className="wk-sub">{i.detail}</div>
                      </span>
                      <span className="wk-r">{i.at ? weekday(i.at) : ''}</span>
                    </>
                  )}
                </Section>
                <Section name="Slipping" note={live ? 'overdue now' : 'overdue at week’s end'} items={r.lists.slipping} empty="Nothing is overdue." over onOpen={open}>
                  {(i) => (
                    <>
                      <span>
                        {i.title}
                        <div className="wk-sub">{i.detail}</div>
                      </span>
                      <span className="wk-r">
                        <span className="tag-over" style={{ margin: 0 }}>
                          Overdue {plural(i.overdueDays ?? 0, 'day')}
                        </span>
                      </span>
                    </>
                  )}
                </Section>
                <Section name="Waiting on" note="longest first" items={r.lists.waiting} empty="Not waiting on anyone." onOpen={open}>
                  {(i) => (
                    <>
                      <span>
                        {i.title}
                        <div className="wk-sub">{i.detail}</div>
                      </span>
                      <span className="wk-r mono">{i.days != null ? plural(i.days, 'day') : ''}</span>
                    </>
                  )}
                </Section>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** "Your week": the AI's reflection. Only the current week can be written or refreshed. */
function Reflection({
  review,
  busy,
  error,
  calls,
  onWrite,
  onCopy,
  onLog,
}: {
  review: WeeklyReview
  busy: boolean
  error: string | null
  calls: AiCall[] | null
  onWrite: () => void
  onCopy: () => void
  onLog: () => void
}) {
  const live = review.record === 'live'
  const r = review.reflection
  const button = !live ? null : busy ? (
    <button className="btn sm" disabled>
      <span className="spin" /> Writing…
    </button>
  ) : (
    <button className={`btn sm ${r ? '' : 'primary'}`} onClick={onWrite}>
      {error ? 'Try again' : r ? 'Refresh' : 'Write reflection'}
    </button>
  )
  const changed = review.changedSince
  const changes = changed && (changed.completed || changed.added) ? [changed.completed && `${plural(changed.completed, 'task')} completed`, changed.added && `${changed.added} added`].filter(Boolean).join(' and ') : null
  const points = (title: string, items: string[], none: string) => (
    <div className="wk-points" data-points={title}>
      <div className="label">{title}</div>
      {items.length ? (
        <ul>
          {items.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      ) : (
        <div className="b-none">{none}</div>
      )}
    </div>
  )

  return (
    <div className="ai" data-reflection>
      <div className="row" style={{ gap: 6, marginBottom: 2 }}>
        <span style={{ color: 'var(--accent)' }}>✦</span>
        <b style={{ fontWeight: 500 }}>Your week</b>
        {r && (
          <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
            · Written {stamp(r.writtenAt)} · {r.writtenBy}
          </span>
        )}
        <div className="spacer" />
        {r && (
          <button className="btn ghost sm" title="See exactly what was sent to the AI and what came back" onClick={onLog}>
            {calls ? 'Back to reflection' : 'AI log'}
          </button>
        )}
        {r && (
          <button className="btn ghost sm" onClick={onCopy}>
            Copy
          </button>
        )}
        {(r || error) && button}
      </div>

      {error && (
        <div className="b-error">
          Couldn't write the reflection: {error}
          {r ? ' Your last one is below.' : ''}
        </div>
      )}

      {calls ? (
        <div style={{ marginTop: 10 }}>
          {calls.length === 0 && <div className="empty">The AI log is kept for the newest 5 weeks only.</div>}
          {calls.map((c) => (
            <CallCard key={c.id} call={c} />
          ))}
        </div>
      ) : !r ? (
        live ? (
          !error && (
            <>
              <div className="muted" style={{ lineHeight: 1.6, margin: '4px 0 8px' }}>
                A short look back for you: what went well, what slipped, and what to focus on next. The lists below already update on their own; this is written only when you click.
              </div>
              {button}
            </>
          )
        ) : (
          <div className="muted">No reflection was written for this week.</div>
        )
      ) : (
        <>
          {live && changes && <div className="b-stale">{changes} since this was written</div>}
          <div className="b-summary">{r.summary}</div>
          <div className="wk-refl">
            {points('Went well', r.wentWell, 'Nothing to note.')}
            {points('Slipped', r.slipped, 'Nothing slipped.')}
            {points('Focus next', r.focusNext, 'Nothing to suggest.')}
          </div>
        </>
      )}
    </div>
  )
}

/** One of the four lists. A null list wasn't recorded (weeks before the weekly review, or missed weeks). */
function Section({
  name,
  note,
  items,
  empty,
  over,
  onOpen,
  children,
}: {
  name: string
  note?: string
  items: WeeklyItem[] | null
  empty: string
  over?: boolean
  onOpen: (item: WeeklyItem) => void
  children: (item: WeeklyItem) => React.ReactNode
}) {
  return (
    <div className="wk-sec" data-section={name}>
      <div className="wk-sec-h">
        <b>{name}</b>
        <span className="mono muted">{items ? items.length : '–'}</span>
        <div className="spacer" />
        {note && items && <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{note}</span>}
      </div>
      {items === null ? (
        <div className="wk-notrec">Not recorded. The app doesn't know what was overdue or waiting that week.</div>
      ) : items.length === 0 ? (
        <div className="wk-none">{empty}</div>
      ) : (
        items.map((i) => (
          <button key={i.taskId} className={`wk-it ${over ? 'over' : ''}`} onClick={() => onOpen(i)}>
            <span className="stripe" style={{ background: i.projectColor ?? 'var(--border-strong)' }} />
            {children(i)}
          </button>
        ))
      )}
    </div>
  )
}
