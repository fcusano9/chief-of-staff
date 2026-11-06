import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  // GitHub's Windows runners have slow disks: tests that create real databases and backups can pass 5 seconds there.
  test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: process.env.CI ? 30_000 : 5_000 },
})
