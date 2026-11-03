import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MIGRATIONS, openDatabase, SCHEMA_VERSION, schemaVersion } from '../src/main/db'
import { chooseDataLocation, findRedirectingPackage } from '../src/main/paths'
import { applyPendingRestore, createBackup, inspectBackup, listBackups, pruneBackups, requestRestore, SAFETY_COPIES_KEPT, snapshotNow } from '../src/main/services/backup'
import { TaskService } from '../src/main/services/tasks'
import { DEFAULT_SETTINGS } from '@shared/types'

const V1 = ['CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT);']
const V2 = [...V1, 'ALTER TABLE notes ADD COLUMN pinned INTEGER;']

describe('data safety', () => {
  let folder: string
  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'cos-safety-'))
  })
  afterEach(() => rmSync(folder, { recursive: true, force: true }))

  const addTask = (db: DatabaseSync, title: string) =>
    new TaskService(db, () => DEFAULT_SETTINGS.priorityWeights).save({
      id: 0, title, notes: null, status: 'open', dueDate: null, projectId: null, requesterId: null,
      priorityOverride: null, followUpCount: 0, waitingOn: null, subtasks: [],
    })

  it('takes a copy before upgrading an existing database, and the copy has the old data', () => {
    const path = join(folder, 'app.db')
    const v1 = openDatabase(path, { migrations: V1 })
    v1.exec(`INSERT INTO notes (text) VALUES ('keep me')`)
    v1.close()

    const calls: [number, number][] = []
    const upgraded = openDatabase(path, {
      migrations: V2,
      beforeUpgrade: (db, from, to) => {
        calls.push([from, to])
        snapshotNow(db, join(folder, 'backups'), 'before-upgrade', from)
      },
    })
    expect(calls).toEqual([[1, 2]])
    expect(schemaVersion(upgraded)).toBe(2)
    upgraded.close()

    const [copy] = readdirSync(join(folder, 'backups'))
    expect(copy).toMatch(/^chiefofstaff-\d{8}-\d{6}-before-upgrade-v1\.db$/)
    const snap = new DatabaseSync(join(folder, 'backups', copy!), { readOnly: true })
    expect(schemaVersion(snap)).toBe(1)
    expect(snap.prepare('SELECT text FROM notes').get()).toEqual({ text: 'keep me' })
    snap.close()
  })

  it('does not upgrade when the safety copy fails', () => {
    const path = join(folder, 'app.db')
    openDatabase(path, { migrations: V1 }).close()
    expect(() =>
      openDatabase(path, {
        migrations: V2,
        beforeUpgrade: () => {
          throw new Error('OneDrive unavailable')
        },
      }),
    ).toThrow('OneDrive unavailable')
    const db = new DatabaseSync(path, { readOnly: true })
    expect(schemaVersion(db)).toBe(1)
    db.close()
  })

  it('upgrades a database that got the AI log as version 5 (parallel branches), keeping its data', () => {
    const path = join(folder, 'dev-v5.db')
    // What the AI log development build created: migrations 1-4, then the AI log tables as version 5.
    const devBuild = [...MIGRATIONS.slice(0, 4), MIGRATIONS[5]!]
    const old = openDatabase(path, { migrations: devBuild })
    expect(schemaVersion(old)).toBe(5)
    old.exec(`INSERT INTO source_items (kind, title, occurred_at, content, content_hash, imported_at) VALUES ('note', 'n', 'x', 'c', 'h', 'x')`)
    old.exec(`INSERT INTO extraction_runs (source_id, provider, started_at) VALUES (1, 'Demo AI', 'x')`)
    old.exec(`INSERT INTO projects (name, color, created_at) VALUES ('Roadmap', '#7F77DD', 'x')`)
    old.close()

    const db = openDatabase(path)
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION)
    const projectColumns = (db.prepare('PRAGMA table_info(projects)').all() as { name: string }[]).map((c) => c.name)
    expect(projectColumns).toEqual(expect.arrayContaining(['overview', 'brief', 'brief_by', 'brief_at', 'brief_context']))
    expect(db.prepare('SELECT provider FROM extraction_runs').get()).toEqual({ provider: 'Demo AI' })
    expect(db.prepare('SELECT name, overview FROM projects').get()).toEqual({ name: 'Roadmap', overview: null })
    db.close()
  })

  it('upgrades a main-branch version 5 database (project columns) to the AI log', () => {
    const path = join(folder, 'main-v5.db')
    openDatabase(path, { migrations: MIGRATIONS.slice(0, 5) }).close()
    const db = openDatabase(path)
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION)
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name = 'ai_calls'`).get()).toEqual({ name: 'ai_calls' })
    db.close()
  })

  it('does not take a copy for a brand-new database', () => {
    let called = false
    openDatabase(join(folder, 'new.db'), { beforeUpgrade: () => (called = true) }).close()
    expect(called).toBe(false)
  })

  it('prunes daily backups and safety copies separately', () => {
    const dir = join(folder, 'b')
    mkdirSync(dir)
    for (let d = 1; d <= 5; d++) writeFileSync(join(dir, `chiefofstaff-2026110${d}-080000.db`), '')
    for (let d = 10; d < 10 + SAFETY_COPIES_KEPT + 2; d++) writeFileSync(join(dir, `chiefofstaff-202611${d}-080000-before-upgrade-v3.db`), '')
    writeFileSync(join(dir, 'unrelated.txt'), '')
    pruneBackups(dir, 2)
    const files = readdirSync(dir)
    expect(files.filter((f) => /\d{6}\.db$/.test(f))).toEqual(['chiefofstaff-20261104-080000.db', 'chiefofstaff-20261105-080000.db'])
    expect(files.filter((f) => f.includes('before-upgrade'))).toHaveLength(SAFETY_COPIES_KEPT)
    expect(files).toContain('unrelated.txt')
  })

  it('only offers backups this version can restore', () => {
    const dir = join(folder, 'b')
    mkdirSync(dir)
    const good = openDatabase(join(folder, 'live.db'))
    addTask(good, 'Roadmap slides')
    snapshotNow(good, dir, 'before-restore', undefined, new Date(2026, 10, 3, 9, 0, 0))
    good.close()

    const old = new DatabaseSync(join(dir, 'chiefofstaff-20261102-121613.db')) // the old Windows app's schema
    old.exec('CREATE TABLE WorkItems (Id INTEGER PRIMARY KEY)')
    old.close()
    const newer = new DatabaseSync(join(dir, 'chiefofstaff-20261102-130000.db'))
    newer.exec(`CREATE TABLE work_items (id INTEGER); PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    newer.close()
    writeFileSync(join(dir, 'chiefofstaff-20261102-140000.db'), 'not a database')

    const list = listBackups([dir, dir], SCHEMA_VERSION)
    expect(list).toHaveLength(4) // the same folder twice is listed once
    const byName = Object.fromEntries(list.map((b) => [b.fileName, b]))
    expect(byName['chiefofstaff-20261103-090000-before-restore.db']).toMatchObject({ compatible: true, openTasks: 1, kind: 'before-restore' })
    expect(byName['chiefofstaff-20261102-121613.db']!.reason).toMatch(/earlier Windows-only/)
    expect(byName['chiefofstaff-20261102-130000.db']!.reason).toMatch(/newer version/)
    expect(byName['chiefofstaff-20261102-140000.db']!.compatible).toBe(false)
    expect(inspectBackup(join(folder, 'missing.db'), SCHEMA_VERSION).compatible).toBe(false)
  })

  it('writes daily backups as single files and never adds files to the backup folder when listing', async () => {
    const dir = join(folder, 'b')
    const db = openDatabase(join(folder, 'live.db'))
    addTask(db, 'One')
    await createBackup(db, dir, 30)
    db.close()
    const before = readdirSync(dir)
    expect(before).toHaveLength(1)
    listBackups([dir], SCHEMA_VERSION)
    listBackups([dir], SCHEMA_VERSION)
    expect(readdirSync(dir)).toEqual(before)
  })

  it('restores a backup on the next start, replacing the database and its WAL files', () => {
    const live = join(folder, 'chiefofstaff.db')
    const dir = join(folder, 'backups')
    let db = openDatabase(live)
    addTask(db, 'From the backup')
    const backupPath = snapshotNow(db, dir, 'before-restore')
    addTask(db, 'Added after the backup')
    db.close()
    writeFileSync(`${live}-wal`, 'stale')

    expect(applyPendingRestore(folder, live)).toBeNull() // nothing requested yet
    requestRestore(folder, backupPath)
    expect(applyPendingRestore(folder, live)).toBe(backupPath)
    expect(existsSync(join(folder, 'restore-pending.json'))).toBe(false)
    expect(existsSync(`${live}-wal`)).toBe(false)

    db = openDatabase(live)
    expect(new TaskService(db, () => DEFAULT_SETTINGS.priorityWeights).listActive().map((t) => t.title)).toEqual(['From the backup'])
    db.close()
  })

  it('leaves the database alone if the requested backup has disappeared', () => {
    const live = join(folder, 'chiefofstaff.db')
    const db = openDatabase(live)
    addTask(db, 'Still here')
    db.close()
    requestRestore(folder, join(folder, 'gone.db'))
    expect(() => applyPendingRestore(folder, live)).toThrow(/not found/)
    const reopened = openDatabase(live)
    expect(new TaskService(reopened, () => DEFAULT_SETTINGS.priorityWeights).listActive()).toHaveLength(1)
    reopened.close()
  })

  it('keeps dev and test runs away from real data and real backups', () => {
    const base = { appDataFolder: 'C:/AppData/Roaming', defaultUserData: 'C:/AppData/Roaming/Chief of Staff', oneDrive: 'C:/OneDrive', documents: 'C:/Docs' }
    const installed = chooseDataLocation({ ...base, isPackaged: true })
    expect(installed).toEqual({ dataFolder: base.defaultUserData, defaultBackupFolder: join('C:/OneDrive', 'Chief of Staff Backups'), isSeparateData: false })
    const dev = chooseDataLocation({ ...base, isPackaged: false })
    expect(dev.dataFolder).toBe(join(base.appDataFolder, 'Chief of Staff (dev)'))
    expect(dev.defaultBackupFolder).toBe(join(dev.dataFolder, 'backups'))
    expect(dev.isSeparateData).toBe(true)
    const test = chooseDataLocation({ ...base, isPackaged: true, envDataDir: 'C:/Temp/cos' })
    expect(test).toEqual({ dataFolder: 'C:/Temp/cos', defaultBackupFolder: join('C:/Temp/cos', 'backups'), isSeparateData: true })
  })
})

