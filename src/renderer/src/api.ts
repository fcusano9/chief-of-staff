import type { AsyncApi } from '@shared/api'

declare global {
  interface Window {
    cos: AsyncApi
  }
}

/** Typed bridge to the main process (see src/preload). */
export const cos = window.cos

/** Turns an IPC rejection into the message the main process threw. */
export const errorMessage = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
