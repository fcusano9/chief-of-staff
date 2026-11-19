import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MailAccount, MailApp } from '@shared/types'
import { REPLY_LATER_EMAILS } from '../ai/limits'
import { emailsAfter, includesPerson, isAutomatic, peopleOn, replyTarget, type ReplyPerson } from './plan'
import script from './outlook.ps1?raw'

/** One message as outlook.ps1 reports it. */
export interface OutlookMessage {
  entryId: string
  storeId: string
  messageId: string
  conversationId: string
  topic: string
  subject: string
  messageClass: string
  isMail: boolean
  direction: 'received' | 'sent'
  folder: string
  from: string
  fromEmail: string
  to: string
  cc: string
  /** ISO time it was received (or sent, for Sent Items). */
  time: string
  listUnsubscribe: boolean
  listId: string
  precedence: string
  autoSubmitted: string
  body: string
}

export interface OutlookMailbox {
  me: { name: string; addresses: string[] }
  messages: OutlookMessage[]
}

/** Who a reply would go to: names and addresses as Outlook shows them, separated by semicolons. */
export interface ReplyRecipients {
  subject: string
  reply: { to: string; cc: string }
  replyAll: { to: string; cc: string }
}

/** One email's text, as the mail app gives it for a draft reply. */
export interface MailText {
  entryId: string
  /** The user sent it (a follow-up, when they're waiting on someone). */
  fromMe: boolean
  from: string
  to: string
  cc: string
  subject: string
  /** ISO time it was sent. */
  time: string
  /** The whole body, quoted history included. */
  body: string
}

/** The email a draft reply answers (`replyTarget` in plan.ts), as the mail app threads the conversation. */
export interface LatestMessage extends MailText {
  storeId: string
  /** The emails after it that aren't automatic (a side discussion without that person), oldest first, for the AI to read. */
  after: MailText[]
}

/** What latest() looks for. */
export interface ReplyFind {
  /** The person the task is with: the reply goes on the newest email that includes them. */
  person?: ReplyPerson | null
  /** When the app first read mail in the conversation (ISO), so Apple Mail, which searches by date, looks back far enough. */
  since?: string | null
}

/**
 * Where mail comes from: classic Outlook on Windows, Apple Mail on the Mac (applemail.ts), or a
 * fixture file in tests. The message shapes are Outlook's; Apple Mail's are converted to them.
 */
export interface OutlookReader {
  /** Which mail app this is, for the words on screen ("Check Outlook", "Open in Mail"). */
  readonly app: MailApp
  /** The mailbox's email addresses, shown on the Import card. Empty when unknown. */
  addresses(): Promise<string[]>
  /** Apple Mail only: every account in Mail, for Settings. */
  accounts?(refresh?: boolean): Promise<MailAccount[]>
  /** Fills in message text that list() left out (Apple Mail reads it only for what the AI reads). */
  fillBodies?(messages: OutlookMessage[]): Promise<void>
  /** Received mail (Inbox and subfolders) and sent mail since `since`. */
  list(since: Date): Promise<OutlookMailbox>
  /** Shows one message in Outlook. */
  open(entryId: string, storeId: string): Promise<void>
  /**
   * The email a draft reply answers, in the conversation this message belongs to: the newest one,
   * sent or received, that includes `find.person` and isn't automatic (`replyTarget`). Drafts don't count.
   */
  latest(entryId: string, storeId: string, find?: ReplyFind): Promise<LatestMessage>
  /** Who Reply and Reply all would go to. Nothing is saved. */
  recipients(entryId: string, storeId: string): Promise<ReplyRecipients>
  /** Saves a reply (text above the quoted thread) to Outlook Drafts. Never sends. Returns the draft's ids. */
  saveReply(entryId: string, storeId: string, replyAll: boolean, body: string): Promise<{ entryId: string; storeId: string }>
  /** Opens a reply window (text above the quoted thread) for the user to finish. Never saves or sends. */
  openReply(entryId: string, storeId: string, replyAll: boolean, body: string): Promise<void>
}

/** Errors with a message that is safe to show as-is, like "Outlook isn't running". */
export class OutlookError extends Error {}

/**
 * Reads classic Outlook on Windows through its COM object model. Electron can't call COM, so a
 * PowerShell script (outlook.ps1, bundled as text) does the reading and writes JSON to a file.
 */
export class PowerShellOutlook implements OutlookReader {
  readonly app = 'outlook' as const

  async addresses(): Promise<string[]> {
    const r = await this.run(['-Action', 'me'])
    return firstAddress(asArray(r.addresses as string[] | string | null))
  }

