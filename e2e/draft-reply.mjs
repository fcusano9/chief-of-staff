// Draft replies: the Reply card on a "Reply to" task from Outlook mail. With Basic it's greyed out with
// a Settings link; with a model (a fake Ollama here) Draft reply shows To, Cc and the AI's Reply all /
// Reply pick, the text can be edited, Try again takes a note, and Save to Outlook Drafts hands it to
// Outlook (a fixture, COS_OUTLOOK_FIXTURE, which writes <fixture>.drafts.json) and notes it in Activity.
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './cdp.mjs'

const here = import.meta.dirname
const appDir = resolve(here, '..')
const dataDir = join(tmpdir(), 'cos-e2e-draft-reply')
const shots = join(here, 'shots')
mkdirSync(shots, { recursive: true })
const results = []
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
const text = (app, selector) => app.eval(`return document.querySelector(${JSON.stringify(selector)})?.innerText ?? ''`)

const ago = (days) => new Date(Date.now() - days * 86_400_000).toISOString()
const fixture = join(tmpdir(), 'cos-e2e-draft-reply-fixture.json')
const drafts = `${fixture}.drafts.json`
rmSync(drafts, { force: true })
writeFileSync(
  fixture,
  JSON.stringify({
    me: { name: 'Frank Cusano', addresses: ['frank@example.com'] },
    messages: [
      {
        entryId: 'E1', storeId: 'S', messageId: '<e2e-1@example.com>', conversationId: 'A', topic: '', subject: 'Q1 dealer pricing', messageClass: 'IPM.Note', isMail: true,
        direction: 'received', folder: 'Inbox', from: 'Dana Lee', fromEmail: 'dana@example.com', to: 'Frank Cusano; Priya Shah', cc: 'Marcus Webb', time: ago(1),
        listUnsubscribe: false, listId: '', precedence: '', autoSubmitted: '', body: 'Hi Frank,\nCan you confirm the tier 2 discount by Friday?',
      },
    ],
  }),
)
process.env.COS_OUTLOOK_FIXTURE = fixture

// A fake local model: every chat answers with a draft; the second one (Try again) is different.
const chats = []
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'fake:1b' }] }))
    if (req.url === '/api/chat') {
      chats.push(JSON.parse(body))
      const answer = chats.length === 1 ? { reply_all: true, body: 'Hi Dana,\n\nYes, tier 2 works.\n\nFrank' } : { reply_all: true, body: 'Hi Dana,\n\nYes, but Friday is tight. [date] works better.\n\nFrank' }
      return res.end(JSON.stringify({ message: { content: JSON.stringify(answer) }, done_reason: 'stop', prompt_eval_count: 100 }))
    }
    res.statusCode = 404
    res.end('{}')
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const ollamaUrl = `http://127.0.0.1:${server.address().port}`

const openReplyTask = async (app) => {
  await app.clickText('Tasks', '.tab')
  await app.waitFor('.pane.left .r')
  await app.clickText('Reply to Dana', '.pane.left .r')
  await app.waitFor('[data-testid="reply-card"]')
  await app.sleep(300)
}

let app = await launch({ appDir, dataDir })
try {
  // Import the email with Basic and accept its "Reply to" task, as a user would.
  await app.eval(`
    const c = await window.cos['mail.check'](new Date(Date.now() - 7 * 86400000).toISOString());
    await window.cos['mail.read'](c.id, c.conversations.map(x => x.key));
    for (let i = 0; i < 100 && (await window.cos['mail.status']()).state === 'reading'; i++) await new Promise(r => setTimeout(r, 50));
    const s = (await window.cos['suggestions.listPending']()).find(x => x.kind === 'needs_reply');
    await window.cos['suggestions.accept'](s.id);
    return true`)
  await openReplyTask(app)
  const basic = await text(app, '[data-testid="reply-card"]')
  check('Reply card names the email', basic.includes('To the email “Q1 dealer pricing” from Dana Lee'), basic)
  check('Basic: Settings note and no Draft reply', basic.includes('Select an AI model in Settings to use this feature.') && (await app.eval(`return [...document.querySelectorAll('[data-testid="reply-card"] button')].find(b => b.textContent.includes('Draft reply')).disabled`)), basic)
  check('a task with no email has no Reply card', await app.eval(`
    await window.cos['tasks.save']({id:0,title:'Plain task',notes:null,status:'open',dueDate:null,projectId:null,requesterId:null,priorityOverride:null,followUpCount:0,waitingOn:null,subtasks:[]});
    return (await window.cos['replies.target']((await window.cos['tasks.listActive']({})).find(t => t.title === 'Plain task').id)) === null`))
} catch (e) {
  results.push(`ERROR  ${e.stack}`)
} finally {
  await app.close()
}

