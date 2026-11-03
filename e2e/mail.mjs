// Outlook mail: Check Outlook, skipped list, Read, Recent imports, Review (needs reply, waiting on), Waiting follow-up.
// Outlook is replaced by a fixture file (COS_OUTLOOK_FIXTURE), which the app only honors for test data folders.
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './cdp.mjs'

const here = import.meta.dirname
const appDir = resolve(here, '..')
const dataDir = join(tmpdir(), 'cos-e2e-mail')
const shots = join(here, 'shots')
mkdirSync(shots, { recursive: true })
const results = []
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
const text = (app, selector) => app.eval(`return document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`)

const ago = (days) => new Date(Date.now() - days * 86_400_000).toISOString()
let n = 0
const msg = (o) => ({
  entryId: `E${++n}`, storeId: 'S', messageId: `<e2e-${n}@example.com>`, conversationId: 'C', topic: '', subject: '', messageClass: 'IPM.Note', isMail: true,
  direction: 'received', folder: 'Inbox', from: '', fromEmail: '', to: 'Frank Cusano', cc: '', time: ago(1), listUnsubscribe: false, listId: '', precedence: '', autoSubmitted: '', body: '', ...o,
})
const fixture = join(tmpdir(), 'cos-e2e-mail-fixture.json')
writeFileSync(
  fixture,
  JSON.stringify({
    me: { name: 'Frank Cusano', addresses: ['frank@example.com'] },
    messages: [
      msg({ conversationId: 'A', subject: 'Q1 dealer pricing', from: 'Dana Lee', fromEmail: 'dana@example.com', body: 'Hi Frank,\nCan you confirm the tier 2 discount by Friday?' }),
      msg({ conversationId: 'B', subject: 'Touch panel spec', direction: 'sent', folder: 'Sent Items', from: 'Frank Cusano', fromEmail: 'frank@example.com', to: 'Tom Alvarez', time: ago(6), body: 'Tom, could you send your comments on sections 2 and 3?' }),
      msg({ conversationId: 'N', subject: 'Industry weekly digest', from: 'Newsletter', fromEmail: 'news@example.com', listUnsubscribe: true, body: 'Can you believe these stories?' }),
    ],
  }),
)
process.env.COS_OUTLOOK_FIXTURE = fixture

const app = await launch({ appDir, dataDir })
try {
  await app.clickText('Import', '.tab')
  await app.waitFor('main select')
  check('first run says never imported', (await text(app, '[data-outlook]')).includes('never imported'))
  check('first run starts 7 days back', (await app.eval(`return document.querySelector('main select').value`)) === '7')

  await app.clickText('Check Outlook', 'main button')
  await app.waitFor('.stats', 10000)
  const stats = await text(app, '.stats')
  check('check counts', stats.includes('2received') && stats.includes('1sent') && stats.includes('3conversations') && stats.includes('1skipped') && stats.includes('2to read'), stats)
  check('nothing read yet', (await app.eval(`return (await window.cos['mail.imports']()).length`)) === 0)
  await app.clickText('Skipped conversations', 'main button')
  const skipped = await app.eval(`return [...document.querySelectorAll('main .list')][0].textContent`)
  check('skipped list says why', skipped.includes('Industry weekly digest') && skipped.includes('Newsletter or mailing list'), skipped)
  await app.screenshot(join(shots, 'mail-01-check.png'))

  await app.clickText('Read 2 conversations', 'main button')
  for (let i = 0; i < 80 && !(await text(app, '[data-outlook]')).includes('conversations read'); i++) await app.sleep(100)
  const done = await text(app, '[data-outlook]')
  check('reads and reports', done.includes('2 conversations read') && /\d+ suggestions? to review/.test(done), done)
  check('recent imports has one mail row', (await app.eval(`return [...document.querySelectorAll('main .ttl')].filter(t => t.textContent.startsWith('Outlook mail · 2 conversations')).length`)) === 1)
  await app.clickText('Conversations', 'main button')
  check('conversations listed with Open in Outlook', (await app.eval(`return [...document.querySelectorAll('main button')].filter(b => b.textContent === 'Open in Outlook').length`)) === 2)
  await app.screenshot(join(shots, 'mail-02-read.png'))

  await app.clickText('Go to Review', 'main button')
  await app.waitFor('[data-suggestion]')
  const chips = await app.eval(`return [...document.querySelectorAll('[data-suggestion] .chip')].map(c => c.textContent)`)
  check('Review shows Needs reply and Waiting on', chips.includes('Needs reply') && chips.includes('Waiting on'), JSON.stringify(chips))
  check('Review groups have Open in Outlook', (await app.eval(`return [...document.querySelectorAll('main button')].some(b => b.textContent === 'Open in Outlook')`)) === true)
  await app.screenshot(join(shots, 'mail-03-review.png'))

  const ids = await app.eval(`const p = await window.cos['suggestions.listPending'](); return { reply: p.find(s => s.kind === 'needs_reply')?.id, wait: p.find(s => s.kind === 'waiting_on')?.id }`)
  await app.click(`[data-suggestion="${ids.reply}"]`)
  await app.key('a')
  await app.sleep(300)
  const task = await app.eval(`return (await window.cos['tasks.listActive']()).find(t => t.title.startsWith('Reply to Dana'))?.title ?? null`)
  check('accepting makes a Reply to task', task === 'Reply to Dana: Q1 dealer pricing', String(task))
  await app.click(`[data-suggestion="${ids.wait}"]`)
  await app.key('a')
  await app.sleep(300)

  await app.clickText('Waiting', '.tab')
  await app.sleep(300)
  const waiting = await text(app, 'main .list')
  check('waiting item from sent mail, flagged for follow-up', waiting.includes('Tom Alvarez') && waiting.includes('Follow up'), waiting)
  await app.screenshot(join(shots, 'mail-04-waiting.png'))

  await app.clickText('Import', '.tab')
  await app.waitFor('main select')
  check('remembers the last import', (await text(app, '[data-outlook]')).includes('last imported today'))
  check('next check starts at the last import', (await app.eval(`return document.querySelector('main select').value`)) === 'last')
  await app.eval(`const s = document.querySelector('main select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '7'); s.dispatchEvent(new Event('change', { bubbles: true }))`)
  await app.clickText('Check Outlook', 'main button')
  await app.waitFor('.stats', 10000)
  const again = await text(app, '.stats')
  check('mail is never read twice', again.includes('2read before') && again.includes('0to read'), again)
  check('no console errors', app.errors.length === 0, app.errors.join(' | '))
} catch (err) {
  check('suite ran to the end', false, err.message)
} finally {
  await app.close()
}
console.log(results.join('\n'))
process.exitCode = results.some((r) => r.startsWith('FAIL')) ? 1 : 0
