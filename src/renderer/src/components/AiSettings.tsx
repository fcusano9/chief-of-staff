import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiProviderId, OllamaSetupStatus } from '@shared/types'
import { formatCost } from '@shared/pricing'
import { CLAUDE_MODELS, TESTED_LOCAL_MODELS } from '@shared/types'
import { cos, errorMessage } from '../api'
import { useApp } from '../context'
import { ConfirmButton } from './bits'
import { ModelMenu, ProviderIcon } from './ModelMenu'

type TestResult = { ok: boolean; text: string } | 'testing' | null

/** Settings: your name and the model picker, then where each AI provider is set up. */
export function AiSettings() {
  return (
    <>
      <ModelCard />
      <div className="card" id="ai-providers" style={{ gridColumn: '1 / -1' }}>
        <div style={{ fontWeight: 500, marginBottom: 8 }}>AI providers</div>
        <ClaudeProvider />
        <OllamaProvider />
      </div>
    </>
  )
}

function ModelCard() {
  const { settings, saveSettings, ai } = useApp()
  const [name, setName] = useState(settings.userName)
  const [style, setStyle] = useState(settings.replyStyle)
  const [menuFor, setMenuFor] = useState<HTMLElement | null>(null)

  const note = !ai.available ? (
<span style={{ color: 'var(--danger)' }}>{ai.problem}</span>
  ) : ai.provider === 'demo' ? (
    'Basic uses simple rules to spot action items, "waiting on", "done" and dates. It isn\'t actually AI, so it misses a lot. It runs on this computer and sends nothing.'
  ) : ai.provider === 'claude' ? (
    'Imports, open-task titles, briefs and names are sent to Anthropic.'
  ) : ai.sendsDataExternally ? (
    `Imports are sent to the Ollama server at ${settings.localUrl}, which is not this computer.`
  ) : (
    'Runs on this computer. Nothing is sent anywhere. Each import takes about 40 seconds, longer for long transcripts.'
  )

  return (
    <div className="card" style={{ gridColumn: '1 / -1' }}>
      <div style={{ fontWeight: 500, marginBottom: 8 }}>AI</div>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div>
          <label className="field">
            <span>Your name</span>
            <input className="inp" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() !== settings.userName && void saveSettings({ userName: name })} />
          </label>
          <div className="field">
            <span>Model</span>
            <button className="inp model-btn" data-model-picker onClick={(e) => setMenuFor(menuFor ? null : e.currentTarget)}>
              <ProviderIcon provider={ai.provider} />
              <span className="lbl" style={ai.available ? undefined : { color: 'var(--danger)' }}>
                {ai.label}
                {ai.available ? '' : ' (unavailable)'}
              </span>
              <span className="faint">▾</span>
            </button>
          </div>
        </div>
        <div style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.6 }}>
          <p style={{ margin: '4px 0 6px' }} data-model-note>
            {note}
          </p>
          <p className="faint" style={{ margin: 0 }}>
            The AI only proposes. Every suggestion waits in Review until you accept it, and nothing is ever sent on your behalf.
          </p>
        </div>
      </div>
      <label style={{ display: 'block', marginTop: 14 }}>
        <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Writing style for draft replies</span>
        <textarea
          className="inp"
          aria-label="Writing style for draft replies"
          style={{ marginTop: 4, minHeight: 56 }}
          value={style}
          placeholder={'e.g. Short and direct. Sign off as ' + (settings.userName.split(/\s+/)[0] || 'me') + '.'}
          onChange={(e) => setStyle(e.target.value)}
          onBlur={() => style !== settings.replyStyle && void saveSettings({ replyStyle: style })}
        />
        <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>Sent with every draft reply. Leave it empty for plain, professional replies.</span>
      </label>
      {menuFor && <ModelMenu anchor={menuFor} placement="below" onClose={() => setMenuFor(null)} />}
    </div>
  )
}

function TestButton({ provider, disabled }: { provider: AiProviderId; disabled: boolean }) {
  const [result, setResult] = useState<TestResult>(null)
  const test = async () => {
    setResult('testing')
    try {
      setResult({ ok: true, text: await cos['ai.test'](provider) })
    } catch (err) {
      setResult({ ok: false, text: errorMessage(err) })
    }
  }
  return (
    <div className="row">
      <button className="btn" disabled={disabled || result === 'testing'} onClick={() => void test()}>
        {result === 'testing' ? 'Testing…' : 'Test connection'}
      </button>
      {result && result !== 'testing' && <span style={{ fontSize: 'var(--fs-sm)', color: result.ok ? 'var(--ok)' : 'var(--danger)' }}>{result.text}</span>}
    </div>
  )
}

