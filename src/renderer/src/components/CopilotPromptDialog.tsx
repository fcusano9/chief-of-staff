import { useEffect, useState } from 'react'
import type { CopilotCoverage, CopilotPrompt, CopilotPromptKind } from '@shared/types'
import { cos, errorMessage } from '../api'
import { useApp } from '../context'

const KINDS: [CopilotPromptKind, string][] = [
  ['chats', 'Teams chats'],
  ['meetings', 'Teams meetings'],
]
const stamp = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/**
 * Import → Copilot Prompt Generator: the Teams chats or meetings prompt for Microsoft 365 Copilot,
 * from where the last imported answer ended (or 7 days ago) to now. Copy puts it on the clipboard
 * and closes; the user pastes Copilot's answer into the text import.
 */
export function CopilotPromptDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useApp()
  const [kind, setKind] = useState<CopilotPromptKind>('chats')
  const [coverage, setCoverage] = useState<CopilotCoverage | null>(null)
  const [from, setFrom] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<CopilotPrompt | null>(null)
  const [show, setShow] = useState(false)

  useEffect(() => {
    void cos['copilot.coverage']().then(setCoverage)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // A new prompt for each choice; `from` null means "where the last import ended".
  useEffect(() => {
    cos['copilot.prompt'](kind, from)
      .then(setPrompt)
      .catch((err) => toast(errorMessage(err), true))
  }, [kind, from])

  const copy = () => {
    if (!prompt) return
    // Made fresh, so "to" is the moment it's copied.
    void cos['copilot.prompt'](kind, prompt.from)
      .then((p) => navigator.clipboard.writeText(p.text))
      .then(() => {
        toast('Prompt copied')
        onClose()
      })
      .catch((err) => toast(errorMessage(err), true))
  }

  const last = coverage?.[kind]
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label="Copilot Prompt Generator" data-copilot-dialog>
        <div className="dialog-head">
          <b style={{ fontWeight: 600 }}>Copilot Prompt Generator</b>
          <div className="spacer" />
          <button className="btn ghost sm" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="dialog-body" style={{ paddingTop: 12 }}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <span className="seg">
              {KINDS.map(([k, label]) => (
                <button
                  key={k}
                  className={kind === k ? 'on' : ''}
                  onClick={() => {
                    setKind(k)
                    setFrom(null)
                  }}
                >
                  {label}
                </button>
              ))}
            </span>
            <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
              From
            </span>
            <input
              className="inp"
              style={{ width: 'auto' }}
              type="datetime-local"
              aria-label="From"
              value={prompt ? prompt.from.replace(' ', 'T') : ''}
              onChange={(e) => e.target.value && setFrom(e.target.value.replace('T', ' '))}
            />
            <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
              to now
            </span>
          </div>
          <div className="faint" style={{ fontSize: 'var(--fs-sm)', marginTop: 6 }} data-copilot-last>
            {last ? `Last imported up to ${stamp(last)}` : 'Never imported'}
          </div>
          {show && prompt && (
            <pre className="mono" style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--fs-xs)', color: 'var(--muted)', maxHeight: 320, overflow: 'auto', margin: '10px 0 0', paddingTop: 8, borderTop: '1px solid var(--border)' }} data-copilot-text>
              {prompt.text}
            </pre>
          )}
        </div>
        <div className="dialog-foot">
          <button className="btn ghost" onClick={() => setShow(!show)}>
            {show ? 'Hide prompt' : 'Show prompt'}
          </button>
          <div className="spacer" />
          <button className="btn primary" disabled={!prompt} onClick={copy}>
            Copy prompt
          </button>
        </div>
      </div>
    </div>
  )
}
