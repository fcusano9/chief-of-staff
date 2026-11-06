/*
 * Every limit on what the AI is sent and what it may answer, in one place. The wording itself is
 * in prompts.ts.
 *
 * Changing a number here changes the app's behavior directly: the code enforces these limits, and
 * where a prompt mentions one (for example "up to 3 items"), the prompt quotes the same constant,
 * so the two can't disagree. After a change, run `npx vitest run -u` to update the saved copy of
 * every request (tests/__snapshots__/prompts.test.ts.snap) and check the diff, and update
 * docs/AI-RULES.md, which lists these limits for review.
 */

/* ═══ What the AI may answer ════════════════════════════════════════════════════════════════ */

/** Daily briefing: the fewest top priorities the AI is asked for (a quiet day can have fewer). */
export const MIN_PRIORITIES = 3

/** Daily briefing: at most this many top priorities, unless more than this are overdue (every overdue task is shown). */
export const MAX_PRIORITIES = 5

/** Daily briefing: at most this many waiting-on items to follow up on. */
export const MAX_NUDGES = 3

/** Daily briefing: at most this many items new since the last briefing (plus a Review line). */
export const MAX_NEW = 8

/** Weekly reflection: points per list (Went well, Slipped, Focus next). */
export const MAX_POINTS = 3

/** "Where this stands" cards (task and project cards, imports, daily briefing): at most this many bullets. */
export const MAX_STATUS_BULLETS = 3

/** Imports and daily briefings: the most the AI may move a task's priority score, up or down. */
export const MAX_AI_ADJUSTMENT = 15

/**
 * Claude only: the most each request may write, in tokens (roughly ¾ of a word each). A request
 * that hits it fails with "cut off" instead of saving half an answer. A higher value costs
 * nothing extra unless it's used.
 */
export const CLAUDE_MAX_TOKENS = {
  import: 16000,
  personBrief: 4000,
  statusCard: 6000,
  briefing: 8000,
  weekly: 8000,
}

/* ═══ How much the AI is sent ═══════════════════════════════════════════════════════════════ */

/**
 * Imports and daily briefings: characters of each task's latest updates sent (whole updates only,
 * newest first; see recentNotes). Imports also send this much of a person's updates when they
 * have no one-line brief.
 */
export const UPDATES_FOR_AI = 300

/** Imports: characters of a project's latest updates sent (whole updates only). */
export const PROJECT_UPDATES_FOR_AI = 400

/** Imports: each project's and person's descriptions are cut to this many characters. */
export const IMPORT_TEXT_CHARS = {
  overview: 300,
  projectStatus: 500,
  instructions: 200,
  personBrief: 300,
}

/** Daily briefing: open tasks sent for it to pick priorities from, highest priority first (overdue ones always go, even past this). */
export const BRIEFING_TASKS_SENT = 25

/** Daily briefing: waiting-on items sent. */
export const BRIEFING_WAITING_SENT = 20

/** Daily briefing: characters of each task's Notes sent. */
export const BRIEFING_NOTES_CHARS = 300

/** Weekly reflection: items per list sent (the counts are always exact; the rest is "and N more"). */
export const WEEKLY_ITEMS_SENT = 40

/** "Where this stands" on Write: characters of the item's Updates sent (whole updates only, newest first). */
export const STATUS_UPDATES_CHARS = 1500

/** "Where this stands" on Write: a task's newest Activity lines sent. */
export const STATUS_ACTIVITY_LINES = 20

/** "Where this stands" on Write: characters of a task's Notes sent. */
export const STATUS_NOTES_CHARS = 1000

/** Outlook mail: characters sent per message, of earlier messages quoted in the newest one, and per conversation in all. */
export const MAIL_CHARS = {
  message: 8000,
  quoted: 4000,
  total: 40000,
}

/* ═══ Local model (Ollama) ═══════════════════════════════════════════════════════════════════ */

/**
 * The local model's working memory per request, in tokens. Ollama's default is small and it
 * silently drops the start of longer prompts, so the app sizes it to fit, between these bounds.
 * An item too long for the maximum is refused with a message rather than cut.
 */
export const LOCAL_CONTEXT = {
  min: 8192,
  max: 65536,
}

/** Room left after the prompt for the local model's thinking and answer, in tokens. More reasoning needs more room. */
export const LOCAL_OUTPUT_HEADROOM = {
  low: 4096,
  medium: 12288,
  high: 20480,
}

/** A local model on a laptop can be slow on long transcripts; give up on one request after this many milliseconds (6 minutes). */
export const LOCAL_TIMEOUT_MS = 6 * 60_000
