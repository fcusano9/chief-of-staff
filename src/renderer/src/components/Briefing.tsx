import { useCallback, useEffect, useState } from 'react'
import type { AiCall, Briefing, BriefingItem, BriefingListItem } from '@shared/types'
import { cos, errorMessage } from '../api'
import { useApp } from '../context'
import { formatCost } from '@shared/pricing'
import { CallCard } from '../screens/AiLogScreen'
import { useShortcutHints } from './hints'

/** Window event sent when a briefing is started from outside the card (the command palette). */
export const BRIEFING_STARTED = 'cos:briefing-started'

/** Starts a briefing from anywhere; the Today card shows its progress and result. */
export function startBriefing(): void {
  void cos['briefing.write']().catch(() => {}) // the card shows any error when it picks this up
  window.dispatchEvent(new Event(BRIEFING_STARTED))
}

const dayKey =(d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
const daysAgo = (iso: string) => {
  const then = new Date(iso)
  const a = new Date(then.getFullYear(), then.getMonth(), then.getDate())
  const now = new Date()
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
/** "Today, 8:12 AM" or "Tue, Nov 3, 8:05 AM". */
const when = (iso: string) => `${dayKey(new Date(iso)) === dayKey(new Date()) ? 'Today' : day(iso)}, ${time(iso)}`
/** "Tue 4:40 PM" for the New since line. */
const sinceLabel = (iso: string) => `${new Date(iso).toLocaleDateString(undefined, { weekday: 'short' })} ${time(iso)}`
const howStarted = (b: { trigger: string }) => (b.trigger === 'scheduled' ? 'Scheduled' : 'You clicked')

/** The three sections; empty ones stay, with a line saying there's nothing there. */
function Sections({ briefing, columns, onOpen }: { briefing: Briefing; columns: boolean; onOpen: (item: BriefingItem) => void }) {
  const sections: [string, string | null, BriefingItem[], string][] = [
    ['Top priorities', null, briefing.priorities, 'Nothing is due or overdue. Your Focus list below is still in priority order.'],
    ['Waiting-on nudges', null, briefing.nudges, 'No one needs a nudge.'],
    ['New since last briefing', `since ${sinceLabel(briefing.since)}`, briefing.newItems, 'Nothing new since your last briefing.'],
  ]
  return (
    <div className={columns ? 'b-cols' : undefined}>
      {sections.map(([name, sub, items, none]) => (
        <div key={name} className="b-sec" data-section={name}>
          <div className="label">
            {name}
            {sub && <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{sub}</span>}
          </div>
          {items.map((item, i) => (
            <button key={`${item.taskId}-${i}`} className={`b-item ${item.overdueDays ? 'over' : ''}`} onClick={() => onOpen(item)}>
              {item.overdueDays ? <span className="tag-over">Overdue {item.overdueDays} day{item.overdueDays === 1 ? '' : 's'}</span> : null}
              <span className="t">
                {item.title}
                {item.who ? ` · ${item.who}` : ''}
              </span>
              {item.note && <span className="w"> — {item.note}</span>}
            </button>
          ))}
          {items.length === 0 && <div className="b-none">{none}</div>}
        </div>
      ))}
    </div>
  )
}

/** Opens what a briefing line is about: its task, or Review. */
function useOpenItem() {
  const { openTask, go, toast } = useApp()
  return useCallback(
    async (item: BriefingItem) => {
      if (item.kind === 'review' || item.taskId == null) return go('review')
      const task = await cos['tasks.get'](item.taskId)
      if (!task) return toast('That task no longer exists.')
      openTask({ id: task.id, waiting: task.status === 'waiting_on' })
    },
    [openTask, go, toast],
  )
}

/**
 * The daily briefing on Today: a one-line summary and three short sections, written by the AI
 * only when Frank clicks. Each one is saved; History shows earlier ones.
 */
export function BriefingCard() {
  const { go, toast, reviewCount, version } = useApp()
  const [briefing, setBriefing] = useState<Briefing | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState(false)
  const open = useOpenItem()

  const write = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      setBriefing(await cos['briefing.write']())
      toast('Briefing ready')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }, [toast])

  useEffect(() => {
    void cos['briefing.latest']().then(setBriefing)
  }, [version])
  // A briefing still being written (e.g. after switching screens) is picked back up: write() returns the same one.
  useEffect(() => {
    void cos['briefing.isWriting']().then((writing) => writing && void write())
    // "Write briefing" in the command palette starts one and announces it here.
    const onStart = () => void write()
    window.addEventListener(BRIEFING_STARTED, onStart)
    return () => window.removeEventListener(BRIEFING_STARTED, onStart)
  }, [write])

  if (briefing === undefined) return null
  const age = briefing ? daysAgo(briefing.createdAt) : 0
  const button = busy ? (
    <button className="btn sm" disabled>
      <span className="spin" /> Writing…
    </button>
  ) : (
    <button className={`btn sm ${!briefing || age > 0 ? 'primary' : ''}`} onClick={() => void write()}>
      {error ? 'Try again' : !briefing ? 'Write briefing' : age > 0 ? "Write today's" : 'Refresh'}
    </button>
  )

  return (
    <div className="ai" data-briefing>
      <div className="row" style={{ gap: 6, marginBottom: 2 }}>
        <span style={{ color: 'var(--accent)' }}>✦</span>
        <b style={{ fontWeight: 500 }}>Briefing</b>
        {briefing && <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>· {when(briefing.createdAt)}</span>}
        <div className="spacer" />
        {briefing && (
          <button className="btn ghost sm" onClick={() => setHistory(true)}>
            History
          </button>
        )}
        {briefing && button}
      </div>

      {error && (
        <div className="b-error">
          Couldn't write the briefing: {error}
          {briefing ? ' Your last briefing is below.' : ''}
        </div>
      )}

      {!briefing ? (
        <>
          <div className="muted" style={{ lineHeight: 1.6, margin: '4px 0 8px' }}>
            Get a short read on today: your top priorities, who to chase, and what's new.
          </div>
          {button}
        </>
      ) : (
        <>
          {age > 0 && <div className="b-stale">From {age === 1 ? 'yesterday' : day(briefing.createdAt)} · things may have changed since</div>}
          <div className="b-summary">{briefing.summary}</div>
          <Sections briefing={briefing} columns onOpen={(item) => void open(item)} />
        </>
      )}

      {reviewCount > 0 && (
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn sm" onClick={() => go('review')}>
            Review suggestions <span className="mono muted">{reviewCount}</span>
          </button>
        </div>
      )}

      {history && briefing && <BriefingHistory latestId={briefing.id} onClose={() => setHistory(false)} />}
    </div>
  )
}

