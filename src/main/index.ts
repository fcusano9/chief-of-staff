import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'
import { API_CHANNELS, type Api } from '@shared/api'
import { BASIC_LABEL, CLAUDE_MODELS, isTestedLocalModel, localModelLabel, type AiChoiceGroup, type AiProviderId, type AiStatus, type AppSettings } from '@shared/types'
import { buildPersonBriefInput, cleanBrief } from './ai/brief'
import { buildProjectStatusInput, buildTaskStatusInput, cleanStatusCard } from './ai/status'
import { ClaudeProvider } from './ai/claude'
import { DemoProvider } from './ai/demo'
import { isLoopbackUrl, OllamaProvider } from './ai/ollama'
import { AiError, type AiProvider } from './ai/provider'
import { openDatabase, SCHEMA_VERSION } from './db'
import { chooseDataLocation, findRedirectingPackage } from './paths'
import { applyPendingRestore, createBackup, listBackups, requestRestore, snapshotNow } from './services/backup'
import { FixtureOutlook, PowerShellOutlook } from './mail/outlook'
import { AppleMailReader } from './mail/applemail'
import { BriefingService } from './services/briefings'
import { WeeklyService } from './services/weekly'
import { BriefService, PersonService, ProjectService } from './services/directory'
import { MailService } from './services/mail'
import { NextActionService, ProjectCardService } from './services/next-actions'
import { ReplyService } from './services/replies'
import { PriorityAdjustmentService } from './services/priority-adjustments'
import { nodeHost, OllamaManager } from './services/ollama-setup'
import { KeyStore } from './services/secrets'
import { SettingsStore } from './services/settings'
import { SourceService } from './services/sources'
import { SuggestionService } from './services/suggestions'
import { TaskService } from './services/tasks'
import { UsageService } from './services/usage'

// Only the installed app touches real data; dev runs and tests get their own folder (see paths.ts).
const location = chooseDataLocation({
  isPackaged: app.isPackaged,
  envDataDir: process.env.COS_DATA_DIR,
  appDataFolder: app.getPath('appData'),
  defaultUserData: app.getPath('userData'),
  oneDrive: process.env.OneDriveCommercial ?? process.env.OneDrive,
  documents: app.getPath('documents'),
})
app.setPath('userData', location.dataFolder)
const { dataFolder, defaultBackupFolder, isSeparateData } = location
mkdirSync(dataFolder, { recursive: true })
const databasePath = join(dataFolder, 'chiefofstaff.db')

// Real data must never be opened from inside another app's file redirection (e.g. started from
// Claude Desktop): it would read and write a private copy instead, and the two would drift apart.
const redirectedBy = isSeparateData ? null : findRedirectingPackage(dataFolder, app.getPath('appData'), process.env.LOCALAPPDATA)
if (redirectedBy) {
  dialog.showErrorBox(
    'Open Chief of Staff from the Start menu',
    `Chief of Staff was started from inside another app (${redirectedBy.split('_')[0]}). Windows would save your data into that app's private copy instead of your real data folder, so the two would no longer match.\n\nNothing was opened or changed. Close this and start Chief of Staff from the Start menu.`,
  )
  app.exit(1)
  process.exit(1)
}

// A second copy of the app must quit before it opens (or restores) the database.
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

function logCrash(error: unknown): void {
  try {
    appendFileSync(join(dataFolder, 'crash.log'), `${new Date().toISOString()}  ${error instanceof Error ? error.stack : String(error)}\n\n`)
  } catch {
    // Nothing more we can do.
  }
}
process.on('uncaughtException', logCrash)
process.on('unhandledRejection', logCrash)

const settings = new SettingsStore(join(dataFolder, 'settings.json'))
const backupFolder = () => settings.current.backupFolder ?? defaultBackupFolder
/** Kept next to the database, used when the backup folder (e.g. OneDrive) isn't available. */
const localBackupFolder = join(dataFolder, 'backups')

/** Opens the database, finishing a requested restore and taking a safety copy before any upgrade. */
function startDatabase(): { db: DatabaseSync; restoredFrom: string | null } {
  const restoredFrom = applyPendingRestore(dataFolder, databasePath)
  const db = openDatabase(databasePath, {
    beforeUpgrade: (d, from, to) => {
      try {
        snapshotNow(d, backupFolder(), 'before-upgrade', from)
      } catch (err) {
        logCrash(err)
        snapshotNow(d, localBackupFolder, 'before-upgrade', from) // if this also fails, the upgrade doesn't run
      }
    },
  })
  return { db, restoredFrom }
}

