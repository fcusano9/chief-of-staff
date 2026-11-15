import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { MAX_AI_ADJUSTMENT } from '../src/main/ai/limits'
import { openDatabase, SCHEMA_VERSION } from '../src/main/db'
import { API_CHANNELS } from '../src/shared/api'
import { DUE_HORIZON_DAYS, FOLLOW_UP_BUSINESS_DAYS, NO_SIGNALS, scorePriority, STALE_HORIZON_DAYS, type PriorityInput } from '../src/shared/priority'
import { DEFAULT_SETTINGS, effectivePriority, type PriorityWeights } from '../src/shared/types'

/*
 * The interactive guide, docs/architecture.html, is one file. Most of it is written by hand: the
 * system map, flows, table purposes, screens and glossary (its "model" block). One region is built
 * from the code here: the business and AI rules (parsed from docs/BUSINESS-RULES.md and
 * docs/AI-RULES.md), the database schema (from the real migrations), the IPC channels, and a few
 * facts. After changing a rule, a table, or an IPC call, run `npm run docs` to rebuild it.
 * The other checks make sure the hand-written part still matches the code.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = 'https://github.com/fcusano9/chief-of-staff/blob/main/'
const START = '<!-- generated:start -->'
const END = '<!-- generated:end -->'

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

// ---------- Markdown to the page's rule blocks ----------

interface Block {
  type: 'p' | 'list' | 'table'
  html?: string
  items?: string[]
  head?: string[]
  rows?: string[][]
}
interface Section {
  id: string
  title: string
  level: number
  blocks: Block[]
}
interface RulesDoc {
  id: string
  title: string
  file: string
  intro: Block[]
  sections: Section[]
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
const REPO_PATH = /^(?:src|tests|e2e|docs|bench|scripts|design|\.github)\/[\w./-]*\w\.[a-z0-9]+$/

/** Where a link in docs/ points: the guide itself stays on the page, other repo files go to GitHub. */
function linkTarget(url: string): string {
  if (/^[a-z]+:/i.test(url) || url.startsWith('#')) return url
  if (url === 'architecture.html') return '#overview'
  return REPO + posix.normalize(posix.join('docs', url))
}

/** Inline Markdown: `code` (repo paths become links), **bold** and [links](url). */
function inline(text: string): string {
  return text
    .split(/(`[^`]*`)/)
    .map((part) => {
      if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
        const code = part.slice(1, -1)
        const html = `<code>${escapeHtml(code)}</code>`
        return REPO_PATH.test(code) ? `<a class="src" href="${REPO}${code}">${html}</a>` : html
      }
      return escapeHtml(part)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, url: string) => `<a href="${escapeHtml(linkTarget(url))}">${label}</a>`)
    })
    .join('')
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'))

function parseRules(id: string, file: string): RulesDoc {
  const lines = read(file).split('\n')
  const doc: RulesDoc = { id, title: '', file, intro: [], sections: [] }
  let target = doc.intro
  let para: string[] = []
  let list: string[] | null = null
  const flush = () => {
    if (para.length) target.push({ type: 'p', html: inline(para.join(' ')) })
    if (list) target.push({ type: 'list', items: list.map(inline) })
    para = []
    list = null
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const heading = /^(#{1,3}) (.+)$/.exec(line)
    if (heading) {
      flush()
      const [, hashes, title] = heading
      if (hashes!.length === 1) doc.title = title!.trim()
      else {
        const section: Section = { id: `${id}-${slug(title!)}`, title: title!.trim(), level: hashes!.length, blocks: [] }
        doc.sections.push(section)
        target = section.blocks
      }
    } else if (line.startsWith('|')) {
      flush()
      const head = cells(line)
      const rows: string[][] = []
      i++ // the |---| line
      while (i + 1 < lines.length && lines[i + 1]!.startsWith('|')) rows.push(cells(lines[++i]!).map(inline))
      target.push({ type: 'table', head: head.map(inline), rows })
    } else if (/^\s*- /.test(line)) {
      if (para.length) flush()
      list ??= []
      list.push(line.replace(/^\s*- /, ''))
    } else if (!line.trim()) flush()
    else if (list) list[list.length - 1] += ` ${line.trim()}`
    else para.push(line.trim())
  }
  flush()
  return doc
}

// ---------- The schema, from a freshly migrated database ----------

const folder = mkdtempSync(join(tmpdir(), 'cos-docs-'))
afterAll(() => rmSync(folder, { recursive: true, force: true }))

function schema() {
  const db = openDatabase(join(folder, 'docs.db'))
  try {
    const names = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite%' ORDER BY name`).all() as { name: string }[]).map((r) => r.name)
    return names.map((name) => {
      const columns = (db.prepare(`PRAGMA table_info(${name})`).all() as { name: string; type: string; notnull: number; pk: number }[]).map((c) => ({
        name: c.name,
        type: c.type,
        required: c.notnull === 1,
        key: c.pk > 0,
      }))
      const links = (db.prepare(`PRAGMA foreign_key_list(${name})`).all() as { table: string; from: string; to: string | null; on_delete: string }[])
        .map((f) => ({ column: f.from, table: f.table, onDelete: f.on_delete }))
        .sort((a, b) => a.column.localeCompare(b.column))
      return { name, columns, links }
    })
  } finally {
    db.close()
  }
}

