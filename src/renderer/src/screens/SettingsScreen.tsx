import { useState } from 'react'
import { DENSITIES, type PriorityWeights, type ThemeSetting } from '@shared/types'
import { cos, errorMessage } from '../api'
import { AiSettings } from '../components/AiSettings'
import { AppleMailSettings } from '../components/AppleMailSettings'
import { RestoreBackups } from '../components/RestoreBackups'
import { useApp } from '../context'

/** Shown in Settings, grouped so related keys sit together. */
export const SHORTCUTS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Anywhere',
    keys: [
      ['Ctrl K', 'Command palette'],
      ['N', 'New task'],
      ['/', 'Search the list'],
      ['← / →', 'Previous / next tab'],
    ],
  },
  {
    title: 'In lists',
    keys: [
      ['↑ / ↓', 'Move up / down'],
      ['Enter', 'Open item'],
      ['Ctrl Enter', 'Save'],
      ['Esc', 'Close or cancel'],
      ['E', 'Mark done (Tasks)'],
      ['A / R', 'Accept / reject (Review)'],
    ],
  },
  {
    title: 'Go to',
    keys: [
      ['G then T', 'Today'],
      ['G then K', 'Tasks'],
      ['G then W', 'Waiting'],
      ['G then V', 'Weekly'],
      ['G then P', 'Projects'],
      ['G then E', 'People'],
      ['G then I', 'Import'],
      ['G then R', 'Review'],
    ],
  },
]

export function SettingsScreen() {
  const { settings, saveSettings, info, toast } = useApp()
  const [weights, setWeights] = useState<PriorityWeights>(settings.priorityWeights)
  const [backupFolder, setBackupFolder] = useState(settings.backupFolder ?? '')
  const [keep, setKeep] = useState(settings.backupsToKeep)
  const [busy, setBusy] = useState(false)

  const weightRows: [keyof PriorityWeights, string][] = [
    ['dueDate', 'Due date'],
    ['requester', 'Who is asking'],
    ['staleness', 'Staleness and follow-ups'],
  ]

  return (
    <div className="page">
      <div className="head">
        <h1>Settings</h1>
      </div>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <AiSettings />

        <div className="card">
          <div style={{ fontWeight: 500, marginBottom: 8 }}>Appearance</div>
          <label className="field">
            <span>Theme</span>
            <select className="inp" value={settings.theme} onChange={(e) => void saveSettings({ theme: e.target.value as ThemeSetting })}>
              <option value="system">Follow system</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <div className="field" style={{ alignItems: 'start' }}>
            <span style={{ paddingTop: 8 }}>Density</span>
            <div>
              <div className="density-pick" role="radiogroup" aria-label="Density">
                {DENSITIES.map((d, i) => (
                  <button key={d.id} type="button" role="radio" aria-checked={settings.density === d.id} className={`dopt ${settings.density === d.id ? 'on' : ''}`} onClick={() => void saveSettings({ density: d.id })}>
                    <span className="mini" style={{ gap: 3 + i * 2 }}>
                      {[0, 1, 2, 3].map((n) => <i key={n} style={{ height: 5 + i }} />)}
                    </span>
                    <b>{d.label}</b>
                  </button>
                ))}
              </div>
              <div className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 6 }}>{DENSITIES.find((d) => d.id === settings.density)?.description}</div>
            </div>
          </div>
          <div className="field">
            <span>Split view</span>
            <span className="row">
              <span className="mono">{Math.round(settings.splitPercent)}%</span>
              <button className="btn ghost" onClick={() => void saveSettings({ splitPercent: 50 })}>
                Reset to 50/50
              </button>
            </span>
          </div>
        </div>

        <div className="card">
          <div style={{ fontWeight: 500, marginBottom: 8 }}>Priority weights</div>
          {weightRows.map(([key, label]) => (
            <label key={key} className="field" style={{ gridTemplateColumns: '150px 1fr 24px' }}>
              <span>{label}</span>
              <input type="range" min={0} max={10} step={1} value={weights[key]} onChange={(e) => setWeights({ ...weights, [key]: Number(e.target.value) })} />
              <span className="mono">{weights[key]}</span>
            </label>
          ))}
          <div className="row" style={{ marginTop: 8 }}>
            <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>How much each signal counts toward the 0–100 score.</span>
            <div className="spacer" />
            <button
              className="btn"
              onClick={() =>
                void saveSettings({ priorityWeights: weights }).then(() => {
                  toast('Weights saved. Priorities recalculated.')
                })
              }
            >
              Save weights
            </button>
          </div>
        </div>

        <AppleMailSettings />

        <div className="card">
          <div style={{ fontWeight: 500, marginBottom: 8 }}>Backup</div>
          <label className="field">
            <span>Folder</span>
            <input className="inp" value={backupFolder} placeholder={info.defaultBackupFolder} onChange={(e) => setBackupFolder(e.target.value)} />
          </label>
          <label className="field">
            <span>Keep</span>
            <span className="row">
              <input className="inp" type="number" min={1} style={{ width: 80 }} value={keep} onChange={(e) => setKeep(Number(e.target.value) || 1)} />
              <span className="muted">daily snapshots</span>
            </span>
          </label>
          <div className="muted" style={{ fontSize: 'var(--fs-sm)', margin: '6px 0 8px' }}>
            Last backup: {settings.lastBackupAt ? new Date(settings.lastBackupAt).toLocaleString() : 'never'}
          </div>
          <div className="row">
            <button className="btn" onClick={() => void saveSettings({ backupFolder: backupFolder || null, backupsToKeep: keep }).then(() => toast('Backup settings saved'))}>
              Save
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                cos['backup.now']()
                  .then((path) => toast(`Backed up to ${path}`))
                  .catch((err) => toast(errorMessage(err), true))
                  .finally(() => setBusy(false))
              }}
            >
              {busy ? 'Backing up…' : 'Back up now'}
            </button>
            <button className="btn ghost" onClick={() => void cos['backup.openFolder']()}>
              Open folder
            </button>
          </div>
        </div>

        <RestoreBackups />

        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <div style={{ fontWeight: 500, marginBottom: 8 }}>Keyboard shortcuts</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px 22px', alignItems: 'start' }}>
            {SHORTCUTS.map((group) => (
              <div key={group.title} className="grid" style={{ gap: 6 }}>
                <div className="label">{group.title}</div>
                {group.keys.map(([keys, label]) => (
                  <div key={label} className="row" style={{ justifyContent: 'space-between' }}>
                    <span>{label}</span>
                    <span className="row" style={{ gap: 3 }}>
                      {keys.split(' ').map((k, i) => (k === 'then' || (k === '/' && keys !== '/') ? <span key={i} className="faint">{k}</span> : <span key={i} className="kbd">{k}</span>))}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <div style={{ fontWeight: 500, marginBottom: 4 }}>About</div>
          <div className="muted" style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.8 }}>
            Chief of Staff {info.version} · data stored at <span className="mono">{info.databasePath}</span>
            {info.isSeparateData && <div style={{ color: 'var(--warn)' }}>This is a development or test copy of the app. It uses its own data and backups, separate from your real ones.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