let started: ReturnType<typeof startDatabase>
try {
  started = startDatabase()
} catch (err) {
  logCrash(err)
  dialog.showErrorBox(
    'Chief of Staff could not start',
    `${err instanceof Error ? err.message : String(err)}\n\nYour data has not been changed. Details are in ${join(dataFolder, 'crash.log')}.`,
  )
  app.exit(1)
  throw err
}
const db = started.db
let restoredFrom = started.restoredFrom
const keys = new KeyStore(join(dataFolder, 'secrets.json'))
const tasks = new TaskService(db, () => settings.current.priorityWeights)
const projects = new ProjectService(db)
const people = new PersonService(db)
const briefs = new BriefService(db)
const nextActions = new NextActionService(db)
const projectCards = new ProjectCardService(db)
const adjustments = new PriorityAdjustmentService(db)
const suggestions = new SuggestionService(db, tasks, briefs, projects, people)

/** The AI that reads imports. Claude only when chosen in Settings and a key is stored. */
function currentProvider(): AiProvider {
  return providerFor(settings.current.aiProvider)
}
function providerFor(id: AiProviderId, localModel = settings.current.localModel): AiProvider {
  if (id === 'local') return new OllamaProvider(settings.current.localUrl, localModel)
  if (id === 'claude') {
    const key = keys.get()
    if (!key) throw new AiError('Claude is selected but no API key is set. Add one in Settings → AI providers, or pick another model.')
    return new ClaudeProvider(key, settings.current.aiModel)
  }
  return new DemoProvider()
}
const sources = new SourceService(db, currentProvider, () => settings.current.userName)
const briefings = new BriefingService(db, tasks, currentProvider, () => settings.current.userName)
const weekly = new WeeklyService(db, tasks, currentProvider, () => settings.current.userName)
const usage = new UsageService(db)
// Test data folders can read mail from a fixture file instead of Outlook (see e2e/README.md).
const outlookFixture = isSeparateData ? process.env.COS_OUTLOOK_FIXTURE : undefined
// COS_MAIL_APP=apple-mail makes the fixture behave as Apple Mail, for the Mac's words and Settings.
const outlook = outlookFixture
  ? new FixtureOutlook(outlookFixture, `${outlookFixture}.drafts.json`, process.env.COS_MAIL_APP === 'apple-mail' ? 'apple-mail' : 'outlook')
  : process.platform === 'win32' ? new PowerShellOutlook()
  : process.platform === 'darwin' ? new AppleMailReader(() => settings.current.mailAccounts)
  : null
const mail = new MailService(db, sources, outlook, () => settings.current.userName, () => aiLabel(), undefined, () => settings.current.mailAccounts)
const replies = new ReplyService(db, outlook, currentProvider, () => settings.current, () => usage.logFor('reply'))
const ollama = new OllamaManager(() => settings.current.localUrl, nodeHost(app.getPath('temp')))

/** The chosen model's name, e.g. "Basic", "Claude Opus 5.5" or "Ollama gpt-oss:20b". */
function aiLabel(): string {
  const { aiProvider, aiModel, localModel } = settings.current
  if (aiProvider === 'local') return localModelLabel(localModel)
  if (aiProvider === 'claude') return CLAUDE_MODELS.find((m) => m.id === aiModel)?.label ?? aiModel
  return BASIC_LABEL
}

async function aiStatus(): Promise<AiStatus> {
  const { aiProvider, aiModel, localModel, localUrl } = settings.current
  const hasKey = !!keys.get()
  const local = aiProvider === 'local'
  let problem: string | null = null
  if (aiProvider === 'claude' && !hasKey) problem = `${aiLabel()} needs a Claude API key. Add one below, or pick another model.`
  if (local) {
    const o = await ollama.status()
    if (o.state === 'missing') problem = "Ollama isn't installed. Install it below, or pick another model."
    else if (o.state === 'stopped') problem = o.remote ? `Ollama at ${o.url} isn't answering. Pick another model, or start it there.` : "Ollama isn't running. Start it below, or pick another model."
    else if (!o.models.some((m) => m.name === localModel)) problem = `${aiLabel()} isn't downloaded. Download it below, or pick another model.`
  }
  return {
    provider: aiProvider,
    model: local ? localModel : aiModel,
    hasKey,
    encryptionAvailable: keys.encryptionAvailable,
    label: aiLabel(),
    sendsDataExternally: aiProvider === 'claude' || (local && !isLoopbackUrl(localUrl)),
    available: problem == null,
    problem,
  }
}