function ClaudeProvider() {
  const { ai, setAi, toast, go, version } = useApp()
  const [key, setKey] = useState('')
  const [monthCost, setMonthCost] = useState<number | null>(null)
  useEffect(() => {
    if (ai.hasKey) void cos['usage.spending']().then((s) => setMonthCost(s.month.total.cost))
  }, [ai.hasKey, version])
  const saveKey = async (value: string | null) => {
    try {
      setAi(await cos['ai.setKey'](value))
      setKey('')
      toast(value ? 'API key saved, encrypted on this computer' : 'API key removed')
    } catch (err) {
      toast(errorMessage(err), true)
    }
  }
  return (
    <div className="provider" data-provider="claude">
      <div className="provider-head">
        <ProviderIcon provider="claude" size={18} />
        <span style={{ fontWeight: 500 }}>Claude</span>
        <span className={`tag ${ai.hasKey ? 'ok' : ''}`}>{ai.hasKey ? `Set up · ${CLAUDE_MODELS.length} models` : 'Not set up'}</span>
        <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
          Anthropic API. Most accurate. Paid per use.
        </span>
        {ai.hasKey && (
          <>
            <div className="spacer" />
            <button className="btn sm" data-ai-spending-btn onClick={() => go('aispending')}>
              AI spending{monthCost != null ? ` · ${formatCost(monthCost)} this month` : ''}
            </button>
          </>
        )}
      </div>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 20 }}>
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
        <TestButton provider="claude" disabled={!ai.hasKey} />
      </div>
      {!ai.encryptionAvailable && <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>This computer can't encrypt stored secrets, so a key can't be saved.</p>}
    </div>
  )
}

