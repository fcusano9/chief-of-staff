// Calendar: Today's Meetings card, the meeting panel, "Next meeting with" on a task, "Meetings this week"
// on a person, + Add to People, and Settings → Apple Calendar. The calendar is replaced by a fixture file
// (COS_CALENDAR_FIXTURE), which the app only honors for test data folders.
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './cdp.mjs'

const here = import.meta.dirname
const appDir = resolve(here, '..')
const shots = join(here, 'shots')
mkdirSync(shots, { recursive: true })
const results = []
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
const text = (app, selector) => app.eval(`return document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`)

// Times are worked out from now so the meetings are always today, whenever the suite runs.
const now = Date.now()
const midnight = new Date(new Date().setHours(0, 0, 0, 0)).getTime()
const clamp = (t) => Math.min(Math.max(t, midnight + 60_000), midnight + 86_400_000 - 120_000)
const iso = (t) => new Date(t).toISOString()
const me = { name: 'Frank Cusano', email: 'frank@example.com', response: 'accepted', isMe: true }
const person = (name, email, response = 'accepted') => ({ name, email, response, isMe: false })
const meeting = (o) => ({
  id: o.title, location: 'Teams', allDay: false, busy: 'busy', private: false, cancelled: false, myResponse: 'accepted',
  organizer: { name: 'Frank Cusano', email: 'frank@example.com', isMe: true }, invite: '', ...o, attendeeCount: (o.attendees ?? []).length,
})
const nowStart = clamp(now - 10 * 60_000)
const nowEnd = Math.max(clamp(now + 20 * 60_000), nowStart + 60_000)
const fixture = join(tmpdir(), 'cos-e2e-calendar-fixture.json')
writeFileSync(
  fixture,
  JSON.stringify([
    meeting({
      title: 'Partner portal design review', start: iso(nowStart), end: iso(nowEnd),
      attendees: [me, person('Ruiz, Marco', 'marco@example.com', 'tentative'), person('Natarajan, Priya', ''), person('Jordan Blake', 'jordan@example.com')],
      invite: 'Agenda\n1. Login copy\n2. Launch date\n________________________________________________________________________________\nMicrosoft Teams meeting\nJoin: https://teams.example/x',
    }),
    meeting({ title: 'Early standup', start: iso(midnight + 60_000), end: iso(midnight + 120_000), attendees: [me, person('Sam Okafor', 'sam@example.com')] }),
    meeting({ title: 'Declined sync', start: iso(nowStart), end: iso(nowEnd), myResponse: 'declined', attendees: [me] }),
    meeting({ title: 'Company holiday', start: iso(midnight), end: iso(midnight + 86_400_000), allDay: true, attendees: [] }),
    meeting({ title: 'Next week planning', start: iso(now + 8 * 86_400_000), end: iso(now + 8 * 86_400_000 + 3_600_000), attendees: [me] }),
  ]),
)
process.env.COS_CALENDAR_FIXTURE = fixture

// Seed people and tasks, then restart so the app loads them (the app blocks page reloads).
async function start(dataDir, port) {
  const seed = await launch({ appDir, dataDir, port })
  await seed.eval(`
    const p = (name, email) => window.cos['people.save']({ id: 0, name, role: null, company: null, email, priorityWeight: 3 });
    const priya = await p('Priya Natarajan', null);
    await p('Marco Ruiz', 'marco@example.com');
    const t = (o) => window.cos['tasks.save']({ id: 0, title: 'Task', notes: null, status: 'open', dueDate: null, projectId: null, requesterId: null, priorityOverride: null, followUpCount: 0, waitingOn: null, subtasks: [], ...o });
    await t({ title: 'Review margin model', requesterId: priya.id });
    await t({ title: 'Portal login copy', status: 'waiting_on', waitingOn: 'Marco Ruiz' });
    await t({ title: 'Unrelated task' });
    return true`)
  await seed.close()
  await seed.sleep(1500)
  const app = await launch({ appDir, dataDir, port, fresh: false })
  await app.sleep(1000)
  return app
}

