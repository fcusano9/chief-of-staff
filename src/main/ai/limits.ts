/**
 * Limits the app enforces on AI answers. The prompts in prompts.ts quote these numbers, so the
 * AI is told the same limit the code applies. Change a limit here, not in the prompt text.
 */

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
