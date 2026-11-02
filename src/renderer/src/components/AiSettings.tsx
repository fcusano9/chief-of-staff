import { useState } from 'react'
import type { AiProviderId } from '@shared/types'
import { CLAUDE_MODELS } from '@shared/types'
import { cos, errorMessage } from '../api'
import { useApp } from '../context'

/** Which AI reads imports, the Claude model and API key, and the name the AI works for. */
export function AiSettings() {
  const { settings, saveSettings, ai, setAi, toast } = useApp()
  const [name, setName] = useState(settings.userName)
  const [key, setKey] = useState('')
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [testing, setTesting] = useState(false)

  const saveKey = async (value: string | null) => {
    try {
      setAi(await cos['ai.setKey'](value))
      setKey('')
      setTestResult(null)
      toast(value ? 'API key saved, encrypted on this computer' : 'API key removed')
    } catch (err) {
      toast(errorMessage(err), true)
    }
  }

  const test = async () => {
    setTesting(true)
    try {
      setTestResult({ ok: true, text: await cos['ai.test']() })
    } catch (err) {
      setTestResult({ ok: false, text: errorMessage(err) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="card" style={{ gridColumn: '1 / -1' }}>
      <div style={{ fontWeight: 500, marginBottom: 8 }}>AI</div>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div>
          <label className="field">
            <span>Your name</span>
            <input className="inp" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() !== settings.userName && void saveSettings({ userName: name })} />
          </label>
          <label className="field">
            <span>Provider</span>
            <select className="inp" value={settings.aiProvider} onChange={(e) => void saveSettings({ aiProvider: e.target.value as AiProviderId }).then(() => setTestResult(null))}>
              <option value="demo">Demo AI (runs on this PC; nothing is sent)</option>
              <option value="claude">Claude (Anthropic API)</option>
            </select>
          </label>
          {settings.aiProvider === 'claude' && (
            <label className="field">
              <span>Model</span>
              <select className="inp" value={settings.aiModel} onChange={(e) => void saveSettings({ aiModel: e.target.value })}>
                {CLAUDE_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} · {m.note}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="faint" style={{ fontSize: 12, margin: '8px 0 0' }}>
            The AI only proposes. Every suggestion waits in Review until you accept it, and nothing is ever sent on your behalf. Microsoft 365 Copilot can be added once IT approves an app registration.
          </p>
        </div>

        <div>
          {settings.aiProvider === 'claude' ? (
            <>
              <div className="field">
                <span>API key</span>
                {ai.hasKey ? (
                  <span className="row">
                    <span style={{ color: 'var(--ok)' }}>✓</span>
                    <span>Stored, encrypted on this computer</span>
                    <div className="spacer" />
                    <button className="btn ghost danger" onClick={() => void saveKey(null)}>
                      Remove
                    </button>
                  </span>
                ) : (
                  <span className="row">
                    <input
                      className="inp"
                      type="password"
                      autoComplete="off"
                      placeholder="sk-ant-…"
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && key.trim() && void saveKey(key)}
                    />
                    <button className="btn" disabled={!key.trim() || !ai.encryptionAvailable} onClick={() => void saveKey(key)}>
                      Save
                    </button>
                  </span>
                )}
              </div>
              {!ai.encryptionAvailable && <p style={{ fontSize: 12, color: 'var(--danger)' }}>This computer can't encrypt stored secrets, so a key can't be saved.</p>}
              <div className="row" style={{ marginTop: 6 }}>
                <button className="btn" disabled={testing || !ai.hasKey} onClick={() => void test()}>
                  {testing ? 'Testing…' : 'Test connection'}
                </button>
                {testResult && <span style={{ fontSize: 12, color: testResult.ok ? 'var(--ok)' : 'var(--danger)' }}>{testResult.text}</span>}
              </div>
              <p className="muted" style={{ fontSize: 12, margin: '10px 0 0', lineHeight: 1.6 }}>
                With Claude selected, each import's text, plus your open task titles, project and person briefs, and names, is sent to Anthropic to produce suggestions.
                Confirm this is allowed by Crestron's policy before importing work content. Use a key from the Anthropic Console; usage is billed per token.
              </p>
            </>
          ) : (
            <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
              The demo AI looks for action items, "waiting on", "done", and dates using simple rules. It's good for trying out the import and review flow; switch to Claude for real
              understanding of your emails, chats, and transcripts.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
