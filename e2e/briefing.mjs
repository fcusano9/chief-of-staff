// Daily briefing on Today: none yet, Write briefing, Do next (overdue first), Follow up and New, opening a task,
// Refresh, the Review button, History with the AI log, the palette command, empty sections, and an AI failure.
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './cdp.mjs'

const here = import.meta.dirname
const appDir = resolve(here, '..')
const dataDir = join(tmpdir(), 'cos-e2e-briefing')
const shots = join(here, 'shots')
mkdirSync(shots, { recursive: true })
const results = []
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
const card = (app) => app.eval(`return document.querySelector('[data-briefing]')?.textContent ?? ''`)
const section = (app, name) =>
  app.eval(`const s = document.querySelector('[data-briefing] [data-section="${name}"]'); return s ? [...s.querySelectorAll('.b-do, .b-item')].map(b => b.textContent) : null`)
const waitForText = async (app, text, ms = 8000) => {
  for (let t = 0; t < ms; t += 200) {
    if ((await card(app)).includes(text)) return true
    await app.sleep(200)
  }
  return false
}

let app = await launch({ appDir, dataDir })
try {
  // Today with no briefing yet.
  await app.waitFor('[data-briefing]')
  check('no briefing yet: invites you to write one', (await card(app)).includes('Get a short read on today') && (await card(app)).includes('Write briefing'))
  check('no Import button or data note on the card', !/Import|Anthropic|sent anywhere/.test(await card(app)), await card(app))
  check('briefing sits above Focus, full width', await app.eval(`const b = document.querySelector('[data-briefing]').getBoundingClientRect(); const f = [...document.querySelectorAll('h2')].find(h => h.textContent.startsWith('Focus')).getBoundingClientRect(); return b.bottom <= f.top && b.width > f.width * 1.3`))

  // Every section empty.
  await app.clickText('Write briefing', '[data-briefing] button')
  check('quiet day: briefing written', await waitForText(app, 'A quiet day'))
  const empties = await app.eval(`return [...document.querySelectorAll('[data-briefing] .b-none')].map(e => e.textContent)`)
  check('quiet day: three sections stay, each says it is empty', JSON.stringify(empties) === JSON.stringify(['Nothing is due or overdue. Your Focus list below is still in priority order.', 'No one needs a follow-up.', 'Nothing new since your last briefing.']), JSON.stringify(empties))
  await app.screenshot(join(shots, 'briefing-01-quiet.png'))

  // Tasks: one overdue, one due today, one waiting 9 days, then a Review suggestion.
  await app.eval(`
    const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0') };
    const t = (o) => window.cos['tasks.save']({ id: 0, title: 'Task', notes: null, status: 'open', dueDate: null, projectId: null, requesterId: null, priorityOverride: null, followUpCount: 0, waitingOn: null, subtasks: [], ...o });
    await t({ title: 'Review margin model', dueDate: d(-2) });
    await t({ title: 'Roadmap slides', dueDate: d(0) });
    const nine = new Date(Date.now() - 9 * 86400000).toISOString();
    await t({ title: 'Signed pilot agreement', status: 'waiting_on', waitingOn: 'Northwind AV', waitingSince: nine });
    await window.cos['sources.importAndExtract']({ kind: 'note', title: 'Pricing call', content: '- Action item: Frank to send the pricing deck to EMEA by Friday.' });
    return true`)
  // The app blocks page reloads, so restart it on the same data to show what was added.
  await app.close()
  app = await launch({ appDir, dataDir, fresh: false })
  await app.waitFor('[data-briefing]')
  await app.sleep(800)

  await app.clickText('Refresh', '[data-briefing] button')
  check('refresh: new briefing written', await waitForText(app, 'overdue'))
  const top = await section(app, 'Do next')
  check('overdue task listed first, numbered, with its tag', top?.[0]?.startsWith('1Review margin model') && top[0].includes('Overdue 2 days'), JSON.stringify(top))
  check('overdue tag is red', await app.eval(`return !!document.querySelector('[data-section="Do next"] .b-do .b-tag.over')`))
  check('due-today task in Do next, tagged Due today', top?.some((t) => t.includes('Roadmap slides') && t.includes('Due today')), JSON.stringify(top))
  check('Do next is one line per task', await app.eval(`return [...document.querySelectorAll('[data-section="Do next"] .b-do')].every(b => b.getBoundingClientRect().height < 40)`))
  const nudges = await section(app, 'Follow up')
  check('long wait in Follow up, with who and days', nudges?.[0]?.startsWith('Waiting 9 daysSigned pilot agreement · Northwind AV'), JSON.stringify(nudges))
  const fresh = await section(app, 'New')
  check('New: the three tasks and the Review line', fresh?.length === 4 && fresh.at(-1).startsWith('Review1 suggestion in Review'), JSON.stringify(fresh))
  check('only three sections', (await app.eval(`return document.querySelectorAll('[data-briefing] .b-sec').length`)) === 3)
  check('Review suggestions button with count', /Review suggestions\s*1/.test(await card(app)), await card(app))
  check('Follow up and New side by side, under Do next', await app.eval(`const s = [...document.querySelectorAll('[data-briefing] .b-sec')].map(e => e.getBoundingClientRect().top); return Math.abs(s[1] - s[2]) < 2 && s[0] < s[1]`))
  check('dated today', (await card(app)).includes('· Today,'))
  await app.screenshot(join(shots, 'briefing-02-today.png'))

  // A line opens its task.
  await app.click('[data-section="Do next"] .b-do')
  await app.sleep(600)
  check('clicking an item opens its task', (await app.eval(`return document.querySelector('.tab.on')?.textContent`)) === 'Tasks' && (await app.eval(`return document.querySelector('.pane.right input')?.value`)) === 'Review margin model')
  await app.clickText('Today', '.tab')
  await app.waitFor('[data-briefing]')
  await app.sleep(400)

  // History, with the AI log.
  await app.clickText('History', '[data-briefing] button')
  await app.waitFor('.b-hist')
  const rows = await app.eval(`return [...document.querySelectorAll('.b-hist-row')].map(r => r.textContent)`)
  check('history lists both briefings, newest first, as You clicked', rows.length === 2 && rows.every((r) => r.includes('You clicked')), JSON.stringify(rows))
  await app.clickText('AI log', '.b-hist-view button')
  await app.sleep(400)
  check('AI log shows the request', (await app.eval(`return document.querySelector('.b-hist-view [data-call]')?.textContent ?? ''`)).includes('Write the briefing (demo rules)'))
  await app.screenshot(join(shots, 'briefing-03-history.png'))
  await app.click('.b-hist-row:nth-child(2)')
  await app.sleep(400)
  check('older briefing opens', (await app.eval(`return document.querySelector('.b-hist-view').textContent`)).includes('A quiet day'))
  await app.key('Escape')
  await app.sleep(300)
  check('Esc closes history', !(await app.eval(`return !!document.querySelector('.b-hist')`)))

  // Command palette, from another screen.
  await app.clickText('Tasks', '.tab')
  await app.key('k', { ctrl: true })
  await app.type('Write briefing')
  await app.key('Enter')
  await app.sleep(1500)
  check('palette: goes to Today and writes a briefing', (await app.eval(`return document.querySelector('.tab.on')?.textContent`)) === 'Today' && (await app.eval(`return (await window.cos['briefing.list']()).length`)) === 3)
  check('no keyboard shortcut listed for it', !(await app.eval(`return document.querySelector('.statusbar, footer')?.textContent ?? ''`)).toLowerCase().includes('briefing'))

  // An AI failure keeps the last briefing.
  await app.eval(`await window.cos['settings.save']({ ...(await window.cos['settings.get']()), aiProvider: 'claude' }); return true`)
  await app.clickText('Refresh', '[data-briefing] button')
  check('failure: error shown, last briefing kept', await waitForText(app, "Couldn't write the briefing") && (await card(app)).includes('Your last briefing is below') && (await card(app)).includes('Do next'))
  check('failure: button says Try again', (await card(app)).includes('Try again'))
  check('failure: nothing saved', (await app.eval(`return (await window.cos['briefing.list']()).length`)) === 3)
  await app.screenshot(join(shots, 'briefing-04-error.png'))
  await app.eval(`await window.cos['settings.save']({ ...(await window.cos['settings.get']()), aiProvider: 'demo' }); return true`)

  check('no renderer errors', app.errors.length === 0, app.errors.join(' | '))
} catch (e) {
  results.push(`ERROR  ${e?.stack ?? String(e)}`)
} finally {
  await app.close()
}
console.log(results.join('\n'))
if (results.some((r) => !r.startsWith('PASS'))) process.exitCode = 1