const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`

function OllamaProvider() {
  const { settings, saveSettings, setAi, toast } = useApp()
  const [status, setStatus] = useState<OllamaSetupStatus | null>(null)
  const [url, setUrl] = useState(settings.localUrl)
  const modelsKey = useRef('')

  const apply = useCallback(
    (s: OllamaSetupStatus) => {
      setStatus(s)
      // When Ollama starts or the downloaded models change, the chosen model may become (un)available.
      const key = `${s.state}|${s.models.map((m) => m.name).join(',')}`
      if (key !== modelsKey.current) {
        modelsKey.current = key
        void cos['ai.status']().then(setAi)
      }
    },
    [setAi],
  )
  const act = useCallback(
    async (call: () => Promise<OllamaSetupStatus>) => {
      try {
        apply(await call())
      } catch (err) {
        toast(errorMessage(err), true)
      }
    },
    [apply, toast],
  )

  useEffect(() => {
    void act(() => cos['ollama.status']())
  }, [act, settings.localUrl])

  // Poll while something is happening: an install, or a model download.
  const busy = !!status && (status.install?.phase === 'downloading' || status.install?.phase === 'installing' || status.pulls.some((p) => !p.error))
  useEffect(() => {
    if (!busy) return
    const t = window.setInterval(() => void act(() => cos['ollama.status']()), status?.install?.phase === 'installing' ? 2000 : 700)
    return () => window.clearInterval(t)
  }, [busy, act, status?.install?.phase])

  const s = status
  const tag = !s ? null : s.state === 'ready' ? (
    <span className="tag ok">
      Running · {s.models.length} model{s.models.length === 1 ? '' : 's'}
    </span>
  ) : s.state === 'stopped' ? (
    <span className="tag warn">{s.remote ? 'Not answering' : 'Installed, not running'}</span>
  ) : (
    <span className="tag">Not installed</span>
  )

  let body: React.ReactNode = <p className="faint">Looking for Ollama…</p>
  if (s?.state === 'missing') {
    const i = s.install
    body = !s.canInstall ? (
      <p style={{ margin: 0 }}>Install Ollama from ollama.com. The app will find it once it's running.</p>
    ) : i?.phase === 'downloading' ? (
      <div>
        <div style={{ fontSize: 'var(--fs-sm)' }}>
          Downloading the Ollama installer…{i.percent != null && <span className="mono"> {i.percent}%</span>}
        </div>
        <div className="progress">
          <i style={{ width: `${i.percent ?? 0}%` }} />
        </div>
        <button className="btn ghost" style={{ marginTop: 6 }} onClick={() => void act(() => cos['ollama.cancelInstall']())}>
          Cancel
        </button>
      </div>
    ) : i?.phase === 'installing' ? (
      <div>
        <div style={{ fontSize: 'var(--fs-sm)' }}>Finish installing in Ollama's window. The app will find it when it's done.</div>
        <div className="row" style={{ marginTop: 6 }}>
          <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
            Checking every few seconds…
          </span>
          <button className="btn ghost" onClick={() => void act(() => cos['ollama.cancelInstall']())}>
            Stop waiting
          </button>
        </div>
      </div>
    ) : (
      <div>
        <p style={{ margin: '0 0 8px', fontSize: 'var(--fs-sm)' }}>
          Ollama runs AI models on this computer, so nothing leaves it. The app downloads the official installer from ollama.com, checks it's signed, and opens it.
        </p>
        {i?.phase === 'failed' && <p style={{ margin: '0 0 8px', fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>{i.error}</p>}
        <button className="btn primary" onClick={() => void act(() => cos['ollama.install']())}>
          {i?.phase === 'failed' ? 'Try again' : 'Install Ollama'}
        </button>
      </div>
    )
  } else if (s?.state === 'stopped') {
    body = s.remote ? (
      <p style={{ margin: 0, fontSize: 'var(--fs-sm)' }}>Ollama at {s.url} isn't answering. Start it on that machine, or change the address under Advanced.</p>
    ) : (
      <div>
        <p style={{ margin: '0 0 8px', fontSize: 'var(--fs-sm)' }}>Ollama is installed but isn't running, so your local models can't be listed.</p>
        <StartButton onStart={() => act(() => cos['ollama.start']())} />
      </div>
    )
  } else if (s?.state === 'ready') {
    // One list: tested models first (downloaded or not), then anything else already downloaded.
    const names = [...TESTED_LOCAL_MODELS.map((m) => m.name), ...s.models.map((m) => m.name).filter((n) => !TESTED_LOCAL_MODELS.some((t) => t.name === n))]
    body = (
      <>
        <div className="model-list">
          {names.map((name) => {
            const tested = TESTED_LOCAL_MODELS.find((m) => m.name === name)
            const have = s.models.find((m) => m.name === name)
            const pull = s.pulls.find((p) => p.name === name)
            let state: React.ReactNode
            let action: React.ReactNode
            if (have) {
              state = `Downloaded · ${gb(have.sizeBytes)}`
              action = (
                <ConfirmButton
                  label="Delete"
                  confirmLabel={`Delete ${gb(have.sizeBytes)}?`}
                  onConfirm={() =>
                    void act(async () => {
                      const next = await cos['ollama.delete'](name)
                      toast(`Deleted ${name}`)
                      return next
                    })
                  }
                />
              )
            } else if (pull && !pull.error) {
              state = (
                <>
                  Downloading{pull.percent != null && <span className="mono"> · {pull.percent}%</span>}
                  <div className="progress">
                    <i style={{ width: `${pull.percent ?? 0}%` }} />
                  </div>
                </>
              )
              action = (
                <button className="btn ghost" onClick={() => void act(() => cos['ollama.cancelPull'](name))}>
                  Cancel
                </button>
              )
            } else {
              state = pull?.error ? (
                <span style={{ color: 'var(--danger)' }}>{pull.error}</span>
              ) : (
                `Not downloaded · ${tested!.size}. ${tested!.note}`
              )
              action = (
                <button className="btn" onClick={() => void act(() => cos['ollama.pull'](name))}>
                  {pull?.error ? 'Try again' : 'Download'}
                </button>
              )
            }
            return (
              <div className="model-row" key={name} data-model={name}>
                <div>
                  <span className="mono">{name}</span> <span className={`tag ${tested ? 'ok' : ''}`}>{tested ? 'Tested' : 'Not tested'}</span>
                  <div className="state">{state}</div>
                </div>
                {action}
              </div>
            )
          })}
        </div>
        <TestButton provider="local" disabled={!s.models.length} />
      </>
    )
  }

  return (
    <div className="provider" data-provider="ollama">
      <div className="provider-head">
        <ProviderIcon provider="local" size={18} />
        <span style={{ fontWeight: 500 }}>Ollama</span>
        {tag}
        <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
          Runs models on this computer. Free and private.
        </span>
      </div>
      {body}
      <details style={{ marginTop: 8 }}>
        <summary className="muted" style={{ cursor: 'pointer', fontSize: 'var(--fs-sm)' }}>
          Advanced
        </summary>
        <label className="field" style={{ maxWidth: 420 }}>
          <span>Ollama address</span>
          <input className="inp mono" value={url} onChange={(e) => setUrl(e.target.value)} onBlur={() => url.trim() !== settings.localUrl && void saveSettings({ localUrl: url })} />
        </label>
        <div className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
          Change this only if Ollama runs on another machine. Then imports are sent there.
        </div>
      </details>
    </div>
  )
}

function StartButton({ onStart }: { onStart: () => Promise<void> }) {
  const [starting, setStarting] = useState(false)
  return (
    <button
      className="btn primary"
      disabled={starting}
      onClick={() => {
        setStarting(true)
        void onStart().finally(() => setStarting(false))
      }}
    >
      {starting ? 'Starting…' : 'Start Ollama'}
    </button>
  )
}
