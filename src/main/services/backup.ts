import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { backup, type DatabaseSync } from 'node:sqlite'

export const BACKUP_PREFIX = 'chiefofstaff-'

const pad = (n: number) => String(n).padStart(2, '0')
const stamp = (d: Date) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`

/**
 * Copies a consistent snapshot of the live database (SQLite online backup API) into a backup
 * folder, typically on OneDrive, then keeps only the newest `keep` snapshots.
 * The live database itself never lives in a synced folder.
 */
export async function createBackup(db: DatabaseSync, folder: string, keep: number, now = new Date()): Promise<string> {
  mkdirSync(folder, { recursive: true })
  const target = join(folder, `${BACKUP_PREFIX}${stamp(now)}.db`)
  await backup(db, target)
  pruneBackups(folder, keep)
  return target
}

export function pruneBackups(folder: string, keep: number): void {
  readdirSync(folder)
    .filter((f) => f.startsWith(BACKUP_PREFIX) && f.endsWith('.db'))
    .sort()
    .reverse()
    .slice(Math.max(1, keep))
    .forEach((f) => rmSync(join(folder, f)))
}