/** Every model that can be picked now: Basic, Claude's models with a key, and whatever is downloaded in Ollama. */
async function aiChoices(): Promise<AiChoiceGroup[]> {
  const groups: AiChoiceGroup[] = [{ provider: 'demo', title: 'Built into the app', choices: [{ provider: 'demo', model: '', label: BASIC_LABEL, note: 'Simple rules, no setup' }] }]
  if (keys.get())
    groups.push({
      provider: 'claude',
      title: 'Claude · sent to Anthropic',
      choices: CLAUDE_MODELS.map((m) => ({ provider: 'claude', model: m.id, label: m.label, note: m.note, detail: m.price })),
    })
  const o = await ollama.status()
  if (o.models.length)
    groups.push({
      provider: 'local',
      title: o.remote ? `Ollama · on ${new URL(o.url).host}` : 'Ollama · on this computer',
      choices: o.models.map((m) => ({ provider: 'local', model: m.name, label: localModelLabel(m.name), note: isTestedLocalModel(m.name) ? '' : 'Not tested' })),
    })
  return groups
}

let mainWindow: BrowserWindow | null = null
const isMac = process.platform === 'darwin'
const titleBarColors = (dark: boolean) => (dark ? { color: '#131317', symbolColor: '#ececf0' } : { color: '#ffffff', symbolColor: '#18181b' })

