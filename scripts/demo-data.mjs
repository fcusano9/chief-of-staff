// Fills the dev copy of the app ("Chief of Staff (dev)") with realistic made-up data, so
// `npm run dev` has something to look at. Usage: npm run demo:data
//
// It starts the built app in the background and adds everything through the app's own API, the
// same way the UI does, so the data goes through the real checks. The installed app's real data
// is never touched. Any existing dev data is moved aside first, not deleted.
import { existsSync, lstatSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from '../e2e/cdp.mjs'

const appDir = resolve(import.meta.dirname, '..')

/** Electron's appData folder, which is where `npm run dev` keeps "Chief of Staff (dev)". */
function appDataFolder() {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support')
  if (process.platform === 'win32') return process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
  return process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
}
const dataDir = process.env.COS_DATA_DIR ?? join(appDataFolder(), 'Chief of Staff (dev)')

// The app keeps a lock file in its data folder while it runs.
const running = ['SingletonLock', 'lockfile'].some((f) => {
  try {
    lstatSync(join(dataDir, f))
    return true
  } catch {
    return false
  }
})
if (running) {
  console.error('The dev copy of Chief of Staff seems to be running. Close it, then run this again.')
  process.exit(1)
}

if (existsSync(join(dataDir, 'chiefofstaff.db'))) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  const aside = `${dataDir} backup ${stamp}`
  renameSync(dataDir, aside)
  console.log(`Moved your existing dev data to:\n  ${aside}`)
}

/** YYYY-MM-DD, n days from today. */
const day = (n) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString()

const app = await launch({ appDir, dataDir, fresh: false, port: 9340 })
const api = (name, ...args) => app.eval(`return await window.cos[${JSON.stringify(name)}](...${JSON.stringify(args)})`)

