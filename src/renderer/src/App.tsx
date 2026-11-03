import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AiStatus, AppInfo, AppSettings, PersonSummary, ProjectSummary } from '@shared/types'
import { cos, errorMessage } from './api'
import { CommandPalette, TABS } from './components/CommandPalette'
import { AppContext, type AppContextValue, type TaskSelection, type View } from './context'
import { ComingSoonScreen } from './screens/ComingSoonScreen'
import { AiLogScreen } from './screens/AiLogScreen'
import { ImportScreen } from './screens/ImportScreen'
import { ReviewScreen } from './screens/ReviewScreen'
import { PeopleScreen } from './screens/PeopleScreen'
import { ProjectsScreen } from './screens/ProjectsScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { TasksScreen } from './screens/TasksScreen'
import { TodayScreen } from './screens/TodayScreen'
import { WaitingScreen } from './screens/WaitingScreen'

const G_KEYS: Record<string, View> = { t: 'today', k: 'tasks', r: 'review', w: 'waiting', p: 'projects', e: 'people' }
const isTyping = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')
const FALLBACK_AI: AiStatus = { provider: 'demo', model: '', hasKey: false, encryptionAvailable: false, label: 'Demo AI', sendsDataExternally: false }
const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches

export function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [people, setPeople] = useState<PersonSummary[]>([])
  const [ai, setAi] = useState<AiStatus | null>(null)
  const [reviewCount, setReviewCount] = useState(0)
  const [view, setView] = useState<View>('today')
  const [aiLog, setAiLog] = useState<{ sourceId: number; from: View } | null>(null)
  const [selection, setSelection] = useState<TaskSelection>(null)
  const [version, setVersion] = useState(0)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [toastMsg, setToastMsg] = useState<{ text: string; error: boolean } | null>(null)
  const [osDark, setOsDark] = useState(systemDark)
  const toastTimer = useRef<number>(undefined)
  const settingsRef = useRef<AppSettings | null>(null)
  settingsRef.current = settings

  useEffect(() => {
    void Promise.all([cos['settings.get'](), cos['app.info']()]).then(([s, i]) => {
      setSettings(s)
      setInfo(i)
      document.body.classList.add(`platform-${i.platform}`)
      if (i.restoredFrom) toast(`Restored from backup ${i.restoredFrom.split(/[\\/]/).pop()}`)
    })
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setOsDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    void cos['projects.list']().then(setProjects)
    void cos['people.list']().then(setPeople)
    void cos['suggestions.count']().then(setReviewCount)
    void cos['ai.status']().then(setAi)
  }, [version])

  const dark = settings?.theme === 'dark' || (settings?.theme !== 'light' && osDark)
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    void cos['app.setTitleBarTheme'](dark)
  }, [dark])

  const toast = useCallback((text: string, error = false) => {
    setToastMsg({ text, error })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToastMsg(null), error ? 4000 : 2200)
  }, [])
  const refresh = useCallback(() => setVersion((v) => v + 1), [])
  const saveSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      if (!settingsRef.current) return
      try {
        const saved = await cos['settings.save']({ ...settingsRef.current, ...patch })
        setSettings(saved)
        if (patch.priorityWeights) refresh()
        if (patch.aiProvider || patch.aiModel || patch.localModel || patch.localUrl || patch.localThoroughness) setAi(await cos['ai.status']())
      } catch (err) {
        toast(errorMessage(err), true)
      }
    },
    [refresh, toast],
  )
  const go = useCallback((v: View) => setView(v), [])
  const openAiLog = useCallback((sourceId: number, from: View) => {
    setAiLog({ sourceId, from })
    setView('ailog')
  }, [])
  const openTask = useCallback((s: TaskSelection) => {
    setSelection(s)
    if (s) setView('tasks')
  }, [])
  const toggleTheme = useCallback(() => void saveSettings({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' }), [saveSettings])

  // Global shortcuts run in the capture phase so screen-level shortcuts (J/K, E) never see a consumed key.
  useEffect(() => {
    let gPending = false
    let gTimer = 0
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        e.stopImmediatePropagation()
        setPaletteOpen((o) => !o)
        return
      }
      if (document.querySelector('.scrim') || isTyping()) return
      const consume = () => {
        e.preventDefault()
        e.stopImmediatePropagation()
      }
      if (e.altKey && /^[1-9]$/.test(e.key)) {
        consume()
        setView(TABS[Number(e.key) - 1]![0])
        return
      }
      if (gPending) {
        gPending = false
        const target = G_KEYS[e.key.toLowerCase()]
        if (target) {
          consume()
          setView(target)
        }
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'g') {
        consume()
        gPending = true
        window.clearTimeout(gTimer)
        gTimer = window.setTimeout(() => (gPending = false), 1000)
      } else if (e.key === 'n') {
        consume()
        openTask({ id: 'new' })
      } else if (e.key === 'D' && e.shiftKey) {
        consume()
        toggleTheme()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [openTask, toggleTheme])

  const ctx = useMemo<AppContextValue | null>(
    () =>
      settings && info
        ? { view, go, selection, openTask, version, refresh, toast, settings, saveSettings, info, projects, people, dark, toggleTheme, ai: ai ?? FALLBACK_AI, setAi, reviewCount, openAiLog, aiLog }
        : null,
    [view, selection, version, settings, info, projects, people, dark, go, openTask, refresh, toast, saveSettings, toggleTheme, ai, reviewCount, openAiLog, aiLog],
  )
  if (!ctx) return null

  const screen =
    view === 'today' ? <TodayScreen />
    : view === 'tasks' ? <TasksScreen />
    : view === 'waiting' ? <WaitingScreen />
    : view === 'projects' ? <ProjectsScreen />
    : view === 'people' ? <PeopleScreen />
    : view === 'settings' ? <SettingsScreen />
    : view === 'review' ? <ReviewScreen />
    : view === 'import' ? <ImportScreen />
    : view === 'ailog' ? <AiLogScreen />
    : <ComingSoonScreen view={view} />
  const fill = view === 'tasks' || view === 'projects' || view === 'people'

  return (
    <AppContext.Provider value={ctx}>
      <div className="app">
        <header className="top">
          <div className="logo">
            <b>CS</b>
            <span>Chief of Staff</span>
          </div>
          <nav className="tabs">
            {TABS.map(([v, label], i) => (
              <button key={v} className={`tab ${view === v || (view === 'ailog' && aiLog?.from === v) ? 'on' : ''}`} title={`Alt+${i + 1}`} onClick={() => setView(v)}>
                {label}
                {v === 'review' && reviewCount > 0 && <span className="count">{reviewCount}</span>}
              </button>
            ))}
          </nav>
          <div className="spacer" />
          <div className="search" onClick={() => setPaletteOpen(true)}>
            <span>⌕</span>
            <span className="stext" style={{ flex: 1 }}>Search or jump to…</span>
            <span className="kbd">Ctrl K</span>
          </div>
          <button className="iconbtn" title="New task (N)" onClick={() => openTask({ id: 'new' })}>
            ＋
          </button>
          <button className="iconbtn" title="Toggle light / dark (Shift+D)" onClick={toggleTheme}>
            ◐
          </button>
          <button className={`iconbtn ${view === 'settings' ? 'on' : ''}`} title="Settings" onClick={() => setView('settings')}>
            ⚙
          </button>
        </header>
        <main className={fill ? 'fill' : ''}>{screen}</main>
        <footer className="statusbar">
          {info?.isSeparateData && (
            <span className="note" style={{ background: "color-mix(in srgb, var(--warn) 18%, transparent)", color: "var(--warn)" }} title={info.dataFolder}>
              Test data
            </span>
          )}
          <span>
            <span className="kbd">Ctrl K</span> commands
          </span>
          <span>
            <span className="kbd">J</span> <span className="kbd">K</span> move
          </span>
          <span>
            <span className="kbd">N</span> new
          </span>
          <span>
            <span className="kbd">E</span> done
          </span>
          <div className="spacer" />
          <span>{settings!.lastBackupAt ? `Backed up ${new Date(settings!.lastBackupAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Not backed up yet'}</span>
          <button className="btn ghost" style={{ padding: '0 6px', fontSize: 12, color: 'var(--muted)' }} title="AI settings" onClick={() => setView('settings')}>
            AI · {ai?.label ?? '…'}
          </button>
        </footer>
      </div>
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
      {toastMsg && <div className={`toast ${toastMsg.error ? 'err' : ''}`}>{toastMsg.text}</div>}
    </AppContext.Provider>
  )
}
