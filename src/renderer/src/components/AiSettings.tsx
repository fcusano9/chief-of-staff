import { useEffect, useState } from 'react'
import type { AiProviderId } from '@shared/types'
import { CLAUDE_MODELS } from '@shared/types'
import { cos, errorMessage } from '../api'
import { useApp } from '../context'

/** Which AI reads imports, the Claude model and API key or the local model, and the name the AI works for. */
export function AiSettings() {
  const { settings, saveSettings, ai, setAi, toast } = useApp()
  const [name, setName] = useState(settings.userName)
  const [key, setKey] = useState('')
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [localUrl, setLocalUrl] = useState(settings.localUrl)
  const [localModels, setLocalModels] = useState<string[] | null>(null)
  const isLocal = settings.aiProvider === 'local'

  useEffect(() => {
    if (isLocal) void cos['ai.listLocalModels']().then(setLocalModels)
  }, [isLocal, settings.localUrl])

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
              <option value="local">Local model (Ollama, runs on this computer)</option>
            </select>
          </label>
          {isLocal && (
            <>
              <label className="field">
                <span>Model</span>
                {localModels?.length ? (
                  <select className="inp" value={settings.localModel} onChange={(e) => void saveSettings({ localModel: e.target.value }).then(() => setTestResult(null))}>
                    {!localModels.includes(settings.localModel) && <option value={settings.localModel}>{settings.localModel} (not installed)</option>}
                    {localModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="inp"
                    defaultValue={settings.localModel}
                    placeholder="gpt-oss:20b"
                    onBlur={(e) => e.target.value.trim() !== settings.localModel && void saveSettings({ localModel: e.target.value }).then(() => setTestResult(null))}
                  />
                )}
              </label>
              <label className="field">
                <span>Ollama address</span>
                <input
                  className="inp"
                  value={localUrl}
                  onChange={(e) => setLocalUrl(e.target.value)}
                  onBlur={() => localUrl.trim() !== settings.localUrl && void saveSettings({ localUrl }).then(() => setTestResult(null))}
                />
              </label>
            </>
          )}
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
          <p className="faint" style={{ fontSize: 'var(--fs-sm)', margin: '8px 0 0' }}>
            The AI only proposes. Every suggestion waits in Review until you accept it, and nothing is ever sent on your behalf.
          </p>
        </div>

        <div>
          {isLocal ? (
            <>
              <div className="row">
                <button className="btn" disabled={testing} onClick={() => void test()}>
                  {testing ? 'Testing…' : 'Test connection'}
                </button>
                {testResult && <span style={{ fontSize: 'var(--fs-sm)', color: testResult.ok ? 'var(--ok)' : 'var(--danger)' }}>{testResult.text}</span>}
              </div>
              <p className="muted" style={{ fontSize: 'var(--fs-sm)', margin: '10px 0 0', lineHeight: 1.6 }}>
                {ai.sendsDataExternally
                  ? `Imports are sent to the Ollama server at ${settings.localUrl}, which is not this computer.`
                  : 'Imports are read by a model running on this computer. Nothing is sent anywhere.'}{' '}
                Install Ollama from ollama.com, then run "ollama pull {settings.localModel}" in a terminal. Local models are free but less accurate than Claude. Each import takes about
                40 seconds, longer for long transcripts.
              </p>
            </>
          ) : settings.aiProvider === 'claude' ? (
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
              {!ai.encryptionAvailable && <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>This computer can't encrypt stored secrets, so a key can't be saved.</p>}
              <div className="row" style={{ marginTop: 6 }}>
                <button className="btn" disabled={testing || !ai.hasKey} onClick={() => void test()}>
                  {testing ? 'Testing…' : 'Test connection'}
                </button>
                {testResult && <span style={{ fontSize: 'var(--fs-sm)', color: testResult.ok ? 'var(--ok)' : 'var(--danger)' }}>{testResult.text}</span>}
              </div>
            </>
          ) : (
            <p className="muted" style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.6, margin: 0 }}>
              The demo AI looks for action items, "waiting on", "done", and dates using simple rules. It's good for trying out the import and review flow; switch to Claude for real
              understanding of your emails, chats, and transcripts.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
