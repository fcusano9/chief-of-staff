import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/** Separate from the unit tests: the benchmark is slow and needs Ollama or an API key. */
export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: { include: ['bench/**/*.test.ts'], environment: 'node', reporters: ['default'] },
})
