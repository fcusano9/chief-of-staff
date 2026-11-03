// New projects, new people and context suggestions, end to end. A tiny fake Ollama server
// answers with canned suggestions, so this also drives the local provider through the real app.
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './cdp.mjs'

const here = import.meta.dirname
const appDir = resolve(here, '..')
const dataDir = join(tmpdir(), 'cos-e2e-m2-projects-people')
const shots = join(here, 'shots')
mkdirSync(shots, { recursive: true })
const results = []
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)

const s = (o) => ({
  kind: 'new_task', task_id: null, title: '', details: '', due_date: null, project_id: null, project_name: null, requester_name: null,
  waiting_on: null, brief_scope: null, brief_owner_id: null, role: null, email: null, evidence: 'quote', ...o,
})
// Ids match the project and person created below (a fresh database starts at 1).
const CANNED = [
  s({ kind: 'new_task', title: 'Send course outline to Alex', due_date: '2026-11-06', requester_name: 'Alex', project_name: 'Dealer training program', evidence: 'Frank, can you send me the course outline by Friday?' }),
  s({ kind: 'new_task', title: 'Pick three pilot dealers', project_name: 'Dealer training program', evidence: 'Frank to pick three pilot dealers.' }),
  s({ kind: 'waiting_on', title: 'Training platform quotes', waiting_on: 'Alex Rivera', project_name: 'Dealer training program', evidence: 'Alex will get quotes from two platforms.' }),
  s({ kind: 'brief_update', title: 'Training tile', brief_scope: 'project', brief_owner_id: 1, details: 'Training courses will be linked from the portal dashboard.', evidence: "I'll add a Training tile." }),
  s({ kind: 'brief_update', title: 'Owns portal side', brief_scope: 'person', brief_owner_id: 1, details: 'Owns the portal side of dealer training.', evidence: "I'll own the portal side." }),
  s({ kind: 'new_project', title: 'Dealer training program', details: 'Online certification for dealers, live with the new tiers in Q2.', evidence: 'We want the dealer training program live in April.' }),
  s({ kind: 'new_person', title: 'Alex Rivera', role: 'Training manager', details: 'Runs dealer training.', evidence: "I'm running the training side." }),
  s({ kind: 'new_person', title: 'Frank Cusano', evidence: 'the user, must be dropped' }),
]
const thinkSent = []
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    if (req.url === '/api/chat') thinkSent.push(JSON.parse(body).think)
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'fake:1b' }] }))
    if (req.url === '/api/chat') return res.end(JSON.stringify({ message: { content: JSON.stringify({ suggestions: CANNED }) }, done_reason: 'stop', prompt_eval_count: 100 }))
    res.statusCode = 404
    res.end('{}')
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const ollamaUrl = `http://127.0.0.1:${server.address().port}`

const rows = (app) => app.eval(`return [...document.querySelectorAll('[data-suggestion]')].map(r => r.querySelector('.chip').textContent + ' | ' + r.children[1].textContent)`)

