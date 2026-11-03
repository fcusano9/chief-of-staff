import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import type { BackupInfo, BackupKind } from '@shared/types'

export const BACKUP_PREFIX = 'chiefofstaff-'
/** Safety copies (before an upgrade or a restore) kept per kind, apart from the daily ones. */
export const SAFETY_COPIES_KEPT = 10

const pad = (n: number) => String(n).padStart(2, '0')
const stamp = (d: Date) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`

// chiefofstaff-20261103-091353.db  or  chiefofstaff-20261103-091353-before-upgrade-v5.db
const NAME = /^chiefofstaff-(\d{8})-(\d{6})(?:-(before-upgrade|before-restore)(?:-v\d+)?)?\.db$/

/**
 * Copies a consistent snapshot of the live database (SQLite online backup API) into a backup
 * folder, typically on OneDrive, then keeps only the newest `keep` daily snapshots.
 * The live database itself never lives in a synced folder.
 */
export async function createBackup(db: DatabaseSync, folder: string, keep: number, now = new Date()): Promise<string> {
  mkdirSync(folder, { recursive: true })
  const target = join(folder, `${BACKUP_PREFIX}${stamp(now)}.db`)
  await backup(db, target)
  // The copy inherits WAL mode; switch it to a single self-contained file so opening it later never
  // creates -wal/-shm side files in the (synced) backup folder.
  const copy = new DatabaseSync(target)
  copy.exec('PRAGMA journal_mode = DELETE')
  copy.close()
  pruneBackups(folder, keep)
  return target
}

/**
 * Writes a complete copy right now (SQLite `VACUUM INTO`), for moments that can't wait for an
 * async backup: just before a schema upgrade or a restore. Throws if the copy can't be written.
 */
export function snapshotNow(db: DatabaseSync, folder: string, label: 'before-upgrade' | 'before-restore', version?: number, now = new Date()): string {
  mkdirSync(folder, { recursive: true })
  const target = join(folder, `${BACKUP_PREFIX}${stamp(now)}-${label}${version ? `-v${version}` : ''}.db`)
  if (existsSync(target)) rmSync(target)
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
  pruneBackups(folder, Number.POSITIVE_INFINITY)
  return target
}

/** Keeps the newest `keep` daily backups and the newest few safety copies of each kind. */
export function pruneBackups(folder: string, keep: number): void {
  const files = readdirSync(folder)
    .filter((f) => f.startsWith(BACKUP_PREFIX) && f.endsWith('.db'))
    .sort()
    .reverse()
  const groups = new Map<string, string[]>()
  for (const f of files) {
    const kind = NAME.exec(f)?.[3] ?? 'daily'
    groups.set(kind, [...(groups.get(kind) ?? []), f])
  }
  for (const [kind, list] of groups) {
    const limit = kind === 'daily' ? Math.max(1, keep) : SAFETY_COPIES_KEPT
    list.slice(limit).forEach((f) => rmSync(join(folder, f)))
  }
}

/**
 * Checks a backup is one this version of the app can use. It reads a temporary copy, because
 * SQLite may create side files when opening a database, and the backup folder must stay untouched.
 */
export function inspectBackup(path: string, maxVersion: number): Pick<BackupInfo, 'compatible' | 'reason' | 'schemaVersion' | 'openTasks'> {
  let db: DatabaseSync | null = null
  const temp = join(tmpdir(), `cos-inspect-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  try {
    copyFileSync(path, temp)
    db = new DatabaseSync(temp, { readOnly: true })
    const version = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
    const hasTasks = !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'work_items'`).get()
    if (!hasTasks || version < 1) return { compatible: false, reason: 'Made by the earlier Windows-only version of the app', schemaVersion: version, openTasks: null }
    if (version > maxVersion) return { compatible: false, reason: 'Made by a newer version of the app. Update this app first', schemaVersion: version, openTasks: null }
    const open = Number((db.prepare(`SELECT COUNT(*) AS n FROM work_items WHERE status IN ('open', 'in_progress', 'waiting_on')`).get() as { n: number }).n)
    return { compatible: true, reason: null, schemaVersion: version, openTasks: open }
  } catch {
    return { compatible: false, reason: "Couldn't be read. The file may be damaged or still syncing", schemaVersion: null, openTasks: null }
  } finally {
    db?.close()
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${temp}${suffix}`, { force: true })
  }
}

/** All backups in the given folders, newest first, with whether each can be restored. */
export function listBackups(folders: string[], maxVersion: number): BackupInfo[] {
  const seen = new Set<string>()
  const out: BackupInfo[] = []
  for (const folder of folders) {
    if (!existsSync(folder)) continue
    for (const fileName of readdirSync(folder)) {
      const m = NAME.exec(fileName)
      const path = resolve(folder, fileName)
      if (!m || seen.has(path.toLowerCase())) continue
      seen.add(path.toLowerCase())
      const [, d, t, label] = m
      const createdAt = new Date(+d!.slice(0, 4), +d!.slice(4, 6) - 1, +d!.slice(6, 8), +t!.slice(0, 2), +t!.slice(2, 4), +t!.slice(4, 6)).toISOString()
      const kind: BackupKind = (label as BackupKind | undefined) ?? 'daily'
      out.push({ path, fileName, folder, createdAt, kind, size: statSync(path).size, ...inspectBackup(path, maxVersion) })
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.fileName.localeCompare(a.fileName))
}

const MARKER = 'restore-pending.json'

/** Records a restore to perform at the next start, before the database is opened. */
export function requestRestore(dataFolder: string, backupPath: string): void {
  writeFileSync(join(dataFolder, MARKER), JSON.stringify({ backupPath, requestedAt: new Date().toISOString() }))
}

/**
 * If a restore was requested, replaces the database file with the chosen backup. Runs at startup
 * before anything opens the database. Returns the backup used, or null if there was nothing to do.
 * The copy goes to a temporary file first, so a failure never leaves a half-written database.
 */
export function applyPendingRestore(dataFolder: string, databasePath: string): string | null {
  const markerPath = join(dataFolder, MARKER)
  if (!existsSync(markerPath)) return null
  let backupPath: string
  try {
    backupPath = (JSON.parse(readFileSync(markerPath, 'utf8')) as { backupPath: string }).backupPath
  } finally {
    rmSync(markerPath, { force: true })
  }
  if (!backupPath || !existsSync(backupPath)) throw new Error(`The backup to restore (${basename(backupPath ?? '')}) was not found, so nothing was changed.`)
  const temp = `${databasePath}.restoring`
  copyFileSync(backupPath, temp)
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${databasePath}${suffix}`, { force: true })
  renameSync(temp, databasePath)
  return backupPath
}