function generated() {
  const pkg = JSON.parse(read('package.json')) as { version: string }
  const rules = [parseRules('b', 'docs/BUSINESS-RULES.md'), parseRules('a', 'docs/AI-RULES.md')]
  const tables = schema()
  return {
    facts: {
      version: pkg.version,
      schemaVersion: SCHEMA_VERSION,
      channelCount: API_CHANNELS.length,
      tableCount: tables.length,
      priority: {
        dueHorizonDays: DUE_HORIZON_DAYS,
        staleHorizonDays: STALE_HORIZON_DAYS,
        followUpBusinessDays: FOLLOW_UP_BUSINESS_DAYS,
        noSignals: NO_SIGNALS,
        defaultWeights: DEFAULT_SETTINGS.priorityWeights,
        maxAiAdjustment: MAX_AI_ADJUSTMENT,
      },
    },
    channels: [...API_CHANNELS],
    schema: tables,
    rules,
  }
}

/** The page with its generated region rebuilt. `<` is escaped so the JSON can't end the script early. */
function rebuild(page: string): string {
  const start = page.indexOf(START)
  const end = page.indexOf(END)
  if (start < 0 || end < start) throw new Error(`docs/architecture.html must contain ${START} and ${END}`)
  const json = JSON.stringify(generated(), null, 1).replace(/</g, '\\u003c')
  return `${page.slice(0, start + START.length)}\n<script type="application/json" id="generated">\n${json}\n</script>\n${page.slice(end)}`
}

// ---------- The hand-written model ----------

const page = () => read('docs/architecture.html')

interface ModelNode {
  id: string
  label: string
  files?: { path: string; names?: string[] }[]
  ipc?: string[]
  tables?: string[]
  rules?: string[]
  flows?: string[]
}
interface Model {
  nodes: ModelNode[]
  edges: { from: string; to: string }[]
  flows: { id: string; steps: { nodes: string[]; edges?: [string, string][]; code?: string }[] }[]
  tables: Record<string, { group: string; purpose: string; writers?: string[] }>
  screens: { id: string; calls?: string[]; files?: { path: string; names?: string[] }[]; rules?: string[] }[]
}

function model(): Model {
  const m = /<script type="application\/json" id="model">([\s\S]*?)<\/script>/.exec(page())
  if (!m) throw new Error('docs/architecture.html has no model block')
  return JSON.parse(m[1]!) as Model
}

/** Every `path · name` reference in a text: the path must exist and each name must appear in it. */
function brokenRefs(text: string): string[] {
  const broken: string[] = []
  const ref = /`?((?:src|tests|e2e|docs|bench|scripts|design|\.github)\/[\w./-]*\w\.[a-z0-9]+)`?(?:\s*·\s*`?([A-Za-z_$][\w.$]*)`?)?/g
  for (const [, path, name] of text.matchAll(ref)) {
    if (!existsSync(join(ROOT, path!))) {
      broken.push(`${path} doesn't exist`)
      continue
    }
    if (!name) continue
    const source = read(path!)
    for (const part of name.split('.')) {
      const escaped = part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (!new RegExp(`\\b${escaped}\\b`).test(source)) broken.push(`${path} has no "${part}"`)
    }
  }
  return broken
}

// ---------- The tests ----------

