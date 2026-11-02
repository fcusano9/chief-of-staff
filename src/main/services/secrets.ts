import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { safeStorage } from 'electron'

/**
 * Stores the Anthropic API key encrypted with the operating system (Windows DPAPI, macOS Keychain)
 * through Electron's safeStorage. The key never touches disk in plain text and is never sent to
 * the UI; the UI only learns whether a key is set.
 */
export class KeyStore {
  private cached: string | null | undefined

  constructor(private readonly path: string) {}

  get encryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  get(): string | null {
    if (this.cached !== undefined) return this.cached
    if (!existsSync(this.path) || !this.encryptionAvailable) return (this.cached = null)
    try {
      const { anthropic } = JSON.parse(readFileSync(this.path, 'utf8')) as { anthropic?: string }
      this.cached = anthropic ? safeStorage.decryptString(Buffer.from(anthropic, 'base64')) : null
    } catch {
      this.cached = null
    }
    return this.cached
  }

  set(key: string | null): void {
    const trimmed = key?.trim() || null
    if (!trimmed) {
      rmSync(this.path, { force: true })
      this.cached = null
      return
    }
    if (!this.encryptionAvailable) throw new Error("This computer can't encrypt the key, so it wasn't saved.")
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify({ anthropic: safeStorage.encryptString(trimmed).toString('base64') }))
    renameSync(tmp, this.path)
    this.cached = trimmed
  }
}
