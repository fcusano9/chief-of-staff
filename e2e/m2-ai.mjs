import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './cdp.mjs'

const here = import.meta.dirname
const appDir = resolve(here, '..')
const dataDir = join(tmpdir(), 'cos-e2e-m2')
const shots = join(here, 'shots')
mkdirSync(shots, { recursive: true })
const results = []
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
const h1 = (app) => app.eval(`return document.querySelector('main h1')?.textContent`)
const setValue = (sel, value, kind = 'HTMLInputElement') =>
  `const e=document.querySelector(${JSON.stringify(sel)}); const set=Object.getOwnPropertyDescriptor(${kind}.prototype,'value').set; set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event(${kind === 'HTMLSelectElement' ? "'change'" : "'input'"},{bubbles:true}))`

const SUMMARY = `Copilot summary for the week of Oct 26
Action items:
- Frank to send the updated pricing deck to EMEA distributors by Friday.
- Marcus confirmed the partner portal wireframes are approved.
- Still waiting on Finance for the margin model for new tiers.
- Frank needs to book customer visits for the spring launch.
The team discussed the spring launch timeline.`

let app = await launch({ appDir, dataDir })
try {
  // Setup through the API
  await app.eval(`
    const dana = await window.cos['people.save']({id:0,name:'Dana Lee',role:'VP, Product',email:null,priorityWeight:5});
    await window.cos['projects.save']({id:0,name:'Pricing refresh',color:'#1D9E75',status:'active'});
    const t = (title) => window.cos['tasks.save']({id:0,title,notes:null,status:'open',dueDate:null,projectId:null,requesterId:null,priorityOverride:null,followUpCount:0,waitingOn:null,subtasks:[]});
    await t('Approve partner portal wireframes'); await t('Margin model for new tiers');
    return true`)
  await app.key('g'); await app.key('t') // reload context lists
  await app.sleep(300)
  check('status bar shows demo AI', (await app.eval(`return document.querySelector('.statusbar').textContent`)).includes('Demo AI'))

  // Import via the UI
  await app.clickText('Import', '.tab')
  check('import screen', (await h1(app)) === 'Import')
  check('privacy line for demo AI', (await app.eval(`return document.querySelector('main').textContent`)).includes('nothing leaves this computer'))
  await app.click('main input[placeholder^="Title"]')
  await app.type('Copilot summary, week of Oct 26')
  await app.click('main textarea')
  await app.type(SUMMARY)
  await app.screenshot(join(shots, 'm2-01-import.png'))
  await app.key('Enter', { ctrl: true })
  await app.waitFor('[data-suggestion]', 8000)
  check('extract navigates to review', (await h1(app)) === 'Review queue')
  const kinds = await app.eval(`return [...document.querySelectorAll('[data-suggestion] .chip')].map(c => c.textContent)`)
  check('four suggestions of the right kinds', JSON.stringify(kinds) === JSON.stringify(['New task', 'Looks done', 'Waiting on', 'New task']), JSON.stringify(kinds))
  check('review tab badge', (await app.eval(`return [...document.querySelectorAll('.tab')].find(t => t.textContent.startsWith('Review'))?.querySelector('.count')?.textContent`)) === '4')
  check('nothing applied yet', (await app.eval(`return (await window.cos['tasks.listActive']()).length`)) === 2)
  check('evidence quotes shown', (await app.eval(`return document.querySelector('[data-suggestion]').textContent`)).includes('“Frank to send'))
  await app.screenshot(join(shots, 'm2-02-review.png'))

  // Edit the first suggestion, then accept with A
  await app.eval(`document.activeElement?.blur()`)
  await app.key('Enter')
  await app.waitFor('[data-suggestion] input.inp')
  await app.eval(setValue('[data-suggestion] input.inp', 'Send pricing deck to EMEA distributors'))
  const projId = await app.eval(`return (await window.cos['projects.list']())[0].id`)
  await app.eval(setValue('[data-suggestion] select', String(projId), 'HTMLSelectElement'))
  await app.eval(`document.activeElement?.blur()`)
  await app.key('a')
  await app.sleep(500)
  const created = await app.eval(`return (await window.cos['tasks.listActive']()).find(t => t.title === 'Send pricing deck to EMEA distributors')`)
  check('edited suggestion accepted as task', !!created && created.projectId === projId && created.dueDate === '2026-11-06', JSON.stringify(created && { p: created.projectId, d: created.dueDate }))
  check('task linked to its source', created?.linkedSources?.[0]?.title === 'Copilot summary, week of Oct 26')

  // Accept "Looks done" via button, reject "Waiting on" with R
  await app.clickText('Accept', '[data-suggestion] button')
  await app.sleep(400)
  const done = await app.eval(`return (await window.cos['tasks.listActive']()).some(t => t.title === 'Approve partner portal wireframes')`)
  check('mark-done accepted', done === false)
  await app.eval(`document.activeElement?.blur()`)
  await app.key('r')
  await app.sleep(400)
  const margin = await app.eval(`return (await window.cos['tasks.listActive']()).find(t => t.title === 'Margin model for new tiers').status`)
  check('rejected waiting-on leaves task open', margin === 'open', margin)
  const left = await app.eval(`return document.querySelectorAll('[data-suggestion]').length`)
  check('one suggestion left', left === 1, String(left))

  // Open the created task and see the linked source
  await app.eval(`window.__id = (await window.cos['tasks.listActive']()).find(t => t.title.startsWith('Send pricing')).id`)
  await app.key('k', { ctrl: true }); await app.type('Send pricing'); await app.key('Enter')
  await app.sleep(500)
  const knows = await app.eval(`return document.querySelector('.pane.right').textContent`)
  check('task editor shows linked source', knows.includes('1 linked source') && knows.includes('From copilot summary: Copilot summary, week of Oct 26'))

  // Duplicate import
  await app.clickText('Import', '.tab')
  await app.click('main textarea')
  await app.type(SUMMARY)
  await app.clickText('Extract suggestions', 'button')
  await app.sleep(500)
  check('duplicate detected', ((await app.eval(`return document.querySelector('.toast')?.textContent`)) ?? '').startsWith('Already imported'))
  check('recent imports list', (await app.eval(`return document.querySelectorAll('main .list .r').length`)) === 1)

  // Claude without a key
  await app.click('.iconbtn[title="Settings"]')
  await app.eval(setValue('main .card select', 'claude', 'HTMLSelectElement'))
  await app.sleep(400)
  check('status bar shows Claude without key', (await app.eval(`return document.querySelector('.statusbar').textContent`)).includes('Claude · no API key'))
  await app.screenshot(join(shots, 'm2-03-settings-claude.png'))
  await app.clickText('Import', '.tab')
  check('privacy line for Claude', (await app.eval(`return document.querySelector('main').textContent`)).includes('Sent to Anthropic'))
  await app.click('main textarea')
  await app.type('Brand new notes: Frank to update the roadmap timeline.')
  await app.clickText('Extract suggestions', 'button')
  await app.sleep(600)
  const err = await app.eval(`return document.querySelector('main').textContent`)
  check('missing-key error with retry and settings link', err.includes('no API key is set') && err.includes('Try again') && err.includes('Open Settings'))

  // Save a fake key; it must be encrypted on disk and never returned
  await app.click('.iconbtn[title="Settings"]')
  await app.click('main input[type=password]')
  await app.type('sk-ant-test-not-a-real-key')
  await app.clickText('Save', 'main .card button')
  await app.sleep(400)
  const secretFile = join(dataDir, 'secrets.json')
  const raw = existsSync(secretFile) ? readFileSync(secretFile, 'utf8') : ''
  check('key stored encrypted, not plain text', raw.includes('anthropic') && !raw.includes('sk-ant-test'), raw.slice(0, 40))
  const status = await app.eval(`return await window.cos['ai.status']()`)
  check('UI only learns that a key exists', status.hasKey === true && !JSON.stringify(status).includes('sk-ant'))
  // Optional: sends the fake key to Anthropic (no work data). Run with E2E_NETWORK=1.
  if (process.env.E2E_NETWORK) {
  await app.clickText('Test connection', 'button')
  await app.sleep(6000)
  const testText = await app.eval(`return document.querySelector('main').textContent`)
  check('fake key rejected with a readable message', /rejected the API key|Couldn't reach Anthropic/.test(testText), (testText.match(/(Anthropic[^.]*\.)/) ?? [''])[0])
  }

  // Clean up: remove key, back to demo
  await app.clickText('Remove', 'main .card button')
  await app.sleep(300)
  check('key removed', !existsSync(secretFile))
  await app.eval(setValue('main .card select', 'demo', 'HTMLSelectElement'))
  await app.sleep(300)

  // Retry from the import failure now works with demo
  await app.clickText('Import', '.tab')
  await app.clickText('Run again', 'main .list button')
  await app.sleep(800)
  check('re-run after fixing settings', (await h1(app)) === 'Review queue')

  await app.key('g'); await app.key('t')
  await app.sleep(300)
  check('today shows review prompt', (await app.eval(`return document.querySelector('.ai').textContent`)).includes('waiting for your review'))
  await app.screenshot(join(shots, 'm2-04-today.png'))
  check('no renderer errors', app.errors.length === 0, app.errors.join(' | '))
} catch (e) {
  results.push(`ERROR  ${e.stack}`)
} finally {
  await app.close()
}
console.log(results.join('\n'))
if (results.some((r) => !r.startsWith('PASS'))) process.exitCode = 1