describe('docs/architecture.html', () => {
  it('has its generated region up to date (run `npm run docs` after changing a rule, table, or IPC call)', async () => {
    await expect(rebuild(page())).toMatchFileSnapshot('../docs/architecture.html')
  })

  it('describes every database table, and only real ones', () => {
    const real = schema().map((t) => t.name)
    const described = Object.keys(model().tables)
    expect(
      real.filter((t) => !described.includes(t)),
      'Tables missing from the "tables" part of the model in docs/architecture.html: add each with a group and purpose',
    ).toEqual([])
    expect(described.filter((t) => !real.includes(t)), 'Tables in the model that no longer exist').toEqual([])
  })

  it('places every IPC channel on some node of the system map', () => {
    const owners = model().nodes.flatMap((n) => n.ipc ?? [])
    const unplaced = API_CHANNELS.filter((ch) => !owners.some((o) => (o.endsWith('.') ? ch.startsWith(o) : ch === o)))
    expect(unplaced, 'IPC channels no node lists in its "ipc": add them to the node that handles them').toEqual([])
  })

  it('only names IPC calls that exist', () => {
    const m = model()
    const named = [...m.screens.flatMap((s) => s.calls ?? []), ...m.nodes.flatMap((n) => (n.ipc ?? []).filter((c) => !c.endsWith('.')))]
    expect(named.filter((c) => !(API_CHANNELS as string[]).includes(c))).toEqual([])
  })

  it('links nodes, edges, flows and rules that exist', () => {
    const m = model()
    const ids = new Set(m.nodes.map((n) => n.id))
    const sections = new Set(generated().rules.flatMap((d) => d.sections.map((s) => s.id)))
    const flows = new Set(m.flows.map((f) => f.id))
    const bad: string[] = []
    for (const e of m.edges) for (const id of [e.from, e.to]) if (!ids.has(id)) bad.push(`edge to unknown node ${id}`)
    for (const f of m.flows)
      for (const s of f.steps) for (const id of [...s.nodes, ...(s.edges ?? []).flat()]) if (!ids.has(id)) bad.push(`flow ${f.id}: unknown node ${id}`)
    for (const item of [...m.nodes, ...m.screens]) {
      for (const r of item.rules ?? []) if (!sections.has(r)) bad.push(`${item.id}: unknown rules section ${r}`)
    }
    for (const n of m.nodes) for (const f of n.flows ?? []) if (!flows.has(f)) bad.push(`${n.id}: unknown flow ${f}`)
    for (const [t, d] of Object.entries(m.tables)) for (const w of d.writers ?? []) if (!ids.has(w)) bad.push(`table ${t}: unknown writer ${w}`)
    expect(bad).toEqual([])
  })

  it('cites files and names that exist', () => {
    const m = model()
    const refs = [
      ...[...m.nodes, ...m.screens].flatMap((n) => (n.files ?? []).map((f) => f.path)),
      ...[...m.nodes, ...m.screens].flatMap((n) => (n.files ?? []).flatMap((f) => (f.names ?? []).map((name) => `${f.path} · ${name}`))),
      ...m.flows.flatMap((f) => f.steps.map((s) => s.code ?? '')),
      read('docs/BUSINESS-RULES.md'),
    ]
    expect(refs.flatMap(brokenRefs)).toEqual([])
  })
})

describe('the priority calculator on the page', () => {
  // A seeded random sequence, so a failure always shows the same inputs.
  let seed = 20261114
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))
  const DAY = 86_400_000
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  interface Calc {
    scorePriority(item: PriorityInput, weights: PriorityWeights, now: Date): { score: number; rationale: string }
    effectivePriority(t: { priorityScore: number; priorityOverride: number | null; aiAdjustment?: { delta: number } | null }): number
  }
  const calc = (): Calc => {
    const m = /<script id="priority-calc">([\s\S]*?)<\/script>/.exec(page())
    if (!m) throw new Error('docs/architecture.html has no priority-calc script')
    return new Function(`${m[1]}\nreturn PriorityCalc`)() as Calc
  }

  it('gives the same score and reason as the app', () => {
    const c = calc()
    for (let i = 0; i < 400; i++) {
      const now = new Date(Date.UTC(2026, 0, 1) + int(0, 364) * DAY + int(0, 86_399) * 1000)
      const waiting = rand() < 0.4
      const item: PriorityInput = {
        dueDate: rand() < 0.25 ? null : ymd(new Date(now.getTime() + int(-20, 30) * DAY)),
        requester: rand() < 0.3 ? null : { name: 'Dana Lee', priorityWeight: int(0, 6) },
        followUpCount: rand() < 0.6 ? 0 : int(1, 6),
        lastActivityAt: new Date(now.getTime() - int(0, 40 * 24) * 3_600_000).toISOString(),
        status: waiting ? 'waiting_on' : 'open',
        waitingSince: waiting && rand() < 0.9 ? new Date(now.getTime() - int(0, 25 * 24) * 3_600_000).toISOString() : null,
      }
      const weights = rand() < 0.5 ? DEFAULT_SETTINGS.priorityWeights : rand() < 0.05 ? { dueDate: 0, requester: 0, staleness: 0 } : { dueDate: int(0, 10), requester: int(0, 10), staleness: int(0, 10) }
      expect(c.scorePriority(item, weights, now), JSON.stringify({ item, weights, now })).toEqual(scorePriority(item, weights, now))
    }
  })

  it('gives the same effective priority as the app', () => {
    const c = calc()
    for (let i = 0; i < 200; i++) {
      const t = {
        priorityScore: int(0, 100),
        priorityOverride: rand() < 0.3 ? int(0, 100) : null,
        aiAdjustment: rand() < 0.5 ? null : { delta: int(-MAX_AI_ADJUSTMENT, MAX_AI_ADJUSTMENT) },
      }
      expect(c.effectivePriority(t), JSON.stringify(t)).toBe(effectivePriority(t))
    }
  })
})