let app = await launch({ appDir, dataDir, port: 9335 })
try {
  await app.eval(`
    await window.cos['projects.save']({id:0,name:'Partner portal',color:'#378ADD',status:'active'});
    await window.cos['people.save']({id:0,name:'Marcus Webb',role:'UX lead',email:null,priorityWeight:3});
    return true`)
  // Pick the local provider in Settings, point it at the fake server, then pick its model.
  const setInput = (sel, value, kind = 'HTMLInputElement', event = 'input') =>
    `Object.getOwnPropertyDescriptor(${kind}.prototype,'value').set.call(${sel}, ${JSON.stringify(value)}); ${sel}.dispatchEvent(new Event('${event}',{bubbles:true}))`
  const field = (label, tag) => `[...document.querySelectorAll('main .field')].find(f => f.textContent.startsWith('${label}')).querySelector('${tag}')`
  await app.click('.iconbtn[title="Settings"]')
  await app.eval(setInput(`document.querySelector('main .card select')`, 'local', 'HTMLSelectElement', 'change'))
  await app.sleep(400)
  await app.eval(`const e = ${field('Ollama address', 'input')}; e.focus(); ${setInput('e', ollamaUrl)}; e.blur()`)
  await app.sleep(800)
  await app.eval(`const e = ${field('Model', 'select')}; ${setInput('e', 'fake:1b', 'HTMLSelectElement', 'change')}`)
  await app.sleep(400)
  const bar = await app.eval(`return document.querySelector('.statusbar')?.textContent ?? ''`)
  check('local model selected', bar.includes('fake:1b (local)'), bar.slice(-60))
  await app.eval(`const e = ${field('Thoroughness', 'select')}; ${setInput('e', 'thorough', 'HTMLSelectElement', 'change')}`)
  await app.sleep(400)
  const bar2 = await app.eval(`return document.querySelector('.statusbar')?.textContent ?? ''`)
  check('thorough shows in the status bar', bar2.includes('fake:1b (local, thorough)'), bar2.slice(-60))

  await app.clickText('Import', '.tab')
  await app.click('main input[placeholder^="Title"]')
  await app.type('Dealer training kickoff')
  await app.click('main textarea')
  await app.type('Transcript of the dealer training kickoff.')
  await app.key('Enter', { ctrl: true })
  await app.waitFor('[data-suggestion]', 8000)

  check('thorough asks the model to think, in every pass', thinkSent.length >= 2 && thinkSent.every((t) => t === true), JSON.stringify(thinkSent))
  const labels = await app.eval(`return [...document.querySelectorAll('[data-suggestion] > div:first-child .chip')].map(c => c.textContent)`)
  check(
    'new projects and people first, then context, then tasks',
    JSON.stringify(labels) === JSON.stringify(['New project', 'New person', 'Project context', 'Person context', 'New task', 'New task', 'Waiting on']),
    JSON.stringify(labels),
  )
  const text = (await rows(app)).join('\n')
  check('the user is never suggested as a new person', !text.includes('Frank Cusano'))
  check('new person starts at 3 stars with role', text.includes('Alex Rivera') && text.includes('Training manager') && text.includes('Starts at'))
  check('tasks show the new project as "(new)"', text.includes('Send course outline to Alex') && text.includes('Dealer training program (new)'))
  check('requester linked to the new person', text.includes('Asked by Alex Rivera (new)'))
  check('new project counts its links', text.includes('3 suggestions below link to it'), (text.match(/\d+ suggestions? below link to it/) ?? [''])[0])
  check('context names what it adds to', text.includes('Partner portal') && text.includes('Marcus Webb') && text.includes('add to context'))
  await app.screenshot(join(shots, 'm2pp-01-review.png'))
  await app.eval(`document.activeElement?.blur()`)
  await app.key('D', { shift: true })
  await app.sleep(300)
  await app.screenshot(join(shots, 'm2pp-01b-review-other-theme.png'))
  await app.key('D', { shift: true })
  await app.sleep(300)

  // Accept the first task: its project and person are created with it.
  await app.eval(`document.activeElement?.blur()`)
  for (let i = 0; i < 4; i++) await app.key('j')
  await app.key('a')
  await app.sleep(600)
  check('toast says what else was created', ((await app.eval(`return document.querySelector('.toast')?.textContent`)) ?? '').includes('with its new project and person'))
  const state = await app.eval(`
    const projects = await window.cos['projects.list'](); const people = await window.cos['people.list']();
    const tasks = await window.cos['tasks.listActive']();
    const p = projects.find(x => x.name === 'Dealer training program'); const alex = people.find(x => x.name === 'Alex Rivera');
    const t = tasks.find(x => x.title === 'Send course outline to Alex');
    return { p: !!p, alex: alex && { role: alex.role, w: alex.priorityWeight }, linked: t && t.projectId === p?.id && t.requesterId === alex?.id,
             brief: p ? (await window.cos['briefs.get']('project', p.id)).summary : '' }`)
  check('project and person created with the task', state.p && state.alex?.role === 'Training manager' && state.alex?.w === 3 && state.linked, JSON.stringify(state))
  check('project summary saved to its brief', state.brief.includes('Online certification for dealers'))
  const after = (await rows(app)).join('\n')
  check('created project and person leave the queue', !after.includes('New project') && !after.includes('New person'))
  check('other tasks now show the real project', after.includes('Pick three pilot dealers') && !after.includes('(new)'))

  // Edit a context suggestion, then accept it.
  await app.key('k'); await app.key('k'); await app.key('k')
  await app.sleep(200)
  await app.clickText('Accept', '[data-suggestion] button')
  await app.sleep(500)
  const portalBrief = await app.eval(`const p = (await window.cos['projects.list']()).find(x => x.name === 'Partner portal'); return (await window.cos['briefs.get']('project', p.id)).summary`)
  check('project context added to the existing brief', portalBrief.includes('Training courses will be linked from the portal dashboard'), portalBrief.slice(0, 80))
  await app.screenshot(join(shots, 'm2pp-02-after-accept.png'))
  check('no renderer errors', app.errors.length === 0, app.errors.join(' | '))
} catch (e) {
  results.push(`ERROR  ${e.stack}`)
} finally {
  await app.close()
  server.close()
}
console.log(results.join('\n'))
if (results.some((r) => !r.startsWith('PASS'))) process.exitCode = 1
