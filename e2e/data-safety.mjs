// Data safety: the safety copy before a database upgrade, restoring a backup through Settings
// (the app restarts itself), and dev runs staying out of the real data folder.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { launch } from './cdp.mjs'

const here = import.meta.dirname
const appDir = resolve(here, '..')
const dataDir = join(tmpdir(), 'cos-e2e-safety')
const backups = join(dataDir, 'backups')
const results = []
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** A database at schema version 1 (an older app version) with one task in it. */
function makeOldDatabase(path) {
  const db = new DatabaseSync(path)
  db.exec(`
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL);
    CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT, email TEXT, priority_weight INTEGER NOT NULL DEFAULT 3);
    CREATE TABLE work_items (id INTEGER PRIMARY KEY, title TEXT NOT NULL, notes TEXT, status TEXT NOT NULL DEFAULT 'open', due_date TEXT,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL, requester_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
      priority_score INTEGER NOT NULL DEFAULT 0, priority_rationale TEXT, priority_override INTEGER, follow_up_count INTEGER NOT NULL DEFAULT 0,
      waiting_on TEXT, waiting_since TEXT, created_at TEXT NOT NULL, last_activity_at TEXT NOT NULL, completed_at TEXT);
    CREATE TABLE subtasks (id INTEGER PRIMARY KEY, work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE, title TEXT NOT NULL, is_done INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE status_updates (id INTEGER PRIMARY KEY, work_item_id INTEGER NOT NULL REFERENCES work_items(id) ON DELETE CASCADE, text TEXT NOT NULL, is_ai_generated INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE context_briefs (id INTEGER PRIMARY KEY, scope TEXT NOT NULL, owner_id INTEGER NOT NULL, summary TEXT NOT NULL DEFAULT '', standing_instructions TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, UNIQUE (scope, owner_id));
    CREATE TABLE source_items (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, from_name TEXT, occurred_at TEXT NOT NULL, content TEXT NOT NULL, content_hash TEXT NOT NULL UNIQUE, external_id TEXT, imported_at TEXT NOT NULL);
    INSERT INTO work_items (title, created_at, last_activity_at) VALUES ('Task from the old version', '2026-11-01T12:00:00Z', '2026-11-01T12:00:00Z');
    PRAGMA user_version = 1;
  `)
  db.close()
}

rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
makeOldDatabase(join(dataDir, 'chiefofstaff.db'))
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ backupFolder: backups }))

let app = await launch({ appDir, dataDir, fresh: false })
try {
  // 1. Upgrading an older database makes a safety copy first, and keeps the data.
  const copies = existsSync(backups) ? readdirSync(backups) : []
  const pre = copies.find((f) => /-before-upgrade-v1\.db$/.test(f))
  check('safety copy taken before the upgrade', !!pre, copies.join(', '))
  if (pre) {
    const snap = new DatabaseSync(join(backups, pre), { readOnly: true })
    check('safety copy holds the old version', snap.prepare('PRAGMA user_version').get().user_version === 1)
    snap.close()
  }
  const titles = await app.eval(`return (await window.cos['tasks.listActive']()).map(t => t.title)`)
  check('data kept through the upgrade', JSON.stringify(titles) === JSON.stringify(['Task from the old version']), JSON.stringify(titles))
  check('test data is marked in the status bar', (await app.eval(`return document.querySelector('.statusbar').textContent`)).includes('Test data'))

  // 2. Make a backup, change the data, then restore the backup through Settings.
  await app.eval(`return await window.cos['backup.now']()`)
  await app.eval(`return await window.cos['tasks.save']({id:0,title:'Added after the backup',notes:null,status:'open',dueDate:null,projectId:null,requesterId:null,priorityOverride:null,followUpCount:0,waitingOn:null,subtasks:[]})`)
  await app.click('.iconbtn[title="Settings"]')
  await app.clickText('Show backups', 'button')
  await app.sleep(400)
  const rows = await app.eval(`return [...document.querySelectorAll('main .list .r')].map(r => r.textContent)`)
  check('backups listed with their open-task counts', rows.length >= 2 && rows.some((r) => r.includes('Daily') && r.includes('1 open task')), JSON.stringify(rows))
  await app.eval(`[...document.querySelectorAll('main .list .r')].find(r => r.textContent.includes('Daily')).querySelector('button').click()`)
  await app.sleep(200)
  check('restore asks to confirm', (await app.eval(`return document.querySelector('main').textContent`)).includes('Click again to restore'))
  await app.eval(`[...document.querySelectorAll('main .list button')].find(b => b.textContent.includes('Click again')).click()`)
  app.detach() // the app restarts itself; don't stop it
} catch (e) {
  results.push(`ERROR  ${e?.stack ?? e?.message ?? e?.type ?? String(e)}`)
  await app.close().catch(() => {})
}

// The app restarts itself with the same arguments; reattach and check the restored data.
try {
  // Wait for the old instance to exit (its debugging port goes away), then attach to the new one.
  const portUp = () => fetch('http://127.0.0.1:9333/json').then(() => true, () => false)
  for (let i = 0; i < 100 && (await portUp()); i++) await sleep(100)
  app = await launch({ appDir, dataDir, fresh: false, attachOnly: true })
  const titles = await app.eval(`return (await window.cos['tasks.listActive']()).map(t => t.title)`)
  check('restore brought back the backed-up data', JSON.stringify(titles) === JSON.stringify(['Task from the old version']), JSON.stringify(titles))
  await app.sleep(300)
  check('the app confirms the restore', ((await app.eval(`return document.querySelector('.toast')?.textContent`)) ?? '').startsWith('Restored from backup'))
  const files = readdirSync(backups)
  check('current data was saved before restoring', files.some((f) => f.includes('before-restore')), files.join(', '))
  check('no restore left pending', !existsSync(join(dataDir, 'restore-pending.json')))
  check('no renderer errors', app.errors.length === 0, app.errors.join(' | '))
  await app.close()
} catch (e) {
  results.push(`ERROR  ${e?.stack ?? e?.message ?? e?.type ?? String(e)}`)
}

// 3. Running from source without a test folder uses the separate dev folder, never the real one.
const devFolder = join(process.env.APPDATA ?? join(process.env.HOME ?? '', 'Library', 'Application Support'), 'Chief of Staff (dev)')
const devExisted = existsSync(devFolder)
try {
  app = await launch({ appDir, dataDir: null, port: 9334 })
  const info = await app.eval(`return await window.cos['app.info']()`)
  check('dev run uses the separate dev folder', info.isSeparateData && /Chief of Staff \(dev\)$/.test(info.dataFolder), info.dataFolder)
  check('dev run keeps backups in its own folder', info.defaultBackupFolder.startsWith(info.dataFolder), info.defaultBackupFolder)
  await app.close()
} catch (e) {
  results.push(`ERROR  ${e?.stack ?? e?.message ?? e?.type ?? String(e)}`)
}

console.log(results.join('\n'))
if (results.some((r) => !r.startsWith('PASS'))) process.exitCode = 1
await sleep(1000)
for (const dir of [dataDir, ...(devExisted ? [] : [devFolder])]) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }) // only folders this suite created
  } catch (e) {
    console.log(`Note: couldn't remove ${dir}: ${e.code}`)
  }
}