  async list(since: Date): Promise<OutlookMailbox> {
    const result = (await this.run(['-Action', 'list', '-Since', since.toISOString()])) as Partial<OutlookMailbox>
    return { me: { name: result.me?.name ?? '', addresses: asArray(result.me?.addresses) }, messages: asArray(result.messages) }
  }

  async open(entryId: string, storeId: string): Promise<void> {
    await this.run(['-Action', 'open', '-EntryId', entryId, '-StoreId', storeId])
  }

  async latest(entryId: string, storeId: string, find?: ReplyFind): Promise<LatestMessage> {
    // -Person only with a value: PowerShell can drop an empty argument and read the next one as its value.
    const person = find?.person?.email.trim()
    const r = await this.run(['-Action', 'latest', '-EntryId', entryId, '-StoreId', storeId, '-Later', String(REPLY_LATER_EMAILS), ...(person ? ['-Person', person] : [])])
    const text = (x: Record<string, unknown>): MailText => {
      const str = (k: string) => String(x[k] ?? '')
      return { entryId: str('entryId'), fromMe: x.fromMe === true, from: str('from'), to: str('to'), cc: str('cc'), subject: str('subject'), time: str('time'), body: str('body') }
    }
    return { ...text(r), storeId: String(r.storeId ?? ''), after: asArray(r.after as Record<string, unknown>[] | Record<string, unknown> | null).map(text) }
  }

  async recipients(entryId: string, storeId: string): Promise<ReplyRecipients> {
    const r = (await this.run(['-Action', 'recipients', '-EntryId', entryId, '-StoreId', storeId])) as Partial<ReplyRecipients>
    const pair = (p?: { to?: string; cc?: string }) => ({ to: String(p?.to ?? ''), cc: String(p?.cc ?? '') })
    return { subject: String(r.subject ?? ''), reply: pair(r.reply), replyAll: pair(r.replyAll) }
  }

  async saveReply(entryId: string, storeId: string, replyAll: boolean, body: string): Promise<{ entryId: string; storeId: string }> {
    const r = await this.reply(entryId, storeId, replyAll, body, false)
    return { entryId: String(r.entryId ?? ''), storeId: String(r.storeId ?? '') }
  }

  async openReply(entryId: string, storeId: string, replyAll: boolean, body: string): Promise<void> {
    await this.reply(entryId, storeId, replyAll, body, true)
  }

  private async reply(entryId: string, storeId: string, replyAll: boolean, body: string, open: boolean): Promise<Record<string, unknown>> {
    const bodyPath = join(tmpdir(), `cos-outlook-${randomUUID()}.txt`)
    writeFileSync(bodyPath, body.replace(/\r?\n/g, '\r\n'), 'utf8')
    try {
      return await this.run(['-Action', 'reply', '-EntryId', entryId, '-StoreId', storeId, '-BodyFile', bodyPath, ...(replyAll ? ['-ReplyAll'] : []), ...(open ? ['-Open'] : [])])
    } finally {
      rmSync(bodyPath, { force: true })
    }
  }

  private run(args: string[]): Promise<Record<string, unknown>> {
    return runOutlookScript(args)
  }
}

/** Runs outlook.ps1 with these arguments and returns its JSON result, or throws an OutlookError that's safe to show. */
export async function runOutlookScript(args: string[]): Promise<Record<string, unknown>> {
  const id = randomUUID()
  const scriptPath = join(tmpdir(), `cos-outlook-${id}.ps1`)
  const outPath = join(tmpdir(), `cos-outlook-${id}.json`)
  // A BOM makes Windows PowerShell 5.1 read the script as UTF-8.
  writeFileSync(scriptPath, `﻿${script}`, 'utf8')
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args, '-OutFile', outPath],
        { windowsHide: true, timeout: 10 * 60_000 },
        (err, _stdout, stderr) => (err ? reject(new OutlookError(`Couldn't run the Outlook reader: ${stderr.trim() || err.message}`)) : resolve()),
      )
    })
    let result: Record<string, unknown>
    try {
      result = JSON.parse(readFileSync(outPath, 'utf8').replace(/^﻿/, '')) as Record<string, unknown>
    } catch {
      throw new OutlookError("The Outlook reader didn't return a result.")
    }
    if (!result.ok) throw new OutlookError(String(result.error ?? 'Outlook could not be read.'))
    return result
  } finally {
    rmSync(scriptPath, { force: true })
    rmSync(outPath, { force: true })
  }
}

