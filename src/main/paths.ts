import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'

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

/**
 * On Windows, a program started from inside a packaged (MSIX) app, such as Claude Desktop,
 * inherits that app's file redirection: what it saves under AppData silently goes to the
 * package's private copy (`%LOCALAPPDATA%\Packages\<package>\LocalCache\Roaming\...`), not the
 * real folder. The installed app opening real data that way splits it into two copies.
 * This writes a probe file and looks for it in each package's private copy. Returns the package
 * that captured it, or null when the data folder is real. The probe is always removed.
 */
export function findRedirectingPackage(dataFolder: string, appDataFolder: string, localAppData: string | undefined): string | null {
  const rel = relative(appDataFolder, dataFolder)
  if (!localAppData || !rel || rel.startsWith('..') || isAbsolute(rel)) return null
  const probe = `.cos-redirect-probe-${process.pid}-${Date.now()}`
  const packages = join(localAppData, 'Packages')
  try {
    writeFileSync(join(dataFolder, probe), '')
    if (!existsSync(packages)) return null
    return readdirSync(packages).find((p) => existsSync(join(packages, p, 'LocalCache', 'Roaming', rel, probe))) ?? null
  } catch {
    return null
  } finally {
    rmSync(join(dataFolder, probe), { force: true })
  }
}
