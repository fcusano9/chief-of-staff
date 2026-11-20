import { useEffect, useMemo, useState } from 'react'
import { formatCost } from '@shared/pricing'
import {
  CLAUDE_EFFORTS,
  LOCAL_REASONINGS,
  MODEL_TEST_MAX_IMPORTS,
  MODEL_TEST_MAX_MODELS,
  modelTestLabel,
  SOURCE_KIND_LABELS,
  suggestionLabel,
  type AiCall,
  type AiChoice,
  type ClaudeEffort,
  type ModelTest,
  type ModelTestEstimate,
  type ModelTestJob,
  type ModelTestModel,
  type ModelTestRun,
  type ModelTestSource,
  type ModelTestSuggestion,
  type ModelTestSummary,
} from '@shared/types'
import { cos, errorMessage } from '../api'
import { useApp } from '../context'
import { ConfirmButton, SearchBox } from '../components/bits'
import { useShortcutHints } from '../components/hints'
import { CallCard } from './AiLogScreen'

type Page = { kind: 'past' } | { kind: 'setup' } | { kind: 'test'; id: number; summary?: boolean }

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const seconds = (ms: number | null) => (ms == null ? '' : `${Math.round(ms / 1000)} s`)
const money = (n: number | null) => (n == null ? 'Free' : formatCost(n))
const isTyping = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')

/** Model test (Settings → Developer Tools): past tests, a new test, and each test's results. */
export function ModelTestScreen() {
  const { version } = useApp()
  const [page, setPage] = useState<Page>({ kind: 'past' })
  const [job, setJob] = useState<ModelTestJob | null>(null)

  // Follow the running test, so its page updates while it runs.
  useEffect(() => {
    const poll = () => void cos['modelTests.status']().then(setJob)
    poll()
    const timer = setInterval(poll, 1500)
    return () => clearInterval(timer)
  }, [version])

  if (page.kind === 'setup') return <Setup onBack={() => setPage({ kind: 'past' })} onStarted={(id) => setPage({ kind: 'test', id })} />
  if (page.kind === 'test')
    return <TestPage id={page.id} job={job} summary={!!page.summary} onSummary={(summary) => setPage({ ...page, summary })} onBack={() => setPage({ kind: 'past' })} />
  return <PastTests job={job} onOpen={(id) => setPage({ kind: 'test', id })} onNew={() => setPage({ kind: 'setup' })} />
}

