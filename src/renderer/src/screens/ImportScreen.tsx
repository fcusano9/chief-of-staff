import { useEffect, useRef, useState } from 'react'
import type { ImportResult, MailImportRun, SourceItem, SourceKind } from '@shared/types'
import { SOURCE_KIND_LABELS } from '@shared/types'
import { cos, errorMessage } from '../api'
import { ConfirmButton, CostNote } from '../components/bits'
import { OutlookImport } from '../components/OutlookImport'
import { CopilotPromptDialog } from '../components/CopilotPromptDialog'
import { useShortcutHints } from '../components/hints'
import { mailAppName, useMailApp } from '../components/mailApp'
import { useApp } from '../context'

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/** Paste or drop text; the AI turns it into suggestions for the review queue. */
export function ImportScreen() {
  const { ai, go, toast, refresh, version } = useApp()
  useShortcutHints([['Ctrl ↵', 'extract'], ['N', 'new task']])
  // Set only by a dropped or chosen file (its name and type); otherwise the AI names the import.
  const [file, setFile] = useState<{ title: string; kind: SourceKind | undefined } | null>(null)
  const [copilotOpen, setCopilotOpen] = useState(false)
  const [occurredOn, setOccurredOn] = useState(today)
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<ImportResult | null>(null)
  const [recent, setRecent] = useState<SourceItem[]>([])
  const [mailRuns, setMailRuns] = useState<MailImportRun[]>([])
  const [openRun, setOpenRun] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void cos['sources.list']().then(setRecent)
    void cos['mail.imports']().then(setMailRuns)
  }, [version])
  // Mail imports and other imports, newest first.
  const rows: (SourceItem | MailImportRun)[] = [...recent, ...mailRuns].sort((a, b) =>
    ('conversations' in b ? b.startedAt : b.importedAt).localeCompare('conversations' in a ? a.startedAt : a.importedAt),
  )

  const loadFile = async (file: File) => {
    if (file.size > 5_000_000) return toast('That file is over 5 MB. Paste the relevant part instead.', true)
    const text = await file.text()
    setContent(text)
    setFile({ title: file.name.replace(/\.[^.]+$/, ''), kind: /\.(vtt|srt)$/i.test(file.name) ? 'meeting_transcript' : /\.eml$/i.test(file.name) ? 'email' : undefined })
  }

  const handleResult = (r: ImportResult) => {
    refresh()
    if (r.duplicate) {
      toast(`Already imported on ${shortDate(r.source.importedAt)}, so nothing was sent again.`)
      return
    }
    if (r.error) {
      setFailure(r)
      return
    }
    setFailure(null)
    setContent('')
    setFile(null)
    if (r.suggestionsCreated > 0) {
      toast(`${r.suggestionsCreated} suggestion${r.suggestionsCreated === 1 ? '' : 's'} ready to review`)
      go('review')
    } else toast('Nothing actionable found. The item is saved in your archive.')
  }

  const run = async () => {
    if (!content.trim()) return toast('Paste some text or choose a file first', true)
    setBusy(true)
    try {
      handleResult(await cos['sources.importAndExtract']({ content, occurredOn, ...(file ? { title: file.title, kind: file.kind } : {}) }))
    } catch (err) {
      toast(errorMessage(err), true)
    } finally {
      setBusy(false)
    }
  }

  const rerun = async (id: number) => {
    setBusy(true)
    try {
      handleResult(await cos['sources.extract'](id))
    } catch (err) {
      toast(errorMessage(err), true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="head">
        <h1>Import</h1>
        <div className="spacer" />
        <button className="btn" onClick={() => setCopilotOpen(true)}>
          Copilot Prompt Generator
        </button>
      </div>
      {copilotOpen && <CopilotPromptDialog onClose={() => setCopilotOpen(false)} />}

      <OutlookImport onFinished={refresh} />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
          <b style={{ fontWeight: 600 }}>Paste or drop text</b>
          <div className="spacer" />
          <input className="inp" style={{ width: 150 }} type="date" aria-label="Date" value={occurredOn} max={today()} onChange={(e) => setOccurredOn(e.target.value || today())} title="When this happened" />
        </div>
        <textarea
          className="inp"
          style={{ minHeight: 220, fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)', borderStyle: dragging ? 'dashed' : 'solid', borderColor: dragging ? 'var(--accent)' : undefined }}
          placeholder="Copilot summary, Teams chat, email, transcript or notes"
          value={content}
          onChange={(e) => {
            setContent(e.target.value)
            if (!e.target.value) setFile(null)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            const file = e.dataTransfer.files[0]
            if (file) void loadFile(file)
          }}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault()
              void run()
            }
          }}
        />
        <input ref={fileRef} type="file" accept=".txt,.vtt,.srt,.md,.eml,.csv,.log" hidden onChange={(e) => e.target.files?.[0] && void loadFile(e.target.files[0])} />
        <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
          <button className="btn ghost" onClick={() => fileRef.current?.click()}>
            Choose file…
          </button>
          <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
            {content ? `${content.length.toLocaleString()} characters` : ''}
          </span>
          <div className="spacer" />
          <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
            {ai.label} · {ai.sendsDataExternally ? `sent to ${ai.provider === 'claude' ? 'Anthropic' : 'your Ollama server'}` : 'nothing leaves this computer'}
          </span>
          <button className="btn primary" disabled={busy} onClick={() => void run()}>
            {busy ? 'Reading…' : 'Extract suggestions'}
          </button>
        </div>
        {failure && (
          <div className="row" style={{ marginTop: 10, padding: '8px 10px', borderRadius: 6, background: 'color-mix(in srgb, var(--danger) 12%, transparent)', color: 'var(--danger)' }}>
            <span style={{ flex: 1 }}>{failure.error} The text was saved, so you can try again.</span>
            <button className="btn" onClick={() => void rerun(failure.source.id)} disabled={busy}>
              Try again
            </button>
            {failure.error?.includes('Settings') && (
              <button className="btn ghost" onClick={() => go('settings')}>
                Open Settings
              </button>
            )}
          </div>
        )}
      </div>

      <h2>Recent imports</h2>
      <div className="list">
        {rows.map((row) =>
          'conversations' in row ? (
            <MailRunRow key={`m${row.id}`} run={row} open={openRun === row.id} onToggle={() => setOpenRun(openRun === row.id ? null : row.id)} busy={busy} rerun={rerun} />
          ) : (
            <SourceRow key={row.id} s={row} busy={busy} rerun={rerun} />
          ),
        )}
        {rows.length === 0 && <div className="empty">Nothing imported yet.</div>}
      </div>
    </div>
  )
}

