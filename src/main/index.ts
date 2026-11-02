import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, Menu, nativeTheme, shell } from 'electron'
import { API_CHANNELS, type Api } from '@shared/api'
import { CLAUDE_MODELS, type AiStatus, type AppSettings } from '@shared/types'
import { ClaudeProvider } from './ai/claude'
import { DemoProvider } from './ai/demo'
import { AiError, type AiProvider } from './ai/provider'
import { openDatabase } from './db'
import { createBackup } from './services/backup'
import { BriefService, PersonService, ProjectService } from './services/directory'
import { KeyStore } from './services/secrets'
import { SettingsStore } from './services/settings'
import { SourceService } from './services/sources'
import { SuggestionService } from './services/suggestions'
import { TaskService } from './services/tasks'

// COS_DATA_DIR points the app at a separate data folder (used for testing without touching real data).
if (process.env.COS_DATA_DIR) app.setPath('userData', process.env.COS_DATA_DIR)
const dataFolder = app.getPath('userData')
mkdirSync(dataFolder, { recursive: true })
const databasePath = join(dataFolder, 'chiefofstaff.db')

/** OneDrive for Business if present, else personal OneDrive, else Documents. */
const defaultBackupFolder = join(
  process.env.OneDriveCommercial ?? process.env.OneDrive ?? app.getPath('documents'),
  'Chief of Staff Backups',
)

function logCrash(error: unknown): void {
  try {
    appendFileSync(join(dataFolder, 'crash.log'), `${new Date().toISOString()}  ${error instanceof Error ? error.stack : String(error)}\n\n`)
  } catch {
    // Nothing more we can do.
  }
}
process.on('uncaughtException', logCrash)
process.on('unhandledRejection', logCrash)

const db = openDatabase(databasePath)
const settings = new SettingsStore(join(dataFolder, 'settings.json'))
const keys = new KeyStore(join(dataFolder, 'secrets.json'))
const tasks = new TaskService(db, () => settings.current.priorityWeights)
const projects = new ProjectService(db)
const people = new PersonService(db)
const briefs = new BriefService(db)
const suggestions = new SuggestionService(db, tasks, briefs)

/** The AI that reads imports. Claude only when chosen in Settings and a key is stored. */
function currentProvider(): AiProvider {
  const key = keys.get()
  if (settings.current.aiProvider === 'claude') {
    if (!key) throw new AiError('Claude is selected but no API key is set. Add one in Settings, or switch to the demo AI.')
    return new ClaudeProvider(key, settings.current.aiModel)
  }
  return new DemoProvider()
}
const sources = new SourceService(db, currentProvider, () => settings.current.userName)

function aiStatus(): AiStatus {
  const { aiProvider, aiModel } = settings.current
  const hasKey = !!keys.get()
  const modelLabel = CLAUDE_MODELS.find((m) => m.id === aiModel)?.label ?? aiModel
  return {
    provider: aiProvider,
    model: aiModel,
    hasKey,
    encryptionAvailable: keys.encryptionAvailable,
    label: aiProvider === 'demo' ? 'Demo AI (on this PC)' : hasKey ? modelLabel : 'Claude · no API key',
    sendsDataExternally: aiProvider === 'claude',
  }
}

let mainWindow: BrowserWindow | null = null
const isMac = process.platform === 'darwin'
const titleBarColors = (dark: boolean) => (dark ? { color: '#131317', symbolColor: '#ececf0' } : { color: '#ffffff', symbolColor: '#18181b' })

async function backupNow(): Promise<string> {
  const target = await createBackup(db, settings.current.backupFolder ?? defaultBackupFolder, settings.current.backupsToKeep)
  settings.save({ ...settings.current, lastBackupAt: new Date().toISOString() })
  return target
}

/** Backs up at most about once a day. Runs at startup and hourly while the app is open. */
function backupIfDue(): void {
  const last = settings.current.lastBackupAt
  if (last && Date.now() - Date.parse(last) < 20 * 3_600_000) return
  backupNow().catch(logCrash)
}

