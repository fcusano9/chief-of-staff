import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { ImportRequest, ImportResult, SourceItem, SourceKind } from '@shared/types'
import { buildExtractionContext } from '../ai/context'
import type { AiProvider } from '../ai/provider'
import { validateSuggestions } from '../ai/schema'
import { nowIso, transaction } from '../db'

/** Removes WEBVTT/SRT timing lines and cue numbers so transcripts read as plain text. */
export function cleanTranscript(text: string): string {
  if (!/^\s*WEBVTT/i.test(text) && !/^\s*\d+\s*\r?\n\d{2}:\d{2}:\d{2}[,.]\d{3} -->/.test(text)) return text
  return text
    .split(/\r?\n/)
    .filter((l) => !/^\s*WEBVTT/i.test(l) && !/-->/.test(l) && !/^\s*\d+\s*$/.test(l) && !/^\s*(NOTE|STYLE)\b/.test(l))
    .map((l) => l.replace(/<v ([^>]+)>/g, '$1: ').replace(/<\/?[^>]+>/g, '').trim())
    .filter(Boolean)
    .join('\n')
}

/** Hash of the content with whitespace normalized, so re-pasting the same text is caught. */
export const contentHash = (content: string) => createHash('sha256').update(content.replace(/\s+/g, ' ').trim().toLowerCase()).digest('hex')

const SOURCE_SELECT = `
  SELECT s.id, s.kind, s.title, s.from_name, s.occurred_at, s.imported_at, s.extracted_at, s.extracted_by, s.extract_error,
         LENGTH(s.content) AS length,
         (SELECT COUNT(*) FROM suggestions g WHERE g.source_id = s.id AND g.status = 'pending') AS pending_count,
         (SELECT COUNT(*) FROM suggestions g WHERE g.source_id = s.id) AS total_count
  FROM source_items s`

function toSource(r: Record<string, unknown>): SourceItem {
  return {
    id: Number(r.id),
    kind: r.kind as SourceKind,
    title: String(r.title),
    fromName: (r.from_name as string) ?? null,
    occurredAt: String(r.occurred_at),
    importedAt: String(r.imported_at),
    extractedAt: (r.extracted_at as string) ?? null,
    extractedBy: (r.extracted_by as string) ?? null,
    extractError: (r.extract_error as string) ?? null,
    length: Number(r.length),
    pendingCount: Number(r.pending_count),
    totalSuggestions: Number(r.total_count),
  }
}

/**
 * Imported material (pasted text, transcript files, later Outlook mail). Every source is kept
 * permanently for the knowledge archive; the AI turns it into suggestions for the review queue.
 */
export class SourceService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly provider: () => AiProvider,
    private readonly userName: () => string,
  ) {}

  list(limit = 30): SourceItem[] {
    return (this.db.prepare(`${SOURCE_SELECT} ORDER BY s.imported_at DESC, s.id DESC LIMIT ?`).all(limit) as Record<string, unknown>[]).map(toSource)
  }

  get(id: number): SourceItem | null {
    const row = this.db.prepare(`${SOURCE_SELECT} WHERE s.id = ?`).get(id) as Record<string, unknown> | undefined
    return row ? toSource(row) : null
  }

  /** Saves the source (skipping exact duplicates) and asks the AI for suggestions. */
  async importAndExtract(req: ImportRequest): Promise<ImportResult> {
    const content = cleanTranscript(req.content).trim()
    if (!content) throw new Error('There is nothing to import. Paste some text or choose a file.')
    const hash = contentHash(content)
    const existing = this.db.prepare('SELECT id FROM source_items WHERE content_hash = ?').get(hash) as { id: number } | undefined
    if (existing) return { source: this.get(Number(existing.id))!, duplicate: true, suggestionsCreated: 0, error: null }

    const occurredAt = req.occurredOn ? new Date(`${req.occurredOn}T12:00:00`).toISOString() : nowIso()
    const id = Number(
      this.db
        .prepare('INSERT INTO source_items (kind, title, from_name, occurred_at, content, content_hash, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(req.kind, req.title.trim() || defaultTitle(content), req.fromName?.trim() || null, occurredAt, content, hash, nowIso()).lastInsertRowid,
    )
    return this.extract(id)
  }

  /** Runs (or re-runs) extraction for a source. Pending suggestions from an earlier run are replaced. */
  async extract(sourceId: number): Promise<ImportResult> {
    const row = this.db.prepare('SELECT kind, title, from_name, occurred_at, content FROM source_items WHERE id = ?').get(sourceId) as Record<string, unknown> | undefined
    if (!row) throw new Error(`Source ${sourceId} not found`)
    const ctx = buildExtractionContext(this.db, this.userName())
    try {
      // Inside the try: a misconfigured provider (e.g. no API key) is reported on the source like any other failure.
      const provider = this.provider()
      const raw = await provider.extract(ctx, {
        kind: row.kind as SourceKind,
        title: String(row.title),
        fromName: (row.from_name as string) ?? null,
        occurredAt: String(row.occurred_at),
        content: String(row.content),
      })
      const drafts = validateSuggestions(raw, ctx)
      const now = nowIso()
      transaction(this.db, () => {
        this.db.prepare(`DELETE FROM suggestions WHERE source_id = ? AND status = 'pending'`).run(sourceId)
        const insert = this.db.prepare('INSERT INTO suggestions (source_id, kind, payload, evidence, created_at) VALUES (?, ?, ?, ?, ?)')
        for (const d of drafts) insert.run(sourceId, d.kind, JSON.stringify(d.payload), d.evidence, now)
        this.db.prepare('UPDATE source_items SET extracted_at = ?, extracted_by = ?, extract_error = NULL WHERE id = ?').run(now, provider.label, sourceId)
      })
      return { source: this.get(sourceId)!, duplicate: false, suggestionsCreated: drafts.length, error: null }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.db.prepare('UPDATE source_items SET extract_error = ? WHERE id = ?').run(message, sourceId)
      return { source: this.get(sourceId)!, duplicate: false, suggestionsCreated: 0, error: message }
    }
  }

  /** Deletes a source and its pending suggestions. Tasks created from it are kept. */
  delete(id: number): void {
    this.db.prepare('DELETE FROM source_items WHERE id = ?').run(id)
  }
}

function defaultTitle(content: string): string {
  const first = content.split(/\r?\n/).find((l) => l.trim())?.trim() ?? 'Imported text'
  return first.length > 60 ? `${first.slice(0, 57)}…` : first
}
