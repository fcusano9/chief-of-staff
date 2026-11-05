import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { MIGRATIONS, migrate } from '../src/main/db'
import { latestNote, noteStamp, recentNotes } from '../src/shared/notes'

describe('updates: what the AI is sent', () => {
  const summary = ['Nov 1, 2026: First.', 'Nov 2, 2026: Second update (from “Call”)', 'Nov 3, 2026: Third.'].join('\n')

  it('sends whole updates only, newest first, without their sources', () => {
    expect(recentNotes(summary, 300)).toEqual(['Nov 3, 2026: Third.', 'Nov 2, 2026: Second update', 'Nov 1, 2026: First.'])
    // 'Nov 3, 2026: Third.' is 19 characters; the next one doesn't fit in 30, so it stops there.
    expect(recentNotes(summary, 30)).toEqual(['Nov 3, 2026: Third.'])
  })

  it('shortens a newest update that is too long on its own, so the AI still sees something', () => {
    const [only, ...rest] = recentNotes(`Nov 3, 2026: ${'word '.repeat(100)}`, 50)
    expect(rest).toEqual([])
    expect(only).toHaveLength(50)
    expect(only!.endsWith('…')).toBe(true)
  })

  it('finds the latest update', () => {
    expect(latestNote(summary)).toEqual({ date: 'Nov 3, 2026', text: 'Third.', source: null })
    expect(latestNote('  \n')).toBeNull()
  })
})

describe('migration: task updates', () => {
  it('moves status updates and standing instructions into Updates, and In progress becomes Open', () => {
    const db = new DatabaseSync(':memory:')
    // The schema just before the task-updates migration (v11), whatever migrations come after it.
    migrate(db, { migrations: MIGRATIONS.slice(0, 10) })
    const now = '2026-11-01T12:00:00.000Z'
    const task = (title: string, status: string) =>
      Number(db.prepare(`INSERT INTO work_items (title, status, created_at, last_activity_at) VALUES (?, ?, ?, ?)`).run(title, status, now, now).lastInsertRowid)
    const a = task('FAQ', 'in_progress')
    const b = task('Slides', 'open')
    const c = task('Quote', 'open')
    db.prepare(`INSERT INTO context_briefs (scope, owner_id, summary, standing_instructions, updated_at) VALUES ('task', ?, ?, ?, ?)`).run(
      a,
      'Background: dealers asked for this.\nOct 30, 2026: Kenji owns the review. (from “Sync”)\nNov 5, 2026: Draft sent.',
      'Keep it to one page',
      now,
    )
    const update = (id: number, text: string, at: string) => db.prepare(`INSERT INTO status_updates (work_item_id, text, is_ai_generated, created_at) VALUES (?, ?, 1, ?)`).run(id, text, at)
    update(a, 'Release notes arrived', '2026-11-02T15:00:00.000Z')
    update(b, 'Timeline approved', '2026-11-03T15:00:00.000Z')

    migrate(db)

    const summary = (id: number) => (db.prepare(`SELECT summary, standing_instructions FROM context_briefs WHERE scope = 'task' AND owner_id = ?`).get(id) as { summary: string; standing_instructions: string } | undefined)
    expect(summary(a)!.summary.split('\n')).toEqual([
      'Background: dealers asked for this.',
      'Standing instructions: Keep it to one page',
      'Oct 30, 2026: Kenji owns the review. (from “Sync”)',
      `${noteStamp(new Date('2026-11-02T15:00:00.000Z'))}: Release notes arrived`,
      'Nov 5, 2026: Draft sent.',
    ])
    expect(summary(a)!.standing_instructions).toBe('')
    expect(summary(b)!.summary).toBe(`${noteStamp(new Date('2026-11-03T15:00:00.000Z'))}: Timeline approved`)
    expect(summary(c)).toBeUndefined()
    expect(Number((db.prepare('SELECT COUNT(*) AS n FROM status_updates').get() as { n: number }).n)).toBe(0)
    expect((db.prepare('SELECT status FROM work_items WHERE id = ?').get(a) as { status: string }).status).toBe('open')
    db.close()
  })
})
