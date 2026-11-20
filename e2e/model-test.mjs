// Developer Tools and the model test, end to end. A tiny fake Ollama server offers two models that
// answer with different canned suggestions, so a test can compare them without sending anything.
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch } from './cdp.mjs'

const here = import.meta.dirname
const appDir = resolve(here, '..')
const dataDir = join(tmpdir(), 'cos-e2e-model-test')
const shots = join(here, 'shots')
mkdirSync(shots, { recursive: true })
const results = []
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)

const s = (o) => ({
  kind: 'new_task', task_id: null, title: '', details: '', due_date: null, project_id: null, project_name: null, requester_name: null,
  waiting_on: null, brief_scope: null, brief_owner_id: null, role: null, company: null, email: null, evidence: 'quote', ...o,
})
const ANSWERS = {
  'fake:1b': [s({ title: 'Send Dana the price list', due_date: '2026-11-21' })],
  'fake:7b': [s({ title: 'Send Dana the revised price list', due_date: '2026-11-21' }), s({ kind: 'waiting_on', title: 'Finance approval', waiting_on: 'Priya Shah' })],
}
const asked = []
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    res.setHeader('content-type', 'application/json')
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'fake:1b' }, { name: 'fake:7b' }] }))
    if (req.url === '/api/chat') {
      const { model, think } = JSON.parse(body)
      asked.push({ model, think })
      return res.end(JSON.stringify({ message: { content: JSON.stringify({ suggestions: ANSWERS[model] ?? [] }) }, done_reason: 'stop', prompt_eval_count: 100 }))
    }
    res.statusCode = 404
    res.end('{}')
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const ollamaUrl = `http://127.0.0.1:${server.address().port}`

