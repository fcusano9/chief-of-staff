// Lists: Waiting apart from Tasks, Open / Done with Reopen, search on Tasks, Waiting, Projects and People, no "no signals" text, 1 star for new people.
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './cdp.mjs'

const here = import.meta.dirname
const appDir = resolve(here, '..')
const dataDir = join(tmpdir(), 'cos-e2e-lists')
const shots = join(here, 'shots')
mkdirSync(shots, { recursive: true })
const results = []
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
const titles = (app) => app.eval(`return [...document.querySelectorAll('.pane.left .r .ttl')].map(t => t.childNodes[0].textContent)`)
const head = (app) => app.eval(`return document.querySelector('.pane.left .head')?.textContent ?? ''`)
const search = async (app, text) => {
  await app.eval(`const i = document.querySelector('#list-search'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(text)}); i.dispatchEvent(new Event('input', { bubbles: true })); return true`)
  await app.sleep(300)
}

const app = await launch({ appDir, dataDir })
try {
  await app.eval(`
    const p = await window.cos['projects.save']({ id: 0, name: 'Pricing refresh', color: '#D85A30', status: 'active' });
    await window.cos['projects.save']({ id: 0, name: 'Partner portal', color: '#378ADD', status: 'active' });
    await window.cos['people.save']({ id: 0, name: 'Dana Lee', role: 'VP, Product', company: 'Crestron', email: null, priorityWeight: 5 });
    await window.cos['people.save']({ id: 0, name: 'Jordan Kim', role: 'Owner', company: 'Northwind AV', email: null, priorityWeight: 2 });
    const t = (o) => window.cos['tasks.save']({ id: 0, title: 'Task', notes: null, status: 'open', dueDate: null, projectId: null, requesterId: null, priorityOverride: null, followUpCount: 0, waitingOn: null, subtasks: [], ...o });
    await t({ title: 'Send price list to Munich', projectId: p.id });
    await t({ title: 'Book customer visits' });
    await t({ title: 'Platform quotes', status: 'waiting_on', waitingOn: 'Alex Rivera' });
    const done = await t({ title: 'Margin model', status: 'waiting_on', waitingOn: 'Priya Shah' });
    await window.cos['tasks.setStatus'](done.id, 'done');
    const old = await t({ title: 'Roadmap slides' });
    await window.cos['tasks.setStatus'](old.id, 'done');
    return true`)
  await app.eval(`location.reload(); return true`)
  await app.sleep(1500)

  // Tasks
  await app.clickText('Tasks', '.tab')
  await app.sleep(400)
  check('Tasks leaves out waiting items', JSON.stringify((await titles(app)).sort()) === JSON.stringify(['Book customer visits', 'Send price list to Munich']), JSON.stringify(await titles(app)))
  check('no "No deadline or urgency signals" text', !(await app.eval(`return document.querySelector('.pane.left').textContent`)).includes('No deadline or urgency signals'))
  await search(app, 'munich')
  check('Tasks search', JSON.stringify(await titles(app)) === JSON.stringify(['Send price list to Munich']))
  await search(app, '')
  await app.clickText('Done', '.seg button')
  await app.sleep(300)
  check('Done shows finished tasks only', JSON.stringify(await titles(app)) === JSON.stringify(['Roadmap slides']) && (await head(app)).includes('1 done'), (await head(app)))
  await app.screenshot(join(shots, 'lists-01-tasks-done.png'))
  await app.clickText('Roadmap slides', '.pane.left .r')
  await app.waitFor('.pane.right .title-inp')
  await app.clickText('Reopen', '.pane.right button')
  await app.sleep(500)
  await app.clickText('Open', '.seg button')
  await app.sleep(300)
  check('Reopen puts it back on Tasks', (await titles(app)).includes('Roadmap slides'))
  await app.key('Escape')

  // Waiting
  await app.clickText('Waiting', '.tab')
  await app.sleep(400)
  check('Waiting lists only waiting items', JSON.stringify(await titles(app)) === JSON.stringify(['Platform quotes']) && (await head(app)).includes('1 waiting'), JSON.stringify(await titles(app)))
  check('Waiting has project filters and Open / Done', (await app.eval(`return !!document.querySelector('.pane.left .pill') && !!document.querySelector('.pane.left .seg')`)) === true)
  await search(app, 'alex')
  check('Waiting search matches the person', JSON.stringify(await titles(app)) === JSON.stringify(['Platform quotes']))
  await search(app, '')
  await app.clickText('Done', '.seg button')
  await app.sleep(300)
  check('Waiting Done shows answered items with who', (await app.eval(`return document.querySelector('.pane.left .r')?.textContent ?? ''`)).includes('from Priya Shah'))
  await app.clickText('Margin model', '.pane.left .r')
  await app.waitFor('.pane.right .title-inp')
  await app.clickText('Reopen', '.pane.right button')
  await app.sleep(500)
  const reopened = await app.eval(`return (await window.cos['tasks.listActive']({ list: 'waiting' })).map(t => t.title + ':' + t.waitingOn)`)
  check('Reopen puts it back on Waiting with the same person', reopened.includes('Margin model:Priya Shah'), JSON.stringify(reopened))
  await app.clickText('Open', '.seg button')
  await app.key('Escape')
  await app.sleep(200)
  await app.key('n')
  await app.waitFor('.pane.right .title-inp')
  const status = await app.eval(`return [...document.querySelectorAll('.pane.right select')].find(s => [...s.options].some(o => o.value === 'waiting_on'))?.value`)
  check('N on Waiting starts a waiting item', status === 'waiting_on', status)
  await app.screenshot(join(shots, 'lists-02-waiting.png'))
  await app.key('Escape')

  // Projects
  await app.clickText('Projects', '.tab')
  await app.sleep(400)
  await search(app, 'portal')
  check('Projects search', JSON.stringify(await app.eval(`return [...document.querySelectorAll('.pane.left .r .ttl')].map(t => t.childNodes[0].textContent)`)) === JSON.stringify(['Partner portal']))

  // People
  await app.clickText('People', '.tab')
  await app.sleep(400)
  await search(app, 'northwind')
  check('People search matches company', JSON.stringify(await app.eval(`return [...document.querySelectorAll('.pane.left .r .ttl')].map(t => t.childNodes[0].textContent)`)) === JSON.stringify(['Jordan Kim']))
  await search(app, '')
  await app.clickText('Add person', 'button')
  await app.sleep(300)
  const stars = await app.eval(`return document.querySelector('.pane.right .stars')?.getAttribute('aria-label')`)
  check('new person starts at 1 star', stars === 'Priority weight 1 of 5', stars)
  await app.screenshot(join(shots, 'lists-03-people.png'))
  check('no renderer errors', app.errors.length === 0, app.errors.join(' | '))
} catch (e) {
  results.push(`ERROR  ${e?.stack ?? String(e)}`)
} finally {
  await app.close()
}
console.log(results.join('\n'))
if (results.some((r) => !r.startsWith('PASS'))) process.exitCode = 1
