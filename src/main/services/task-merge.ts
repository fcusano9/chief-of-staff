import type { DatabaseSync } from 'node:sqlite'
import { earlier, type MergeChoices, mergedInput, mergeProblem } from '@shared/merge'
import { mergeUpdates } from '@shared/notes'
import type { ChangeBy, Task } from '@shared/types'
import { transaction } from '../db'
import { TaskEventService } from './task-events'
import type { TaskService } from './tasks'

const BY_USER: ChangeBy = { by: 'user' }

/**
 * Merges one task into another, or one waiting item into another (Merge in the task editor). The
 * item the user started from is kept and takes the chosen field values (`mergedInput`), both items'
 * Notes, subtasks, Updates, Activity, linked imports, and follow-ups, and the earlier created and
 * waiting-since dates. Then the other item is removed. Both status cards and AI priority changes
 * are cleared, since each described only half of the work.
 */
export class TaskMergeService {
  private readonly events: TaskEventService

  constructor(
    private readonly db: DatabaseSync,
    private readonly tasks: TaskService,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.events = new TaskEventService(db, now)
  }

  merge(keepId: number, otherId: number, choices: MergeChoices = {}): Task {
    const keep = this.tasks.get(keepId)
    const other = this.tasks.get(otherId)
    if (!keep || !other) throw new Error('One of these items no longer exists.')
    const problem = mergeProblem(keep, other)
    if (problem) throw new Error(problem)
    const by = BY_USER

    transaction(this.db, () => {
      // Dates a save doesn't set. Set first, so the save scores the task with them.
      this.db
        .prepare('UPDATE work_items SET created_at = ?, waiting_since = ? WHERE id = ?')
        .run(earlier(keep.createdAt, other.createdAt), earlier(keep.waitingSince, other.waitingSince), keep.id)
      this.tasks.save(mergedInput(keep, other, choices), by)

      // Activity: the other's lines move over, marked with its title (lines from an earlier merge keep theirs).
      this.db.prepare('UPDATE task_events SET work_item_id = ?, merged_from = IFNULL(merged_from, ?) WHERE work_item_id = ?').run(keep.id, other.title, other.id)

      const updates = mergeUpdates(this.updates(keep.id), this.updates(other.id))
      if (updates) {
        this.db
          .prepare(
            `INSERT INTO context_briefs (scope, owner_id, summary, standing_instructions, updated_at) VALUES ('task', ?, ?, '', ?)
             ON CONFLICT (scope, owner_id) DO UPDATE SET summary = excluded.summary, updated_at = excluded.updated_at`,
          )
          .run(keep.id, updates, this.now().toISOString())
      }

      this.db.prepare('INSERT OR IGNORE INTO task_sources (work_item_id, source_id) SELECT ?, source_id FROM task_sources WHERE work_item_id = ?').run(keep.id, other.id)
      this.repointSuggestions(other.id, keep.id)

      this.db.prepare('DELETE FROM next_actions WHERE work_item_id IN (?, ?)').run(keep.id, other.id)
      if (keep.aiAdjustment) {
        this.db.prepare('DELETE FROM priority_adjustments WHERE work_item_id = ?').run(keep.id)
        this.events.record(keep.id, [{ kind: 'ai_priority', from: String(keep.aiAdjustment.delta), to: null }], by)
      }

      // Recorded last, so it heads the lines this merge added.
      this.events.record(keep.id, [{ kind: 'merged', from: other.title }], by)
      this.tasks.delete(other.id)
    })
    return this.tasks.get(keep.id)!
  }

  private updates(taskId: number): string {
    const row = this.db.prepare(`SELECT summary FROM context_briefs WHERE scope = 'task' AND owner_id = ?`).get(taskId) as { summary: string } | undefined
    return row?.summary ?? ''
  }

  /**
   * Review suggestions still pending about the removed item now point at the kept one, so they can
   * still be accepted. Accepted ones that created it do too, so the weekly review still finds the
   * import the merged item came from.
   */
  private repointSuggestions(from: number, to: number): void {
    this.db.prepare(`UPDATE suggestions SET payload = json_set(payload, '$.taskId', ?) WHERE status = 'pending' AND json_extract(payload, '$.taskId') = ?`).run(to, from)
    this.db
      .prepare(
        `UPDATE suggestions SET payload = json_set(payload, '$.briefOwnerId', ?)
         WHERE status = 'pending' AND json_extract(payload, '$.briefScope') = 'task' AND json_extract(payload, '$.briefOwnerId') = ?`,
      )
      .run(to, from)
    this.db.prepare('UPDATE suggestions SET result_task_id = ? WHERE result_task_id = ?').run(to, from)
  }
}
