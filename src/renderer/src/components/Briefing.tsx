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
/** "Tue 4:40 PM" for the New line. */
const sinceLabel = (iso: string) => `${new Date(iso).toLocaleDateString(undefined, { weekday: 'short' })} ${time(iso)}`
const howStarted = (b: { trigger: string }) => (b.trigger === 'scheduled' ? 'Scheduled' : 'You clicked')

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
/** Whole days from the briefing's day to a 'YYYY-MM-DD' date. */
const daysUntil = (ymd: string, fromIso: string) => {
  const [y, m, d] = ymd.split('-').map(Number)
  const from = new Date(fromIso)
  return Math.round((new Date(y!, m! - 1, d!).getTime() - new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()) / 86_400_000)
}

type Section = 'do' | 'follow' | 'new'
/** The status tag on a line, worked out from the task as it was when the briefing was written (not by the AI). */
function itemTag(item: BriefingItem, section: Section, writtenAt: string): [string, string] | null {
  if (item.kind === 'review') return ['new', 'Review']
  if (section === 'new') return ['new', item.kind === 'waiting' ? 'Now waiting' : 'New task']
  if (item.overdueDays) return ['over', `Overdue ${plural(item.overdueDays, 'day')}`]
  if (item.waitingDays != null) return ['wait', `Waiting ${plural(item.waitingDays, 'day')}`]
  if (!item.due) return null
  const n = daysUntil(item.due, writtenAt)
  if (n <= 0) return ['due', 'Due today']
  if (n === 1) return ['due', 'Due tomorrow']
  const [y, m, d] = item.due.split('-').map(Number)
  const date = new Date(y!, m! - 1, d!)
  return n < 7 ? ['due', `Due ${date.toLocaleDateString(undefined, { weekday: 'short' })}`] : ['wait', `Due ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`]
}

function Tag({ item, section, writtenAt }: { item: BriefingItem; section: Section; writtenAt: string }) {
  const tag = itemTag(item, section, writtenAt)
  return tag ? <span className={`b-tag ${tag[0]}`}>{tag[1]}</span> : null
}

const Dot = ({ item }: { item: BriefingItem }) => <span className="b-dot" style={{ background: item.projectColor ?? 'var(--border-strong)' }} />

/**
 * Do next leads, one line per task: the suggested next step, then the task, its project color and
 * status tag. Follow up and New are just names and tags. The AI's notes show on hover. Empty
 * sections stay, with a line saying there's nothing there.
 */
function Sections({ briefing, columns, onOpen }: { briefing: Briefing; columns: boolean; onOpen: (item: BriefingItem) => void }) {
  const at = briefing.createdAt
  const hover = (item: BriefingItem) => [item.nextAction && item.title, item.note].filter(Boolean).join(' — ')
  const small = (name: string, section: Section, sub: string | null, items: BriefingItem[], none: string) => (
    <div className="b-sec" data-section={name}>
      <div className="b-sec-h">
        {name} {items.length > 0 && <span className="n">{items.length}</span>}
        {sub && <span className="faint">{sub}</span>}
      </div>
      {items.map((item, i) => (
        <button key={`${item.taskId}-${i}`} className="b-item" title={item.note} onClick={() => onOpen(item)}>
          <Tag item={item} section={section} writtenAt={at} />
          <span className="t">
            {item.title}
            {item.who && <span className="muted"> · {item.who}</span>}
          </span>
        </button>
      ))}
      {items.length === 0 && <div className="b-none">{none}</div>}
    </div>
  )
  return (
    <>
      <div className="b-sec" data-section="Do next">
        <div className="b-sec-h">
          Do next {briefing.priorities.length > 0 && <span className="n">{briefing.priorities.length}</span>}
        </div>
        {briefing.priorities.map((item, i) => (
          <button key={`${item.taskId}-${i}`} className="b-do" title={hover(item)} onClick={() => onOpen(item)}>
            <span className="b-num">{i + 1}</span>
            <span className="b-act">{item.nextAction || item.title}</span>
            <span className="b-sub">
              <Dot item={item} />
              {item.nextAction && <span className="b-ttl">{item.title}</span>}
              <Tag item={item} section="do" writtenAt={at} />
            </span>
          </button>
        ))}
        {briefing.priorities.length === 0 && <div className="b-none">Nothing is due or overdue. Your Focus list below is still in priority order.</div>}
      </div>
      <div className={columns ? 'b-cols' : undefined}>
        {small('Follow up', 'follow', null, briefing.nudges, 'No one needs a follow-up.')}
        {small('New', 'new', `since ${sinceLabel(briefing.since)}`, briefing.newItems, 'Nothing new since your last briefing.')}
      </div>
    </>
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
 * The daily briefing on Today: a one-line summary, then Do next, Follow up and New, written by
 * the AI only when the user clicks. Each one is saved; History shows earlier ones.
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
