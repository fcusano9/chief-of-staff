import { useEffect, useState } from 'react'
import type { MailAccount } from '@shared/types'
import { cos, errorMessage } from '../api'
import { useApp } from '../context'
import { useMailApp } from './mailApp'

const TYPE_LABELS: Record<string, string> = { unknown: 'Exchange', imap: 'IMAP', pop: 'POP', iCloud: 'iCloud' }

/**
 * Settings → Apple Mail (Mac only): which of Mail's accounts the mail import reads. Nothing is ticked
 * at first. The list is asked of Mail when Settings opens; Refresh list asks again.
 */
export function AppleMailSettings() {
  const { settings, saveSettings, toast } = useApp()
  const app = useMailApp()
  const [accounts, setAccounts] = useState<MailAccount[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const load = (refresh: boolean) => {
    setProblem(null)
    cos['mail.accounts'](refresh)
      .then(setAccounts)
      .catch((err) => setProblem(errorMessage(err)))
  }
  useEffect(() => {
    if (app === 'apple-mail') load(false)
  }, [app])

  if (app !== 'apple-mail') return null

  const chosen = new Set(settings.mailAccounts)
  const toggle = (id: string) => {
    const next = new Set(chosen)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    void saveSettings({ mailAccounts: [...next] }).catch((err) => toast(errorMessage(err), true))
  }

  return (
    <div className="card" id="apple-mail" data-apple-mail-settings>
      <div className="row" style={{ marginBottom: 4 }}>
        <div style={{ fontWeight: 500 }}>Apple Mail</div>
        <div className="spacer" />
        <button className="btn ghost" style={{ fontSize: 'var(--fs-sm)' }} onClick={() => load(true)}>
          Refresh list
        </button>
      </div>
      <div className="muted" style={{ fontSize: 'var(--fs-sm)', marginBottom: 6 }}>
        Accounts to read
      </div>
      {problem && <div style={{ padding: '8px 10px', borderRadius: 6, fontSize: 'var(--fs-sm)', background: 'color-mix(in srgb, var(--warn) 12%, transparent)', color: 'var(--warn)' }}>{problem}</div>}
      {accounts == null && !problem && <span className="faint">Loading…</span>}
      {accounts?.length === 0 && <span className="faint">No accounts in Mail</span>}
      {accounts?.map((a) => (
        <label key={a.id} className="row" style={{ padding: 'var(--row-py) 0', borderTop: '1px solid var(--border)', cursor: 'pointer' }}>
          <input type="checkbox" checked={chosen.has(a.id)} onChange={() => toggle(a.id)} />
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {a.name}
            {a.addresses[0] && <span className="muted"> · {a.addresses[0]}</span>}
          </span>
          <div className="spacer" />
          <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
            {TYPE_LABELS[a.type] ?? a.type}
          </span>
        </label>
      ))}
    </div>
  )
}