const handlers: { [K in keyof Api]: (...args: Parameters<Api[K]>) => ReturnType<Api[K]> | Promise<Awaited<ReturnType<Api[K]>>> } = {
  'tasks.listActive': (filter) => tasks.listActive(filter),
  'tasks.listWaiting': () => tasks.listWaiting(),
  'tasks.listForPerson': (personId) => tasks.listForPerson(personId),
  'tasks.get': (id) => tasks.get(id),
  'tasks.save': (input) => tasks.save(input),
  'tasks.setStatus': (id, status) => tasks.setStatus(id, status),
  'tasks.delete': (id) => tasks.delete(id),
  'tasks.summary': () => tasks.summary(),
  'projects.list': () => projects.list(),
  'projects.save': (project) => projects.save(project),
  'projects.delete': (id) => projects.delete(id),
  'people.list': () => people.list(),
  'people.save': (person) => {
    const saved = people.save(person)
    tasks.recomputeAll() // a changed weight changes priorities
    return saved
  },
  'people.delete': (id) => {
    people.delete(id)
    tasks.recomputeAll()
  },
  'briefs.get': (scope, ownerId) => briefs.get(scope, ownerId),
  'briefs.save': (brief) => briefs.save(brief),
  'settings.get': () => settings.current,
  'settings.save': (next: AppSettings) => {
    const weightsChanged = JSON.stringify(next.priorityWeights) !== JSON.stringify(settings.current.priorityWeights)
    // The backup time is owned here; a stale copy from the UI must not overwrite it.
    const saved = settings.save({ ...next, lastBackupAt: settings.current.lastBackupAt })
    if (weightsChanged) tasks.recomputeAll()
    return saved
  },
  'backup.now': () => backupNow(),
  'backup.openFolder': () => {
    const folder = settings.current.backupFolder ?? defaultBackupFolder
    mkdirSync(folder, { recursive: true })
    void shell.openPath(folder)
  },
  'app.info': () => ({ version: app.getVersion(), databasePath, defaultBackupFolder, platform: process.platform }),
  'app.setTitleBarTheme': (dark) => {
    if (!isMac) mainWindow?.setTitleBarOverlay({ ...titleBarColors(dark), height: 44 })
  },
  'sources.importAndExtract': (req) => sources.importAndExtract(req),
  'sources.extract': (sourceId) => sources.extract(sourceId),
  'sources.list': () => sources.list(),
  'sources.delete': (id) => sources.delete(id),
  'suggestions.listPending': () => suggestions.listPending(),
  'suggestions.count': () => suggestions.pendingCount(),
  'suggestions.accept': (id, edits) => suggestions.accept(id, edits),
  'suggestions.reject': (id) => suggestions.reject(id),
  'ai.status': () => aiStatus(),
  'ai.setKey': (key) => {
    keys.set(key)
    return aiStatus()
  },
  'ai.test': () => currentProvider().test(),
}

function registerIpc(): void {
  for (const channel of API_CHANNELS) {
    const handler = handlers[channel] as (...args: unknown[]) => unknown
    ipcMain.handle(channel, (_event, ...args: unknown[]) => handler(...args))
  }
}

function createWindow(): void {
  const dark = nativeTheme.shouldUseDarkColors
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 940,
    minHeight: 600,
    show: false,
    title: 'Chief of Staff',
    backgroundColor: dark ? '#0d0d10' : '#fafafa',
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 14, y: 14 } } : { titleBarOverlay: { ...titleBarColors(dark), height: 44 } }),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  // Links open in the user's browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())

  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore()
    mainWindow?.focus()
  })

  void app.whenReady().then(() => {
    if (!isMac) Menu.setApplicationMenu(null)
    tasks.recomputeAll()
    registerIpc()
    createWindow()
    backupIfDue()
    setInterval(() => {
      tasks.recomputeAll() // due dates and staleness change as time passes
      backupIfDue()
    }, 30 * 60_000)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (!isMac) app.quit()
  })
  app.on('will-quit', () => db.close())
}
