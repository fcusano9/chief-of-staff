// Draft replies: the AI writes a reply to the email a task came from. The user sees it in the app,
// can edit it, and saves it to Outlook Drafts. Nothing is ever sent.
import { z } from 'zod'
import { REPLY_BODY_CHARS, REPLY_THREAD_CHARS } from './limits'
import { REPLY_ASK, REPLY_FIELDS, REPLY_NO_NOTE, replySystem } from './prompts'
import { AiError } from './provider'

export { REPLY_THREAD_CHARS }

export interface ReplyInput {
  userName: string
  /** 'YYYY-MM-DD'. */
  today: string
  /** The user's own note on how they write (Settings → AI). May be empty. */
  style: string
  subject: string
  /** Who sent the email being answered; for a follow-up, who the user's email went to. */
  from: string
  /** The newest email is the user's own ('YYYY-MM-DD' sent), unanswered: write a follow-up nudge, not an answer. */
  followUp: { to: string; sentAt: string } | null
  /** The conversation as the mail import saved it, oldest first. */
  thread: string
  task: { title: string; notes: string | null; updates: string[] }
  recipients: { reply: { to: string; cc: string }; replyAll: { to: string; cc: string } }
  /** Try again: the user's note on what should change, and the draft being replaced. */
  revision: { note: string; previous: string } | null
}

export const ReplySchema = z.object({
  reply_all: z.boolean().describe(REPLY_FIELDS.reply_all),
  body: z.string().describe(REPLY_FIELDS.body),
})
export type RawReply = z.infer<typeof ReplySchema>

const fence = (s: string) => s.replace(/<\/?(email_thread|task|style|revision|previous_draft)/gi, '[$1')

export function buildReplyPrompt(input: ReplyInput): { system: string; user: string } {
  const me = input.userName
  const first = me.split(/\s+/)[0] || me
  const system = replySystem({ me, first, from: input.from, followUp: input.followUp, hasStyle: !!input.style.trim(), revision: !!input.revision, today: input.today })
  const list = (items: string[]) => (items.length ? items.map((t) => `- ${t}`).join('\n') : '(none)')
  const thread = input.thread.length > REPLY_THREAD_CHARS ? `(older messages left out)\n${input.thread.slice(-REPLY_THREAD_CHARS)}` : input.thread
  const user = `<email_thread>
Subject: ${fence(input.subject)}
${fence(thread)}
</email_thread>

Reply would go to: ${fence(input.recipients.reply.to) || '(the sender)'}
Reply all would go to: ${fence(input.recipients.replyAll.to) || '(the sender)'}${input.recipients.replyAll.cc ? `, cc ${fence(input.recipients.replyAll.cc)}` : ''}

<task>
Task: ${fence(input.task.title)}
Notes: ${input.task.notes ? fence(input.task.notes) : '(none)'}
Updates, newest first:
${fence(list(input.task.updates))}
</task>
${input.style.trim() ? `\n<style>\n${fence(input.style.trim())}\n</style>\n` : ''}${
    input.revision
      ? `\n<previous_draft>\n${fence(input.revision.previous)}\n</previous_draft>\n\n<revision>\n${fence(input.revision.note.trim() || REPLY_NO_NOTE)}\n</revision>\n`
      : ''
  }
${REPLY_ASK}`
  return { system, user }
}

/** Tidies the draft (trims, collapses runs of blank lines) and refuses an empty one. */
export function cleanReply(raw: RawReply): { replyAll: boolean; body: string } {
  const body = raw.body
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, REPLY_BODY_CHARS)
  if (!body) throw new AiError("The AI didn't write a reply. Try again.")
  return { replyAll: raw.reply_all === true, body }
}
