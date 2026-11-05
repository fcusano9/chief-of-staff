import { DatabaseSync } from 'node:sqlite'

/**
 * Schema migrations, applied in order. PRAGMA user_version records how many have run.
 * Never edit a shipped migration; add a new one.
 */
/** A migration is SQL, or a function for steps SQL can't express (like adding a column only if missing). */
export type Migration = string | ((db: DatabaseSync) => void)

export const MIGRATIONS: Migration[] = [
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
  // AI log: each extraction run of an import, and every request sent to the AI with its raw response.
  // IF NOT EXISTS because a development build applied this as version 5 on one database (see the next step).
  `
  CREATE TABLE IF NOT EXISTS extraction_runs (
    id INTEGER PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES source_items(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    raw_output TEXT,
    kept_output TEXT,
    dropped_output TEXT,
    error TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_extraction_runs_source ON extraction_runs(source_id);
  CREATE TABLE IF NOT EXISTS ai_calls (
    id INTEGER PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES extraction_runs(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    request TEXT NOT NULL,
    response TEXT,
    error TEXT,
    started_at TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER
  );
  CREATE INDEX IF NOT EXISTS ix_ai_calls_run ON ai_calls(run_id);
  `,
  // Repair: the AI log and the project overview were built in parallel and both shipped as
  // version 5. A database that got the AI log as version 5 skipped the project columns above;
  // add whatever is missing. A no-op everywhere else.
  (db) => {
    addMissingColumns(db, 'projects', ['overview', 'brief', 'brief_by', 'brief_at', 'brief_context'])
    addMissingColumns(db, 'extraction_runs', ['dropped_output'])
  },
  // Milestone 4: Outlook mail. Each conversation read becomes a source_item tied to its import;
  // mail_messages records every message read, so the same email is never read twice.
  `
  CREATE TABLE mail_imports (
    id INTEGER PRIMARY KEY,
    since TEXT NOT NULL,
    checked_at TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    complete INTEGER NOT NULL DEFAULT 0,
    provider TEXT
  );
  CREATE TABLE mail_messages (
    message_key TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    source_id INTEGER REFERENCES source_items(id) ON DELETE SET NULL,
    direction TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    entry_id TEXT,
    store_id TEXT
  );
  CREATE INDEX ix_mail_messages_source ON mail_messages(source_id);
  ALTER TABLE source_items ADD COLUMN mail_import_id INTEGER REFERENCES mail_imports(id) ON DELETE SET NULL;
  ALTER TABLE source_items ADD COLUMN mail_meta TEXT;
  `,
  // Waiting items have their own list, including when done: remember who a finished task was waiting on.
  `ALTER TABLE work_items ADD COLUMN waited_on TEXT;`,
  // Milestone 3: daily briefings. Every briefing is kept (content is JSON, a few KB each). The AI
  // requests behind each one go in briefing_ai_calls, kept only for the newest few briefings.
  // started_by is 'manual' today; a scheduler would write 'scheduled'.
  `
  CREATE TABLE briefings (
    id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL,
    started_by TEXT NOT NULL,
    written_by TEXT NOT NULL,
    since TEXT NOT NULL,
    content TEXT NOT NULL
  );
  CREATE TABLE briefing_ai_calls (
    id INTEGER PRIMARY KEY,
    briefing_id INTEGER NOT NULL REFERENCES briefings(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    request TEXT NOT NULL,
    response TEXT,
    error TEXT,
    started_at TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER
  );
  CREATE INDEX ix_briefing_ai_calls_briefing ON briefing_ai_calls(briefing_id);
  `,
  // AI spending: one row per paid (Claude) request, for the cost estimates on the AI spending
  // screen. Unlike the AI logs this is never pruned, so monthly totals don't shrink. Rows are
  // filled in from the Claude requests already in the AI logs; the model is the one that answered
  // (response), else the one asked for (request).
  `
  CREATE TABLE ai_usage (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    purpose TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    briefing_id INTEGER REFERENCES briefings(id) ON DELETE SET NULL
  );
  CREATE INDEX ix_ai_usage_at ON ai_usage(at);
  CREATE INDEX ix_ai_usage_briefing ON ai_usage(briefing_id);
  INSERT INTO ai_usage (at, purpose, model, input_tokens, output_tokens)
    SELECT started_at, 'import', COALESCE(json_extract(response, '$.model'), json_extract(request, '$.model')), input_tokens, output_tokens
    FROM ai_calls
    WHERE endpoint LIKE 'Anthropic%' AND input_tokens IS NOT NULL AND json_valid(request)
      AND (response IS NULL OR json_valid(response)) AND json_extract(request, '$.model') IS NOT NULL
    ORDER BY started_at;
  INSERT INTO ai_usage (at, purpose, model, input_tokens, output_tokens, briefing_id)
    SELECT started_at, 'briefing', COALESCE(json_extract(response, '$.model'), json_extract(request, '$.model')), input_tokens, output_tokens, briefing_id
    FROM briefing_ai_calls
    WHERE endpoint LIKE 'Anthropic%' AND input_tokens IS NOT NULL AND json_valid(request)
      AND (response IS NULL OR json_valid(response)) AND json_extract(request, '$.model') IS NOT NULL
    ORDER BY started_at;
  `,
]

/** Adds TEXT columns that aren't there yet (SQLite has no ADD COLUMN IF NOT EXISTS). */
function addMissingColumns(db: DatabaseSync, table: string, columns: string[]): void {
  const existing = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name))
  for (const column of columns) if (!existing.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`)
}

/** The schema version this build of the app writes. Backups newer than this can't be restored. */
export const SCHEMA_VERSION = MIGRATIONS.length

export interface MigrateOptions {
  /** Defaults to the app's migrations; tests pass their own. */
  migrations?: Migration[]
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
      const step = migrations[i]!
      if (typeof step === 'string') db.exec(step)
      else step(db)
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
