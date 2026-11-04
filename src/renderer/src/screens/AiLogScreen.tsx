import { useEffect, useState } from 'react'
import type { AiCall, AiRun, SourceItem, SuggestionKind } from '@shared/types'
import { SUGGESTION_LABELS } from '@shared/types'
import { cos, errorMessage } from '../api'
import { useApp, type View } from '../context'

const VIEW_LABELS: Partial<Record<View, string>> = { import: 'Import', review: 'Review' }
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const seconds = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`)
const num = (n: number) => n.toLocaleString()
const kindLabel = (k: string) => SUGGESTION_LABELS[k as SuggestionKind] ?? k

type Json = Record<string, unknown>
const parse = (s: string | null): unknown => {
  if (!s) return null
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}
/** Message content is a string or a list of text blocks. */
const text = (content: unknown): string | null =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.map((b) => (b as Json)?.text ?? '').join('\n') || null : null

/** Splits a recorded request into the parts a person reads: instructions, message, answer form. */
function tabsFor(call: AiCall): { label: string; body: string }[] {
  const req = (parse(call.request) ?? {}) as Json
  const messages = Array.isArray(req.messages) ? (req.messages as Json[]) : []
  const instructions = text(req.system) ?? text(messages.find((m) => m.role === 'system')?.content) ?? (typeof req.note === 'string' ? req.note : null)
  const message = text(messages.find((m) => m.role === 'user')?.content) ?? (typeof req.importedItem === 'string' ? req.importedItem : null)
  const format = ((req.output_config as Json | undefined)?.format as Json | undefined)?.schema ?? req.format
  const tabs: { label: string; body: string }[] = []
  if (instructions) tabs.push({ label: 'Instructions', body: instructions })
  if (message) tabs.push({ label: 'Message', body: message })
  if (format) tabs.push({ label: 'Answer form', body: JSON.stringify(format, null, 2) })
  tabs.push({ label: 'Response', body: call.error ? `Error: ${call.error}${call.response ? `\n\n${call.response}` : ''}` : (call.response ?? '(no response)') })
  tabs.push({ label: 'Full request', body: call.request })
  return tabs
}

export function CallCard({ call }: { call: AiCall }) {
  const { toast } = useApp()
  const tabs = tabsFor(call)
  const [tab, setTab] = useState(0)
  const current = tabs[Math.min(tab, tabs.length - 1)]!
  const tokens = call.inputTokens != null ? ` · ${num(call.inputTokens)} in · ${num(call.outputTokens ?? 0)} out` : ''
  return (
    <div className="card" style={{ padding: 0, marginBottom: 12 }} data-call={call.id}>
      <div className="row" style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
        <b style={{ fontWeight: 500 }}>{call.purpose}</b>
        {call.error && <span className="chip" style={{ background: 'color-mix(in srgb, var(--danger) 15%, transparent)', color: 'var(--danger)' }}>Failed</span>}
        <span className="muted ttl" style={{ fontSize: 'var(--fs-sm)', flex: 1 }} title={call.endpoint}>
          {call.endpoint} · {seconds(call.durationMs)}
          {tokens}
        </span>
        <button
          className="btn ghost"
          onClick={() =>
            void navigator.clipboard
              .writeText(current.body)
              .then(() => toast(`${current.label} copied`))
              .catch((err) => toast(errorMessage(err), true))
          }
        >
          Copy
        </button>
      </div>
      <div className="row" style={{ gap: 0, padding: '0 8px', borderBottom: '1px solid var(--border)' }}>
        {tabs.map((t, i) => (
          <button key={t.label} className={`subtab ${i === tab ? 'on' : ''}`} onClick={() => setTab(i)}>
            {t.label}
          </button>
        ))}
      </div>
      <pre className="code-block">{current.body}</pre>
    </div>
  )
}

/** Everything sent to the AI for one import, what came back, and what the app kept. */
export function AiLogScreen() {
  const { aiLog, go, version } = useApp()
  const [runs, setRuns] = useState<AiRun[] | null>(null)
  const [source, setSource] = useState<SourceItem | null>(null)
  const [selected, setSelected] = useState(0)
  const sourceId = aiLog?.sourceId

  useEffect(() => {
    if (sourceId == null) return
    void cos['sources.aiRuns'](sourceId).then((r) => {
      setRuns(r)
      setSelected(0)
    })
    void cos['sources.list']().then((list) => setSource(list.find((s) => s.id === sourceId) ?? null))
  }, [sourceId, version])

  if (!aiLog) return null
  const back = aiLog.from
  const run = runs?.[selected]
  const kept = (parse(run?.keptOutput ?? null) as { kind: SuggestionKind; payload: { title: string } }[] | null) ?? []
  const totalMs = run ? run.calls.reduce((t, c) => t + c.durationMs, 0) : 0
  const inTokens = run ? run.calls.reduce((t, c) => t + (c.inputTokens ?? 0), 0) : 0
  const outTokens = run ? run.calls.reduce((t, c) => t + (c.outputTokens ?? 0), 0) : 0

  return (
    <div className="page">
      <div className="head">
        <button className="btn ghost" onClick={() => go(back)}>
          ← {VIEW_LABELS[back] ?? 'Back'}
        </button>
        <h1 className="ttl">{source?.title ?? 'Import'}</h1>
        <span className="muted">· AI log</span>
        <div className="spacer" />
        {(source?.pendingCount ?? 0) > 0 && back !== 'review' && (
          <button className="btn" onClick={() => go('review')}>
            Open in Review
          </button>
        )}
      </div>

      {runs && runs.length === 0 && (
        <div className="card empty">
          No AI log for this import yet. Imports from before this feature weren't recorded; use <b style={{ fontWeight: 500 }}>Run again</b> on the Import screen to record one.
        </div>
      )}

      {runs && runs.length > 0 && (
        <>
          <div className="row" style={{ gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
            <span className="label">Runs</span>
            {runs.map((r, i) => (
              <button key={r.id} className={`pill ${i === selected ? 'on' : ''}`} onClick={() => setSelected(i)}>
                Run {runs.length - i} · {r.provider} · {when(r.startedAt)}
              </button>
            ))}
          </div>

          {run && (
            <>
              <div className="card row" style={{ gap: 20, marginBottom: 12, flexWrap: 'wrap', background: 'var(--bg)' }}>
                <span>
                  <span className="muted">Requests</span> <b style={{ fontWeight: 500 }}>{run.calls.length}</b>
                </span>
                <span>
                  <span className="muted">Time</span> <b style={{ fontWeight: 500 }}>{seconds(totalMs)}</b>
                </span>
                {inTokens > 0 && (
                  <span>
                    <span className="muted">Tokens</span>{' '}
                    <b style={{ fontWeight: 500 }}>
                      {num(inTokens)} in · {num(outTokens)} out
                    </b>
                  </span>
                )}
                <span>
                  <span className="muted">Suggestions</span>{' '}
                  <b style={{ fontWeight: 500 }}>{run.error ? 'none (failed)' : `${run.rawCount ?? 0} proposed → ${run.keptCount ?? 0} sent to Review`}</b>
                </span>
              </div>

              {run.error && (
                <div className="card" style={{ marginBottom: 12, color: 'var(--danger)', borderColor: 'color-mix(in srgb, var(--danger) 40%, transparent)' }}>
                  {run.error}
                </div>
              )}

              {run.calls.map((c) => (
                <CallCard key={c.id} call={c} />
              ))}

              {!run.error && (
                <div className="card" data-checks>
                  <div style={{ fontWeight: 500, marginBottom: 6 }}>After the app's checks</div>
                  {kept.map((k, i) => (
                    <div key={`k${i}`} className="row" style={{ padding: '3px 0' }}>
                      <span className="chip" style={{ background: 'var(--accent-bg)', color: 'var(--accent)', minWidth: 92, textAlign: 'center' }}>
                        {kindLabel(k.kind)}
                      </span>
                      <span className="ttl" style={{ flex: 1 }}>{k.payload.title}</span>
                      <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Sent to Review</span>
                    </div>
                  ))}
                  {run.dropped.map((d, i) => (
                    <div key={`d${i}`} className="row" style={{ padding: '3px 0' }} data-dropped>
                      <span className="chip" style={{ background: 'color-mix(in srgb, var(--danger) 15%, transparent)', color: 'var(--danger)', minWidth: 92, textAlign: 'center' }}>
                        Dropped
                      </span>
                      <span className="ttl" style={{ flex: 1 }}>
                        {kindLabel(d.kind)}: {d.title}
                      </span>
                      <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{d.reason}</span>
                    </div>
                  ))}
                  {kept.length === 0 && run.dropped.length === 0 && <div className="muted">The AI found nothing to suggest in this import.</div>}
                  {run.rawOutput && (
                    <details style={{ marginTop: 8 }}>
                      <summary className="muted" style={{ cursor: 'pointer', fontSize: 'var(--fs-sm)' }}>
                        Everything the AI proposed, before the checks (JSON)
                      </summary>
                      <pre className="code-block">{run.rawOutput}</pre>
                    </details>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
