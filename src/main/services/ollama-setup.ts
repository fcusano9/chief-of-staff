import { execFile, spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { isTestedLocalModel, type OllamaSetupStatus } from '@shared/types'
import { isLoopbackUrl } from '../ai/ollama'

const run = promisify(execFile)

/** Official installers, from https://ollama.com/download. */
export const INSTALLER_URLS: Partial<Record<NodeJS.Platform, string>> = {
  win32: 'https://ollama.com/download/OllamaSetup.exe',
  darwin: 'https://ollama.com/download/Ollama.dmg',
}

/** What the manager needs from the computer. Tests replace these. */
export interface OllamaHost {
  platform: NodeJS.Platform
  /** A folder for the downloaded installer. */
  tempFolder: string
  env: NodeJS.ProcessEnv
  exists: (path: string) => boolean
  /** Starts a program and doesn't wait for it. */
  launch: (file: string, args: string[]) => void
  /** Runs a program to the end and returns its output; rejects if it fails. */
  exec: (file: string, args: string[]) => Promise<string>
}

export const nodeHost = (tempFolder: string): OllamaHost => ({
  platform: process.platform,
  tempFolder,
  env: process.env,
  exists: existsSync,
  launch: (file, args) => spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref(),
  exec: async (file, args) => (await run(file, args, { windowsHide: true, maxBuffer: 1 << 20 })).stdout,
})

type Install = NonNullable<OllamaSetupStatus['install']>
interface Pull {
  percent: number | null
  error: string | null
  abort: AbortController
  layers: Map<string, { total: number; completed: number }>
}

/**
 * Finds, installs and starts Ollama, and downloads or deletes its models. Everything runs only when
 * Frank clicks. Downloads are limited to models tested with this app (TESTED_LOCAL_MODELS).
 */
export class OllamaManager {
  private install: Install | null = null
  private installAbort: AbortController | null = null
  private readonly pulls = new Map<string, Pull>()

  constructor(
    private readonly url: () => string,
    private readonly host: OllamaHost,
  ) {}

  /** Where an installed Ollama is, if anywhere: the app (to start it) or the command-line program. */
  findInstall(): { app: string | null; cli: string | null } {
    const { platform, env, exists } = this.host
    const first = (paths: string[]) => paths.find((p) => exists(p)) ?? null
    const onPath = (name: string) => (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean).map((d) => join(d, name))
    if (platform === 'win32') {
      const dir = env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Programs', 'Ollama') : null
      return {
        app: dir ? first([join(dir, 'ollama app.exe')]) : null,
        cli: first([...(dir ? [join(dir, 'ollama.exe')] : []), ...onPath('ollama.exe')]),
      }
    }
    if (platform === 'darwin') {
      const app = first(['/Applications/Ollama.app', ...(env.HOME ? [join(env.HOME, 'Applications', 'Ollama.app')] : [])])
      return { app, cli: first([...(app ? [join(app, 'Contents', 'Resources', 'ollama')] : []), '/opt/homebrew/bin/ollama', '/usr/local/bin/ollama', ...onPath('ollama')]) }
    }
    return { app: null, cli: first(['/usr/local/bin/ollama', '/usr/bin/ollama', ...onPath('ollama')]) }
  }

  async status(): Promise<OllamaSetupStatus> {
    const url = this.url()
    const remote = !isLoopbackUrl(url)
    const models = await this.models()
    const installed = models != null || remote || !!(this.findInstall().app || this.findInstall().cli)
    if (models && this.install?.phase === 'installing') this.install = null // the installer finished and Ollama answered
    return {
      state: models ? 'ready' : installed ? 'stopped' : 'missing',
      url,
      remote,
      canInstall: !remote && !!INSTALLER_URLS[this.host.platform],
      models: models ?? [],
      install: this.install ? { ...this.install } : null,
      pulls: [...this.pulls].map(([name, p]) => ({ name, percent: p.percent, error: p.error })),
    }
  }

  /** Models in Ollama, or null when it isn't answering. */
  private async models(): Promise<{ name: string; sizeBytes: number }[] | null> {
    try {
      const response = await fetch(new URL('/api/tags', this.url()), { signal: AbortSignal.timeout(2000) })
      if (!response.ok) return null
      const body = (await response.json()) as { models?: { name: string; size?: number }[] }
      return (body.models ?? []).map((m) => ({ name: m.name, sizeBytes: m.size ?? 0 })).sort((a, b) => a.name.localeCompare(b.name))
    } catch {
      return null
    }
  }

  /** Downloads the official installer, checks it's signed, and opens it. Progress shows in status(). */
  async startInstall(): Promise<OllamaSetupStatus> {
    const current = await this.status()
    if (!current.canInstall) throw new Error(current.remote ? `Ollama is set to ${current.url}, another machine. Install it there.` : "The app can't install Ollama on this system.")
    if (current.state !== 'missing') return current
    if (this.install && this.install.phase !== 'failed') return current
    this.install = { phase: 'downloading', percent: 0, error: null }
    const abort = (this.installAbort = new AbortController())
    void this.runInstall(abort.signal).catch((err) => {
      if (abort.signal.aborted) return
      this.install = { phase: 'failed', percent: null, error: err instanceof Error ? err.message : String(err) }
    })
    return this.status()
  }

  /** Stops the download, or stops waiting for an installer that was opened. */
  cancelInstall(): Promise<OllamaSetupStatus> {
    this.installAbort?.abort()
    this.installAbort = null
    this.install = null
    return this.status()
  }

  private async runInstall(signal: AbortSignal): Promise<void> {
    const { platform, tempFolder } = this.host
    const source = INSTALLER_URLS[platform]!
    const folder = join(tempFolder, 'ollama-installer')
    rmSync(folder, { recursive: true, force: true })
    mkdirSync(folder, { recursive: true })
    const file = join(folder, source.split('/').pop()!)
    await download(source, file, signal, (percent) => {
      if (this.install) this.install.percent = percent
    })
    if (signal.aborted) return
    this.install = { phase: 'installing', percent: null, error: null }
    if (platform === 'win32') {
      // Only a validly signed installer is run.
      const quoted = file.replace(/'/g, "''")
      const signature = (await this.host.exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-AuthenticodeSignature -LiteralPath '${quoted}').Status`])).trim()
      if (signature !== 'Valid') throw new Error(`The downloaded installer isn't validly signed (${signature || 'no signature'}), so it wasn't run.`)
      this.host.launch(file, []) // Ollama's own installer window; it installs for this user without admin rights
      return
    }
    // Mac: open the disk image, check the app's signature, copy it to Applications, and start it.
    const mount = join(folder, 'mount')
    mkdirSync(mount, { recursive: true })
    await this.host.exec('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, file])
    try {
      const appName = readdirSync(mount).find((n) => n.endsWith('.app'))
      if (!appName) throw new Error("The download didn't contain the Ollama app.")
      const app = join(mount, appName)
      await this.host.exec('codesign', ['--verify', '--deep', '--strict', app]).catch(() => {
        throw new Error("The downloaded app isn't validly signed, so it wasn't installed.")
      })
      await this.host.exec('spctl', ['--assess', '--type', 'execute', app]).catch(() => {
        throw new Error("macOS didn't approve the downloaded app, so it wasn't installed.")
      })
      await this.host.exec('ditto', [app, join('/Applications', appName)]).catch(() => {
        throw new Error("Couldn't copy Ollama to Applications. Install it from ollama.com instead.")
      })
      this.host.launch('open', [join('/Applications', appName)])
    } finally {
      await this.host.exec('hdiutil', ['detach', mount, '-quiet']).catch(() => undefined)
    }
  }

  /** Starts an installed Ollama: the app if there is one, otherwise the server on its own. */
  async start(): Promise<OllamaSetupStatus> {
    const current = await this.status()
    if (current.state === 'ready') return current
    if (current.remote) throw new Error(`Ollama is set to ${current.url}, another machine. Start it there.`)
    const { app, cli } = this.findInstall()
    if (app) this.host.platform === 'darwin' ? this.host.launch('open', [app]) : this.host.launch(app, [])
    else if (cli) this.host.launch(cli, ['serve'])
    else throw new Error("Ollama isn't installed.")
    // Give it a few seconds to answer.
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500))
      const now = await this.status()
      if (now.state === 'ready') return now
    }
    return this.status()
  }

  /** Starts downloading a tested model. Progress shows in status(). */
  async pull(name: string): Promise<OllamaSetupStatus> {
    if (!isTestedLocalModel(name)) throw new Error(`${name} hasn't been tested with this app, so it can't be downloaded here.`)
    const existing = this.pulls.get(name)
    if (existing && !existing.error) return this.status()
    const pull: Pull = { percent: 0, error: null, abort: new AbortController(), layers: new Map() }
    this.pulls.set(name, pull)
    void this.runPull(name, pull)
      .then(() => this.pulls.get(name) === pull && this.pulls.delete(name))
      .catch((err) => {
        if (this.pulls.get(name) !== pull) return
        if (pull.abort.signal.aborted) this.pulls.delete(name)
        else pull.error = err instanceof Error ? err.message : String(err)
      })
    return this.status()
  }

  private async runPull(name: string, pull: Pull): Promise<void> {
    let response: Response
    try {
      response = await fetch(new URL('/api/pull', this.url()), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: name }),
        signal: pull.abort.signal,
      })
    } catch (err) {
      if (pull.abort.signal.aborted) throw err
      throw new Error(`Couldn't reach Ollama at ${this.url()}.`)
    }
    if (!response.ok || !response.body) throw new Error(`Ollama error ${response.status} while downloading ${name}.`)
    await readJsonLines(response.body, (line: { status?: string; digest?: string; total?: number; completed?: number; error?: string }) => {
      if (line.error) throw new Error(line.error)
      if (line.digest && line.total) pull.layers.set(line.digest, { total: line.total, completed: line.completed ?? 0 })
      const layers = [...pull.layers.values()]
      const total = layers.reduce((n, l) => n + l.total, 0)
      if (total) pull.percent = Math.min(100, Math.round((layers.reduce((n, l) => n + l.completed, 0) / total) * 100))
      if (line.status === 'success') pull.percent = 100
    })
    if (pull.percent !== 100) throw new Error(`The download of ${name} stopped before it finished. Try again.`)
  }

  cancelPull(name: string): Promise<OllamaSetupStatus> {
    const pull = this.pulls.get(name)
    if (pull) {
      pull.abort.abort()
      this.pulls.delete(name)
    }
    return this.status()
  }

  async delete(name: string): Promise<OllamaSetupStatus> {
    const response = await fetch(new URL('/api/delete', this.url()), {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: name }),
      signal: AbortSignal.timeout(15000),
    }).catch(() => {
      throw new Error(`Couldn't reach Ollama at ${this.url()}.`)
    })
    if (!response.ok && response.status !== 404) throw new Error(`Ollama couldn't delete ${name} (error ${response.status}).`)
    return this.status()
  }
}

/** Saves a URL to a file, reporting whole-number percents when the size is known. */
async function download(url: string, file: string, signal: AbortSignal, progress: (percent: number | null) => void): Promise<void> {
  const response = await fetch(url, { signal }).catch(() => {
    throw new Error("Couldn't download the Ollama installer. Check the internet connection and try again.")
  })
  if (!response.ok || !response.body) throw new Error(`Couldn't download the Ollama installer (error ${response.status}).`)
  const total = Number(response.headers.get('content-length')) || 0
  const out = createWriteStream(file)
  let received = 0
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      received += chunk.length
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r))
      progress(total ? Math.min(100, Math.round((received / total) * 100)) : null)
    }
  } finally {
    await new Promise((r) => out.end(r))
  }
}

/** Calls back with each JSON line of a streamed response (Ollama streams one object per line). */
export async function readJsonLines<T>(body: ReadableStream<Uint8Array>, onLine: (line: T) => void): Promise<void> {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const text = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (text) onLine(JSON.parse(text) as T)
    }
  }
  if (buffer.trim()) onLine(JSON.parse(buffer) as T)
}
