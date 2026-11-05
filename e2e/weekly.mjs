// Weekly tab: the live week, a saved week, a week the app missed, a week before the weekly review
// started, opening a task, the reflection (write, out of date, AI log, copy), the palette command,
// G then V, Up/Down between weeks, and an AI failure.
import { mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './cdp.mjs'

const here = import.meta.dirname
const appDir = resolve(here, '..')
const dataDir = join(tmpdir(), 'cos-e2e-weekly')
const shots = join(here, 'shots')
mkdirSync(shots, { recursive: true })
const results = []
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)

// Weeks run Sunday to Saturday, local time.
const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const today = new Date()
const sunday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay())
const day = (offset, hour = 10) => new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + offset, hour)
const thisWeek = ymd(sunday)
const lastWeek = ymd(day(-7))
const missedWeek = ymd(day(-14))
const octWeek = ymd(day(-35))

const reflection = (app) => app.eval(`return document.querySelector('[data-reflection]')?.textContent ?? ''`)
const section = (app, name) =>
  app.eval(`const s = document.querySelector('[data-section="${name}"]'); return s ? { items: [...s.querySelectorAll('.wk-it')].map(b => b.textContent), text: s.textContent } : null`)
const headText = (app) => app.eval(`return document.querySelector('.wk-page .head')?.textContent ?? ''`)
const waitFor = async (app, fn, ms = 8000) => {
  for (let t = 0; t < ms; t += 200) {
    if (await fn()) return true
    await app.sleep(200)
  }
  return false
}

// First run: create the tasks, then give them dates in earlier weeks straight in the database.
let app = await launch({ appDir, dataDir })
let ids
try {
  await app.waitFor('.tab')
  ids = await app.eval(`
    const t = (o) => window.cos['tasks.save']({ id: 0, title: 'Task', notes: null, status: 'open', dueDate: null, projectId: null, requesterId: null, priorityOverride: null, followUpCount: 0, waitingOn: null, subtasks: [], ...o }).then(x => x.id);
    const nine = new Date(Date.now() - 9 * 86400000).toISOString();
    return {
      approval: await t({ title: 'Pricing approval' }),
      margin: await t({ title: 'Margin review', dueDate: '${ymd(day(-4))}' }),
      october: await t({ title: 'Old October task' }),
      roadmap: await t({ title: 'Roadmap slides' }),
      expense: await t({ title: 'Expense report' }),
      pilot: await t({ title: 'Signed pilot agreement', status: 'waiting_on', waitingOn: 'Northwind AV', waitingSince: nine }),
    }`)
} finally {
  await app.close()
}
const db = new DatabaseSync(join(dataDir, 'chiefofstaff.db'))
const set = db.prepare('UPDATE work_items SET created_at = ?, status = ?, completed_at = ? WHERE id = ?')
set.run(day(-6).toISOString(), 'done', day(-5).toISOString(), ids.approval)
set.run(day(-7).toISOString(), 'open', null, ids.margin)
set.run(day(-35).toISOString(), 'done', day(-34).toISOString(), ids.october)
set.run(new Date().toISOString(), 'done', new Date().toISOString(), ids.expense)
db.prepare('UPDATE work_items SET created_at = ? WHERE id = ?').run(day(-20).toISOString(), ids.pilot)
// Pretend the weekly review started two weeks ago and nothing was saved since.
db.exec('DELETE FROM weekly_reviews; DELETE FROM weekly_meta;')
db.prepare('INSERT INTO weekly_meta (started_week) VALUES (?)').run(missedWeek)
db.close()

