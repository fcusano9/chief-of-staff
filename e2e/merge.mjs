// Merge: two tasks from the editor's Merge button (picker, conflicts, Keep / Merge in, Combined, Cleared),
// the merged task's Notes, subtasks, Updates and Activity, Esc in each step, and two waiting items from Ctrl+K.
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './cdp.mjs'

const here = import.meta.dirname
const appDir = resolve(here, '..')
const dataDir = join(tmpdir(), 'cos-e2e-merge')
const shots = join(here, 'shots')
mkdirSync(shots, { recursive: true })
const results = []
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
const titles = (app) => app.eval(`return [...document.querySelectorAll('.pane.left .r .ttl')].map(t => t.childNodes[0].textContent)`)
const picker = (app) => app.eval(`return [...document.querySelectorAll('.merge-picker .pi[data-merge-id]')].map(p => p.querySelector('.ttl').textContent)`)
const rowState = (app) =>
  app.eval(`return Object.fromEntries([...document.querySelectorAll('.merge-grid tr[data-field]')].map(r => [r.dataset.field, r.querySelectorAll('input[type=radio]').length ? 'choose' : r.textContent.trim()]))`)
const gridText = (app) => app.eval(`return document.querySelector('.merge-grid').textContent.replace(/\\s+/g, ' ')`)
const hints = (app) => app.eval(`return [...document.querySelectorAll('.statusbar [data-hint]')].map(h => h.textContent.replace(/\\s+/g, ' ').trim())`)