// Outlook (Windows) wording.
delete process.env.COS_MAIL_APP
let app = await start(join(tmpdir(), 'cos-e2e-calendar'), 9333)
try {
  await app.clickText('Tasks', '.tab')
  await app.clickText('Today', '.tab')
  await app.waitFor('[data-meetings-card] .mt')
  const card = await text(app, '[data-meetings-card]')
  check('Today shows the meetings card with today’s meetings', card.includes('Meetings today') && card.includes('Partner portal design review') && card.includes('Early standup'), card)
  check('Declined, all-day and next week’s entries are left out', !card.includes('Declined sync') && !card.includes('Company holiday') && !card.includes('Next week planning'))
  check('The card says when it was read', /Read \d\d:\d\d/.test(card))
  check('The placeholder text is gone', !card.includes('milestone 4'))
  const badge = await app.eval(`return document.querySelector('[data-meeting="Partner portal design review"] .mt-n')?.textContent ?? ''`)
  check('A meeting counts the open tasks with its attendees', badge === '2', badge)
  check('The meeting happening now is marked', await app.eval(`return document.querySelector('[data-meeting="Partner portal design review"]').classList.contains('now')`))
  check('A meeting that has ended is greyed', await app.eval(`return document.querySelector('[data-meeting="Early standup"]').classList.contains('past')`))
  await app.screenshot(join(shots, 'calendar-today.png'))

  await app.click('[data-meeting="Partner portal design review"]')
  await app.waitFor('[data-meeting-panel]')
  const panel = await text(app, '[data-meeting-panel]')
  check('The panel lists attendees, linked or not', panel.includes('Marco Ruiz') && panel.includes('Priya Natarajan') && panel.includes('Jordan Blake') && panel.includes('+ Add to People'), panel)
  check('The panel shows the attendee’s answer', panel.includes('Tentative'))
  check('The panel lists the open tasks and waiting items with them', panel.includes('Review margin model') && panel.includes('Portal login copy') && !panel.includes('Unrelated task'))
  check('The invite leaves out the Teams join block', panel.includes('Login copy') && !panel.includes('teams.example'))
  check('The panel offers Open in Outlook', panel.includes('Open in Outlook'))
  await app.screenshot(join(shots, 'calendar-panel.png'))
  await app.key('Escape')
  await app.sleep(200)
  check('Esc closes the panel', !(await app.eval(`return !!document.querySelector('[data-meeting-panel]')`)))

  await app.click('[data-meeting="Partner portal design review"]')
  await app.waitFor('[data-meeting-panel]')
  await app.clickText('Review margin model', '.mt-task')
  await app.waitFor('[data-next-meeting]')
  const next = await text(app, '[data-next-meeting]')
  check('The task editor shows the next meeting with who asked', next.includes('Next meeting with Priya') && next.includes('Partner portal design review'), next)
  await app.screenshot(join(shots, 'calendar-task.png'))

  await app.clickText('People', '.tab')
  await app.clickText('Marco Ruiz', '.r')
  await app.waitFor('[data-person-meetings]')
  check('The person editor lists their meetings this week', (await text(app, '[data-person-meetings]')).includes('Partner portal design review'))

  await app.clickText('Today', '.tab')
  await app.waitFor('[data-meetings-card] .mt')
  await app.click('[data-meeting="Partner portal design review"]')
  await app.waitFor('[data-meeting-panel]')
  await app.clickText('+ Add to People', 'button')
  await app.sleep(400)
  const name = await app.eval(`return document.querySelector('.title-inp')?.value ?? ''`)
  const email = await app.eval(`return [...document.querySelectorAll('input.inp')].find((i) => i.placeholder === 'name@company.com')?.value ?? ''`)
  check('+ Add to People starts a person with their name and email', name === 'Jordan Blake' && email === 'jordan@example.com', `${name} ${email}`)

  await app.click('button[title="Settings"]')
  await app.sleep(300)
  check('Windows has no Apple Calendar settings', !(await app.eval(`return !!document.querySelector('[data-apple-calendar-settings]')`)))
  check('No errors in the page', app.errors.length === 0, app.errors.join(' | '))
} catch (err) {
  check('Outlook run finished', false, err.message)
} finally {
  await app.close()
}

// Apple Calendar (Mac) wording: nothing until calendars are chosen in Settings.
process.env.COS_MAIL_APP = 'apple-mail'
// An empty fixture mailbox, so Settings → Apple Mail never asks the real Mail for its accounts.
const mailFixture = join(tmpdir(), 'cos-e2e-calendar-mail.json')
writeFileSync(mailFixture, JSON.stringify({ me: { name: 'Frank Cusano', addresses: ['frank@example.com'] }, messages: [] }))
process.env.COS_OUTLOOK_FIXTURE = mailFixture
app = await start(join(tmpdir(), 'cos-e2e-calendar-mac'), 9334)
try {
  await app.clickText('Tasks', '.tab')
  await app.clickText('Today', '.tab')
  await app.waitFor('[data-meetings-card]')
  check('Apple Calendar asks for calendars first', (await text(app, '[data-meetings-card]')).includes('Choose calendars to read in'))
  await app.clickText('Settings', '[data-meetings-card] button')
  await app.waitFor('[data-apple-calendar-settings] input[type=checkbox]')
  const box = await text(app, '[data-apple-calendar-settings]')
  check('Settings lists the calendars, none ticked', box.includes('Calendar') && box.includes('Exchange') && !(await app.eval(`return document.querySelector('[data-apple-calendar-settings] input').checked`)), box)
  await app.click('[data-apple-calendar-settings] input[type=checkbox]')
  await app.sleep(500)
  await app.screenshot(join(shots, 'calendar-settings.png'))
  await app.clickText('Today', '.tab')
  await app.waitFor('[data-meetings-card] .mt')
  check('Ticking a calendar reads it', (await text(app, '[data-meetings-card]')).includes('Partner portal design review'))
  await app.click('[data-meeting="Partner portal design review"]')
  await app.waitFor('[data-meeting-panel]')
  check('The panel offers Open in Calendar on the Mac', (await text(app, '[data-meeting-panel]')).includes('Open in Calendar'))
  check('No errors in the page', app.errors.length === 0, app.errors.join(' | '))
} catch (err) {
  check('Apple Calendar run finished', false, err.message)
} finally {
  await app.close()
}

console.log(results.join('\n'))
process.exitCode = results.some((r) => r.startsWith('FAIL')) ? 1 : 0
