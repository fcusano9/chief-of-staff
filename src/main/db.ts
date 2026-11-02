import { DatabaseSync } from 'node:sqlite'

/**
 * Schema migrations, applied in order. PRAGMA user_version records how many have run.
 * Never edit a shipped migration; add a new one.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL
  );
  CREATE TABLE people (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT,
    email TEXT,
    priority_weight INTEGER NOT NULL DEFAULT 3
  );
  CREATE TABLE work_items (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    due_date TEXT,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    requester_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
    priority_score INTEGER NOT NULL DEFAULT 0,
    priority_rationale TEXT,
    priority_override INTEGER,
    follow_up_count INTEGER NOT NULL DEFAULT 0,
    waiting_on TEXT,
    waiting_since TEXT,
    created_at TEXT NOT NULL,
    last_activity_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE INDEX ix_work_items_status ON work_items(status);
  CREATE INDEX ix_work_items_project ON work_items(project_id);
  CREATE INDEX ix_work_items_requester ON work_items(requester_id);
  CREATE TABLE subtasks (
    id INTEGER PRIMARY KEY,
    work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    is_done INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX ix_subtasks_item ON subtasks(work_item_id);
  CREATE TABLE status_updates (
    id INTEGER PRIMARY KEY,
    work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    is_ai_generated INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX ix_status_updates_item ON status_updates(work_item_id);
  CREATE TABLE context_briefs (
    id INTEGER PRIMARY KEY,
    scope TEXT NOT NULL,
    owner_id INTEGER NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    standing_instructions TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    UNIQUE (scope, owner_id)
  );
  CREATE TABLE source_items (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    from_name TEXT,
    occurred_at TEXT NOT NULL,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL UNIQUE,
    external_id TEXT,
    imported_at TEXT NOT NULL
  );
  `,
]

/** Opens (creating if needed) the database and brings its schema up to date. */
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  migrate(db)
  return db
}

export function migrate(db: DatabaseSync): void {
  const current = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[i]!)
      db.exec(`PRAGMA user_version = ${i + 1}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
}

/** Runs `fn` inside a transaction. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export const nowIso = (): string => new Date().toISOString()