const app = await launch({ appDir, dataDir })
try {
  await app.eval(`
    const launch = await window.cos['projects.save']({ id: 0, name: 'DM-NVX 3.2 launch', color: '#378ADD', status: 'active' });
    const portal = await window.cos['projects.save']({ id: 0, name: 'Dealer portal', color: '#3B9C6E', status: 'active' });
    const t = (o) => window.cos['tasks.save']({ id: 0, title: 'Task', notes: null, status: 'open', dueDate: null, projectId: null, requesterId: null, priorityOverride: null, followUpCount: 0, waitingOn: null, subtasks: [], ...o });
    const b = await t({ title: 'Firmware FAQ for dealers', projectId: portal.id, dueDate: '2030-11-24', notes: 'Dana wants a portal version too.', followUpCount: 1, subtasks: [{ id: 0, title: 'Collect dealer questions', isDone: false }] });
    await window.cos['tasks.save']({ ...(await window.cos['tasks.get'](b.id)), dueDate: '2030-11-25' });
    const a = await t({ title: 'Dealer FAQ for DM-NVX 3.2 firmware', projectId: launch.id, dueDate: '2030-11-21', notes: 'Cover the upgrade steps.', subtasks: [{ id: 0, title: 'Draft the Q&A list', isDone: true }] });
    await window.cos['briefs.save']({ scope: 'task', ownerId: a.id, summary: 'Nov 10, 2026: Kenji wants it before the webinar', standingInstructions: '', updatedAt: null });
    await window.cos['briefs.save']({ scope: 'task', ownerId: b.id, summary: 'Nov 2, 2026: Asked for it in the dealer call', standingInstructions: '', updatedAt: null });
    await t({ title: 'Roadmap slides for Q1 planning' });
    await t({ title: 'Signed SOW from Northside AV', status: 'waiting_on', waitingOn: 'Priya Shah' });
    await t({ title: 'Northside SOW countersignature', status: 'waiting_on', waitingOn: 'Marco Diaz', followUpCount: 2 });
    return true`)
  await app.reload()

  // From the task editor
  await app.clickText('Tasks', '.tab')
  await app.sleep(400)
  await app.clickText('Dealer FAQ for DM-NVX', '.pane.left .r')
  await app.waitFor('.pane.right [data-action="merge"]')
  check('Merge sits next to Delete', (await app.eval(`const b = document.querySelector('.pane.right [data-action="merge"]'); return b.previousElementSibling?.textContent`)) === 'Delete')
  await app.click('.pane.right [data-action="merge"]')
  await app.waitFor('.merge-picker input')
  const offered = await picker(app)
  check('picker lists the other open tasks only', JSON.stringify(offered.sort()) === JSON.stringify(['Firmware FAQ for dealers', 'Roadmap slides for Q1 planning']), JSON.stringify(offered))
  check('picker shows its keys in the bottom bar', (await hints(app)).some((h) => h.includes('pick')), JSON.stringify(await hints(app)))
  await app.key('Escape')
  await app.sleep(200)
  check('Esc closes the picker', !(await app.eval(`return !!document.querySelector('.merge-picker')`)))

  await app.click('.pane.right [data-action="merge"]')
  await app.waitFor('.merge-picker input')
  await app.type('firmware')
  await app.sleep(200)
  check('typing filters the picker', JSON.stringify(await picker(app)) === JSON.stringify(['Firmware FAQ for dealers']), JSON.stringify(await picker(app)))
  await app.key('Enter')
  await app.waitFor('.merge-grid')
  await app.waitFor('[data-action="merge-confirm"]:not([disabled])')
  const states = await rowState(app)
  check('a choice for the title, project, and due date', states.title === 'choose' && states.projectId === 'choose' && states.dueDate === 'choose', JSON.stringify(states))
  check('the kept item’s values are picked first', (await app.eval(`return [...document.querySelectorAll('.merge-grid tr[data-field] input[type=radio]')].filter((r, i) => i % 2 === 0).every(r => r.checked)`)) === true)
  const grid = await gridText(app)
  check('Combined lists Notes, subtasks, Updates, Activity, and follow-ups', ['Combined', 'Notes', 'Both', 'Subtasks', 'Updates', 'Activity', 'Follow-ups'].every((w) => grid.includes(w)), grid)
  check('nothing to clear with Basic', !grid.includes('Cleared'))
  check('dialog shows its keys in the bottom bar', (await hints(app)).some((h) => h.includes('merge')), JSON.stringify(await hints(app)))
  await app.key('Escape')
  await app.sleep(200)
  check('Esc in the dialog goes back to the picker', (await app.eval(`return !!document.querySelector('.merge-picker') && !document.querySelector('.merge-grid')`)) === true)
  await app.key('Enter')
  await app.waitFor('[data-action="merge-confirm"]:not([disabled])')
  await app.click('.merge-grid tr[data-field="projectId"] td:nth-child(3) input')
  await app.screenshot(join(shots, 'merge-01-dialog.png'))
  await app.key('Enter', { ctrl: true })
  await app.sleep(1200)

  check('the dialog closes', !(await app.eval(`return !!document.querySelector('.merge-grid, .merge-picker')`)))
  check('the merged-in task leaves the list', !(await titles(app)).includes('Firmware FAQ for dealers'), JSON.stringify(await titles(app)))
  const merged = await app.eval(`const t = (await window.cos['tasks.listActive']({ list: 'tasks' })).find(t => t.title.startsWith('Dealer FAQ')); return { project: t.project?.name, due: t.dueDate, notes: t.notes, subtasks: t.subtasks.map(s => s.title), followUps: t.followUpCount }`)
  check('the chosen project and the kept due date', merged.project === 'Dealer portal' && merged.due === '2030-11-21', JSON.stringify(merged))
  check('Notes joined with a blank line', merged.notes === 'Cover the upgrade steps.\n\nDana wants a portal version too.', JSON.stringify(merged.notes))
  check('subtasks and follow-ups combined', JSON.stringify(merged.subtasks) === JSON.stringify(['Draft the Q&A list', 'Collect dealer questions']) && merged.followUps === 1, JSON.stringify(merged))
  await app.waitFor('.pane.right .title-inp')
  check('the editor shows the merged Notes', (await app.eval(`return document.querySelector('.pane.right textarea.notes-inp').value`)).includes('Dana wants a portal version too.'))
  check('Updates count both', (await app.eval(`return document.querySelector('.pane.right').textContent`)).includes('Kenji wants it') && (await app.eval(`return (await window.cos['briefs.get']('task', (await window.cos['tasks.listActive']({ list: 'tasks' })).find(t => t.title.startsWith('Dealer FAQ')).id)).summary.split('\\n').length`)) === 2)
  await app.clickText('Activity', '.pane.right .fold')
  await app.sleep(300)
  const activity = await app.eval(`return document.querySelector('.pane.right [data-testid="activity"]').textContent`)
  check('Activity starts with the merge and tags moved lines', activity.includes('Merged in “Firmware FAQ for dealers”') && activity.includes('on “Firmware FAQ for dealers”'), activity.slice(0, 300))
  await app.screenshot(join(shots, 'merge-02-merged.png'))

  // Ctrl+K, two waiting items
  await app.key('Escape')
  await app.sleep(200)
  await app.key('k', { ctrl: true })
  await app.waitFor('.palette input')
  await app.type('Merge')
  await app.sleep(200)
  check('no Merge with… while nothing is open', !(await app.eval(`return [...document.querySelectorAll('.palette .pi')].some(p => p.textContent.includes('Merge with'))`)))
  await app.key('Escape')
  await app.clickText('Waiting', '.tab')
  await app.sleep(400)
  await app.clickText('Signed SOW', '.pane.left .r')
  await app.waitFor('.pane.right .title-inp')
  await app.key('k', { ctrl: true })
  await app.waitFor('.palette input')
  await app.type('Merge with')
  await app.sleep(200)
  await app.key('Enter')
  await app.waitFor('.merge-picker input')
  check('Ctrl+K opens the picker, with waiting items only', JSON.stringify(await picker(app)) === JSON.stringify(['Northside SOW countersignature']), JSON.stringify(await picker(app)))
  await app.key('Enter')
  await app.waitFor('[data-action="merge-confirm"]:not([disabled])')
  check('a choice for who it waits on', (await rowState(app)).waitingOn === 'choose', JSON.stringify(await rowState(app)))
  check('Waiting since shows both', (await gridText(app)).includes('Waiting since'))
  await app.screenshot(join(shots, 'merge-03-waiting.png'))
  await app.click('[data-action="merge-confirm"]')
  await app.sleep(1200)
  const waiting = await app.eval(`return (await window.cos['tasks.listActive']({ list: 'waiting' })).map(t => [t.title, t.waitingOn, t.followUpCount])`)
  check('one waiting item left, still waiting on the kept person', JSON.stringify(waiting) === JSON.stringify([['Signed SOW from Northside AV', 'Priya Shah', 2]]), JSON.stringify(waiting))
  check('no renderer errors', app.errors.length === 0, app.errors.join(' | '))
} catch (e) {
  results.push(`ERROR  ${e?.stack ?? String(e)}`)
} finally {
  await app.close()
}
console.log(results.join('\n'))
if (results.some((r) => !r.startsWith('PASS'))) process.exitCode = 1
