// Updates: the dated notes kept for every project, person and task (their context brief's summary),
// one per line, oldest first. Review adds 'Nov 2, 2026: text (from “Import title”)'; notes added
// by hand have no source; lines without a date are kept whole.

export interface Note {
  date: string
  text: string
  source: string | null
}

/** The date stamp updates use: "Nov 3, 2026". */
export const noteStamp = (d: Date = new Date()): string => d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

/** Splits one line into its date, text and source; other lines are kept whole. */
export function parseNote(line: string): Note {
  const m = line.match(/^([A-Z][a-z]{2,8}\.? \d{1,2}, \d{4}): ([\s\S]*?)(?: \(from “(.*)”\))?$/)
  return m ? { date: m[1]!, text: m[2]!, source: m[3] ?? null } : { date: '', text: line, source: null }
}

/** The non-empty lines of an updates text, oldest first. */
export const noteLines = (summary: string): string[] =>
  summary
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

/** The newest update, or null when there are none. */
export function latestNote(summary: string): Note | null {
  const lines = noteLines(summary)
  return lines.length ? parseNote(lines[lines.length - 1]!) : null
}

/**
 * The newest updates that fit in `max` characters, newest first, as 'Nov 3, 2026: text' (sources
 * left out, to save room). Only whole updates: it stops at the first one that doesn't fit, so
 * nothing is cut mid-sentence. The one exception is a newest update longer than `max` on its own,
 * which is shortened at the end so the AI still sees something.
 */
export function recentNotes(summary: string, max: number): string[] {
  const out: string[] = []
  let used = 0
  for (const line of noteLines(summary).reverse()) {
    const n = parseNote(line)
    const text = (n.date ? `${n.date}: ${n.text}` : n.text).replace(/\s+/g, ' ').trim()
    const cost = text.length + (out.length ? 3 : 0) // ' | ' between updates
    if (used + cost > max) {
      if (!out.length) out.push(`${text.slice(0, max - 1)}…`)
      break
    }
    out.push(text)
    used += cost
  }
  return out
}