/** One mail import (Outlook or Apple Mail): a summary row that opens to show each conversation it read. */
function MailRunRow({ run, open, onToggle, busy, rerun }: { run: MailImportRun; open: boolean; onToggle: () => void; busy: boolean; rerun: (id: number) => void }) {
  const mailApp = useMailApp()
  const { go } = useApp()
  const pending = run.conversations.reduce((n, s) => n + s.pendingCount, 0)
  const total = run.conversations.reduce((n, s) => n + s.totalSuggestions, 0)
  const failed = run.conversations.filter((s) => s.extractError).length
  const n = run.conversations.length
  const costs = run.conversations.map((s) => s.estimatedCost).filter((c): c is number => c != null)
  const cost = costs.length ? costs.reduce((a, b) => a + b, 0) : null
  return (
    <>
      <div className="r" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto auto', paddingLeft: 12, cursor: 'default' }}>
        <div className="ttl">
          {mailApp === 'apple-mail' ? 'Apple Mail' : 'Outlook mail'} · {n} conversation{n === 1 ? '' : 's'}
          <span className="why">
            Email · {shortDate(run.startedAt)}
            {run.provider ? ` · ${run.provider}` : ''}
            {run.finishedAt == null ? ' · reading…' : run.complete ? '' : ' · stopped early'}
          </span>
        </div>
        <span style={{ fontSize: 'var(--fs-sm)' }} className="muted">
          {failed > 0 && <span style={{ color: 'var(--danger)' }}>{failed} failed · </span>}
          {pending > 0 ? (
            <button className="btn ghost" style={{ padding: '0 6px', color: 'var(--accent)' }} onClick={() => go('review')}>
              {pending} to review
            </button>
          ) : (
            `${total} suggestion${total === 1 ? '' : 's'}`
          )}
          <CostNote cost={cost} what="every conversation in this import (each one's latest run)" />
        </span>
        <button className="btn ghost" onClick={onToggle}>
          {open ? 'Hide conversations' : 'Conversations'}
        </button>
      </div>
      {open && run.conversations.map((s) => <SourceRow key={s.id} s={s} busy={busy} rerun={rerun} nested />)}
    </>
  )
}

