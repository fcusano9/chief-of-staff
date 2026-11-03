import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './cdp.mjs'

const here = import.meta.dirname
const appDir = resolve(here, '..')
const dataDir = join(tmpdir(), 'cos-e2e-m1')
const shots = join(here, 'shots')
const results = []
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)

const { mkdirSync } = await import('node:fs')
mkdirSync(shots, { recursive: true })

let app = await launch({ appDir, dataDir })
try {
  await app.eval(`return 0`)
  await app.screenshot(join(shots, '01-today-empty.png'))

  // Every tab renders
  for (const tab of ['Today', 'Tasks', 'Review', 'Waiting', 'Projects', 'People', 'Prep', 'Weekly', 'Archive', 'Import']) {
    await app.clickText(tab, '.tab')
    await app.sleep(200)
    const h1 = await app.eval(`return document.querySelector('main h1')?.textContent`)
    check(`tab ${tab} renders`, !!h1, h1)
  }
  await app.click('.iconbtn[title="Settings"]')
  check('settings renders', (await app.eval(`return document.querySelector('main h1')?.textContent`)) === 'Settings')

  // People: add a VP with weight 5 and a peer
  await app.clickText('People', '.tab')
  for (const [name, role, stars] of [['Dana Lee', 'VP, Product', 5], ['Tom Baker', 'Channel sales', 2]]) {
    await app.clickText('Add person')
    await app.waitFor('.pane.right .title-inp')
    await app.click('.pane.right .title-inp')
    await app.type(name)
    await app.click('.pane.right input[placeholder="e.g. VP, Product"]')
    await app.type(role)
    await app.click(`.pane.right .stars button:nth-child(${stars})`)
    await app.clickText('Save', '.pane.right button')
    await app.sleep(300)
  }
  check('two people saved', (await app.eval(`return document.querySelectorAll('.pane.left .r').length`)) === 2)

  // Projects: create one with a brief
  await app.clickText('Projects', '.tab')
  await app.clickText('New project')
  await app.waitFor('.pane.right .title-inp')
  await app.click('.pane.right .title-inp')
  await app.type('Q1 roadmap')
  await app.click('.pane.right textarea[placeholder^="e.g. Always cc"]')
  await app.type('Keep decks to five slides.')
  await app.click('.swatch:nth-child(5)')
  await app.clickText('Save', '.pane.right button')
  await app.sleep(300)
  check('project saved', (await app.eval(`return document.querySelector('.pane.left .r .ttl')?.textContent`)) === 'Q1 roadmap')

  // New task in this project, with requester, due today, subtasks
  await app.clickText('New task in this project')
  await app.waitFor('.pane.right .title-inp')
  check('new-task-in-project opens Tasks with project preset', (await app.eval(`return document.querySelector('.pane.right select').selectedOptions[0].textContent`)) === 'Q1 roadmap')
  await app.type('Roadmap slides for VP review')
  await app.eval(`const s=[...document.querySelectorAll('.pane.right select')][2]; const o=[...s.options].find(o=>o.text==='Dana Lee'); const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; set.call(s,o.value); s.dispatchEvent(new Event('change',{bubbles:true}))`)
  const today = new Date(); const ymd = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
  await app.eval(`const d=document.querySelector('.pane.right input[type=date]'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(d,'${ymd}'); d.dispatchEvent(new Event('input',{bubbles:true}))`)
  await app.click('.pane.right input[placeholder="Add subtask…"]')
  await app.type('Timeline'); await app.key('Enter')
  await app.type('Pricing assumptions'); await app.key('Enter')
  await app.key('Enter', { ctrl: true })
  await app.sleep(400)
  const t1 = await app.eval(`return { score: document.querySelector('.pane.right .score').textContent, why: document.querySelector('.pane.right .card div:nth-child(2)').textContent, subs: document.querySelectorAll('.pane.right .check input[type=text]').length }`)
  check('task saved with score and rationale', Number(t1.score) === 73 && /due today/i.test(t1.why) && /Dana Lee/.test(t1.why), JSON.stringify(t1))

  // A few more tasks via N key
  const more = ['Submit expense report', 'Reply to distributor pricing thread', 'Renew design tool license', 'Draft dealer FAQ', 'Book customer visits']
  for (const title of more) {
    await app.eval(`document.activeElement?.blur()`)
    await app.key('n')
    await app.waitFor('.pane.right .title-inp')
    await app.type(title)
    await app.key('Enter', { ctrl: true })
    await app.sleep(250)
  }
  const count = await app.eval(`return document.querySelectorAll('.pane.left .r').length`)
  check('six tasks in list', count === 6, String(count))
  check('highest priority first', (await app.eval(`return document.querySelector('.pane.left .r .ttl').firstChild.textContent`)) === 'Roadmap slides for VP review')

  // J/K moves selection and shows the task on the right
  await app.eval(`document.activeElement?.blur()`)
  await app.key('Escape')
  for (let i = 0; i < 6; i++) await app.key('k')
  await app.key('j')
  const sel = await app.eval(`return [document.querySelector('.pane.left .r.sel .ttl')?.firstChild.textContent, document.querySelector('.pane.right .title-inp')?.value]`)
  check('J moves selection and right pane follows', sel[0] && sel[0] === sel[1], JSON.stringify(sel))

  // Autosave: edit notes then press J; edit must persist
  await app.click('.pane.right textarea')
  await app.type('Edited while browsing')
  const editedTitle = sel[1]
  await app.eval(`document.activeElement.blur()`)
  await app.key('j')
  await app.sleep(500)
  const note = await app.eval(`return (await window.cos['tasks.listActive']()).find(t => t.title === ${JSON.stringify(editedTitle)})?.notes`)
  check('switching tasks autosaves edits', note === 'Edited while browsing', String(note))

  // E marks done and removes from list
  const before = await app.eval(`return document.querySelectorAll('.pane.left .r').length`)
  const doneTitle = await app.eval(`return document.querySelector('.pane.left .r.sel .ttl')?.firstChild.textContent`)
  const doneId = await app.eval(`return Number(document.querySelector('.pane.left .r.sel').dataset.id)`)
  await app.click('.pane.right textarea')
  await app.type('Final note before done')
  await app.eval(`document.activeElement.blur()`)
  await app.key('e')
  await app.sleep(700)
  const after = await app.eval(`return document.querySelectorAll('.pane.left .r').length`)
  check('E marks done', after === before - 1, `${before} -> ${after} (${doneTitle})`)
  const doneTask = await app.eval(`return await window.cos['tasks.get'](${doneId})`)
  check('E with unsaved edits keeps edits and stays done', doneTask.status === 'done' && doneTask.notes === 'Final note before done', `${doneTask.status} / ${doneTask.notes}`)

  // Waiting on
  await app.click('.pane.left .r:last-child')
  await app.eval(`const s=[...document.querySelectorAll('.pane.right select')][1]; const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; set.call(s,'waiting_on'); s.dispatchEvent(new Event('change',{bubbles:true}))`)
  await app.click('.pane.right input[placeholder="Who or what"]')
  await app.type('Finance')
  await app.clickText('Save', '.pane.right button')
  await app.sleep(300)
  await app.screenshot(join(shots, '02-tasks-split-light.png'))

  // Divider: drag far left and far right; each pane keeps >= 360px
  const div = await app.eval(`const r=document.querySelector('.divider').getBoundingClientRect(); return {x:r.x+3,y:r.y+200}`)
  await app.drag(div.x, div.y, 20, div.y)
  const w1 = await app.eval(`return [document.querySelector('.pane.left').offsetWidth, document.querySelector('.pane.right').offsetWidth]`)
  const div2 = await app.eval(`const r=document.querySelector('.divider').getBoundingClientRect(); return {x:r.x+3,y:r.y+200}`)
  await app.drag(div2.x, div2.y, 5000, div2.y)
  const w2 = await app.eval(`return [document.querySelector('.pane.left').offsetWidth, document.querySelector('.pane.right').offsetWidth]`)
  check('divider min left 360', w1[0] >= 359 && w1[0] <= 362, JSON.stringify(w1))
  check('divider min right 360', w2[1] >= 359 && w2[1] <= 362, JSON.stringify(w2))
  await app.eval(`document.querySelector('.divider').dispatchEvent(new MouseEvent('dblclick', {bubbles:true}))`)
  await app.sleep(300)
  const pct = await app.eval(`return (await window.cos['settings.get']()).splitPercent`)
  check('double-click resets to 50 and saves', pct === 50, String(pct))

  // Waiting tab + Today
  await app.clickText('Waiting', '.tab')
  check('waiting list shows Finance', (await app.eval(`return document.querySelector('main .r')?.textContent ?? ''`)).includes('Finance'))
  await app.clickText('Today', '.tab')
  const metrics = await app.eval(`return [...document.querySelectorAll('.stat')].map(s => s.textContent)`)
  check('today metrics populated', metrics.length === 4 && metrics[3] !== '–', JSON.stringify(metrics))

  // Command palette
  await app.key('k', { ctrl: true })
  await app.waitFor('.palette input')
  await app.type('expense')
  await app.key('Enter')
  await app.sleep(400)
  check('palette opens a task', (await app.eval(`return document.querySelector('.pane.right .title-inp')?.value`)) === 'Submit expense report')

  // Theme toggle via Shift+D
  await app.eval(`document.activeElement?.blur()`)
  const themeBefore = await app.eval(`return document.documentElement.dataset.theme`)
  await app.key('D', { shift: true })
  await app.sleep(300)
  const themeAfter = await app.eval(`return document.documentElement.dataset.theme`)
  check('Shift+D toggles theme', themeBefore !== themeAfter, `${themeBefore} -> ${themeAfter}`)
  if (themeAfter !== 'dark') await app.key('D', { shift: true })
  await app.screenshot(join(shots, '03-tasks-split-dark.png'))

  // G-sequence navigation
  await app.key('g'); await app.key('p')
  check('G then P goes to Projects', (await app.eval(`return document.querySelector('main h1')?.textContent`)) === 'Projects')
  await app.screenshot(join(shots, '04-projects-dark.png'))
  await app.key('g'); await app.key('t')
  await app.screenshot(join(shots, '05-today-dark.png'))

  // Backup now
  await app.click('.iconbtn[title="Settings"]')
  await app.clickText('Back up now')
  await app.sleep(1500)
  const last = await app.eval(`return (await window.cos['settings.get']()).lastBackupAt`)
  check('backup now records time', !!last, String(last))
  await app.screenshot(join(shots, '06-settings-dark.png'))

  check('no renderer errors', app.errors.length === 0, app.errors.join(' | '))
} catch (err) {
  results.push(`ERROR  ${err.stack}`)
} finally {
  await app.close()
}

// Restart: data persists
app = await launch({ appDir, dataDir, fresh: false })
try {
  const persisted = await app.eval(`return (await window.cos['tasks.listActive']()).length`)
  check('data persists across restart', persisted === 5, String(persisted))
} finally {
  await app.close()
}
console.log(results.join('\n'))
if (results.some((r) => !r.startsWith('PASS'))) process.exitCode = 1