app = await launch({ appDir, dataDir, fresh: false })
try {
  await app.waitFor('.tab')
  const tabs = await app.eval(`return [...document.querySelectorAll('.tab')].map(t => t.textContent)`)
  check('Weekly tab sits next to Today', tabs[0] === 'Today' && tabs[1] === 'Weekly', JSON.stringify(tabs))

  // G then V opens it.
  await app.key('g')
  await app.key('v')
  await app.waitFor('.wk-row')
  await app.sleep(500)
  check('G then V opens Weekly', (await app.eval(`return document.querySelector('.tab.on')?.textContent`)) === 'Weekly')

  const rows = await app.eval(`return [...document.querySelectorAll('.wk-row')].map(r => r.dataset.week + ' | ' + r.textContent)`)
  check('weeks listed newest first, this week then last week', rows[0]?.startsWith(`${thisWeek} |`) && rows[0].includes('This week') && rows[1]?.startsWith(`${lastWeek} |`) && rows[1].includes('Last week'), JSON.stringify(rows.slice(0, 3)))
  check('weeks go back to the first task', rows.at(-1)?.startsWith(`${octWeek} |`) && rows.length === 6, `${rows.length} weeks; last ${rows.at(-1)}`)
  check('missed and older weeks marked partly recorded', rows[2]?.includes('partly recorded') && rows.at(-1)?.includes('partly recorded') && !rows[1]?.includes('partly'), JSON.stringify(rows))

  // The live week.
  check('this week is live', (await headText(app)).includes('Live') && (await headText(app)).includes('updates as you go'), await headText(app))
  const counts = await app.eval(`return [...document.querySelectorAll('[data-count]')].map(c => c.textContent)`)
  check('number cards', JSON.stringify(counts) === JSON.stringify(['Completed1', 'New2', 'Slipping1', 'Waiting on1']), JSON.stringify(counts))
  check('completed: done this week', (await section(app, 'Completed')).items[0]?.includes('Expense report'))
  const added = (await section(app, 'New')).items
  check('new: added this week, by you', added.length === 2 && added.every((a) => a.includes('Added by you')), JSON.stringify(added))
  const slipping = await section(app, 'Slipping')
  check('slipping: overdue task with its tag', slipping.items[0]?.includes('Margin review') && slipping.items[0].includes('Overdue') && slipping.text.includes('overdue now'), JSON.stringify(slipping))
  check('waiting: who and how long', (await section(app, 'Waiting on')).items[0]?.includes('Northwind AV') && (await section(app, 'Waiting on')).items[0].includes('9 days'))
  check('no reflection yet: invites you to write one', (await reflection(app)).includes('Write reflection') && (await reflection(app)).includes('only when you click'))
  await app.screenshot(join(shots, 'weekly-01-live.png'))

  // Write the reflection (Basic).
  await app.clickText('Write reflection', '[data-reflection] button')
  check('reflection written', await waitFor(app, async () => (await reflection(app)).includes('completed and 2 new tasks added')), await reflection(app))
  check('three short lists', JSON.stringify(await app.eval(`return [...document.querySelectorAll('[data-points] > .label')].map(l => l.textContent)`)) === JSON.stringify(['Went well', 'Slipped', 'Focus next']))
  check('written by Basic, with Refresh', (await reflection(app)).includes('Basic') && (await reflection(app)).includes('Refresh'))
  await app.screenshot(join(shots, 'weekly-02-reflection.png'))

  await app.clickText('Copy', '[data-reflection] button')
  await app.sleep(300)
  check('copy says so', (await app.eval(`return document.querySelector('.toast')?.textContent ?? ''`)) === 'Copied')

  await app.clickText('AI log', '[data-reflection] button')
  await app.sleep(400)
  check('AI log shows the request', (await app.eval(`return document.querySelector('[data-reflection] [data-call]')?.textContent ?? ''`)).includes('Write the weekly reflection (Basic rules)'))
  await app.clickText('Back to reflection', '[data-reflection] button')

  // Out of date once something changes.
  await app.eval(`await window.cos['tasks.save']({ id: 0, title: 'Pick a training platform', notes: null, status: 'open', dueDate: null, projectId: null, requesterId: null, priorityOverride: null, followUpCount: 0, waitingOn: null, subtasks: [] }); return true`)
  await app.clickText('Tasks', '.tab')
  await app.clickText('Weekly', '.tab')
  check('says what changed since it was written', await waitFor(app, async () => (await reflection(app)).includes('1 added since this was written')), await reflection(app))

  // Opening a task.
  await app.click('[data-section="Slipping"] .wk-it')
  await app.sleep(600)
  check('clicking an item opens its task', (await app.eval(`return document.querySelector('.tab.on')?.textContent`)) === 'Tasks' && (await app.eval(`return document.querySelector('.pane.right input')?.value`)) === 'Margin review')
  await app.clickText('Weekly', '.tab')
  await app.waitFor('.wk-row')
  await app.sleep(500)

  // Last week: saved as it stood Saturday night.
  await app.key('ArrowDown')
  await app.sleep(600)
  check('Down goes to last week, saved', (await headText(app)).includes('Saved') && (await headText(app)).includes('as it stood Saturday night'), await headText(app))
  check('last week: completed and overdue at its end', (await section(app, 'Completed')).items[0]?.includes('Pricing approval') && (await section(app, 'Slipping')).text.includes('overdue at week’s end') && (await section(app, 'Slipping')).items[0]?.includes('Margin review'))
  check('last week: no reflection, and no button to write one', (await reflection(app)).includes('No reflection was written for this week.') && !(await reflection(app)).includes('Write reflection'))
  await app.screenshot(join(shots, 'weekly-03-saved.png'))

  // The week the app missed, then the first week, before the weekly review started.
  await app.key('ArrowDown')
  await app.sleep(600)
  check('missed week: partly recorded, says why', (await headText(app)).includes('Partly recorded') && (await headText(app)).includes('wasn’t opened the week after'), await headText(app))
  check('missed week: slipping and waiting not recorded', (await section(app, 'Slipping')).text.includes('Not recorded') && (await section(app, 'Waiting on')).text.includes('Not recorded'))
  await app.click(`[data-week="${octWeek}"]`)
  await app.sleep(600)
  check('older week: before weekly reviews, completed known', (await headText(app)).includes('Before weekly reviews') && (await section(app, 'Completed')).items[0]?.includes('Old October task'), await headText(app))
  await app.screenshot(join(shots, 'weekly-04-partial.png'))
  await app.clickText('This week', '.wk-page button')
  await app.sleep(500)
  check('This week button returns to the live week', (await headText(app)).includes('Live'))

  // Command palette from another tab.
  const before = await app.eval(`return (await window.cos['weekly.get']('${thisWeek}')).reflection.writtenAt`)
  await app.clickText('Tasks', '.tab')
  await app.key('k', { ctrl: true })
  await app.type('Write weekly reflection')
  await app.key('Enter')
  await app.sleep(1500)
  check('palette: goes to Weekly and rewrites the reflection', (await app.eval(`return document.querySelector('.tab.on')?.textContent`)) === 'Weekly' && (await app.eval(`return (await window.cos['weekly.get']('${thisWeek}')).reflection.writtenAt`)) !== before)
  check('rewritten reflection is up to date', !(await reflection(app)).includes('since this was written'))

  // An AI failure keeps the last reflection.
  await app.eval(`await window.cos['settings.save']({ ...(await window.cos['settings.get']()), aiProvider: 'claude' }); return true`)
  await app.clickText('Refresh', '[data-reflection] button')
  check('failure: error shown, last reflection kept', await waitFor(app, async () => (await reflection(app)).includes("Couldn't write the reflection")) && (await reflection(app)).includes('Your last one is below') && (await reflection(app)).includes('Went well'))
  check('failure: button says Try again', (await reflection(app)).includes('Try again'))
  await app.screenshot(join(shots, 'weekly-05-error.png'))
  await app.eval(`await window.cos['settings.save']({ ...(await window.cos['settings.get']()), aiProvider: 'demo' }); return true`)

  // Settings lists the new key.
  await app.click('.iconbtn[title="Settings"]')
  await app.sleep(500)
  check('Settings lists G then V', (await app.eval(`return document.querySelector('main').textContent`)).includes('Weekly'))

  check('no renderer errors', app.errors.length === 0, app.errors.join(' | '))
} catch (e) {
  results.push(`ERROR  ${e?.stack ?? String(e)}`)
} finally {
  await app.close()
}
console.log(results.join('\n'))
if (results.some((r) => !r.startsWith('PASS'))) process.exitCode = 1