// Switch to the fake local model and come back.
const settingsPath = join(dataDir, 'settings.json')
writeFileSync(settingsPath, JSON.stringify({ ...JSON.parse(readFileSync(settingsPath, 'utf8')), aiProvider: 'local', localUrl: ollamaUrl, localModel: 'fake:1b', replyStyle: 'Short and direct.' }))
app = await launch({ appDir, dataDir, fresh: false })
try {
  await openReplyTask(app)
  await app.clickText('Draft reply', '[data-testid="reply-card"] button')
  await app.waitFor('textarea[aria-label="Draft reply"]', 10000)
  const card = await text(app, '[data-testid="reply-card"]')
  check('preview shows recipients, the AI pick and subject', card.includes('Dana Lee; Priya Shah') && card.includes('Marcus Webb') && card.includes('AI pick') && card.includes('RE: Q1 dealer pricing'), card)
  check('the draft text is shown, editable', (await app.eval(`return document.querySelector('textarea[aria-label="Draft reply"]').value`)) === 'Hi Dana,\n\nYes, tier 2 works.\n\nFrank')
  const sent = JSON.stringify(chats[0]?.messages ?? [])
  check('the AI got the thread, the task and the style note', sent.includes('Can you confirm the tier 2 discount by Friday?') && sent.includes('Reply to Dana') && sent.includes('Short and direct.'))
  check('nothing reaches Outlook before saving', !existsSync(drafts))
  await app.screenshot(join(shots, 'draft-reply-01-preview.png'))

  // Try again with a note.
  await app.clickText('Try again', '[data-testid="reply-card"] button')
  await app.waitFor('input[aria-label="What should change"]')
  await app.type('Friday is tight')
  await app.clickText('Rewrite', '[data-testid="reply-card"] button')
  for (let i = 0; i < 50 && !(await app.eval(`return document.querySelector('textarea[aria-label="Draft reply"]')?.value.includes('[date]')`)); i++) await app.sleep(100)
  const retry = JSON.stringify(chats[1]?.messages ?? [])
  check('Try again sends the note and the previous draft', retry.includes('Friday is tight') && retry.includes('Yes, tier 2 works.'))
  check('the new draft replaces the old one', (await app.eval(`return document.querySelector('textarea[aria-label="Draft reply"]').value`)).includes('[date] works better'))

  // Switch to Reply, edit, save.
  await app.clickText('Reply', '[data-testid="reply-card"] .rp-seg button:last-child')
  await app.sleep(200)
  const one = await text(app, '[data-testid="reply-card"]')
  check('Reply goes to the sender only, and the AI pick mark goes', !one.includes('Priya Shah') && !one.includes('AI pick'), one)
  await app.eval(`const t = document.querySelector('textarea[aria-label="Draft reply"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t, t.value.replace('[date]', 'Monday')); t.dispatchEvent(new Event('input',{bubbles:true})); return true`)
  await app.clickText('Save to Outlook Drafts', '[data-testid="reply-card"] button')
  await app.sleep(500)
  const saved = existsSync(drafts) ? JSON.parse(readFileSync(drafts, 'utf8')) : []
  check('saved to Drafts as Reply, with the edit', saved.length === 1 && saved[0].replyAll === false && saved[0].entryId === 'E1' && saved[0].body.includes('Monday works better'), JSON.stringify(saved))
  const after = await text(app, '[data-testid="reply-card"]')
  check('says saved, with Open in Outlook', after.includes('Saved to Outlook Drafts') && after.includes('Open in Outlook'), after)
  check('Activity notes the draft', (await text(app, '.pane.right')).includes('Draft reply saved to Outlook Drafts'))
  check('the task stays open', (await app.eval(`return (await window.cos['tasks.listActive']({})).some(t => t.title.startsWith('Reply to Dana'))`)))
  await app.screenshot(join(shots, 'draft-reply-02-saved.png'))
  check('no renderer errors', app.errors.length === 0, app.errors.join(' | '))
} catch (e) {
  results.push(`ERROR  ${e.stack}`)
} finally {
  await app.close()
  server.close()
}
console.log(results.join('\n'))
if (results.some((r) => !r.startsWith('PASS'))) process.exitCode = 1