const app = await launch({ appDir, dataDir, port: 9347 })
try {
  // Point Ollama at the fake server and pick its model through Settings, as a person would.
  const setInput = (sel, value) =>
    `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(${sel}, ${JSON.stringify(value)}); ${sel}.dispatchEvent(new Event('input',{bubbles:true}))`
  await app.click('.iconbtn[title="Settings"]')
  await app.waitFor('[data-dev-tools]')
  await app.eval(`const e = [...document.querySelectorAll('main .field')].find(f => f.textContent.startsWith('Ollama address')).querySelector('input'); e.closest('details').open = true; e.focus(); ${setInput('e', ollamaUrl)}; e.blur()`)
  await app.sleep(800)
  await app.click('[data-ai-button]')
  await app.waitFor('.model-menu .mm-item')
  await app.clickText('Ollama fake:1b', '.mm-item')
  await app.sleep(400)
  // A past import, read by that model, to test on.
  await app.eval(`await window.cos['sources.importAndExtract']({ content: 'Dana: can you send the revised Q1 price list by Friday? Finance still has to approve the discount.' }); return true`)
  check('the import was read by the fake model', asked.some((a) => a.model === 'fake:1b'), JSON.stringify(asked))
  const reviewBefore = await app.eval(`return window.cos['suggestions.count']()`)
  asked.length = 0

  // Developer Tools: off at first, so no Effort; on, Effort and Passes appear under Model.
  check('Developer Tools is off at first, with no Effort', await app.eval(`return !document.querySelector('[data-effort]') && document.querySelector('[data-dev-tools] .switch').getAttribute('aria-checked') === 'false'`))
  await app.click('[data-dev-tools] .switch')
  await app.waitFor('[data-effort]')
  const fields = await app.eval(`return [...document.querySelectorAll('[data-effort] option, [data-passes] option')].map(o => o.textContent)`)
  check('Ollama shows Effort and Passes', JSON.stringify(fields) === JSON.stringify(['Low', 'Medium', 'High', 'Split', 'Single']), JSON.stringify(fields))
  check('each has an ⓘ', (await app.eval(`return document.querySelectorAll('[data-effort] .info-tip, [data-passes] .info-tip').length`)) === 2)
  await app.screenshot(join(shots, 'model-test-settings.png'))

  // Ctrl+K lists Model test while Developer Tools is on.
  await app.key('k', { ctrl: true })
  await app.waitFor('.palette')
  await app.type('Model test')
  check('Ctrl+K has Model test', (await app.eval(`return document.querySelector('.palette .pi.cur')?.textContent ?? ''`)).includes('Model test'))
  await app.key('Escape')

  // Past tests, then a new test with both models.
  await app.click('[data-open-model-test]')
  await app.waitFor('[data-model-tests]')
  check('opens on Past tests, empty', (await app.eval(`return document.querySelector('main')?.textContent ?? ''`)).includes('No model tests yet'))
  await app.click('[data-new-test]')
  await app.waitFor('[data-source]')
  await app.click('[data-source] input')
  await app.waitFor('[data-model-row]')
  await app.click('[data-add-model]')
  await app.eval(`
    const sel = document.querySelectorAll('[data-model-row] select[aria-label="Model"]')[1];
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'local|fake:7b');
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const eff = document.querySelectorAll('[data-model-row] select[aria-label="Effort"]')[1];
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(eff, 'medium|single');
    eff.dispatchEvent(new Event('change', { bubbles: true }));
    return true`)
  await app.sleep(300)
  const setupText = await app.eval(`return document.querySelector('main').textContent`)
  check('counts the runs', setupText.includes('1 import × 2 models = 2 runs'), setupText.match(/imports? ×[^=]+= \d+ runs/)?.[0])
  check('no Anthropic line', !/Anthropic/.test(setupText))
  await app.screenshot(join(shots, 'model-test-setup.png'))
  await app.click('[data-run-test]')
  await app.waitFor('[data-run] [data-suggestion]', 15000)
  await app.sleep(500)

  const thinks = asked.map((a) => `${a.model}:${a.think}`)
  check('each model ran with its own effort', thinks.includes('fake:1b:false') && thinks.includes('fake:7b:true'), JSON.stringify(thinks))
  check('the 7b model ran once (single pass)', asked.filter((a) => a.model === 'fake:7b').length === 1)
  const cols = await app.eval(`return [...document.querySelectorAll('[data-run]')].map(c => c.querySelectorAll('[data-suggestion]').length)`)
  check('one column per model, with what each found', JSON.stringify(cols) === '[1,2]', JSON.stringify(cols))
  check('nothing went to Review', (await app.eval(`return window.cos['suggestions.count']()`)) === reviewBefore)

  // Marking: accepted, then rejected, then neither; the best column gets the green edge.
  const second = `[data-run]:nth-child(2) [data-suggestion]`
  await app.click(second)
  await app.sleep(200)
  check('a click marks it accepted', await app.eval(`return document.querySelector('${second}').classList.contains('accepted') && document.querySelector('[data-run]:nth-child(2)').classList.contains('best')`))
  const next = `[data-run]:nth-child(2) [data-suggestion] + [data-suggestion]`
  await app.click(next)
  await app.sleep(150)
  await app.click(next)
  await app.sleep(200)
  const head = await app.eval(`return document.querySelector('[data-run]:nth-child(2) .mt-col-head').textContent`)
  check('the column counts accepted and rejected', head.includes('1 accepted') && head.includes('1 rejected'), head)
  await app.screenshot(join(shots, 'model-test-results.png'))

  // Summary, then back to Past tests with the test listed.
  await app.click('[data-summary]')
  await app.waitFor('[data-model-test-summary]')
  const summary = await app.eval(`return [...document.querySelectorAll('[data-model-test-summary] tbody tr')].map(r => [...r.children].slice(0, 4).map(c => c.textContent).join('|'))`)
  check('Summary compares the models', JSON.stringify(summary) === JSON.stringify(['Ollama fake:1b · Low|0|0|0%', 'Ollama fake:7b · Medium · Single|1|1|100%']), JSON.stringify(summary))
  await app.screenshot(join(shots, 'model-test-summary.png'))
  await app.clickText('← Results', 'button')
  await app.clickText('← Past tests', 'button')
  await app.waitFor('[data-test-row]')
  const row = await app.eval(`return document.querySelector('[data-test-row]').textContent`)
  check('Past tests lists it with the leader and what is unmarked', row.includes('Ollama fake:7b · Medium · Single') && row.includes('1'), row)
  await app.screenshot(join(shots, 'model-test-past.png'))

  // Turning Developer Tools off hides Effort again.
  await app.click('.iconbtn[title="Settings"]')
  await app.waitFor('[data-dev-tools]')
  await app.click('[data-dev-tools] .switch')
  await app.sleep(300)
  check('off again: no Effort, no model test button', await app.eval(`return !document.querySelector('[data-effort]') && !document.querySelector('[data-open-model-test]')`))
} catch (err) {
  check('suite ran to the end', false, err instanceof Error ? err.message : String(err))
  await app.screenshot(join(shots, 'model-test-failure.png')).catch(() => {})
} finally {
  await app.close()
  server.close()
}

console.log(results.join('\n'))
if (results.some((r) => r.startsWith('FAIL'))) process.exit(1)
