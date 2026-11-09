import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  // GitHub's Windows runners have slow disks: tests (and their setup, which opens a real database) can pass the defaults there.
  test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: process.env.CI ? 30_000 : 5_000, hookTimeout: process.env.CI ? 30_000 : 10_000 },
})