/** Every saved briefing, newest first, with the AI requests behind the newest few. */
function BriefingHistory({ latestId, onClose }: { latestId: number; onClose: () => void }) {
  const open = useOpenItem()
  const [list, setList] = useState<BriefingListItem[]>([])
  const [selected, setSelected] = useState(latestId)
  const [briefing, setBriefing] = useState<Briefing | null>(null)
  const [calls, setCalls] = useState<AiCall[] | null>(null)
  useShortcutHints([['Esc', 'close']], 2)

  useEffect(() => {
    void cos['briefing.list']().then(setList)
  }, [])
  useEffect(() => {
    setCalls(null)
    void cos['briefing.get'](selected).then(setBriefing)
  }, [selected])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wide" role="dialog" aria-label="Briefing history">
        <div className="dialog-head">
          <b style={{ fontWeight: 500 }}>Briefing history</b>
          <span className="muted">
            {list.length} briefing{list.length === 1 ? '' : 's'}
          </span>
          <div className="spacer" />
          <button className="btn ghost sm" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="b-hist">
          <div className="b-hist-list">
            {list.map((b) => (
              <button key={b.id} className={`b-hist-row ${b.id === selected ? 'on' : ''}`} onClick={() => setSelected(b.id)}>
                <div style={{ fontWeight: 500 }}>{day(b.createdAt)}</div>
                <div className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                  {time(b.createdAt)} · {howStarted(b)}
                  {b.estimatedCost != null && ` · est. ${formatCost(b.estimatedCost)}`}
                </div>
              </button>
            ))}
          </div>
          <div className="b-hist-view">
            {briefing && (
              <>
                <div className="row">
                  <span className="label">
                    {day(briefing.createdAt)}, {time(briefing.createdAt)} · {howStarted(briefing)} · {briefing.writtenBy}
                  </span>
                  <div className="spacer" />
                  <button
                    className="btn ghost sm"
                    title="See exactly what was sent to the AI and what came back"
                    onClick={() => (calls ? setCalls(null) : void cos['briefing.aiCalls'](briefing.id).then(setCalls))}
                  >
                    {calls ? 'Back to briefing' : 'AI log'}
                  </button>
                </div>
                {calls ? (
                  <div style={{ marginTop: 10 }}>
                    {calls.length === 0 && <div className="empty">The AI log is kept for the newest 5 briefings only.</div>}
                    {calls.map((c) => (
                      <CallCard key={c.id} call={c} />
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="b-summary" style={{ marginTop: 6 }}>
                      {briefing.summary}
                    </div>
                    <Sections
                      briefing={briefing}
                      columns={false}
                      onOpen={(item) => {
                        onClose()
                        void open(item)
                      }}
                    />
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
