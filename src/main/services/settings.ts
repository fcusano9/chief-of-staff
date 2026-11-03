import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { CLAUDE_MODELS, DEFAULT_SETTINGS, type AppSettings } from '@shared/types'

/** JSON settings file next to the database. Unknown or missing fields fall back to defaults. */
export class SettingsStore {
  current: AppSettings

  constructor(private readonly path: string) {
    this.current = this.load()
  }

  private load(): AppSettings {
    try {
      const saved = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<AppSettings>
      return { ...DEFAULT_SETTINGS, ...saved, priorityWeights: { ...DEFAULT_SETTINGS.priorityWeights, ...saved.priorityWeights } }
    } catch {
      return structuredClone(DEFAULT_SETTINGS)
    }
  }

  save(settings: AppSettings): AppSettings {
    const clampWeight = (n: number) => Math.min(10, Math.max(0, Math.round(n)))
    this.current = {
      ...settings,
      userName: settings.userName?.trim() || DEFAULT_SETTINGS.userName,
      aiProvider: settings.aiProvider === 'claude' || settings.aiProvider === 'local' ? settings.aiProvider : 'demo',
      aiModel: CLAUDE_MODELS.some((m) => m.id === settings.aiModel) ? settings.aiModel : DEFAULT_SETTINGS.aiModel,
      localModel: settings.localModel?.trim() || DEFAULT_SETTINGS.localModel,
      localUrl: /^https?:\/\/[^\s]+$/.test(settings.localUrl?.trim() ?? '') ? settings.localUrl.trim().replace(/\/+$/, '') : DEFAULT_SETTINGS.localUrl,
      priorityWeights: {
        dueDate: clampWeight(settings.priorityWeights.dueDate),
        requester: clampWeight(settings.priorityWeights.requester),
        staleness: clampWeight(settings.priorityWeights.staleness),
      },
      splitPercent: Math.min(90, Math.max(10, settings.splitPercent)),
      backupsToKeep: Math.max(1, Math.round(settings.backupsToKeep)),
      backupFolder: settings.backupFolder?.trim() || null,
    }
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(this.current, null, 2))
    renameSync(tmp, this.path)
    return this.current
  }
}
