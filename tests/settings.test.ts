import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SettingsStore } from '../src/main/services/settings'
import type { DensitySetting } from '@shared/types'

describe('density setting', () => {
  let folder: string
  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'cos-settings-'))
  })
  afterEach(() => rmSync(folder, { recursive: true, force: true }))

  it('starts on Comfortable, including for settings saved before density existed', () => {
    expect(new SettingsStore(join(folder, 'new.json')).current.density).toBe('comfortable')
    writeFileSync(join(folder, 'old.json'), JSON.stringify({ theme: 'dark' }))
    const old = new SettingsStore(join(folder, 'old.json')).current
    expect(old.density).toBe('comfortable')
    expect(old.theme).toBe('dark')
  })

  it('saves a chosen level and rejects unknown ones', () => {
    const path = join(folder, 'settings.json')
    const store = new SettingsStore(path)
    store.save({ ...store.current, density: 'spacious' })
    expect(new SettingsStore(path).current.density).toBe('spacious')
    store.save({ ...store.current, density: 'huge' as DensitySetting })
    expect(new SettingsStore(path).current.density).toBe('comfortable')
  })
})
