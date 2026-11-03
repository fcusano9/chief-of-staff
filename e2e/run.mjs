// Runs every end-to-end suite against the built app. Usage: npm run e2e
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

let failed = false
for (const suite of ['m1-core.mjs', 'm2-ai.mjs', 'm2-projects-people.mjs', 'm2-people.mjs']) {
  console.log(`\n== ${suite}`)
  const r = spawnSync(process.execPath, [join(import.meta.dirname, suite)], { stdio: 'inherit' })
  if (r.status !== 0) failed = true
}
process.exitCode = failed ? 1 : 0
