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
  // Milestone 2: AI suggestions awaiting review, and which sources each task came from.
  `
  ALTER TABLE source_items ADD COLUMN extracted_at TEXT;
  ALTER TABLE source_items ADD COLUMN extract_error TEXT;
  ALTER TABLE source_items ADD COLUMN extracted_by TEXT;
  CREATE TABLE suggestions (
    id INTEGER PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES source_items(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    payload TEXT NOT NULL,
    evidence TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    decided_at TEXT,
    result_task_id INTEGER
  );
  CREATE INDEX ix_suggestions_status ON suggestions(status);
  CREATE TABLE task_sources (
    work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
    source_id INTEGER NOT NULL REFERENCES source_items(id) ON DELETE CASCADE,
    PRIMARY KEY (work_item_id, source_id)
  );
  `,
  // AI-proposed projects and people: the id of the project or person an accepted suggestion created.
  `
  ALTER TABLE suggestions ADD COLUMN result_ref_id INTEGER;
  `,
  // People: company, and a one-line brief kept apart from the context history (the person's
  // context_briefs.summary). brief_context is the history the brief was written from, so notes
  // added since can be counted.
  `
  ALTER TABLE people ADD COLUMN company TEXT;
  ALTER TABLE people ADD COLUMN brief TEXT;
  ALTER TABLE people ADD COLUMN brief_by TEXT;
  ALTER TABLE people ADD COLUMN brief_at TEXT;
  ALTER TABLE people ADD COLUMN brief_context TEXT;
  `,
  // Projects: a one-line overview written by hand, and a short status brief the AI writes from the
  // project's history (its context_briefs.summary, which keeps every dated note). brief_context is
  // the history the brief was written from, so notes added since can be counted.
  `
  ALTER TABLE projects ADD COLUMN overview TEXT;
  ALTER TABLE projects ADD COLUMN brief TEXT;
  ALTER TABLE projects ADD COLUMN brief_by TEXT;
  ALTER TABLE projects ADD COLUMN brief_at TEXT;
  ALTER TABLE projects ADD COLUMN brief_context TEXT;
  `,
]

/** The schema version this build of the app writes. Backups newer than this can't be restored. */
export const SCHEMA_VERSION = MIGRATIONS.length

export interface MigrateOptions {
  /** Defaults to the app's migrations; tests pass their own. */
  migrations?: string[]
  /**
   * Runs before an existing database is upgraded (never for a brand-new one). Used to take a
   * safety copy. If it throws, nothing is migrated and the error is passed on.
   */
  beforeUpgrade?: (db: DatabaseSync, from: number, to: number) => void
}

/** Opens (creating if needed) the database and brings its schema up to date. */
export function openDatabase(path: string, options: MigrateOptions = {}): DatabaseSync {
  const db = new DatabaseSync(path)
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    migrate(db, options)
  } catch (err) {
    db.close()
    throw err
  }
  return db
}

export const schemaVersion = (db: DatabaseSync): number => Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)

export function migrate(db: DatabaseSync, { migrations = MIGRATIONS, beforeUpgrade }: MigrateOptions = {}): void {
  const current = schemaVersion(db)
  if (current > 0 && current < migrations.length) beforeUpgrade?.(db, current, migrations.length)
  for (let i = current; i < migrations.length; i++) {
    db.exec('BEGIN')
    try {
      db.exec(migrations[i]!)
      db.exec(`PRAGMA user_version = ${i + 1}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
}

const depth = new WeakMap<DatabaseSync, number>()

/** Runs `fn` inside a transaction. Nested calls join the outer transaction. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  const level = depth.get(db) ?? 0
  if (level > 0) {
    depth.set(db, level + 1)
    try {
      return fn()
    } finally {
      depth.set(db, level)
    }
  }
  depth.set(db, 1)
  try {
    return runTransaction(db, fn)
  } finally {
    depth.set(db, 0)
  }
}

function runTransaction<T>(db: DatabaseSync, fn: () => T): T {
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
