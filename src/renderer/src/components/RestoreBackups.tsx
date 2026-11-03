import { useState } from 'react'
import type { BackupInfo, BackupKind } from '@shared/types'
import { cos, errorMessage } from '../api'
import { useApp } from '../context'

const KIND_LABELS: Record<BackupKind, string> = {
  daily: 'Daily',
  'before-upgrade': 'Before an app upgrade',
  'before-restore': 'Before a restore',
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const size = (bytes: number) => (bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`)

/** Lists backups and restores one. The app saves current data first, then restarts with the backup. */
export function RestoreBackups() {
  const { toast } = useApp()
  const [backups, setBackups] = useState<BackupInfo[] | null>(null)
  const [armed, setArmed] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)

  const load = async () => {
    setArmed(null)
    try {
      setBackups(await cos['backup.list']())
    } catch (err) {
      toast(errorMessage(err), true)
    }
  }

  const restore = async (b: BackupInfo) => {
    setRestoring(true)
    try {
      await cos['backup.restore'](b.path)
      toast('Restoring… the app will restart')
    } catch (err) {
      setRestoring(false)
      toast(errorMessage(err), true)
    }
  }

  return (
    <div className="card" style={{ gridColumn: '1 / -1' }}>
      <div className="row" style={{ marginBottom: 6 }}>
        <span style={{ fontWeight: 500 }}>Restore from backup</span>
        <div className="spacer" />
        <button className="btn" onClick={() => void load()}>
          {backups ? 'Refresh' : 'Show backups'}
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: '0 0 8px', lineHeight: 1.6 }}>
        Restoring replaces everything in the app with the backup you pick. Your current data is saved first as a "before a restore" backup, so you can always undo it by restoring that one. The app restarts to finish.
      </p>
      {backups && (
        <div className="list">
          {backups.map((b) => (
            <div key={b.path} className="r" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto auto', paddingLeft: 12, cursor: 'default', opacity: b.compatible ? 1 : 0.55 }}>
              <div className="ttl">
                {when(b.createdAt)}
                <span className="why">
                  {KIND_LABELS[b.kind]} · {size(b.size)}
                  {b.compatible ? ` · ${b.openTasks} open task${b.openTasks === 1 ? '' : 's'}` : ` · ${b.reason}`}
                </span>
              </div>
              <span className="faint" style={{ fontSize: 11 }} title={b.path}>
                {b.folder.split(/[\\/]/).slice(-1)[0]}
              </span>
              {b.compatible ? (
                armed === b.path ? (
                  <button className="btn danger" disabled={restoring} onClick={() => void restore(b)}>
                    {restoring ? 'Restoring…' : 'Click again to restore'}
                  </button>
                ) : (
                  <button className="btn ghost" disabled={restoring} onClick={() => setArmed(b.path)}>
                    Restore
                  </button>
                )
              ) : (
                <span />
              )}
            </div>
          ))}
          {backups.length === 0 && <div className="empty">No backups yet. One is made automatically each day, or use Back up now.</div>}
        </div>
      )}
    </div>
  )
}