/**
 * Test data instead of Outlook (COS_OUTLOOK_FIXTURE, only for test data folders). Opening does
 * nothing; latest() picks from the messages with the same conversationId (`replyTarget`); recipients come from the
 * fixture message (for the user's own message, its To and Cc); saved replies are kept in `saved` (and, in
 * the app, written next to the fixture as <fixture>.drafts.json so e2e can check them).
 */
export class FixtureOutlook implements OutlookReader {
  readonly saved: { entryId: string; storeId: string; replyAll: boolean; body: string; draftId: string; opened?: boolean }[] = []

  constructor(
    private readonly path: string,
    private readonly draftsPath: string | null = null,
    readonly app: MailApp = 'outlook',
  ) {}

  async addresses(): Promise<string[]> {
    return firstAddress(this.box().me.addresses)
  }

  async accounts(): Promise<MailAccount[]> {
    if (this.app !== 'apple-mail') return []
    return [{ id: 'fixture-account', name: 'Work', type: 'unknown', enabled: true, addresses: this.box().me.addresses }]
  }

  async list(since: Date): Promise<OutlookMailbox> {
    const box = this.box()
    return { me: box.me, messages: box.messages.filter((m) => Date.parse(m.time) >= since.getTime()) }
  }

  async open(): Promise<void> {}

  async latest(entryId: string, _storeId?: string, find?: ReplyFind): Promise<LatestMessage> {
    const box = this.box()
    const m = box.messages.find((x) => x.entryId === entryId)
    if (!m) throw new OutlookError('That email is not in Outlook.')
    const mine = new Set(box.me.addresses.map((a) => a.toLowerCase()))
    const conversation = box.messages.filter((x) => x.isMail && x.conversationId === m.conversationId)
    const person = find?.person
    const pick = replyTarget(conversation, isAutomatic, person ? (x) => includesPerson(peopleOn(x), person) : undefined) ?? m
    const text = (x: OutlookMessage): MailText => ({
      entryId: x.entryId, fromMe: x.direction === 'sent' || mine.has(x.fromEmail.toLowerCase()), from: x.from, to: x.to, cc: x.cc, subject: x.subject, time: x.time, body: x.body,
    })
    return { ...text(pick), storeId: pick.storeId, after: emailsAfter(conversation, pick, isAutomatic).map(text) }
  }

  async recipients(entryId: string, _storeId?: string): Promise<ReplyRecipients> {
    const box = this.box()
    const m = box.messages.find((x) => x.entryId === entryId)
    if (!m) throw new OutlookError('That email is not in Outlook.')
    const mine = new Set(box.me.addresses.map((a) => a.toLowerCase()))
    const others = (list: string) => list.split(';').map((s) => s.trim()).filter((s) => s && !mine.has(s.toLowerCase()) && s !== box.me.name)
    const subject = /^re:/i.test(m.subject) ? m.subject : `RE: ${m.subject}`
    if (m.direction === 'sent' || mine.has(m.fromEmail.toLowerCase())) {
      return { subject, reply: { to: others(m.to).join('; '), cc: '' }, replyAll: { to: others(m.to).join('; '), cc: others(m.cc).join('; ') } }
    }
    return { subject, reply: { to: m.from, cc: '' }, replyAll: { to: [m.from, ...others(m.to)].join('; '), cc: others(m.cc).join('; ') } }
  }

  async saveReply(entryId: string, storeId: string, replyAll: boolean, body: string): Promise<{ entryId: string; storeId: string }> {
    const draftId = `draft-${this.saved.length + 1}`
    this.saved.push({ entryId, storeId, replyAll, body, draftId })
    if (this.draftsPath) writeFileSync(this.draftsPath, JSON.stringify(this.saved, null, 2), 'utf8')
    return { entryId: draftId, storeId: 'fixture-store' }
  }

  async openReply(entryId: string, storeId: string, replyAll: boolean, body: string): Promise<void> {
    this.saved.push({ entryId, storeId, replyAll, body, draftId: '', opened: true })
    if (this.draftsPath) writeFileSync(this.draftsPath, JSON.stringify(this.saved, null, 2), 'utf8')
  }

  private box(): OutlookMailbox {
    return JSON.parse(readFileSync(this.path, 'utf8')) as OutlookMailbox
  }
}

/** The first real email address (Outlook can also list an Exchange "/o=…" address), or none. */
function firstAddress(list: string[]): string[] {
  const real = list.map((a) => a.trim()).filter((a) => a.includes('@'))
  return real.length ? [real[0]!] : []
}

/** PowerShell 5.1 turns a one-item array into a lone object, and an empty one into null. */
function asArray<T>(value: T[] | T | null | undefined): T[] {
  return value == null ? [] : Array.isArray(value) ? value : [value]
}
