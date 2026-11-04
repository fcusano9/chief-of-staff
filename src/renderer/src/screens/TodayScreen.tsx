import { useEffect, useState } from 'react'
import type { Task, TodaySummary } from '@shared/types'
import { cos } from '../api'
import { daysSince, TaskRow } from '../components/bits'
import { BriefingCard } from '../components/Briefing'
import { useShortcutHints } from '../components/hints'
import { useApp } from '../context'

const greeting = (h: number) => (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening')

export function TodayScreen() {
  const { openTask, go, version, settings } = useApp()
  useShortcutHints([['N', 'new task'], ['G R', 'review']])
  const [summary, setSummary] = useState<TodaySummary | null>(null)
  const [focus, setFocus] = useState<Task[]>([])
  const [waiting, setWaiting] = useState<Task[]>([])

  useEffect(() => {
    void cos['tasks.summary']().then(setSummary)
    void cos['tasks.listActive']().then((t) => setFocus(t.filter((x) => x.status !== 'waiting_on').slice(0, 7)))
    void cos['tasks.listWaiting']().then((t) => setWaiting(t.slice(0, 5)))
  }, [version])

  const now = new Date()
  const metrics: [string, number | undefined, string, () => void][] = [
    ['Urgent', summary?.urgent, 'var(--danger)', () => go('tasks')],
    ['Overdue', summary?.overdue, 'var(--warn)', () => go('tasks')],
    ['Waiting on', summary?.waitingOn, 'var(--text)', () => go('waiting')],
    ['Open', summary?.open, 'var(--text)', () => go('tasks')],
  ]

  return (
    <div className="page">
      <div className="head">
        <h1>
          {greeting(now.getHours())}, {settings.userName.split(' ')[0]}
        </h1>
        <span className="muted">{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
        <div className="spacer" />
        <button className="btn primary" onClick={() => openTask({ id: 'new' })}>
          New task
        </button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 14 }}>
        {metrics.map(([label, n, color, onClick]) => (
          <button key={label} className="card" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={onClick}>
            <div className="label">{label}</div>
            <div className="stat" style={{ color: n ? color : 'var(--text)' }}>{n ?? '–'}</div>
          </button>
        ))}
      </div>

      <div style={{ marginBottom: 14 }}>
        <BriefingCard />
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)' }}>
        <div>
          <h2 style={{ marginTop: 0 }}>Focus · highest priority first</h2>
          <div className="list">
            {focus.map((t) => (
              <TaskRow key={t.id} task={t} showWhy={false} onClick={() => openTask({ id: t.id, waiting: t.status === 'waiting_on' })} />
            ))}
            {focus.length === 0 && <div className="empty">Nothing open. Press N to add a task.</div>}
          </div>
        </div>
        <div className="grid" style={{ alignContent: 'start' }}>
          <div className="card">
            <div className="row" style={{ marginBottom: 6 }}>
              <span className="label">Waiting on others</span>
              <div className="spacer" />
              <button className="btn ghost" style={{ padding: '0 6px', fontSize: 'var(--fs-sm)' }} onClick={() => go('waiting')}>
                All →
              </button>
            </div>
            {waiting.map((t) => {
              const d = daysSince(t.waitingSince)
              return (
                <div key={t.id} className="row" style={{ padding: '3px 0', cursor: 'pointer' }} onClick={() => openTask({ id: t.id, waiting: t.status === 'waiting_on' })}>
                  <span className="ttl" style={{ flex: 1 }}>{t.title}</span>
                  <span className="muted ttl" style={{ maxWidth: 110 }}>{t.waitingOn}</span>
                  <span className={`mono ${d > 5 ? 's-mid' : 'muted'}`} style={{ width: 30, textAlign: 'right' }}>{d}d</span>
                </div>
              )
            })}
            {waiting.length === 0 && <div className="muted">Nothing is waiting on anyone.</div>}
          </div>
          <div className="card">
            <div className="label" style={{ marginBottom: 4 }}>Meetings today</div>
            <div className="muted">Your Outlook calendar shows up here in milestone 4.</div>
          </div>
        </div>
      </div>
    </div>
  )
}
