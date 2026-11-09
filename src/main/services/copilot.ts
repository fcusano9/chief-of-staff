import type { DatabaseSync } from 'node:sqlite'
import type { CopilotCoverage, CopilotPrompt, CopilotPromptKind } from '@shared/types'

/**
 * The Copilot Prompt Generator (Import → Copilot Prompt Generator). Microsoft 365 Copilot can read
 * the user's Teams chats and meetings; the app can't yet. These prompts ask Copilot for exactly what
 * the import looks for, for an exact time span. Copilot is asked to start its answer with a marker
 * line ("Chief of Staff · Teams chats · <from> to <to>"); when that answer is imported, the span is
 * recorded (SourceService), and the next prompt starts where it ended, so nothing is pulled twice or
 * missed. A prompt that's copied but never imported records nothing.
 *
 * This file is the source of truth for the prompt text; docs/COPILOT-PROMPTS.md describes it.
 */

const LABELS: Record<CopilotPromptKind, string> = { chats: 'Teams chats', meetings: 'Teams meetings' }
const FIRST_RUN_DAYS = 7

const pad = (n: number) => String(n).padStart(2, '0')
/** "2026-11-07 15:14", local time: how prompts and the marker line write times. */
export const localStamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
/** The Date for a local "YYYY-MM-DD HH:MM" (or "YYYY-MM-DDTHH:MM"), or null. */
export function parseStamp(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]))
  return Number.isNaN(d.getTime()) ? null : d
}

/** The marker line Copilot is asked to start its answer with. */
export const markerLine = (kind: CopilotPromptKind, from: string, to: string) => `Chief of Staff · ${LABELS[kind]} · ${from} to ${to}`

export interface CopilotMarker {
  kind: CopilotPromptKind
  from: Date
  to: Date
  /** The import's name, e.g. "Teams chats, Nov 7 – 8". */
  title: string
}

/**
 * Finds the marker line near the top of an imported text (Copilot may add bold, quotes or a dash
 * instead of the dot), or null when the text didn't come from a generated prompt.
 */
export function parseMarker(content: string): CopilotMarker | null {
  const head = content.split(/\r?\n/).filter((l) => l.trim()).slice(0, 5).join('\n')
  const m = /Chief of Staff\s*[·•|–-]\s*Teams (chats|meetings)\s*[·•|–-]\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})\s*(?:to|–|-)\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})/i.exec(head)
  if (!m) return null
  const from = parseStamp(m[2]!)
  const to = parseStamp(m[3]!)
  if (!from || !to || to <= from) return null
  const kind = m[1]!.toLowerCase() as CopilotPromptKind
  return { kind, from, to, title: `${LABELS[kind]}, ${spanLabel(from, to)}` }
}

/** "Nov 8", "Nov 7 – 8" or "Oct 31 – Nov 7". */
function spanLabel(from: Date, to: Date): string {
  const month = (d: Date) => d.toLocaleDateString('en-US', { month: 'short' })
  if (from.toDateString() === to.toDateString()) return `${month(to)} ${to.getDate()}`
  return from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear()
    ? `${month(from)} ${from.getDate()} – ${to.getDate()}`
    : `${month(from)} ${from.getDate()} – ${month(to)} ${to.getDate()}`
}

export class CopilotService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Where each prompt's last imported answer ended. */
  coverage(): CopilotCoverage {
    const last = (kind: CopilotPromptKind) =>
      (this.db.prepare('SELECT MAX(to_at) AS t FROM copilot_coverage WHERE prompt = ?').get(kind) as { t: string | null } | undefined)?.t ?? null
    return { chats: last('chats'), meetings: last('meetings') }
  }

  /** Records the span an imported answer covered. */
  record(marker: CopilotMarker, sourceId: number): void {
    this.db
      .prepare('INSERT INTO copilot_coverage (prompt, from_at, to_at, source_id, imported_at) VALUES (?, ?, ?, ?, ?)')
      .run(marker.kind, marker.from.toISOString(), marker.to.toISOString(), sourceId, this.now().toISOString())
  }

  /**
   * The prompt from `from` (local "YYYY-MM-DD HH:MM"; by default where the last imported answer
   * ended, or 7 days ago) to now.
   */
  prompt(kind: CopilotPromptKind, from?: string | null): CopilotPrompt {
    const now = this.now()
    const last = this.coverage()[kind]
    const chosen = from ? parseStamp(from) : null
    const start = chosen ?? (last ? new Date(last) : new Date(now.getTime() - FIRST_RUN_DAYS * 86_400_000))
    if (start >= now) throw new Error('Pick a start time before now.')
    const f = localStamp(start)
    const t = localStamp(now)
    return { kind, from: f, to: t, text: (kind === 'chats' ? chatsPrompt : meetingsPrompt)(f, t) }
  }
}

