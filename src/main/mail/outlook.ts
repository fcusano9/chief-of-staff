import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

/** Where mail comes from: classic Outlook, or a fixture file in tests. */
export interface OutlookReader {
  /** Received mail (Inbox and subfolders) and sent mail since `since`. */
  list(since: Date): Promise<OutlookMailbox>
  /** Shows one message in Outlook. */
  open(entryId: string, storeId: string): Promise<void>
}

/** Errors with a message that is safe to show as-is, like "Outlook isn't running". */
export class OutlookError extends Error {}

/**
 * Reads classic Outlook on Windows through its COM object model. Electron can't call COM, so a
 * PowerShell script (outlook.ps1, bundled as text) does the reading and writes JSON to a file.
 */
export class PowerShellOutlook implements OutlookReader {
  async list(since: Date): Promise<OutlookMailbox> {
    const result = (await this.run(['-Action', 'list', '-Since', since.toISOString()])) as Partial<OutlookMailbox>
    return { me: { name: result.me?.name ?? '', addresses: asArray(result.me?.addresses) }, messages: asArray(result.messages) }
  }

  async open(entryId: string, storeId: string): Promise<void> {
    await this.run(['-Action', 'open', '-EntryId', entryId, '-StoreId', storeId])
  }

  private async run(args: string[]): Promise<Record<string, unknown>> {
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
}

/** Test data instead of Outlook (COS_OUTLOOK_FIXTURE, only for test data folders). Opening does nothing. */
export class FixtureOutlook implements OutlookReader {
  constructor(private readonly path: string) {}

  async list(since: Date): Promise<OutlookMailbox> {
    const box = JSON.parse(readFileSync(this.path, 'utf8')) as OutlookMailbox
    return { me: box.me, messages: box.messages.filter((m) => Date.parse(m.time) >= since.getTime()) }
  }

  async open(): Promise<void> {}
}

/** PowerShell 5.1 turns a one-item array into a lone object, and an empty one into null. */
function asArray<T>(value: T[] | T | null | undefined): T[] {
  return value == null ? [] : Array.isArray(value) ? value : [value]
}
