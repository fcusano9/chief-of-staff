import { join } from 'node:path'

export interface DataLocation {
  dataFolder: string
  /** Where daily backups go unless Settings names another folder. */
  defaultBackupFolder: string
  /** True for anything other than the installed app: dev runs and test folders. */
  isSeparateData: boolean
}

/**
 * Decides where the app keeps its data. Only the installed app uses the real folder and the real
 * OneDrive backups. Running from source (`npm run dev`, `electron .`) uses "Chief of Staff (dev)",
 * and COS_DATA_DIR (tests) uses the folder it names. Both keep their backups inside that folder,
 * so they can never prune or mix with real backups.
 */
export function chooseDataLocation(opts: {
  isPackaged: boolean
  envDataDir?: string
  appDataFolder: string
  defaultUserData: string
  oneDrive?: string
  documents: string
}): DataLocation {
  if (opts.envDataDir) return { dataFolder: opts.envDataDir, defaultBackupFolder: join(opts.envDataDir, 'backups'), isSeparateData: true }
  if (!opts.isPackaged) {
    const dev = join(opts.appDataFolder, 'Chief of Staff (dev)')
    return { dataFolder: dev, defaultBackupFolder: join(dev, 'backups'), isSeparateData: true }
  }
  return {
    dataFolder: opts.defaultUserData,
    defaultBackupFolder: join(opts.oneDrive ?? opts.documents, 'Chief of Staff Backups'),
    isSeparateData: false,
  }
}