describe('refusing to open real data from inside another app', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cos-redirect-'))
    mkdirSync(join(root, 'Roaming', 'Chief of Staff'), { recursive: true })
    mkdirSync(join(root, 'Local', 'Packages', 'Other.App_abc'), { recursive: true })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))
  const data = () => join(root, 'Roaming', 'Chief of Staff')

  it('finds the package whose private copy receives what the app saves, and cleans up its probe', () => {
    // A junction stands in for Windows redirection: the package's private copy shows what is saved in the data folder.
    const copy = join(root, 'Local', 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming')
    mkdirSync(copy, { recursive: true })
    symlinkSync(data(), join(copy, 'Chief of Staff'), 'junction')
    expect(findRedirectingPackage(data(), join(root, 'Roaming'), join(root, 'Local'))).toBe('Claude_pzs8sxrjxfjjc')
    expect(readdirSync(data())).toEqual([])
  })

  it('finds nothing when the data folder is real, or not under AppData', () => {
    expect(findRedirectingPackage(data(), join(root, 'Roaming'), join(root, 'Local'))).toBeNull()
    expect(findRedirectingPackage(data(), join(root, 'Elsewhere'), join(root, 'Local'))).toBeNull()
    expect(findRedirectingPackage(data(), join(root, 'Roaming'), undefined)).toBeNull()
    expect(readdirSync(data())).toEqual([])
  })
})