try {
  // People: Frank's manager, peers, finance, sales, engineering, and two outside contacts.
  const people = {}
  for (const [key, p, brief] of [
    ['dana', { name: 'Dana Lee', role: 'VP, Product', company: null, email: 'dana.lee@example.com', priorityWeight: 5 }, 'Frank’s manager. Owns the 2027 roadmap review; wants pre-reads 24 hours before exec meetings.'],
    ['marcus', { name: 'Marcus Webb', role: 'UX lead', company: null, email: 'marcus.webb@example.com', priorityWeight: 3 }, 'Leads UX for the partner portal. Prefers feedback in Figma comments.'],
    ['priya', { name: 'Priya Shah', role: 'Finance', company: null, email: 'priya.shah@example.com', priorityWeight: 4 }, 'Owns the margin model for the pricing refresh.'],
    ['tom', { name: 'Tom Alvarez', role: 'Sales, EMEA', company: null, email: 'tom.alvarez@example.com', priorityWeight: 4 }, 'Main channel to EMEA distributors.'],
    ['kenji', { name: 'Kenji Mori', role: 'Firmware engineering lead', company: null, email: 'kenji.mori@example.com', priorityWeight: 3 }, 'Runs DM-NVX firmware releases.'],
    ['alex', { name: 'Alex Rivera', role: 'Training manager', company: null, email: null, priorityWeight: 3 }, 'Runs the dealer training program.'],
    ['jordan', { name: 'Jordan Kim', role: 'Account manager', company: 'Northwind AV', email: 'jordan.kim@example.com', priorityWeight: 2 }, 'Dealer contact; wants to be a pilot dealer for the new tiers.'],
    ['rachel', { name: 'Rachel Kim', role: 'IT director', company: 'Lakeside Hotels', email: null, priorityWeight: 3 }, 'Customer designing a new conference center.'],
  ]) {
    const saved = await api('people.save', { id: 0, ...p })
    await api('people.saveBrief', saved.id, brief, 'user')
    people[key] = saved.id
  }

  // Projects, with overviews and status briefs; one archived so the archive has something in it.
  const projects = {}
  for (const [key, p, overview, brief] of [
    ['roadmap', { name: 'Roadmap 2027', color: '#7F77DD', status: 'active' }, 'The 2027 product roadmap for the exec team.', 'Exec team dropped the three-year view; deck now covers 2027 only. Due to Dana in two weeks.'],
    ['portal', { name: 'Partner portal', color: '#378ADD', status: 'active' }, 'New dealer and partner portal. Marcus Webb leads UX.', 'Wireframes being revised for four pricing tiers. Training tile added to the dashboard.'],
    ['pricing', { name: 'Pricing refresh', color: '#1D9E75', status: 'active' }, 'New dealer pricing tiers for 2027.', 'Decided: four tiers, effective Q2, pending Priya’s margin model.'],
    ['training', { name: 'Dealer training program', color: '#D85A30', status: 'active' }, 'Online certification courses for dealers, live with the new tiers.', null],
    ['nvx', { name: 'DM-NVX 3.2 launch', color: '#D4537E', status: 'on_hold' }, 'Firmware 3.2 release and dealer communication.', 'Firmware passed QA; waiting on the dealer FAQ before publishing.'],
    ['ise', { name: 'ISE 2026 booth', color: '#BA7517', status: 'archived' }, 'Trade show booth and demos.', 'Done. Lessons learned filed.'],
  ]) {
    const saved = await api('projects.save', { id: 0, ...p })
    await api('projects.saveOverview', saved.id, overview)
    if (brief) await api('projects.saveBrief', saved.id, brief, 'user')
    projects[key] = saved.id
  }

  // Tasks: a spread of due dates (overdue, today, this week, later, none), statuses, requesters,
  // subtasks, a manual priority, and waiting-on items that have been waiting a while.
  const task = (o) => ({ id: 0, notes: null, status: 'open', dueDate: null, projectId: null, requesterId: null, priorityOverride: null, followUpCount: 0, waitingOn: null, subtasks: [], ...o })
  const sub = (title, isDone = false) => ({ id: 0, title, isDone })
  const tasks = {}
  for (const [key, t] of [
    ['slides', task({ title: 'Roadmap slides for Q1 planning', dueDate: day(12), projectId: projects.roadmap, requesterId: people.dana, notes: 'Ten slides max. 2027 only.', subtasks: [sub('Outline', true), sub('Draft slides'), sub('Send pre-read to Dana')] })],
    ['cab', task({ title: 'Customer advisory board agenda', dueDate: day(2), projectId: projects.roadmap, requesterId: people.dana })],
    ['wireframes', task({ title: 'Approve partner portal wireframes', dueDate: day(-2), projectId: projects.portal, requesterId: people.marcus, notes: 'Wait for the four-tier revision before approving.' })],
    ['tile', task({ title: 'Review Training tile design', dueDate: day(9), projectId: projects.portal })],
    ['announce', task({ title: 'Draft dealer announcement for new tiers', dueDate: day(17), projectId: projects.pricing, notes: 'Placeholders for discount percentages. Include a short FAQ.' })],
    ['pricelist', task({ title: 'Send updated price list to Munich distributor', dueDate: day(0), projectId: projects.pricing, requesterId: people.tom })],
    ['pilotsheet', task({ title: 'Send pilot pricing sheet to Jordan', dueDate: day(4), projectId: projects.pricing, requesterId: people.jordan })],
    ['outline', task({ title: 'Send course outline to Alex', dueDate: day(3), projectId: projects.training, requesterId: people.alex })],
    ['pilotdealers', task({ title: 'Pick three pilot dealers for training', projectId: projects.training })],
    ['faq', task({ title: 'Dealer FAQ for DM-NVX 3.2 firmware', dueDate: day(-5), projectId: projects.nvx, requesterId: people.kenji, followUpCount: 2, notes: 'Fix the rollback section (still says 3.1).' })],
    ['dante', task({ title: 'Reply to Rachel Kim: does DM-NVX support Dante', dueDate: day(3), requesterId: people.rachel })],
    ['sow', task({ title: 'Review SOW from Northside AV', dueDate: day(6) })],
    ['expense', task({ title: 'Submit October expense report', dueDate: day(-1), priorityOverride: 70 })],
    ['oneonone', task({ title: 'Prep 1:1 notes for Dana', dueDate: day(1), requesterId: people.dana })],
    ['competitor', task({ title: 'Read competitor teardown deck' })],
    ['margin', task({ title: 'Margin model for new tiers', projectId: projects.pricing, status: 'waiting_on', waitingOn: 'Priya Shah', waitingSince: daysAgo(9), dueDate: day(8) })],
    ['quotes', task({ title: 'Training platform quotes', projectId: projects.training, status: 'waiting_on', waitingOn: 'Alex Rivera', waitingSince: daysAgo(3) })],
    ['forecast', task({ title: 'Q1 EMEA forecast numbers', status: 'waiting_on', waitingOn: 'Tom Alvarez', waitingSince: daysAgo(14), followUpCount: 1 })],
    ['legal', task({ title: 'Legal review of pilot contract', projectId: projects.pricing, status: 'waiting_on', waitingOn: 'Legal', waitingSince: daysAgo(21) })],
  ]) {
    tasks[key] = (await api('tasks.save', t)).id
  }
  // Finished work, so Done has history.
  for (const t of [
    task({ title: 'Book customer visits for spring launch', projectId: projects.roadmap }),
    task({ title: 'Send ISE lessons learned', projectId: projects.ise }),
    task({ title: 'Firmware 3.2 QA sign-off', projectId: projects.nvx, requesterId: people.kenji }),
    task({ title: 'Renew demo room licenses' }),
  ]) {
    const saved = await api('tasks.save', t)
    await api('tasks.setStatus', saved.id, 'done')
  }

  // Imports read by the demo AI (runs locally, sends nothing), so Review has suggestions waiting.
  await api('sources.importAndExtract', {
    kind: 'copilot_summary',
    title: 'Copilot summary, last week',
    occurredOn: day(-3),
    content: `Copilot summary for last week
Action items:
- Frank to send the updated pricing deck to EMEA distributors by Friday.
- Marcus confirmed the partner portal wireframes still need the four-tier revision.
- Still waiting on Finance for the margin model for new tiers.
- Frank needs to book a room for the customer advisory board.
The team discussed the spring launch timeline.`,
  })
  await api('sources.importAndExtract', {
    kind: 'meeting_transcript',
    title: 'Dealer training sync',
    occurredOn: day(-1),
    content: `Alex Rivera: Thanks for joining. The course outline is the main thing we need.
Frank Cusano: I'll send the course outline to Alex by Thursday.
Alex Rivera: I'm still waiting on two platform vendors for quotes.
Frank Cusano: I will share the pilot dealer shortlist next week.`,
  })
  // Accept one suggestion so a task shows a linked source and history; leave the rest in Review.
  const pending = await api('suggestions.listPending')
  if (pending[0]) await api('suggestions.accept', pending[0].id)

  const summary = await api('tasks.summary')
  console.log(`Demo data ready in:\n  ${dataDir}`)
  console.log(`${Object.keys(people).length} people, ${Object.keys(projects).length} projects (1 archived), ${summary.open} open tasks, ${summary.waitingOn} waiting, ${summary.overdue} overdue, 4 done, ${(await api('suggestions.count'))} suggestions in Review.`)
  console.log('Run "npm run dev" to see it.')
  if (app.errors.length) console.warn(`The app reported errors while loading data:\n${app.errors.join('\n')}`)
} finally {
  await app.close()
}
