import { useEffect, useState } from 'react'
import type { Task } from '@shared/types'
import { NO_PROJECT_COLOR } from '@shared/types'
import { cos } from '../api'
import { daysSince, ProjectChip } from '../components/bits'
import { useApp } from '../context'

export function WaitingScreen() {
  const { openTask, version } = useApp()
  const [tasks, setTasks] = useState<Task[]>([])
  useEffect(() => void cos['tasks.listWaiting']().then(setTasks), [version])

  return (
    <div className="page">
      <div className="head">
        <h1>Waiting on</h1>
        <span className="muted">longest waiting first · set a task's status to Waiting on to track it here</span>
      </div>
      <div className="list">
        {tasks.map((t) => {
          const d = daysSince(t.waitingSince)
          return (
            <div key={t.id} className="r" style={{ gridTemplateColumns: '3px minmax(0, 1fr) auto auto 70px' }} onClick={() => openTask({ id: t.id })}>
              <div className="stripe" style={{ background: t.project?.color ?? NO_PROJECT_COLOR }} />
              <div className="ttl">
                {t.title}
                <span className="why">{t.waitingOn ? `waiting on ${t.waitingOn}` : ''}</span>
              </div>
              <ProjectChip project={t.project} />
              <span className="muted" style={{ fontSize: 12 }}>{t.requester ? `for ${t.requester.name}` : ''}</span>
              <span className={`mono due ${d > 5 ? 's-mid' : ''}`}>{d === 1 ? '1 day' : `${d} days`}</span>
            </div>
          )
        })}
        {tasks.length === 0 && <div className="empty">Nothing is waiting on anyone right now.</div>}
      </div>
      <p className="faint" style={{ fontSize: 12, marginTop: 12 }}>
        AI-drafted follow-ups arrive with the AI features. Drafts are never sent without you.
      </p>
    </div>
  )
}
