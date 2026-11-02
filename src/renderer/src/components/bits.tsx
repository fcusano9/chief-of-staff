import type { Person, Project, Task } from '@shared/types'
import { daysUntil } from '@shared/priority'
import { effectivePriority, initials, NO_PROJECT_COLOR } from '@shared/types'

export const scoreClass = (s: number) => (s >= 80 ? 's-hi' : s >= 60 ? 's-mid' : 's-lo')

export function ProjectChip({ project }: { project: Pick<Project, 'name' | 'color'> | null }) {
  if (!project) return <span />
  return (
    <span className="chip" style={{ background: `color-mix(in srgb, ${project.color} 16%, transparent)`, color: `color-mix(in srgb, ${project.color} 65%, var(--text))` }}>
      {project.name}
    </span>
  )
}

export function Avatar({ person }: { person: Pick<Person, 'name'> & { color?: string } }) {
  const color = person.color ?? 'var(--accent)'
  return (
    <span className="av" style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}>
      {initials(person.name)}
    </span>
  )
}

export function Stars({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <span className="stars" role={onChange ? 'radiogroup' : undefined} aria-label={`Priority weight ${value} of 5`}>
      {[1, 2, 3, 4, 5].map((n) =>
        onChange ? (
          <button key={n} type="button" className={n > value ? 'off' : ''} onClick={() => onChange(n)} aria-label={`${n} of 5`}>
            ★
          </button>
        ) : (
          <span key={n} className={n > value ? 'off' : ''}>
            ★
          </span>
        ),
      )}
    </span>
  )
}

/** Short due label: Today, Tomorrow, Yesterday, weekday within a week, else "Nov 9". */
export function dueLabel(due: string | null, now = new Date()): { text: string; overdue: boolean } {
  if (!due) return { text: '—', overdue: false }
  const days = daysUntil(due, now)
  const [y, m, d] = due.split('-').map(Number)
  const date = new Date(y!, m! - 1, d!)
  if (days === 0) return { text: 'Today', overdue: false }
  if (days === 1) return { text: 'Tomorrow', overdue: false }
  if (days === -1) return { text: 'Yesterday', overdue: true }
  if (days < 0) return { text: `${-days}d overdue`, overdue: true }
  if (days < 7) return { text: date.toLocaleDateString(undefined, { weekday: 'short' }), overdue: false }
  return { text: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), overdue: false }
}

export const daysSince = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)) : 0)

/** One task line: project stripe, score, title with priority reason, project chip, due date. */
export function TaskRow({ task, selected, current, onClick, showWhy = true }: { task: Task; selected?: boolean; current?: boolean; onClick: () => void; showWhy?: boolean }) {
  const score = effectivePriority(task)
  const due = task.status === 'waiting_on' ? { text: `Wait ${daysSince(task.waitingSince)}d`, overdue: false } : dueLabel(task.dueDate)
  return (
    <div className={`r ${selected ? 'sel' : ''} ${current ? 'cur' : ''}`} data-id={task.id} onClick={onClick}>
      <div className="stripe" style={{ background: task.project?.color ?? NO_PROJECT_COLOR }} />
      <div className={`score ${scoreClass(score)}`} title={task.priorityOverride != null ? 'Manual priority' : undefined}>
        {score}
        {task.priorityOverride != null ? '*' : ''}
      </div>
      <div className="ttl">
        {task.title}
        {showWhy && <span className="why">{task.priorityRationale}</span>}
      </div>
      <ProjectChip project={task.project} />
      <div className={`due ${due.overdue ? 'over' : ''}`}>{due.text}</div>
    </div>
  )
}

/** Two-click delete: the first click arms it, the second confirms. */
export function ConfirmButton({ label, confirmLabel, onConfirm }: { label: string; confirmLabel: string; onConfirm: () => void }) {
  return (
    <button
      type="button"
      className="btn ghost danger"
      onClick={(e) => {
        const b = e.currentTarget
        if (b.dataset.armed) onConfirm()
        else {
          b.dataset.armed = '1'
          b.textContent = confirmLabel
          setTimeout(() => {
            if (b.isConnected) {
              delete b.dataset.armed
              b.textContent = label
            }
          }, 4000)
        }
      }}
    >
      {label}
    </button>
  )
}