function PastTests({ job, onOpen, onNew }: { job: ModelTestJob | null; onOpen: (id: number) => void; onNew: () => void }) {
  const { go, version, toast } = useApp()
  const [tests, setTests] = useState<ModelTestSummary[] | null>(null)
  const [cursor, setCursor] = useState(0)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    void cos['modelTests.list']().then(setTests)
  }, [version, reload, job?.done, job == null])
  useShortcutHints(tests?.length ? [['↑ ↓', 'move'], ['↵', 'open']] : null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!tests?.length || document.querySelector('.scrim') || isTyping()) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setCursor((c) => Math.max(0, Math.min(tests.length - 1, c + (e.key === 'ArrowDown' ? 1 : -1))))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onOpen(tests[Math.min(cursor, tests.length - 1)]!.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="page" data-model-tests>
      <div className="head">
        <button className="btn ghost" onClick={() => go('settings')}>
          ← Settings
        </button>
        <h1>Past tests</h1>
        <div className="spacer" />
        <button className="btn primary" data-new-test onClick={onNew}>
          New test
        </button>
      </div>
      {tests && !tests.length && <div className="card empty">No model tests yet.</div>}
      {tests && tests.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <table className="mt-table">
            <thead>
              <tr>
                <th>Run</th>
                <th className="n">Imports</th>
                <th>Models</th>
                <th>Most accepted</th>
                <th className="n">Unmarked</th>
                <th className="n">Cost</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tests.map((t, i) => (
                <tr key={t.id} className={`mt-row ${i === cursor ? 'cur' : ''}`} data-test-row={t.id} onClick={() => onOpen(t.id)}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {when(t.createdAt)}
                    {t.status === 'running' && <span className="chip mt-chip">Running</span>}
                    {t.status === 'stopped' && <span className="chip mt-chip">Stopped</span>}
                  </td>
                  <td className="n">{t.imports}</td>
                  <td>
                    {t.models.map((m, j) => (
                      <span key={j} className="chip mt-chip" style={{ marginLeft: 0, marginRight: 4 }}>
                        {modelTestLabel(m)}
                      </span>
                    ))}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{t.best != null ? modelTestLabel(t.models[t.best]!) : <span className="faint">–</span>}</td>
                  <td className={`n ${t.unmarked ? '' : 'faint'}`}>{t.unmarked}</td>
                  <td className="n">{t.cost == null ? <span className="faint">Free</span> : formatCost(t.cost)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {t.status !== 'running' && (
                      <ConfirmButton
                        label="Delete"
                        confirmLabel="Delete?"
                        onConfirm={() =>
                          void cos['modelTests.delete'](t.id)
                            .then(() => setReload((n) => n + 1))
                            .catch((err) => toast(errorMessage(err), true))
                        }
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** An effort choice in the set-up list: Claude's level, or Ollama's reasoning plus passes. */
type Row = { choice: AiChoice; effort: ClaudeEffort; passes: 'split' | 'single' }
const rowKey = (r: Row) => `${r.choice.provider}|${r.choice.model}|${r.effort}|${r.passes}`
const CLAUDE_LEVELS = CLAUDE_EFFORTS.filter((e) => e.id !== 'default') as { id: ClaudeEffort; label: string }[]
const LOCAL_LEVELS = LOCAL_REASONINGS.flatMap((r) => [
  { value: `${r.id}|split`, label: r.label },
  { value: `${r.id}|single`, label: `${r.label} · Single` },
])

function Setup({ onBack, onStarted }: { onBack: () => void; onStarted: (id: number) => void }) {
  const { toast, ai } = useApp()
  const [sources, setSources] = useState<ModelTestSource[] | null>(null)
  const [choices, setChoices] = useState<AiChoice[]>([])
  const [picked, setPicked] = useState<number[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [query, setQuery] = useState('')
  const [estimate, setEstimate] = useState<ModelTestEstimate | null>(null)
  const [starting, setStarting] = useState(false)
  useShortcutHints([['/', 'search imports']])

  useEffect(() => {
    void cos['modelTests.sources']().then(setSources)
    void cos['ai.choices']().then((groups) => {
      const list = groups.filter((g) => g.provider !== 'demo').flatMap((g) => g.choices)
      setChoices(list)
      // Start with the model in use, else the first one there is.
      const first = list.find((c) => c.provider === ai.provider && c.model === ai.model) ?? list[0]
      if (first) setRows([{ choice: first, effort: first.provider === 'claude' ? 'medium' : 'low', passes: 'split' }])
    })
  }, [])

  const models: ModelTestModel[] = rows.map((r) =>
    r.choice.provider === 'claude'
      ? { provider: 'claude', model: r.choice.model, effort: r.effort }
      : { provider: 'local', model: r.choice.model, effort: r.effort, passes: r.passes },
  )
  const modelsKey = JSON.stringify(models)
  useEffect(() => {
    setEstimate(null)
    if (!picked.length || !models.length) return
    const timer = setTimeout(() => void cos['modelTests.estimate'](picked, models).then(setEstimate).catch(() => setEstimate(null)), 250)
    return () => clearTimeout(timer)
  }, [picked.join(','), modelsKey])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (sources ?? []).filter((s) => !q || s.title.toLowerCase().includes(q))
  }, [sources, query])
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MODEL_TEST_MAX_IMPORTS ? p : [...p, id]))
  const duplicate = new Set(rows.map(rowKey)).size !== rows.length

  const start = () => {
    setStarting(true)
    cos['modelTests.start'](picked, models)
      .then(onStarted)
      .catch((err) => toast(errorMessage(err), true))
      .finally(() => setStarting(false))
  }

  return (
    <div className="page" data-model-test-setup>
      <div className="head">
        <button className="btn ghost" onClick={onBack}>
          ← Past tests
        </button>
        <h1>New model test</h1>
      </div>
      <div className="mt-split">
        <div className="card">
          <div className="row" style={{ marginBottom: 6 }}>
            <span style={{ fontWeight: 500 }}>Imports</span>
            <div className="spacer" />
            <span className="label">
              {picked.length} selected{picked.length >= MODEL_TEST_MAX_IMPORTS ? ` (up to ${MODEL_TEST_MAX_IMPORTS})` : ''}
            </span>
          </div>
          <SearchBox value={query} onChange={setQuery} placeholder="Search imports" />
          <div className="mt-sources">
            {sources && !sources.length && <div className="empty">No imports yet.</div>}
            {shown.map((s) => (
              <label key={s.id} className={`mt-source ${picked.includes(s.id) ? 'on' : ''}`} data-source={s.id}>
                <input type="checkbox" checked={picked.includes(s.id)} onChange={() => toggle(s.id)} disabled={!picked.includes(s.id) && picked.length >= MODEL_TEST_MAX_IMPORTS} />
                <div style={{ minWidth: 0 }}>
                  <div className="ttl" style={{ fontWeight: 500 }}>
                    {s.title}
                  </div>
                  <div className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
                    {SOURCE_KIND_LABELS[s.kind]} · {day(s.importedAt)} · {s.accepted} accepted
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>
        <div className="grid" style={{ alignContent: 'start' }}>
          <div className="card">
            <div style={{ fontWeight: 500, marginBottom: 8 }}>Models</div>
            {!choices.length && <div className="muted">No models to test. Add a Claude API key or download an Ollama model in Settings → AI providers.</div>}
            {rows.length > 0 && (
              <div className="mt-model-row label" style={{ padding: 0 }}>
                <span>Model</span>
                <span>Effort</span>
                <span />
              </div>
            )}
            {rows.map((r, i) => (
              <div key={i} className="mt-model-row" data-model-row>
                <select
                  className="inp"
                  aria-label="Model"
                  value={`${r.choice.provider}|${r.choice.model}`}
                  onChange={(e) => {
                    const c = choices.find((x) => `${x.provider}|${x.model}` === e.target.value)!
                    setRows(rows.map((x, j) => (j === i ? { choice: c, effort: c.provider === 'claude' ? 'medium' : 'low', passes: 'split' } : x)))
                  }}
                >
                  {choices.map((c) => (
                    <option key={`${c.provider}|${c.model}`} value={`${c.provider}|${c.model}`}>
                      {c.label}
                    </option>
                  ))}
                </select>
                {r.choice.provider === 'claude' ? (
                  <select className="inp" aria-label="Effort" value={r.effort} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, effort: e.target.value as ClaudeEffort } : x)))}>
                    {CLAUDE_LEVELS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <select
                    className="inp"
                    aria-label="Effort"
                    value={`${r.effort}|${r.passes}`}
                    onChange={(e) => {
                      const [effort, passes] = e.target.value.split('|') as [ClaudeEffort, 'split' | 'single']
                      setRows(rows.map((x, j) => (j === i ? { ...x, effort, passes } : x)))
                    }}
                  >
                    {LOCAL_LEVELS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}
                <button className="btn ghost sm" title="Remove" aria-label="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </div>
            ))}
            {choices.length > 0 && (
              <div className="row" style={{ marginTop: 6 }}>
                <button className="btn sm" data-add-model disabled={rows.length >= MODEL_TEST_MAX_MODELS} onClick={() => setRows([...rows, rows[rows.length - 1] ?? { choice: choices[0]!, effort: 'medium', passes: 'split' }])}>
                  + Add model
                </button>
                <span className="label">
                  {rows.length} of {MODEL_TEST_MAX_MODELS}
                </span>
              </div>
            )}
            {duplicate && <div style={{ color: 'var(--warn)', fontSize: 'var(--fs-sm)', marginTop: 6 }}>The same model and effort is listed twice.</div>}
          </div>
          <div className="card row" style={{ flexWrap: 'wrap' }}>
            <span>
              {picked.length} {picked.length === 1 ? 'import' : 'imports'} × {rows.length} {rows.length === 1 ? 'model' : 'models'} = {picked.length * rows.length} runs
            </span>
            {estimate && estimate.cost > 0 && (
              <span className="muted" data-estimate>
                · est. {estimate.partial ? 'at least ' : ''}
                {formatCost(estimate.cost)}
              </span>
            )}
            <div className="spacer" />
            <button className="btn primary" data-run-test disabled={!picked.length || !rows.length || duplicate || starting} onClick={start}>
              {starting ? 'Starting…' : 'Run test'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function TestPage({ id, job, summary, onSummary, onBack }: { id: number; job: ModelTestJob | null; summary: boolean; onSummary: (on: boolean) => void; onBack: () => void }) {
  const { toast, version } = useApp()
  const [test, setTest] = useState<ModelTest | null>(null)
  const [imp, setImp] = useState(0)
  const [log, setLog] = useState<{ run: ModelTestRun; label: string } | null>(null)
  const [text, setText] = useState<{ title: string; body: string } | null>(null)
  // Running by the test's own status too, so a test just started shows progress before the first status check.
  const running = job?.testId === id || test?.status === 'running'

  useEffect(() => {
    void cos['modelTests.get'](id).then(setTest)
    if (!running) return
    const timer = setInterval(() => void cos['modelTests.get'](id).then(setTest), 1500)
    return () => clearInterval(timer)
  }, [id, version, running, job?.done])

  if (!test) return <div className="page" />
  const current = test.imports[Math.min(imp, test.imports.length - 1)]

  const mark = (s: ModelTestSuggestion) => {
    const next = s.mark == null ? 'accepted' : s.mark === 'accepted' ? 'rejected' : null
    setTest({ ...test, runs: test.runs.map((r) => ({ ...r, suggestions: r.suggestions.map((x) => (x.id === s.id ? { ...x, mark: next } : x)) })) })
    void cos['modelTests.mark'](s.id, next).catch((err) => toast(errorMessage(err), true))
  }

  const head = (
    <div className="head">
      <button className="btn ghost" onClick={summary ? () => onSummary(false) : onBack}>
        ← {summary ? 'Results' : 'Past tests'}
      </button>
      <h1>{summary ? 'Model test summary' : 'Model test'}</h1>
      <span className="faint">
        {summary ? `${test.imports.length} ${test.imports.length === 1 ? 'import' : 'imports'} · ` : ''}
        {when(test.createdAt)}
      </span>
      {running && <span className="chip mt-chip on">Running{job?.testId === id ? ` · ${job.done} of ${job.total}` : ''}</span>}
      {test.status === 'stopped' && <span className="chip mt-chip">Stopped</span>}
      <div className="spacer" />
      {running ? (
        <button className="btn" onClick={() => void cos['modelTests.stop']()}>
          Stop
        </button>
      ) : (
        !summary && (
          <>
            <button className="btn sm" data-summary onClick={() => onSummary(true)}>
              Summary
            </button>
            <ConfirmButton label="Delete" confirmLabel="Delete?" onConfirm={() => void cos['modelTests.delete'](test.id).then(onBack).catch((err) => toast(errorMessage(err), true))} />
          </>
        )
      )}
    </div>
  )

  if (running) return <div className="page">{head}<Progress test={test} /></div>
  if (summary) return <div className="page">{head}<Summary test={test} /></div>

  const runs = current ? test.runs.filter((r) => r.sourceId === current.sourceId) : []
  const accepted = (r: ModelTestRun) => r.suggestions.filter((s) => s.mark === 'accepted').length
  const top = Math.max(0, ...runs.map(accepted))

  return (
    <div className="page" data-model-test={test.id}>
      {head}
      {!current && <div className="card empty">The imports in this test have been deleted.</div>}
      {current && (
        <>
          {test.imports.length > 1 && (
            <div className="row" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
              {test.imports.map((m, i) => (
                <button key={m.sourceId} className={`pill ${i === imp ? 'on' : ''}`} title={m.title} onClick={() => setImp(i)}>
                  <span className="ttl" style={{ maxWidth: 260 }}>
                    {m.title}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="row label" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
            {test.imports.length === 1 && <b style={{ color: 'var(--text)', fontWeight: 500 }}>{current.title}</b>}
            <span>
              {SOURCE_KIND_LABELS[current.kind]} · {day(current.importedAt)}
            </span>
            <span>· {current.accepted} accepted at import</span>
            <span>· Input rebuilt as of {day(current.importedAt)}</span>
            <div className="spacer" />
            <button
              className="btn ghost sm"
              onClick={() =>
                void cos['modelTests.sourceText'](current.sourceId)
                  .then((body) => setText({ title: current.title, body }))
                  .catch((err) => toast(errorMessage(err), true))
              }
            >
              Show text
            </button>
          </div>
          <div className="mt-cols">
            {runs.map((r) => {
              const model = test.models[r.modelIndex]!
              const label = modelTestLabel(model)
              const a = accepted(r)
              return (
                <div key={r.id} className={`mt-col ${a > 0 && a === top ? 'best' : ''}`} data-run={r.id}>
                  <div className="mt-col-head">
                    <div className="row" style={{ gap: 6 }}>
                      <b className="ttl" style={{ fontWeight: 600 }} title={label}>
                        {label.split(' · ')[0]}
                      </b>
                      <div className="spacer" />
                      {r.status !== 'pending' && r.status !== 'skipped' && (
                        <button className="btn ghost sm" onClick={() => setLog({ run: r, label })}>
                          AI log
                        </button>
                      )}
                    </div>
                    <div className="mt-stats">
                      <span>{label.split(' · ').slice(1).join(' · ')}</span>
                      {r.durationMs != null && <span>{seconds(r.durationMs)}</span>}
                      {r.status === 'done' && <span>{money(r.cost)}</span>}
                    </div>
                    {r.status === 'done' && (
                      <div className="row" style={{ marginTop: 4, gap: 8 }}>
                        <span className="mt-ok">{a} accepted</span>
                        <span className="mt-no">{r.suggestions.filter((s) => s.mark === 'rejected').length} rejected</span>
                        <span className="label">of {r.suggestions.length}</span>
                      </div>
                    )}
                  </div>
                  {r.status === 'failed' && <div className="mt-error">{r.error}</div>}
                  {r.status === 'skipped' && <div className="empty">Not run</div>}
                  {r.status === 'done' && !r.suggestions.length && <div className="empty">No suggestions</div>}
                  {r.suggestions.map((s) => (
                    <SuggestionRow key={s.id} s={s} onClick={() => mark(s)} />
                  ))}
                </div>
              )
            })}
          </div>
        </>
      )}
      {log && <RunLog run={log.run} label={log.label} onClose={() => setLog(null)} />}
      {text && (
        <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && setText(null)}>
          <div className="dialog wide" role="dialog" aria-label="Import text" onKeyDown={(e) => e.key === 'Escape' && setText(null)}>
            <div className="dialog-head">
              <b className="ttl" style={{ fontWeight: 500 }}>
                {text.title}
              </b>
              <div className="spacer" />
              <button className="btn ghost" autoFocus onClick={() => setText(null)}>
                Close
              </button>
            </div>
            <div className="dialog-body">
              <pre className="mt-text">{text.body}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SuggestionRow({ s, onClick }: { s: ModelTestSuggestion; onClick: () => void }) {
  const meta = [s.dueDate ? `Due ${new Date(`${s.dueDate}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}` : '', s.project ?? '', s.person ? (s.kind === 'waiting_on' ? `Waiting on ${s.person}` : s.person) : '']
    .filter(Boolean)
    .join(' · ')
  return (
    <div className={`mt-sugg ${s.mark ?? ''}`} data-suggestion={s.id} role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick())} title={s.evidence ? `“${s.evidence}”` : undefined}>
      <span className="box" aria-label={s.mark ?? 'not marked'}>{s.mark === 'rejected' ? '✕' : '✓'}</span>
      <div style={{ minWidth: 0 }}>
        <div className="faint" style={{ fontSize: 'var(--fs-xs)' }}>
          {suggestionLabel(s.kind, null)}
        </div>
        <div>{s.title}</div>
        {s.details && <div className="muted mt-details">{s.details}</div>}
        {meta && <div className="muted" style={{ fontSize: 'var(--fs-xs)' }}>{meta}</div>}
      </div>
    </div>
  )
}

function Progress({ test }: { test: ModelTest }) {
  return (
    <div className="card" style={{ maxWidth: 760, padding: 0 }}>
      <table className="mt-table">
        <thead>
          <tr>
            <th>Model</th>
            <th className="n">Imports</th>
            <th />
            <th className="n">Cost</th>
          </tr>
        </thead>
        <tbody>
          {test.models.map((m, i) => {
            const runs = test.runs.filter((r) => r.modelIndex === i)
            const done = runs.filter((r) => r.status === 'done' || r.status === 'failed').length
            const costs = runs.map((r) => r.cost).filter((c): c is number => c != null)
            return (
              <tr key={i}>
                <td>{modelTestLabel(m)}</td>
                <td className="n">
                  {done} of {runs.length}
                </td>
                <td style={{ width: 160 }}>
                  <div className="mt-progress">
                    <div style={{ width: `${runs.length ? (done / runs.length) * 100 : 0}%` }} />
                  </div>
                </td>
                <td className="n">{costs.length ? formatCost(costs.reduce((a, b) => a + b, 0)) : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Summary({ test }: { test: ModelTest }) {
  const rows = test.models.map((m, i) => {
    const runs = test.runs.filter((r) => r.modelIndex === i && r.status === 'done')
    const all = runs.flatMap((r) => r.suggestions)
    const costs = runs.map((r) => r.cost).filter((c): c is number => c != null)
    return {
      label: modelTestLabel(m),
      accepted: all.filter((s) => s.mark === 'accepted').length,
      rejected: all.filter((s) => s.mark === 'rejected').length,
      unmarked: all.filter((s) => s.mark == null).length,
      time: runs.length ? runs.reduce((t, r) => t + (r.durationMs ?? 0), 0) / runs.length : null,
      cost: costs.length ? costs.reduce((a, b) => a + b, 0) / runs.length : null,
      failed: test.runs.filter((r) => r.modelIndex === i && r.status === 'failed').length,
    }
  })
  const top = Math.max(0, ...rows.map((r) => r.accepted))
  return (
    <div className="card" style={{ maxWidth: 900, padding: 0 }} data-model-test-summary>
      <table className="mt-table">
        <thead>
          <tr>
            <th>Model</th>
            <th className="n">Accepted</th>
            <th className="n">Rejected</th>
            <th className="n">vs best</th>
            <th className="n">Avg time</th>
            <th className="n">Avg cost per import</th>
            <th className="n">Unmarked</th>
            <th className="n">Failed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.label}</td>
              <td className="n mt-ok">{r.accepted}</td>
              <td className="n mt-no">{r.rejected}</td>
              <td className="n">{top ? `${Math.round((r.accepted / top) * 100)}%` : '–'}</td>
              <td className="n">{r.time == null ? '–' : seconds(r.time)}</td>
              <td className="n">{r.time == null ? '–' : money(r.cost)}</td>
              <td className={`n ${r.unmarked ? '' : 'faint'}`}>{r.unmarked}</td>
              <td className={`n ${r.failed ? '' : 'faint'}`}>{r.failed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** One run's AI log: every request as sent and received, and what the app's checks dropped. */
function RunLog({ run, label, onClose }: { run: ModelTestRun; label: string; onClose: () => void }) {
  const [data, setData] = useState<{ calls: AiCall[]; dropped: { kind: string; title: string; reason: string }[] } | null>(null)
  useEffect(() => {
    void cos['modelTests.aiLog'](run.id).then(setData)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [run.id])
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wide" role="dialog" aria-label="AI log">
        <div className="dialog-head">
          <b style={{ fontWeight: 500 }}>{label}</b>
          <span className="muted">· AI log</span>
          <div className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="dialog-body" style={{ paddingTop: 12 }}>
          {data?.dropped.length ? (
            <div className="card" style={{ marginBottom: 12 }}>
              <div className="label" style={{ marginBottom: 4 }}>
                Left out by the app's checks
              </div>
              {data.dropped.map((d, i) => (
                <div key={i} style={{ fontSize: 'var(--fs-sm)' }}>
                  {d.title} <span className="muted">· {d.reason}</span>
                </div>
              ))}
            </div>
          ) : null}
          {data?.calls.map((c) => <CallCard key={c.id} call={c} />)}
          {data && !data.calls.length && <div className="empty">No requests were recorded.</div>}
        </div>
      </div>
    </div>
  )
}
