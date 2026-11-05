// AI spending: the button on Settings → AI providers → Claude, the AI spending screen (totals, the
// two tables, the period switch, the prices used and the pricing link), and estimated costs in the
// Import AI log and briefing History. Claude usage is written straight into the throwaway database,
// so nothing is sent to Anthropic.
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { launch } from './cdp.mjs'

const here = import.meta.dirname
const appDir = resolve(here, '..')
const dataDir = join(tmpdir(), 'cos-e2e-ai-spending')
const shots = join(here, 'shots')
mkdirSync(shots, { recursive: true })
const results = []
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
const text = (app, selector) => app.eval(`return document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`)

let app = await launch({ appDir, dataDir })
try {
  await app.waitFor('.tab')
  // No key yet: no spending button.
  await app.click('.iconbtn[title="Settings"]')
  await app.waitFor('[data-provider="claude"]')
  check('no AI spending button before a Claude key is saved', !(await app.eval(`return !!document.querySelector('[data-ai-spending-btn]')`)))
  await app.eval(`await window.cos['ai.setKey']('sk-ant-e2e-not-a-real-key'); return true`)
  await app.close()

  // Seed: two Claude imports (Opus, Sonnet), a Claude briefing, a Haiku person brief, and one old import.
  const db = new DatabaseSync(join(dataDir, 'chiefofstaff.db'))
  const ago = (min) => new Date(Date.now() - min * 60_000).toISOString()
  const oldDate = new Date(Date.now() - 40 * 86_400_000).toISOString()
  const req = (m) => JSON.stringify({ model: m, system: 'rules', messages: [{ role: 'user', content: 'Notes' }] }, null, 2)
  db.exec(`INSERT INTO source_items (id, kind, title, occurred_at, content, content_hash, imported_at, extracted_at) VALUES (1, 'note', 'Pricing call notes', '${ago(30)}', 'x', 'e2e-h1', '${ago(30)}', '${ago(30)}')`)
  db.exec(`INSERT INTO extraction_runs (id, source_id, provider, started_at, finished_at, raw_output, kept_output) VALUES (1, 1, 'Claude Opus 5.5', '${ago(30)}', '${ago(29)}', '[]', '[]')`)
  db.prepare(`INSERT INTO ai_calls (run_id, purpose, endpoint, request, response, error, started_at, duration_ms, input_tokens, output_tokens) VALUES (1, 'Find suggestions', 'Anthropic Messages API (POST /v1/messages)', ?, ?, NULL, ?, 14200, 9000, 1200)`).run(req('claude-opus-5-5'), JSON.stringify({ model: 'claude-opus-5-5', content: [] }), ago(30))
  db.prepare(`INSERT INTO briefings (id, created_at, started_by, written_by, since, content) VALUES (1, ?, 'manual', 'Claude Opus 5.5', ?, ?)`).run(ago(20), ago(1440), JSON.stringify({ summary: 'A short day.', priorities: [], nudges: [], newItems: [] }))
  db.prepare(`INSERT INTO briefing_ai_calls (briefing_id, purpose, endpoint, request, response, error, started_at, duration_ms, input_tokens, output_tokens) VALUES (1, 'Write the briefing', 'Anthropic Messages API (POST /v1/messages)', ?, ?, NULL, ?, 6800, 6000, 900)`).run(req('claude-opus-5-5'), JSON.stringify({ model: 'claude-opus-5-5', content: [] }), ago(20))
  const use = db.prepare('INSERT INTO ai_usage (at, purpose, model, input_tokens, output_tokens, briefing_id) VALUES (?, ?, ?, ?, ?, ?)')
  use.run(ago(30), 'import', 'claude-opus-5-5', 9000, 1200, null) // $0.060
  use.run(ago(25), 'import', 'claude-sonnet-5-5', 12000, 1500, null) // $0.039
  use.run(ago(20), 'briefing', 'claude-opus-5-5', 6000, 900, 1) // $0.042
  use.run(ago(10), 'person_brief', 'claude-haiku-5-5', 2000, 300, null) // $0.00035
  use.run(oldDate, 'import', 'claude-opus-5-5', 9000, 1200, null) // outside both periods
  db.close()

  app = await launch({ appDir, dataDir, fresh: false })
  await app.waitFor('.tab')
  await app.click('.iconbtn[title="Settings"]')
  await app.waitFor('[data-ai-spending-btn]')
  const btn = await text(app, '[data-ai-spending-btn]')
  check('Settings: Claude has an AI spending button with this month’s estimate', btn === 'AI spending · $0.141 this month', btn)
  check('Settings: no spending tables on the Settings page itself', !(await app.eval(`return !!document.querySelector('.usage-table')`)))
  await app.screenshot(join(shots, 'ai-spending-01-settings.png'))

  await app.click('[data-ai-spending-btn]')
  await app.waitFor('[data-ai-spending]')
  const page = await text(app, '[data-ai-spending]')
  check('screen: says what is counted and what is free', page.includes('Basic and Ollama models are free'))
  const stats = await app.eval(`return [...document.querySelectorAll('[data-ai-spending] .stat')].map(s => s.textContent)`)
  check('screen: this month, last 30 days and average import', JSON.stringify(stats) === JSON.stringify(['$0.141', '$0.141', '$0.050']), JSON.stringify(stats))
  check('screen: tokens sent per import', page.includes('10,500 tokens sent per import'))
  const rows = await app.eval(`return [...document.querySelectorAll('[data-ai-spending] .usage-table')].slice(0, 2).map(t => [...t.querySelectorAll('tbody tr')].map(r => [...r.cells].slice(0, 6).map(c => c.textContent).join(' | ')))`)
  check('screen: by purpose, most expensive first', JSON.stringify(rows[0]) === JSON.stringify(['Imports | 2 | 21,000 | 2,700 | $0.050 | $0.099', 'Daily briefings | 1 | 6,000 | 900 | $0.042 | $0.042', 'Person briefs | 1 | 2,000 | 300 | under $0.001 | under $0.001']), JSON.stringify(rows[0]))
  check('screen: by model', JSON.stringify(rows[1]?.map((r) => r.split(' | ')[0])) === JSON.stringify(['Claude Opus 5.5', 'Claude Sonnet 5.5', 'Claude Haiku 5.5']), JSON.stringify(rows[1]))
  const prices = await app.eval(`return [...document.querySelectorAll('[data-prices] tbody tr')].map(r => [...r.cells].map(c => c.textContent).join(' | '))`)
  check('screen: lists the prices used', JSON.stringify(prices) === JSON.stringify(['Claude Opus 5.5 | $4.00 | $20.00', 'Claude Sonnet 5.5 | $2.00 | $10.00', 'Claude Haiku 5.5 | $0.10 | $0.50', 'Claude Haiku 5.5, requests over 100,000 tokens | $0.50 | $2.50']), JSON.stringify(prices))
  const note = await text(app, '[data-prices] .callout-warn')
  check('screen: says prices may have changed', note.includes('as of 4 Nov 2026') && note.includes('Prices may have changed'), note)
  const link = await app.eval(`const a = document.querySelector('[data-prices] a'); return a ? [a.textContent, a.href, a.target] : null`)
  check('screen: links to Anthropic’s pricing page in the browser', link?.[1] === 'https://platform.claude.com/docs/en/about-claude/pricing' && link?.[2] === '_blank', JSON.stringify(link))
  await app.screenshot(join(shots, 'ai-spending-02-screen.png'))
  await app.clickText('Last 30 days', '[data-ai-spending] .pill')
  check('screen: Last 30 days switch', (await app.eval(`return document.querySelector('[data-ai-spending] .pill.on')?.textContent`)) === 'Last 30 days')
  await app.clickText('← Settings', 'button')
  await app.waitFor('[data-provider="claude"]')
  check('← Settings goes back', true)

  // Import AI log.
  await app.clickText('Import', '.tab')
  await app.clickText('AI log', 'main button')
  await app.waitFor('[data-call]')
  check('Import AI log: run estimate', (await text(app, '[data-run-cost]')) === 'Est. cost $0.060', await text(app, '[data-run-cost]'))
  check('Import AI log: model and estimate on the request', (await text(app, '[data-call] [data-cost]')) === 'Claude Opus 5.5 · est. $0.060', await text(app, '[data-call] [data-cost]'))
  const tip = await app.eval(`return document.querySelector('[data-call] [data-cost]')?.title`)
  check('Import AI log: hover shows the price and that it may have changed', tip?.includes('$4.00 in / $20.00 out') && tip?.includes('may have changed'), tip)
  await app.screenshot(join(shots, 'ai-spending-03-import-log.png'))

  // Briefing History.
  await app.clickText('Today', '.tab')
  await app.waitFor('[data-briefing]')
  await app.clickText('History', '[data-briefing] button')
  await app.waitFor('.b-hist-row')
  check('History: estimate under the date', (await text(app, '.b-hist-row')).includes('est. $0.042'), await text(app, '.b-hist-row'))
  await app.clickText('AI log', '.b-hist-view button')
  await app.waitFor('.b-hist-view [data-call]')
  check('History AI log: model and estimate on the request', (await text(app, '.b-hist-view [data-cost]')) === 'Claude Opus 5.5 · est. $0.042')
  const fits = await app.eval(`const c = document.querySelector('.b-hist-view [data-cost]').getBoundingClientRect(); const v = document.querySelector('.b-hist-view').getBoundingClientRect(); return c.right <= v.right && c.width > 0`)
  check('History AI log: the estimate is fully visible, not cut off', fits)
  await app.screenshot(join(shots, 'ai-spending-04-history.png'))
} catch (err) {
  check('suite ran to the end', false, err.message)
} finally {
  await app.close()
}

console.log(results.join('\n'))
if (results.some((r) => r.startsWith('FAIL'))) process.exit(1)
