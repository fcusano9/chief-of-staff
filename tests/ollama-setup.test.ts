import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OllamaManager, readJsonLines, type OllamaHost } from '../src/main/services/ollama-setup'

let folder: string
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'cos-ollama-'))
})
afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(folder, { recursive: true, force: true })
})

function host(over: Partial<OllamaHost> = {}): OllamaHost & { launched: string[][] } {
  const launched: string[][] = []
  return { platform: 'win32', tempFolder: folder, env: {}, exists: () => false, launch: (f, a) => void launched.push([f, ...a]), exec: async () => '', launched, ...over }
}

/** A fake Ollama (and ollama.com) answering by path. */
function fakeFetch(reply: (path: string, init?: RequestInit) => Response | Error) {
  const sent: { path: string; method: string; body: unknown }[] = []
  vi.stubGlobal('fetch', async (url: URL | string, init?: RequestInit) => {
    const u = new URL(String(url))
    sent.push({ path: u.pathname, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const r = reply(u.pathname, init)
    if (r instanceof Error) throw r
    return r
  })
  return sent
}
const json = (body: unknown) => new Response(JSON.stringify(body))
const lines = (...objs: unknown[]) => new Response(objs.map((o) => JSON.stringify(o)).join('\n') + '\n')

describe('Ollama setup', () => {
  const local = () => 'http://127.0.0.1:11434'

  it('finds an installed Ollama on Windows and Mac', () => {
    const win = new OllamaManager(local, host({ env: { LOCALAPPDATA: 'C:\\Users\\f\\AppData\\Local' }, exists: (p) => p.endsWith('ollama.exe') }))
    expect(win.findInstall().cli).toMatch(/Programs[\\/]Ollama[\\/]ollama\.exe$/)
    const mac = new OllamaManager(local, host({ platform: 'darwin', env: {}, exists: (p) => p === '/opt/homebrew/bin/ollama' }))
    expect(mac.findInstall()).toEqual({ app: null, cli: '/opt/homebrew/bin/ollama' })
  })

  it('reports missing, stopped and ready', async () => {
    fakeFetch(() => new TypeError('fetch failed'))
    expect((await new OllamaManager(local, host()).status()).state).toBe('missing')
    expect((await new OllamaManager(local, host({ env: { PATH: '/bin' }, platform: 'linux', exists: (p) => p === '/bin/ollama' })).status()).state).toBe('stopped')
    const remote = await new OllamaManager(() => 'http://10.0.0.5:11434', host()).status()
    expect(remote).toMatchObject({ state: 'stopped', remote: true, canInstall: false })
    fakeFetch(() => json({ models: [{ name: 'qwen3:8b', size: 5 }, { name: 'gpt-oss:20b', size: 13 }] }))
    expect(await new OllamaManager(local, host()).status()).toMatchObject({
      state: 'ready',
      models: [
        { name: 'gpt-oss:20b', sizeBytes: 13 },
        { name: 'qwen3:8b', sizeBytes: 5 },
      ],
    })
  })

  it('only downloads tested models, and adds up progress across layers', async () => {
    const m = new OllamaManager(local, host())
    await expect(m.pull('qwen3:8b')).rejects.toThrow(/hasn't been tested/)
    const sent = fakeFetch((path) =>
      path === '/api/pull'
        ? lines({ status: 'pulling manifest' }, { status: 'pulling a', digest: 'a', total: 100, completed: 50 }, { status: 'pulling b', digest: 'b', total: 100 }, { status: 'success' })
        : json({ models: [] }),
    )
    await m.pull('gpt-oss:20b')
    await vi.waitFor(async () => expect((await m.status()).pulls).toEqual([]))
    expect(sent.find((s) => s.path === '/api/pull')).toMatchObject({ method: 'POST', body: { model: 'gpt-oss:20b' } })
  })

  it('keeps a failed download with its reason', async () => {
    fakeFetch((path) => (path === '/api/pull' ? lines({ status: 'pulling a', digest: 'a', total: 100, completed: 10 }, { error: 'disk full' }) : json({ models: [] })))
    const m = new OllamaManager(local, host())
    await m.pull('gpt-oss:20b')
    await vi.waitFor(async () => expect((await m.status()).pulls).toEqual([{ name: 'gpt-oss:20b', percent: 10, error: 'disk full' }]))
  })

  it('deletes a model by name', async () => {
    const sent = fakeFetch(() => json({ models: [] }))
    await new OllamaManager(local, host()).delete('qwen3:8b')
    expect(sent[0]).toMatchObject({ path: '/api/delete', method: 'DELETE', body: { model: 'qwen3:8b' } })
  })

  it("won't install for another machine", async () => {
    fakeFetch(() => new TypeError('fetch failed'))
    await expect(new OllamaManager(() => 'http://10.0.0.5:11434', host()).startInstall()).rejects.toThrow(/another machine/)
  })

  it('runs the Windows installer only when it is validly signed', async () => {
    fakeFetch((path) => (path === '/download/OllamaSetup.exe' ? new Response('installer bytes') : new TypeError('fetch failed')))
    const unsigned = host({ exec: async () => 'NotSigned\r\n' })
    const m1 = new OllamaManager(local, unsigned)
    await m1.startInstall()
    await vi.waitFor(async () => expect((await m1.status()).install).toMatchObject({ phase: 'failed', error: expect.stringMatching(/isn't validly signed/) }))
    expect(unsigned.launched).toEqual([])

    const signed = host({ exec: async () => 'Valid\r\n' })
    const m2 = new OllamaManager(local, signed)
    await m2.startInstall()
    await vi.waitFor(async () => expect((await m2.status()).install).toMatchObject({ phase: 'installing' }))
    expect(signed.launched).toEqual([[join(folder, 'ollama-installer', 'OllamaSetup.exe')]])
  })

  it('reads streamed JSON lines split across chunks', async () => {
    const enc = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('{"a":1}\n{"a"'))
        c.enqueue(enc.encode(':2}\n{"a":3}'))
        c.close()
      },
    })
    const got: unknown[] = []
    await readJsonLines(body, (l) => got.push(l))
    expect(got).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }])
  })
})
