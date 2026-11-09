import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { calendar } from '../src/main/ai/context'
import { DemoProvider } from '../src/main/ai/demo'
import type { AiProvider } from '../src/main/ai/provider'
import type { RawExtraction } from '../src/main/ai/schema'
import { openDatabase } from '../src/main/db'
import { CopilotService, localStamp, markerLine, parseMarker } from '../src/main/services/copilot'
import { detectKind, SourceService } from '../src/main/services/sources'

/** Basic, but answering with a name and type for the item, as Claude and Ollama do. */
class Namer extends DemoProvider {
  answer: Partial<RawExtraction> = { item_title: 'Dealer pricing sync, Nov 6', item_kind: 'meeting_transcript' }
  override async extract(...args: Parameters<DemoProvider['extract']>) {
    return { ...(await super.extract(...args)), ...this.answer }
  }
}

describe('import naming, rename and Copilot coverage', () => {
  let folder: string
  let db: DatabaseSync
  let namer: Namer
  let sources: SourceService

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'cos-naming-'))
    db = openDatabase(join(folder, 'test.db'))
    namer = new Namer()
    sources = new SourceService(db, () => namer as AiProvider, () => 'Frank Cusano')
  })
  afterEach(() => {
    db.close()
    rmSync(folder, { recursive: true, force: true })
  })

  it('takes the AI\'s name and type for an import the user didn\'t name, until it\'s renamed', async () => {
    const r = await sources.importAndExtract({ content: 'Dana: can we lock tier 2 pricing?\nFrank: yes, by Friday.' })
    expect(r.source).toMatchObject({ title: 'Dealer pricing sync, Nov 6', kind: 'meeting_transcript' })

    expect(sources.rename(r.source.id, '  My   pricing notes ').title).toBe('My pricing notes')
    namer.answer = { item_title: 'Something else', item_kind: 'note' }
    expect((await sources.extract(r.source.id)).source).toMatchObject({ title: 'My pricing notes', kind: 'meeting_transcript' })
    expect(() => sources.rename(r.source.id, '  ')).toThrow('Give the import a name.')
  })

  it('keeps a name the user gave (a file name), and the first line with Basic', async () => {
    const named = await sources.importAndExtract({ content: 'Notes one', title: 'standup.txt', kind: 'note' })
    expect(named.source.title).toBe('standup.txt')
    namer.answer = {}
    const basic = await sources.importAndExtract({ content: 'Weekly sync notes\nNothing urgent.' })
    expect(basic.source).toMatchObject({ title: 'Weekly sync notes', kind: 'note' })
  })

  it('guesses the type before the AI looks', () => {
    expect(detectKind('WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHi')).toBe('meeting_transcript')
    expect(detectKind('00:01 Dana: hi\n00:02 Frank: hey\n00:03 Dana: so')).toBe('meeting_transcript')
    expect(detectKind('From: Dana Lee\nSent: Monday\nSubject: Pricing\n\nHi')).toBe('email')
    expect(detectKind('Just some notes')).toBe('note')
  })

  it('names, dates and records an answer to a Copilot prompt, so the next prompt starts where it ended', async () => {
    const copilot = new CopilotService(db, () => new Date(2026, 10, 9, 9, 30))
    expect(copilot.coverage()).toEqual({ chats: null, meetings: null })
    const first = copilot.prompt('chats')
    expect(first).toMatchObject({ kind: 'chats', from: '2026-11-02 09:30', to: '2026-11-09 09:30' })
    expect(first.text).toContain('Review my Microsoft Teams chats')
    expect(first.text).toContain('from 2026-11-02 09:30 to 2026-11-09 09:30 (my local time)')
    expect(first.text).toContain('Chief of Staff · Teams chats · 2026-11-02 09:30 to 2026-11-09 09:30')

    // Copilot added bold to the marker line; it's still found.
    const answer = `**${markerLine('chats', '2026-11-07 15:14', '2026-11-08 09:30')}**\n\n## Chat: Dana Lee (1:1)\nAsked of me: send the deck`
    const r = await sources.importAndExtract({ content: answer, occurredOn: '2026-11-09' })
    expect(r.source).toMatchObject({ title: 'Teams chats, Nov 7 – 8', kind: 'copilot_summary' })
    expect(new Date(r.source.occurredAt).getTime()).toBe(new Date(2026, 10, 8, 9, 30).getTime())

    expect(copilot.coverage().chats).toBe(new Date(2026, 10, 8, 9, 30).toISOString())
    expect(copilot.coverage().meetings).toBeNull()
    expect(copilot.prompt('chats').from).toBe('2026-11-08 09:30')
    expect(copilot.prompt('meetings').text).toContain('Chief of Staff · Teams meetings · 2026-11-02 09:30 to 2026-11-09 09:30')
    expect(copilot.prompt('chats', '2026-11-05 08:00').from).toBe('2026-11-05 08:00')
    expect(() => copilot.prompt('chats', '2026-11-10 08:00')).toThrow('Pick a start time before now.')

    // Importing the same answer again is a duplicate and records nothing new.
    await sources.importAndExtract({ content: answer })
    expect(Number((db.prepare('SELECT COUNT(*) AS n FROM copilot_coverage').get() as { n: number }).n)).toBe(1)
  })

  it('reads the marker line only when it really is one', () => {
    expect(parseMarker('Chief of Staff · Teams meetings · 2026-10-31 08:00 to 2026-11-07 17:00')!.title).toBe('Teams meetings, Oct 31 – Nov 7')
    expect(parseMarker('Chief of Staff - Teams chats - 2026-11-08 08:00 to 2026-11-08 17:00')!.title).toBe('Teams chats, Nov 8')
    expect(parseMarker('Chief of Staff · Teams chats · 2026-11-08 17:00 to 2026-11-08 08:00')).toBeNull()
    expect(parseMarker('Notes about Chief of Staff')).toBeNull()
    expect(localStamp(new Date(2026, 0, 2, 3, 4))).toBe('2026-01-02 03:04')
  })
})

describe('relative dates count from the item\'s date', () => {
  it('starts the calendar on an older item\'s date, and on today otherwise', () => {
    const older = calendar('2026-11-09', '2026-11-02')
    expect(older).toContain('Today is Monday 2026-11-09, but this item is from Monday 2026-11-02.')
    expect(older).toContain('Monday 2026-11-02 (item date)\nTuesday 2026-11-03')
    expect(older).toContain('Friday 2026-11-06')
    expect(older).toContain('Monday 2026-11-09 (today)')
    const current = calendar('2026-11-09', '2026-11-09')
    expect(current).toContain('Today is Monday 2026-11-09. Use this calendar')
    expect(current).toContain('Monday 2026-11-09 (today)\nTuesday 2026-11-10 (tomorrow)')
    expect(calendar('2026-11-09')).toBe(current)
  })
})
