// Projects and People save pending edits when you switch to another item, start a new one, or change tabs.
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './cdp.mjs'

const here = import.meta.dirname
const appDir = resolve(here, '..')
const dataDir = join(tmpdir(), 'cos-e2e-autosave')
const results = []
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
/** Sets an input's value the way typing would, so React sees it. */
const setValue = (app, selector, value) =>
  app.eval(`const i = document.querySelector(${JSON.stringify(selector)}); const proto = i instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event('input', { bubbles: true })); return true`)
const toastText = (app) => app.eval(`return [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ')`)

// Seed the data, then restart so the app loads it (the app blocks page reloads).
const seed = await launch({ appDir, dataDir })
await seed.eval(`
  await window.cos['projects.save']({ id: 0, name: 'Partner portal', color: '#378ADD', status: 'active' });
  await window.cos['projects.save']({ id: 0, name: 'Pricing refresh', color: '#D85A30', status: 'active' });
  await window.cos['people.save']({ id: 0, name: 'Dana Lee', role: 'VP, Product', company: 'Crestron', email: null, priorityWeight: 5 });
  await window.cos['people.save']({ id: 0, name: 'Jordan Kim', role: 'Owner', company: 'Northwind AV', email: null, priorityWeight: 2 });
  return true`)
await seed.close()
await seed.sleep(1500)

const app = await launch({ appDir, dataDir, fresh: false })
try {
  await app.sleep(1000)

  // Projects: edit, then pick another project
  await app.clickText('Projects', '.tab')
  await app.sleep(500)
  await app.clickText('Partner portal', '.pane.left .r')
  await app.waitFor('.pane.right textarea')
  await setValue(app, '.pane.right textarea', 'Always cc Marcus on dates')
  await app.clickText('Pricing refresh', '.pane.left .r')
  await app.sleep(600)
  const portal = await app.eval(`const p = (await window.cos['projects.list']()).find(x => x.name === 'Partner portal'); return (await window.cos['briefs.get']('project', p.id)).standingInstructions`)
  check('project edits saved when picking another project', portal === 'Always cc Marcus on dates', portal)
  check('says what it saved', (await toastText(app)).includes('Saved changes to “Partner portal”'), await toastText(app))

  // Projects: rename, then switch tabs
  await setValue(app, '.pane.right .title-inp', 'Pricing refresh 2027')
  await app.clickText('Tasks', '.tab')
  await app.sleep(600)
  check('project edits saved when switching tabs', (await app.eval(`return (await window.cos['projects.list']()).some(x => x.name === 'Pricing refresh 2027')`)) === true)

  // Projects: a new project with a name is created when you move away
  await app.clickText('Projects', '.tab')
  await app.sleep(500)
  await app.clickText('New project', 'button')
  await app.sleep(300)
  await setValue(app, '.pane.right .title-inp', 'Dealer training')
  await app.clickText('Partner portal', '.pane.left .r')
  await app.sleep(600)
  check('new project created on switch', (await app.eval(`return (await window.cos['projects.list']()).some(x => x.name === 'Dealer training')`)) === true)

  // Projects: an empty name isn't saved, and says so
  await setValue(app, '.pane.right .title-inp', '')
  await app.clickText('Dealer training', '.pane.left .r')
  await app.sleep(600)
  check('empty name not saved', (await app.eval(`return (await window.cos['projects.list']()).some(x => x.name === 'Partner portal')`)) === true)
  check('empty name warns', (await toastText(app)).includes('Name was empty'), await toastText(app))

  // Projects: no changes, no save
  await app.sleep(2500)
  await app.clickText('Partner portal', '.pane.left .r')
  await app.sleep(500)
  check('nothing saved without changes', !(await toastText(app)).includes('Saved changes'), await toastText(app))

  // People: edit role and weight, then pick another person
  await app.clickText('People', '.tab')
  await app.sleep(500)
  await app.clickText('Dana Lee', '.pane.left .r')
  await app.waitFor('.pane.right input[placeholder="e.g. VP, Product"]')
  await setValue(app, '.pane.right input[placeholder="e.g. VP, Product"]', 'VP, Product and Design')
  await app.click('.pane.right .stars button:nth-child(3)')
  await app.clickText('Jordan Kim', '.pane.left .r')
  await app.sleep(600)
  const dana = await app.eval(`return (await window.cos['people.list']()).find(p => p.name === 'Dana Lee')`)
  check('person edits saved when picking another person', dana.role === 'VP, Product and Design' && dana.priorityWeight === 3, JSON.stringify({ role: dana.role, w: dana.priorityWeight }))

  // People: edit, then switch tabs
  await setValue(app, '.pane.right input[placeholder="name@company.com"]', 'jordan@northwind.example')
  await app.clickText('Today', '.tab')
  await app.sleep(600)
  check('person edits saved when switching tabs', (await app.eval(`return (await window.cos['people.list']()).find(p => p.name === 'Jordan Kim').email`)) === 'jordan@northwind.example')

  // People: Save button still works, and doesn't save twice on switch
  await app.clickText('People', '.tab')
  await app.sleep(500)
  await app.clickText('Jordan Kim', '.pane.left .r')
  await app.waitFor('.pane.right input[placeholder="e.g. VP, Product"]')
  await setValue(app, '.pane.right input[placeholder="e.g. VP, Product"]', 'Owner and CEO')
  await app.clickText('Save', '.pane.right button')
  await app.sleep(2500)
  await app.clickText('Dana Lee', '.pane.left .r')
  await app.sleep(500)
  check('Save then switch saves once', (await app.eval(`return (await window.cos['people.list']()).find(p => p.name === 'Jordan Kim').role`)) === 'Owner and CEO' && !(await toastText(app)).includes('Saved changes'), await toastText(app))
  check('no renderer errors', app.errors.length === 0, app.errors.join(' | '))
} catch (e) {
  results.push(`ERROR  ${e?.stack ?? String(e)}`)
} finally {
  await app.close()
}
console.log(results.join('\n'))
if (results.some((r) => !r.startsWith('PASS'))) process.exitCode = 1
