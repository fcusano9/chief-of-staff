// People: company, the Company and Open asks filters, and the one-line brief (Write brief with
// the demo AI, Keep, Edit, Esc, and the "new updates" hint).
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './cdp.mjs'

const here = import.meta.dirname
const appDir = resolve(here, '..')
const dataDir = join(tmpdir(), 'cos-e2e-m2-people')
const shots = join(here, 'shots')
mkdirSync(shots, { recursive: true })
const results = []
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
const setSelect = (sel, value) =>
  `const e=document.querySelector(${JSON.stringify(sel)}); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('change',{bubbles:true}))`
const rows = (app) => app.eval(`return [...document.querySelectorAll('.pane.left .r')].map(r => r.querySelector('.ttl').firstChild.textContent)`)
const briefText = (app) => app.eval(`return document.querySelector('[data-brief]')?.textContent ?? null`)
const rightText = (app) => app.eval(`return document.querySelector('.pane.right').textContent`)
let app = await launch({ appDir, dataDir })
try {
  await app.eval(`
    const save = (name, role, company, w) => window.cos['people.save']({id:0,name,role,company,email:null,priorityWeight:w});
    const dana = await save('Dana Lee', 'VP, Product', 'Crestron', 5);
    await save('Jordan Kim', 'Account manager', 'Northwind AV', 3);
    await window.cos['briefs.save']({scope:'person',ownerId:dana.id,summary:'Nov 2, 2026: Approved the four-tier pricing model. (from “Pricing sync”)',standingInstructions:'',updatedAt:null});
    const t = (o) => window.cos['tasks.save']({id:0,title:'Task',notes:null,status:'open',dueDate:null,projectId:null,requesterId:null,priorityOverride:null,followUpCount:0,waitingOn:null,subtasks:[],...o});
    await t({title:'Pricing deck', requesterId: dana.id});
    await t({title:'Pilot pricing sheet', status:'waiting_on', waitingOn:'Jordan Kim'});
    return true`)

  // The third person through the editor; saving also reloads the list with the two set up above.
  await app.clickText('People', '.tab')
  await app.clickText('Add person')
  await app.waitFor('.pane.right .title-inp')
  await app.click('.pane.right .title-inp')
  await app.type('Taylor Brooks')
  await app.clickText('Save', '.pane.right button')
  await app.waitFor('.pane.left .r')
  await app.sleep(300)
  check('three people listed', (await rows(app)).length === 3, JSON.stringify(await rows(app)))

  const sub = await app.eval(`return document.querySelector('.pane.left .r .ttl .faint').textContent`)
  check('list shows role and company', sub === 'VP, Product · Crestron', sub)

  // Filters
  await app.eval(setSelect('.pane.left select', 'Northwind AV'))
  await app.sleep(300)
  check('company filter', JSON.stringify(await rows(app)) === '["Jordan Kim"]', JSON.stringify(await rows(app)))
  check('filtered count shown', (await app.eval(`return document.querySelector('.pane.left').textContent`)).includes('1 of 3'))
  check('filter remembered in settings', (await app.eval(`return (await window.cos['settings.get']()).peopleFilter.company`)) === 'Northwind AV')
  await app.eval(setSelect('.pane.left select', '(none)'))
  await app.sleep(300)
  check('no-company filter', JSON.stringify(await rows(app)) === '["Taylor Brooks"]', JSON.stringify(await rows(app)))
  await app.clickText('Clear', '.pane.left button')
  await app.clickText('Open asks', '.pill')
  await app.sleep(300)
  check('open asks filter counts asks and waiting on', JSON.stringify(await rows(app)) === '["Dana Lee","Jordan Kim"]', JSON.stringify(await rows(app)))
  await app.screenshot(join(shots, 'm2-people-01-filters.png'))
  await app.clickText('Clear', '.pane.left button')
  await app.sleep(300)
  check('clear shows everyone', (await rows(app)).length === 3)

  // Brief: write with Basic, keep it
  await app.clickText('Dana Lee', '.pane.left .r')
  await app.waitFor('[data-brief]')
  const labels = await app.eval(`return [...document.querySelectorAll('.pane.right .field > span:first-child')].map(s => s.textContent)`)
  check('company sits above role', JSON.stringify(labels.slice(0, 2)) === '["Company","Role"]', JSON.stringify(labels))
  check('no brief yet', (await briefText(app)).startsWith('No brief yet'))
  await app.click('.pane.right input[placeholder="e.g. VP, Product"]')
  await app.type(' and Design') // unsaved edit that must survive keeping a brief
  await app.clickText('Write brief', '.pane.right button')
  await app.waitFor('.pane.right .ai')
  const suggested = await app.eval(`return document.querySelector('.pane.right .ai').textContent`)
  check('suggested brief shown with its writer', suggested.includes('Dana Lee, VP, Product at Crestron. Approved the four-tier pricing model.') && suggested.includes('Basic'), suggested)
  check('nothing saved before Keep', (await app.eval(`return (await window.cos['people.list']()).find(p => p.name === 'Dana Lee').brief`)) === null)
  await app.screenshot(join(shots, 'm2-people-02-suggested.png'))
  await app.clickText('Keep', '.pane.right .ai button')
  await app.sleep(400)
  check('kept brief shown', (await briefText(app)) === 'Dana Lee, VP, Product at Crestron. Approved the four-tier pricing model.', await briefText(app))
  check('byline says written by AI', (await rightText(app)).includes('Written by AI on'))
  check('unsaved edits survive keeping a brief', (await app.eval(`return document.querySelector('.pane.right input[placeholder="e.g. VP, Product"]').value`)) === 'VP, Product and Design')

  // Updates open in a window, like Projects: add one there, then Save (which saves the role edit above)
  check('no history text box on the page', !(await app.eval(`return !!document.querySelector('.pane.right textarea[placeholder^="Dated notes"]')`)))
  await app.clickText('Updates', '.pane.right button')
  await app.waitFor('[role="dialog"]')
  check('Updates window lists the updates', (await app.eval(`return document.querySelectorAll('[role="dialog"] [data-note]').length`)) === 1)
  await app.click('[role="dialog"] input[aria-label="New update"]')
  await app.type('Wants Finance to review pricing first.')
  await app.key('Enter')
  await app.sleep(400)
  check('note added newest first', (await app.eval(`return document.querySelector('[role="dialog"] [data-note]')?.textContent ?? ''`)).includes('Wants Finance to review pricing first.'))
  await app.key('Escape')
  await app.sleep(200)
  await app.clickText('Save', '.pane.right button')
  await app.sleep(400)
  check('Save keeps the note added in the window', (await app.eval(`const d = (await window.cos['people.list']()).find(p => p.name === 'Dana Lee'); return (await window.cos['briefs.get']('person', d.id)).summary`)).includes('Wants Finance to review pricing first.'))
  check('new notes hint', (await rightText(app)).includes('1 new update since this brief'))
  const dana = await app.eval(`return (await window.cos['people.list']()).find(p => p.name === 'Dana Lee')`)
  check('role saved with the note', dana.role === 'VP, Product and Design', dana.role)

  // Edit by hand: Esc cancels, Ctrl+Enter saves
  await app.clickText('Edit', '.pane.right button')
  await app.waitFor('textarea[aria-label="Brief"]')
  check('edit box focused', await app.eval(`return document.activeElement === document.querySelector('textarea[aria-label="Brief"]')`))
  await app.type(' Typo')
  await app.key('Escape')
  check('Esc cancels the edit', (await briefText(app)) === 'Dana Lee, VP, Product at Crestron. Approved the four-tier pricing model.')
  await app.clickText('Edit', '.pane.right button')
  await app.waitFor('textarea[aria-label="Brief"]')
  await app.type(' Wants Finance to review pricing first.')
  await app.key('Enter', { ctrl: true })
  await app.sleep(400)
  check('Ctrl+Enter saves the edit', (await briefText(app))?.endsWith('Wants Finance to review pricing first.'), await briefText(app))
  const text = await rightText(app)
  check('edited byline, hint cleared', text.includes('Edited by you on') && !text.includes('since this brief'))
  await app.screenshot(join(shots, 'm2-people-03-brief.png'))

  // Company through the editor
  await app.clickText('Taylor Brooks', '.pane.left .r')
  await app.waitFor('.pane.right input[list="company-options"]')
  check('no context, no Write brief', !(await rightText(app)).includes('Write brief'))
  await app.click('.pane.right input[list="company-options"]')
  await app.type('Contoso Integration')
  await app.clickText('Save', '.pane.right button')
  await app.sleep(400)
  check('company saved from the editor', (await app.eval(`return (await window.cos['people.list']()).find(p => p.name === 'Taylor Brooks').company`)) === 'Contoso Integration')
  check('no renderer errors', app.errors.length === 0, app.errors.join(' | '))
} catch (e) {
  results.push(`ERROR  ${e.stack}`)
} finally {
  await app.close()
}
console.log(results.join('\n'))
if (results.some((r) => !r.startsWith('PASS'))) process.exitCode = 1
