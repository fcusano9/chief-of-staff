// Resolution: Mark done and E ask for one (optional, Cancel and Esc keep the task open), Done in the Status menu
// shows the box in the editor, done tasks keep it editable, and Reopen keeps it.
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './cdp.mjs'

const here = import.meta.dirname
const appDir = resolve(here, '..')
const dataDir = join(tmpdir(), 'cos-e2e-resolution')
const shots = join(here, 'shots')
mkdirSync(shots, { recursive: true })
const results = []
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
const titles = (app) => app.eval(`return [...document.querySelectorAll('.pane.left .r .ttl')].map(t => t.childNodes[0].textContent)`)
const dialogOpen = (app) => app.eval(`return !!document.querySelector('[data-dialog="mark-done"]')`)
const taskByTitle = (app, title) => app.eval(`return (await window.cos['tasks.listDone']({})).concat(await window.cos['tasks.listActive']({})).find(t => t.title === ${JSON.stringify(title)}) ?? null`)

const app = await launch({ appDir, dataDir })
try {
  await app.eval(`
    const t = (o) => window.cos['tasks.save']({ id: 0, title: 'Task', notes: null, status: 'open', dueDate: null, projectId: null, requesterId: null, priorityOverride: null, followUpCount: 0, waitingOn: null, subtasks: [], ...o });
    await t({ title: 'Pricing deck', dueDate: '2026-01-01' });
    await t({ title: 'Book customer visits' });
    await t({ title: 'Dealer FAQ' });
    return true`)
  await app.reload()
  await app.clickText('Tasks', '.tab')
  await app.sleep(400)

  // Mark done in the editor: Cancel and Esc keep it open.
  await app.clickText('Pricing deck', '.pane.left .r')
  await app.waitFor('.pane.right .title-inp')
  await app.click('[data-action="done"]')
  await app.sleep(200)
  check('Mark done opens the resolution window', await dialogOpen(app))
  check('the resolution box has focus', await app.eval(`return document.activeElement?.getAttribute('aria-label') === 'Resolution' && !!document.activeElement.closest('[data-dialog]')`))
  check('no Skip button', !(await app.eval(`return [...document.querySelectorAll('[data-dialog] button')].some(b => b.textContent === 'Skip')`)))
  await app.screenshot(join(shots, 'resolution-01-dialog.png'))
  await app.clickText('Cancel', '[data-dialog] button')
  await app.sleep(200)
  check('Cancel closes it and the task stays open', !(await dialogOpen(app)) && (await taskByTitle(app, 'Pricing deck')).status === 'open')
  await app.click('[data-action="done"]')
  await app.sleep(200)
  await app.key('Escape')
  await app.sleep(200)
  check('Esc closes it, the task stays open, and the editor stays', !(await dialogOpen(app)) && (await taskByTitle(app, 'Pricing deck')).status === 'open' && (await app.eval(`return !!document.querySelector('.pane.right .title-inp')`)))

  // Typed resolution, Ctrl+Enter.
  await app.click('[data-action="done"]')
  await app.sleep(200)
  await app.type('Sent to the pricing committee.')
  await app.key('Enter', { ctrl: true })
  await app.sleep(600)
  let t = await taskByTitle(app, 'Pricing deck')
  check('Ctrl+Enter marks done with the resolution', t.status === 'done' && t.resolution === 'Sent to the pricing committee.', JSON.stringify([t.status, t.resolution]))
  check('it leaves the Tasks list', !(await titles(app)).includes('Pricing deck'))

  // E on a row with no editor open, empty box.
  await app.key('Escape')
  await app.sleep(200)
  const first = (await titles(app))[0]
  await app.key('e')
  await app.sleep(200)
  check('E opens the resolution window', await dialogOpen(app))
  await app.clickText('Mark done', '[data-dialog] button')
  await app.sleep(600)
  t = await taskByTitle(app, first)
  check('Mark done with an empty box marks it done with no resolution', t.status === 'done' && t.resolution === null, JSON.stringify([first, t.status, t.resolution]))

  // Done in the Status menu shows the box in the editor.
  const other = (await titles(app))[0]
  await app.clickText(other, '.pane.left .r')
  await app.waitFor('.pane.right .title-inp')
  check('no Resolution box on an open task', !(await app.eval(`return !!document.querySelector('.pane.right textarea[aria-label="Resolution"]')`)))
  await app.eval(`const s = [...document.querySelectorAll('.pane.right select')].find(x => [...x.options].some(o => o.value === 'done')); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'done'); s.dispatchEvent(new Event('change', { bubbles: true })); return true`)
  await app.sleep(200)
  check('Done in the Status menu shows the Resolution box, no window', (await app.eval(`return !!document.querySelector('.pane.right textarea[aria-label="Resolution"]')`)) && !(await dialogOpen(app)))
  await app.click('.pane.right textarea[aria-label="Resolution"]')
  await app.type('Covered by the dealer portal.')
  await app.clickText('Save', '.pane.right button')
  await app.sleep(600)
  t = await taskByTitle(app, other)
  check('Save keeps the status and resolution', t.status === 'done' && t.resolution === 'Covered by the dealer portal.', JSON.stringify([t.status, t.resolution]))

  // A done task shows it, editable; Reopen keeps it and the next Mark done starts from it.
  await app.key('Escape')
  await app.clickText('Done', '.seg button')
  await app.sleep(300)
  await app.clickText('Pricing deck', '.pane.left .r')
  await app.waitFor('.pane.right textarea[aria-label="Resolution"]')
  check('a done task shows its resolution', (await app.eval(`return document.querySelector('.pane.right textarea[aria-label="Resolution"]').value`)) === 'Sent to the pricing committee.')
  await app.screenshot(join(shots, 'resolution-02-done-task.png'))
  await app.clickText('Reopen', '.pane.right button')
  await app.sleep(500)
  t = await taskByTitle(app, 'Pricing deck')
  check('Reopen keeps the resolution', t.status === 'open' && t.resolution === 'Sent to the pricing committee.')
  await app.clickText('Open', '.seg button')
  await app.sleep(300)
  await app.clickText('Pricing deck', '.pane.left .r')
  await app.waitFor('[data-action="done"]')
  await app.click('[data-action="done"]')
  await app.sleep(200)
  check('the next Mark done starts from it', (await app.eval(`return document.querySelector('[data-dialog] textarea').value`)) === 'Sent to the pricing committee.')
  await app.key('Escape')

  check('no renderer errors', app.errors.length === 0, app.errors.join(' | '))
} catch (err) {
  await app.screenshot(join(shots, 'resolution-error.png')).catch(() => {})
  check('suite ran to the end', false, err.stack)
} finally {
  await app.close()
}
console.log(results.join('\n'))
process.exitCode = results.some((r) => r.startsWith('FAIL')) ? 1 : 0