const opening = (what: string, kind: CopilotPromptKind, from: string, to: string) =>
  `${what} from ${from} to ${to} (my local time). Leave out anything outside that time. I will paste your answer into my task tracker, which uses AI to turn it into tasks, so follow the format below exactly.

Start your answer with this line, exactly as written:
${markerLine(kind, from, to)}`

/** Prompt 1: Teams chats. */
export const chatsPrompt = (from: string, to: string) => `${opening('Review my Microsoft Teams chats: 1:1 chats, group chats, and channel conversations where I posted or was @mentioned,', 'chats', from, to)}

Rules:
- Only report what is actually in the chats. Do not guess or fill gaps. If something is unclear, write "unclear".
- Use people's full names as they appear in Teams. Include role, company, or email only if Teams shows it.
- Write every date as YYYY-MM-DD (weekday). Convert relative dates like "Friday", "EOW", or "next week" using the date the message was sent.
- For every item, include a short exact quote from the chat in quotation marks, with who said it and the date.
- Say whether I already replied to or handled each item later in the chat.
- Skip small talk, thank-yous, and FYIs that need nothing from me.
- Plain text and bullets only, no tables.

For each chat that has something relevant, use this format:

## Chat: <chat name or participants> (1:1 / group / channel: <team> > <channel>)
Dates covered: <first message date> to <last message date>
Topic or project: <one line>

Asked of me (questions, requests, approvals, or decisions waiting on me):
- <what they need> — asked by <name> on <date> — deadline: <date or "none stated"> — I already answered: yes/no — "<quote>"

My commitments (things I said I would do):
- <what> — promised to <name> on <date> — by: <date or "none stated"> — "<quote>"

Waiting on others (things I asked for or that someone promised me and hasn't delivered):
- <what> — owed by <name> — asked/promised on <date> — expected by: <date or "none stated"> — "<quote>"

Done or resolved in this time:
- <what was finished or answered> — by <name> on <date> — "<quote>"

Decisions and context worth remembering (decisions, scope or timeline changes, who owns what, stakeholder preferences):
- <fact, written so it makes sense on its own months from now> — <date> — "<quote>"

People involved:
- <full name> — <role / company / email if shown> — <one line on their part in this chat>

Leave out any section that has nothing in it, and leave out chats with nothing in any section. At the end, list the names of chats you checked but skipped because nothing was actionable.`

/** Prompt 2: Teams meetings. */
export const meetingsPrompt = (from: string, to: string) => `${opening('Review my Microsoft Teams meetings, using the transcripts, recaps, and meeting chats you can access,', 'meetings', from, to)}

Rules:
- Only report what was actually said or written. Do not guess or fill gaps. If something is unclear, write "unclear".
- If a meeting has no transcript or recap available, say so and report only what the meeting chat or invite shows. Do not reconstruct the discussion.
- Use people's full names. Include role, company, or email only if it is shown.
- Write every date as YYYY-MM-DD (weekday). Convert relative dates like "by Friday" or "next sprint" using the meeting date.
- For every item, include a short exact quote from the transcript or chat in quotation marks, with who said it.
- Note when an item was already resolved during the meeting itself.
- Skip agenda housekeeping and small talk.
- Plain text and bullets only, no tables.

For each meeting, use this format:

## Meeting: <title> — <date> <start time>
Organizer: <name>
Attendees: <full names>
Source used: transcript / recap / meeting chat only / invite only
Topic or project: <one line>

Summary: <2–4 sentences on what was discussed and concluded>

Action items for me:
- <what I need to do> — asked by <name or "I volunteered"> — due: <date or "none stated"> — "<quote>"

Questions or decisions waiting on me (left unanswered in the meeting):
- <what they need from me> — from <name> — due: <date or "none stated"> — "<quote>"

Waiting on others (things others committed to that I depend on or asked for):
- <what> — owner <name> — due: <date or "none stated"> — "<quote>"

Done or resolved:
- <what was confirmed finished or settled> — "<quote>"

Decisions and context worth remembering (decisions, scope or timeline changes, who owns what, risks, stakeholder preferences):
- <fact, written so it makes sense on its own months from now> — "<quote>"

People involved:
- <full name> — <role / company / email if shown> — <one line on their part in this meeting>

Leave out any section that has nothing in it. At the end, list meetings you found but skipped because nothing was actionable, and meetings where no transcript or recap was available.`
