// Projects: the hand-written overview (pencil, Esc, Ctrl+Enter), the AI status brief (Write brief
// with Basic, Keep, the "new notes" hint, Edit) and the History window (newest first, new
// notes marked, Add, Edit, Esc).
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './cdp.mjs'

const here = import.meta.dirname
const appDir = resolve(here, '..')
const dataDir = join(tmpdir(), 'cos-e2e-m2-project-brief')
const shots = join(here, 'shots')
mkdirSync(shots, { recursive: true })
const results = []
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
const text = (app, sel) => app.eval(`return document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`)
const project = (app) => app.eval(`return (await window.cos['projects.list']()).find(p => p.name === 'Spring pricing launch')`)
const history = (app) => app.eval(`const p = (await window.cos['projects.list']()).find(p => p.name === 'Spring pricing launch'); return (await window.cos['briefs.get']('project', p.id)).summary`)
let app = await launch({ appDir, dataDir })
try {
  await app.eval(`
    const p = await window.cos['projects.save']({id:0,name:'Spring pricing launch',color:'#7F77DD',status:'active'});
    await window.cos['briefs.save']({scope:'project',ownerId:p.id,summary:'Oct 28, 2026: Dana Lee approved the four-tier model. (from “Copilot summary”)\\nNov 1, 2026: Northwind AV pilots the tiers from Dec 1. (from “Dealer call”)',standingInstructions:'Always cc Priya.',updatedAt:null});
    await window.cos['tasks.save']({id:0,title:'Send pricing deck',notes:null,status:'open',dueDate:null,projectId:p.id,requesterId:null,priorityOverride:null,followUpCount:0,waitingOn:null,subtasks:[]});
    return true`)

  // The second project through the editor; saving also reloads the list with the one set up above.
  await app.clickText('Projects', '.tab')
  await app.clickText('New project')
  await app.waitFor('.pane.right .title-inp')
  await app.click('.pane.right .title-inp')
  await app.type('Q1 roadmap')
  check('a new project has no overview, brief or History yet', !(await app.eval(`return !!document.querySelector('[data-overview], [data-brief]')`)))
  await app.clickText('Save', '.pane.right button')
  await app.waitFor('.pane.left .r')
  await app.sleep(300)
  await app.clickText('Spring pricing launch', '.pane.left .r')
  await app.waitFor('[data-overview]')

  // Name and overview look different
  const look = await app.eval(`const n = getComputedStyle(document.querySelector('.pane.right .title-inp')); const o = getComputedStyle(document.querySelector('.ov-line'));
    return { name: n.fontSize, nameColor: n.color, ov: o.fontSize, ovColor: o.color }`)
  check('name is bigger than the overview', parseFloat(look.name) > parseFloat(look.ov), JSON.stringify(look))
  check('overview is a softer color than the name', look.nameColor !== look.ovColor, JSON.stringify(look))
  check('no overview yet', (await text(app, '[data-overview]')) === 'Add a one-line overview')
  check('overview has no Regenerate', !(await app.eval(`return document.querySelector('.ov-line').textContent`)).includes('Regenerate'))

  // Overview: pencil opens the editor; Esc cancels; Ctrl+Enter saves
  await app.click('.pane.right .title-inp')
  await app.type(' 2027') // unsaved name edit that must survive saving the overview and brief
  await app.click('button[aria-label="Edit overview"]')
  await app.waitFor('textarea[aria-label="Overview"]')
  check('pencil opens a focused editor', await app.eval(`return document.activeElement === document.querySelector('textarea[aria-label="Overview"]')`))
  await app.type('Typo')
  await app.key('Escape')
  check('Esc cancels the overview edit', (await text(app, '[data-overview]')) === 'Add a one-line overview')
  await app.click('[data-overview]')
  await app.waitFor('textarea[aria-label="Overview"]')
  await app.type('Moving dealers to a four-tier pricing model for the spring launch.')
  await app.key('Enter', { ctrl: true })
  await app.sleep(400)
  check('Ctrl+Enter saves the overview', (await text(app, '[data-overview]')) === 'Moving dealers to a four-tier pricing model for the spring launch.')
  check('overview saved', (await project(app)).overview === 'Moving dealers to a four-tier pricing model for the spring launch.')
  const listSub = await app.eval(`return [...document.querySelectorAll('.pane.left .r')].find(r => r.textContent.startsWith('Spring')).querySelector('.ttl .faint')?.textContent`)
  check('overview shown under the name in the list', listSub === 'Moving dealers to a four-tier pricing model for the spring launch.', listSub)

  // Brief: write with Basic, keep it
  check('no brief yet', (await text(app, '[data-brief]')).startsWith('No brief yet'))
  check('History button shows the note count', (await app.eval(`return [...document.querySelectorAll('.pane.right button')].find(b => b.textContent.startsWith('History')).textContent.replace(/\\s+/g, ' ')`)) === 'History 2')
  await app.clickText('Write brief', '.pane.right button')
  await app.waitFor('.pane.right .ai')
  const suggested = await text(app, '.pane.right .ai')
  check('suggested brief shown with its writer', suggested.includes('Northwind AV pilots the tiers from Dec 1.') && suggested.includes('Next: Send pricing deck.') && suggested.includes('Basic'), suggested)
  check('nothing saved before Keep', (await project(app)).brief === null)
  await app.screenshot(join(shots, 'm2-project-brief-01-suggested.png'))
  await app.clickText('Keep', '.pane.right .ai button')
  await app.sleep(400)
  const kept = await text(app, '[data-brief]')
  check('kept brief shown on separate lines', kept.includes('Next: Send pricing deck.') && (await app.eval(`return document.querySelector('[data-brief]').innerText.split('\\n').length`)) === 3, kept)
  check('byline says written by AI', (await text(app, '.pane.right')).includes('Written by AI on'))
  check('unsaved name edit survives', (await app.eval(`return document.querySelector('.pane.right .title-inp').value`)) === 'Spring pricing launch 2027')

  // History window: newest first, add a note, new-note marks and hint
  await app.clickText('History', '.pane.right button')
  await app.waitFor('.dialog')
  const notes = await app.eval(`return [...document.querySelectorAll('.dialog [data-note]')].map(n => n.textContent)`)
  check('history newest first, year dropped, source shown', notes.length === 2 && notes[0].startsWith('Nov 1Northwind AV pilots') && notes[0].includes('from “Dealer call”'), JSON.stringify(notes))
  check('add box focused', await app.eval(`return document.activeElement === document.querySelector('input[aria-label="New note"]')`))
  await app.type('EMEA will use the same four tiers, priced in euros.')
  await app.key('Enter')
  await app.sleep(400)
  const after = await app.eval(`return [...document.querySelectorAll('.dialog [data-note]')].map(n => n.textContent)`)
  check('added note first and marked new', after.length === 3 && after[0].includes('new') && after[0].includes('EMEA will use the same four tiers'), JSON.stringify(after))
  check('added note saved with a date', /\n[A-Z][a-z]{2} \d{1,2}, \d{4}: EMEA will use the same four tiers, priced in euros\.$/.test(await history(app)), await history(app))
  await app.screenshot(join(shots, 'm2-project-brief-02-history.png'))

  // Edit the whole history: Esc cancels the edit only, Ctrl+Enter saves
  await app.clickText('Edit', '.dialog button')
  await app.waitFor('textarea[aria-label="History"]')
  await app.type('\nJunk line')
  await app.key('Escape')
  check('Esc leaves history editing but keeps the window open', !!(await app.eval(`return document.querySelector('.dialog') && !document.querySelector('textarea[aria-label="History"]')`)))
  check('cancelled edit not saved', !(await history(app)).includes('Junk line'))
  await app.clickText('Edit', '.dialog button')
  await app.waitFor('textarea[aria-label="History"]')
  await app.eval(`const t = document.querySelector('textarea[aria-label="History"]'); t.focus(); t.setSelectionRange(t.value.length, t.value.length); return true`)
  await app.type('\nNov 3, 2026: Finance reviews margins first.')
  await app.key('Enter', { ctrl: true })
  await app.sleep(400)
  check('Ctrl+Enter saves the history', (await history(app)).endsWith('\nNov 3, 2026: Finance reviews margins first.'))
  await app.key('Escape')
  await app.sleep(200)
  check('Esc closes the window', !(await app.eval(`return !!document.querySelector('.dialog')`)))
  check('new notes hint', (await text(app, '.pane.right')).includes('2 new notes since this brief'))

  // Save keeps the history and saves the name and instructions
  await app.clickText('Save', '.pane.right button')
  await app.sleep(400)
  const saved = await app.eval(`const p = (await window.cos['projects.list']()).find(p => p.name === 'Spring pricing launch 2027'); return { p, b: await window.cos['briefs.get']('project', p.id) }`)
  check('Save keeps the history added in the window', saved.b.summary.split('\n').length === 4 && saved.b.standingInstructions === 'Always cc Priya.', JSON.stringify(saved.b))

  // Edit the brief by hand
  await app.clickText('Edit', '.pane.right button')
  await app.waitFor('textarea[aria-label="Project brief"]')
  await app.eval(`const t = document.querySelector('textarea[aria-label="Project brief"]'); t.focus(); t.setSelectionRange(t.value.length, t.value.length); return true`)
  await app.type(' EMEA matches in euros.')
  await app.key('Enter', { ctrl: true })
  await app.sleep(400)
  const right = await text(app, '.pane.right')
  check('hand edit saved, hint cleared', right.includes('EMEA matches in euros.') && right.includes('Edited by you on') && !right.includes('since this brief'))
  await app.screenshot(join(shots, 'm2-project-brief-03-edited.png'))

  // A project with no history can't ask the AI
  await app.clickText('Q1 roadmap', '.pane.left .r')
  await app.waitFor('[data-brief]')
  await app.sleep(300)
  check('no history, no Write brief', !(await text(app, '.pane.right')).includes('Write brief'))
  check('no renderer errors', app.errors.length === 0, app.errors.join(' | '))
} catch (e) {
  results.push(`ERROR  ${e.stack}`)
} finally {
  await app.close()
}
console.log(results.join('\n'))
if (results.some((r) => !r.startsWith('PASS'))) process.exitCode = 1