async function backupNow(): Promise<string> {
  const target = await createBackup(db, backupFolder(), settings.current.backupsToKeep)
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
  'tasks.listDone': (filter) => tasks.listDone(filter),
  'tasks.reopen': (id) => tasks.reopen(id),
  'tasks.listForPerson': (personId) => tasks.listForPerson(personId),
  'tasks.get': (id) => tasks.get(id),
  'tasks.save': (input) => tasks.save(input),
  'tasks.setStatus': (id, status) => tasks.setStatus(id, status),
  'tasks.delete': (id) => tasks.delete(id),
  'tasks.summary': () => tasks.summary(),
  'tasks.nextAction': (taskId) => nextActions.get(taskId),
  'tasks.writeStatus': async (taskId) => {
    const task = tasks.get(taskId)
    if (!task) throw new Error('That task no longer exists.')
    if (task.status === 'done') throw new AiError('Reopen the task to write where it stands.')
    const input = buildTaskStatusInput(db, task, tasks.activity(taskId).events, settings.current.userName)
    const provider = currentProvider()
    const card = cleanStatusCard(await provider.writeStatus(input, usage.logFor('status')))
    nextActions.save([{ taskId, ...card }], { writtenBy: provider.label, origin: 'manual' })
    return nextActions.get(taskId)!
  },
  'tasks.dismissNextAction': (taskId, dismissed) => nextActions.setDismissed(taskId, dismissed),
  'tasks.activity': (taskId) => tasks.activity(taskId),
  'tasks.removeAiAdjustment': (taskId) => {
    adjustments.remove(taskId)
    const t = tasks.get(taskId)
    if (!t) throw new Error(`Task ${taskId} not found`)
    return t
  },
  'projects.list': () => projects.list(),
  'projects.listArchived': () => projects.listArchived(),
  'projects.save': (project) => projects.save(project),
  'projects.saveOverview': (id, text) => projects.saveOverview(id, text),
  'projects.card': (id) => projectCards.get(id),
  'projects.writeStatus': async (id) => {
    const input = buildProjectStatusInput(db, id, settings.current.userName)
    const provider = currentProvider()
    return projectCards.save(id, cleanStatusCard(await provider.writeStatus(input, usage.logFor('status'))), provider.label)
  },
  'projects.dismissCard': (id, dismissed) => projectCards.setDismissed(id, dismissed),
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
  'people.suggestBrief': async (id) => {
    const input = buildPersonBriefInput(db, id, settings.current.userName)
    const provider = currentProvider()
    return { text: cleanBrief(await provider.writePersonBrief(input, usage.logFor('person_brief'))), writtenBy: provider.label }
  },
  'people.saveBrief': (id, text, by) => people.saveBrief(id, text, by),
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
    const folder = backupFolder()
    mkdirSync(folder, { recursive: true })
    void shell.openPath(folder)
  },
  'backup.list': () => listBackups([backupFolder(), localBackupFolder], SCHEMA_VERSION),
  'backup.restore': (path) => {
    // Only a backup the app itself listed (and judged usable) can be restored; never an arbitrary path.
    const chosen = listBackups([backupFolder(), localBackupFolder], SCHEMA_VERSION).find((b) => b.path === path)
    if (!chosen) throw new Error('That backup is no longer there. Refresh the list and try again.')
    if (!chosen.compatible) throw new Error(`That backup can't be restored: ${chosen.reason}.`)
    // Current data is saved first, so a restore can always be undone by restoring this copy.
    try {
      snapshotNow(db, backupFolder(), 'before-restore')
    } catch {
      snapshotNow(db, localBackupFolder, 'before-restore')
    }
    requestRestore(dataFolder, chosen.path)
    setTimeout(() => {
      app.relaunch()
      app.exit(0)
    }, 300)
  },
  'app.info': () => {
    const info = { version: app.getVersion(), databasePath, dataFolder, defaultBackupFolder, platform: process.platform, isSeparateData, restoredFrom }
    restoredFrom = null // reported once
    return info
  },
  'app.setTitleBarTheme': (dark) => {
    if (!isMac) mainWindow?.setTitleBarOverlay({ ...titleBarColors(dark), height: 44 })
  },
  'sources.importAndExtract': (req) => sources.importAndExtract(req),
  'sources.extract': (sourceId) => sources.extract(sourceId),
  'sources.list': () => sources.list(),
  'sources.delete': (id) => sources.delete(id),
  'sources.aiRuns': (sourceId) => sources.aiRuns(sourceId),
  'mail.info': () => mail.info(),
  'mail.check': (since) => mail.check(since),
  'mail.read': (checkId, keys) => mail.read(checkId, keys),
  'mail.status': () => mail.status(),
  'mail.stop': () => mail.stop(),
  'mail.imports': () => mail.imports(),
  'mail.open': (sourceId) => mail.open(sourceId),
  'mail.addresses': () => mail.addresses(),
  'mail.accounts': (refresh) => mail.accounts(refresh),
  'replies.target': (taskId) => replies.target(taskId),
  'replies.draft': (taskId, revision) => replies.draft(taskId, revision),
  'replies.save': (taskId, reply) => replies.save(taskId, reply),
  'replies.openDraft': (entryId, storeId) => replies.openDraft(entryId, storeId),
  'replies.open': (taskId, reply) => replies.open(taskId, reply),
  'suggestions.listPending': () => suggestions.listPending(),
  'suggestions.count': () => suggestions.pendingCount(),
  'suggestions.accept': (id, edits) => suggestions.accept(id, edits),
  'suggestions.reject': (id) => suggestions.reject(id),
  'ai.status': () => aiStatus(),
  'ai.setKey': (key) => {
    keys.set(key)
    return aiStatus()
  },
  'ai.test': async (provider) => {
    if (provider !== 'local') return providerFor(provider ?? settings.current.aiProvider).test()
    // Test the chosen local model if it's downloaded, otherwise the first one that is.
    const models = (await ollama.status()).models.map((m) => m.name)
    const model = models.includes(settings.current.localModel) ? settings.current.localModel : (models[0] ?? settings.current.localModel)
    return providerFor('local', model).test()
  },
  'ai.choices': () => aiChoices(),
  'ollama.status': () => ollama.status(),
  'ollama.install': () => ollama.startInstall(),
  'ollama.cancelInstall': () => ollama.cancelInstall(),
  'ollama.start': () => ollama.start(),
  'ollama.pull': (name) => ollama.pull(name),
  'ollama.cancelPull': (name) => ollama.cancelPull(name),
  'ollama.delete': (name) => ollama.delete(name),
  'briefing.latest': () => briefings.latest(),
  'briefing.list': () => briefings.list(),
  'briefing.get': (id) => briefings.get(id),
  'briefing.write': () => briefings.write('manual'),
  'briefing.isWriting': () => briefings.isWriting(),
  'briefing.aiCalls': (id) => briefings.aiCalls(id),
  'weekly.list': () => weekly.list(),
  'weekly.get': (weekStart) => weekly.get(weekStart),
  'weekly.writeReflection': () => weekly.writeReflection(),
  'weekly.isWriting': () => weekly.isWriting(),
  'weekly.aiCalls': (weekStart) => weekly.aiCalls(weekStart),
  'usage.spending': () => usage.spending(),
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

app.on('second-instance', () => {
  if (mainWindow?.isMinimized()) mainWindow.restore()
  mainWindow?.focus()
})

/** Saves weekly reviews for weeks that have ended. A failure is logged and tried again later. */
function saveEndedWeeks(): void {
  try {
    weekly.saveEndedWeeks()
  } catch (err) {
    console.error('Saving ended weeks failed', err)
  }
}

void app.whenReady().then(() => {
  if (!isMac) Menu.setApplicationMenu(null)
  tasks.recomputeAll()
  saveEndedWeeks()
  registerIpc()
  createWindow()
  backupIfDue()
  setInterval(() => {
    tasks.recomputeAll() // due dates and staleness change as time passes
    saveEndedWeeks() // a week that ended while the app was open is saved soon after Saturday midnight
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