function SourceRow({ s, busy, rerun, nested }: { s: SourceItem; busy: boolean; rerun: (id: number) => void; nested?: boolean }) {
  const mailApp = useMailApp()
  const { go, toast, refresh, openAiLog } = useApp()
  const [renaming, setRenaming] = useState<string | null>(null)
  const saveName = () => {
    if (renaming == null) return
    if (!renaming.trim() || renaming.trim() === s.title) return setRenaming(null)
    void cos['sources.rename'](s.id, renaming)
      .then(() => {
        setRenaming(null)
        refresh()
      })
      .catch((err) => toast(errorMessage(err), true))
  }
  return (
    <div className="r src-row" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto auto auto auto auto', paddingLeft: nested ? 32 : 12, cursor: 'default', background: nested ? 'var(--bg)' : undefined }}>
      <div className="ttl">
        {renaming != null ? (
          <input
            className="inp"
            aria-label="Import name"
            autoFocus
            value={renaming}
            onChange={(e) => setRenaming(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveName()
              else if (e.key === 'Escape') setRenaming(null)
            }}
          />
        ) : (
          <>
            {s.title}
            {!s.fromOutlook && (
              <button className="rename-btn" title="Rename" aria-label="Rename" onClick={() => setRenaming(s.title)}>
                ✎
              </button>
            )}
          </>
        )}
        <span className="why">
          {SOURCE_KIND_LABELS[s.kind]} · {shortDate(s.occurredAt)}
          {s.fromName ? ` · ${s.fromName}` : ''}
        </span>
      </div>
      <span style={{ fontSize: 'var(--fs-sm)' }} className={s.extractError ? '' : 'muted'}>
        {s.extractError ? (
          <span style={{ color: 'var(--danger)' }} title={s.extractError}>
            Failed
          </span>
        ) : s.pendingCount > 0 ? (
          <button className="btn ghost" style={{ padding: '0 6px', color: 'var(--accent)' }} onClick={() => go('review')}>
            {s.pendingCount} to review
          </button>
        ) : s.extractedAt ? (
          `${s.totalSuggestions} suggestion${s.totalSuggestions === 1 ? '' : 's'} · ${s.extractedBy}`
        ) : (
          'Not read yet'
        )}
        <CostNote cost={s.estimatedCost} what="this import's latest AI run" />
      </span>
      {s.fromOutlook ? (
        <button className="btn ghost" title={`Show this conversation's newest message in ${mailAppName(mailApp)}`} onClick={() => void cos['mail.open'](s.id).catch((err) => toast(errorMessage(err), true))}>
          Open in {mailAppName(mailApp)}
        </button>
      ) : (
        <span />
      )}
      <button className="btn ghost" title="See exactly what was sent to the AI and what came back" onClick={() => openAiLog(s.id, 'import')}>
        AI log
      </button>
      <button className="btn ghost" disabled={busy} title="Ask the AI to read it again" onClick={() => void rerun(s.id)}>
        Run again
      </button>
      <ConfirmButton
        label="Delete"
        confirmLabel="Delete import?"
        onConfirm={() =>
          void cos['sources.delete'](s.id).then(() => {
            toast(s.fromOutlook ? `Import deleted. Tasks created from it are kept, and the email stays in ${mailAppName(mailApp)}.` : 'Import deleted. Tasks created from it are kept.')
            refresh()
          })
        }
      />
    </div>
  )
}
