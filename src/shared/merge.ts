// Merging two tasks, or two waiting items, into one (Merge in the task editor). These rules are
// shared: the merge dialog shows them, and TaskMergeService applies them.
import { isActive, type Task, type TaskInput } from './types'

/** The fields the user may have to choose between. */
export type MergeField = 'title' | 'waitingOn' | 'projectId' | 'dueDate' | 'requesterId' | 'priorityOverride'
/** Whose value to keep: the item the merge started from (kept), or the one merged in. */
export type MergePick = 'keep' | 'other'
/** The user's picks for the fields both items have different values for; a field left out keeps the kept item's. */
export type MergeChoices = Partial<Record<MergeField, MergePick>>

/**
 * How a field is settled: "choose" when both items have a different value; "same" when they match;
 * "keep" or "other" when only that item has one (a value always wins over an empty one); "empty"
 * when neither has.
 */
export type MergeFieldState = 'choose' | 'same' | 'keep' | 'other' | 'empty'

export interface MergeFieldRow {
  field: MergeField
  label: string
  state: MergeFieldState
}

export const MERGE_FIELD_LABELS: Record<MergeField, string> = {
  title: 'Title',
  waitingOn: 'Waiting on',
  projectId: 'Project',
  dueDate: 'Due',
  requesterId: 'Asked by',
  priorityOverride: 'Priority set by hand',
}

type Value = string | number | null

function value(task: Task, field: MergeField): Value {
  const v = task[field]
  return typeof v === 'string' ? v.trim() || null : v
}

/** Text matches without regard to case or surrounding spaces ("Priya Shah" and "priya shah "). */
const matches = (a: Value, b: Value) => (typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b)

/** Why two items can't be merged, or null when they can. */
export function mergeProblem(keep: Task, other: Task): string | null {
  if (keep.id === other.id) return 'Pick a different item to merge with.'
  if (!isActive(keep.status) || !isActive(other.status)) return 'Only open tasks and waiting items can be merged.'
  if (keep.status !== other.status) return 'A task can only be merged with another task, and a waiting item with another waiting item.'
  return null
}

/** Every field the merge settles, in the order the dialog shows them. Waiting on is for waiting items only. */
export function mergeFields(keep: Task, other: Task): MergeFieldRow[] {
  const fields: MergeField[] = ['title', ...(keep.status === 'waiting_on' ? (['waitingOn'] as const) : []), 'projectId', 'dueDate', 'requesterId', 'priorityOverride']
  return fields.map((field) => {
    const a = value(keep, field)
    const b = value(other, field)
    const state: MergeFieldState = a == null && b == null ? 'empty' : a == null ? 'other' : b == null ? 'keep' : matches(a, b) ? 'same' : 'choose'
    return { field, label: MERGE_FIELD_LABELS[field], state }
  })
}

/** Notes: the kept item's, a blank line, then the other's. Null when neither has any. */
export function joinNotes(keep: string | null, other: string | null): string | null {
  const parts = [keep?.trimEnd() ?? '', other?.trim() ?? ''].filter((p) => p.trim())
  return parts.length ? parts.join('\n\n') : null
}

/** The earlier of two times, either of which may be missing. */
export const earlier = (a: string | null, b: string | null): string | null => (a && b ? (a < b ? a : b) : (a ?? b))

/**
 * The kept item as it's saved by a merge: each field from the chosen item (the kept one's unless the
 * user picked the other's), both Notes, the kept item's subtasks then the other's, and follow-ups
 * added together. Its status doesn't change; both items are always in the same list.
 */
export function mergedInput(keep: Task, other: Task, choices: MergeChoices = {}): TaskInput {
  const states = new Map(mergeFields(keep, other).map((r) => [r.field, r.state]))
  const fromOther = (field: MergeField) => states.get(field) === 'other' || (states.get(field) === 'choose' && choices[field] === 'other')
  const pick = <F extends MergeField>(field: F): Task[F] => (fromOther(field) ? other[field] : keep[field])
  return {
    id: keep.id,
    title: pick('title'),
    notes: joinNotes(keep.notes, other.notes),
    status: keep.status,
    dueDate: pick('dueDate'),
    projectId: pick('projectId'),
    requesterId: pick('requesterId'),
    priorityOverride: pick('priorityOverride'),
    followUpCount: keep.followUpCount + other.followUpCount,
    waitingOn: keep.status === 'waiting_on' ? pick('waitingOn') : null,
    subtasks: [...keep.subtasks, ...other.subtasks.map((s) => ({ ...s, id: 0 }))],
  }
}
