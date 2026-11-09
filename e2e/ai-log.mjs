// AI log: open it from Import and from Review, read each part of what was sent, compare runs.
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './cdp.mjs'

const here = import.meta.dirname
const appDir = resolve(here, '..')
const dataDir = join(tmpdir(), 'cos-e2e-ailog')
const shots = join(here, 'shots')
mkdirSync(shots, { recursive: true })
const results = []
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
const h1 = (app) => app.eval(`return document.querySelector('main h1')?.textContent`)
const tabs = (app) => app.eval(`return [...document.querySelectorAll('[data-call] .subtab')].map(t => t.textContent)`)
const pane = (app) => app.eval(`return document.querySelector('[data-call] .code-block')?.textContent ?? ''`)

const SUMMARY = `Action items:
- Frank to send the updated pricing deck to EMEA distributors by Friday.
- Frank needs to book customer visits for the spring launch.`

const app = await launch({ appDir, dataDir })
try {
  await app.clickText('Import', '.tab')
  await app.click('main textarea')
  await app.type(SUMMARY)
  await app.key('Enter', { ctrl: true })
  await app.waitFor('[data-suggestion]', 8000)

  // From Review
  await app.clickText('AI log', 'main button')
  await app.waitFor('[data-call]')
  check('opens from Review', (await h1(app)) === 'Action items:')
  check('Review tab stays highlighted', (await app.eval(`return document.querySelector('.tab.on')?.textContent`))?.startsWith('Review'))
  check('demo AI shows its parts', JSON.stringify(await tabs(app)) === JSON.stringify(['Instructions', 'Message', 'Response', 'Full request']), JSON.stringify(await tabs(app)))
  check('instructions explain the demo sends no prompt', (await pane(app)).includes('sends no prompt'))
  await app.clickText('Message', '.subtab')
  check('message is the imported text', (await pane(app)).includes('Frank to send the updated pricing deck'))
  await app.clickText('Response', '.subtab')
  check('response holds the raw answer', (await pane(app)).includes('"suggestions"'))
  const summary = await app.eval(`return document.querySelector('main .card').textContent`)
  check('summary counts', summary.includes('2 proposed → 2 sent to Review'), summary)
  check('after-checks list', (await app.eval(`return document.querySelector('[data-checks]').textContent`)).includes('Sent to Review'))
  await app.screenshot(join(shots, 'ailog-01.png'))
  await app.clickText('← Review', 'button')
  check('back returns to Review', (await h1(app)) === 'Review queue')

  // From Import, after a second run
  await app.clickText('Import', '.tab')
  await app.clickText('Run again', 'main .list button')
  await app.sleep(800)
  await app.clickText('Import', '.tab')
  await app.clickText('AI log', 'main .list button')
  await app.waitFor('[data-call]')
  const runs = await app.eval(`return [...document.querySelectorAll('main .pill')].map(p => p.textContent)`)
  check('both runs listed, newest first', runs.length === 2 && runs[0].startsWith('Run 2') && runs[1].startsWith('Run 1'), JSON.stringify(runs))
  await app.clickText('Run 1', 'main .pill')
  check('can switch runs', (await app.eval(`return document.querySelector('main .pill.on')?.textContent`))?.startsWith('Run 1'))
  await app.clickText('Full request', '.subtab')
  check('full request is JSON', (await pane(app)).trim().startsWith('{'))
  await app.clickText('← Import', 'button')
  check('back returns to Import', (await h1(app)) === 'Import')
  check('no renderer errors', app.errors.length === 0, app.errors.join(' | '))
} catch (e) {
  results.push(`ERROR  ${e?.stack ?? String(e)}`)
} finally {
  await app.close()
}
console.log(results.join('\n'))
if (results.some((r) => !r.startsWith('PASS'))) process.exitCode = 1
