import { useEffect, useState } from 'react'
import { CLAUDE_PRICES, formatCost, PRICES_CHECKED_LABEL, PRICING_URL, usd } from '@shared/pricing'
import { CLAUDE_MODELS, USAGE_PURPOSE_LABELS, type AiSpending, type UsageGroup, type UsagePurpose } from '@shared/types'
import { cos } from '../api'
import { useApp } from '../context'

const num = (n: number) => n.toLocaleString()
const modelLabel = (id: string) => CLAUDE_MODELS.find((m) => m.id === id)?.label ?? id
const purposeLabel = (key: string) => USAGE_PURPOSE_LABELS[key as UsagePurpose] ?? key

/** Estimated Claude costs, opened from Settings → AI providers → Claude. */
export function AiSpendingScreen() {
  const { go, version } = useApp()
  const [data, setData] = useState<AiSpending | null>(null)
  const [period, setPeriod] = useState<'month' | 'last30'>('month')

  useEffect(() => {
    void cos['usage.spending']().then(setData)
  }, [version])

  const shown = data?.[period]
  const imports = shown?.byPurpose.find((g) => g.key === 'import')
  const monthName = new Date().toLocaleDateString(undefined, { month: 'long' })
  const empty = data != null && data.last30.total.requests === 0 && data.month.total.requests === 0

  return (
    <div className="page" data-ai-spending>
      <div className="head">
        <button className="btn ghost" onClick={() => go('settings')}>
          ← Settings
        </button>
        <h1>AI spending</h1>
        <div className="spacer" />
        {!empty && (
          <>
            <button className={`pill ${period === 'month' ? 'on' : ''}`} onClick={() => setPeriod('month')}>
              This month
            </button>
            <button className={`pill ${period === 'last30' ? 'on' : ''}`} onClick={() => setPeriod('last30')}>
              Last 30 days
            </button>
          </>
        )}
      </div>
      <p className="muted" style={{ margin: '0 0 12px', fontSize: 'var(--fs-sm)' }}>
        Estimated cost of Claude requests, worked out from the tokens each one used. Basic and Ollama models are free and aren't counted.
      </p>

      {empty && <div className="card empty">No Claude requests yet.</div>}

      {data && shown && !empty && (
        <>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            <Total label={`This month (${monthName})`} group={data.month.total} />
            <Total label="Last 30 days" group={data.last30.total} />
            <div className="card">
              <div className="label">Average import</div>
              <div className="stat">{imports && imports.requests > imports.unpriced ? formatCost(imports.cost / (imports.requests - imports.unpriced)) : '–'}</div>
              <div className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
                {imports ? `${num(Math.round(imports.inputTokens / imports.requests))} tokens sent per import` : 'No imports in this period'}
              </div>
            </div>
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <UsageTable title="By what it was used for" first="Used for" groups={shown.byPurpose} labelOf={purposeLabel} />
            <UsageTable title="By model" first="Model" groups={shown.byModel} labelOf={modelLabel} />
            {shown.total.unpriced > 0 && (
              <p className="muted" style={{ fontSize: 'var(--fs-sm)', margin: '8px 0 0' }}>
                {shown.total.unpriced} {shown.total.unpriced === 1 ? 'request was' : 'requests were'} answered by a model this app has no price for, so {shown.total.unpriced === 1 ? "it isn't" : "they aren't"} in the cost.
              </p>
            )}
          </div>
        </>
      )}

      <Prices />
    </div>
  )
}

function Total({ label, group }: { label: string; group: UsageGroup }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="stat">{formatCost(group.cost)}</div>
      <div className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
        {num(group.requests)} {group.requests === 1 ? 'request' : 'requests'}
      </div>
    </div>
  )
}

function UsageTable({ title, first, groups, labelOf }: { title: string; first: string; groups: UsageGroup[]; labelOf: (key: string) => string }) {
  if (groups.length === 0) return null
  const max = Math.max(...groups.map((g) => g.cost), 0)
  return (
    <>
      <div className="label" style={{ margin: '10px 0 4px' }}>
        {title}
      </div>
      <table className="usage-table">
        <thead>
          <tr>
            <th>{first}</th>
            <th className="n">Requests</th>
            <th className="n">Tokens in</th>
            <th className="n">Tokens out</th>
            <th className="n">Avg per request</th>
            <th className="n">Est. cost</th>
            <th style={{ width: 90 }} />
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const priced = g.requests - g.unpriced
            return (
              <tr key={g.key}>
                <td>{labelOf(g.key)}</td>
                <td className="n">{num(g.requests)}</td>
                <td className="n">{num(g.inputTokens)}</td>
                <td className="n">{num(g.outputTokens)}</td>
                <td className="n">{priced > 0 ? formatCost(g.cost / priced) : '–'}</td>
                <td className="n">
                  <b style={{ fontWeight: 500 }}>{priced > 0 ? formatCost(g.cost) : 'price not known'}</b>
                </td>
                <td>{max > 0 && <div className="usage-bar" style={{ width: `${Math.max(4, (g.cost / max) * 100)}%` }} />}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}

function Prices() {
  return (
    <div className="card" style={{ marginTop: 12, background: 'var(--bg)' }} data-prices>
      <div style={{ fontWeight: 500, marginBottom: 4 }}>Prices used for these estimates</div>
      <table className="usage-table" style={{ maxWidth: 600 }}>
        <thead>
          <tr>
            <th>Model</th>
            <th className="n">Input, per million tokens</th>
            <th className="n">Output, per million tokens</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(CLAUDE_PRICES).flatMap(([id, p]) => [
            <tr key={id}>
              <td>{modelLabel(id)}</td>
              <td className="n">{usd(p.input)}</td>
              <td className="n">{usd(p.output)}</td>
            </tr>,
            ...(p.long
              ? [
                  <tr key={`${id}-long`}>
                    <td className="muted">
                      {modelLabel(id)}, requests over {num(p.long.aboveTokens)} tokens
                    </td>
                    <td className="n">{usd(p.long.input)}</td>
                    <td className="n">{usd(p.long.output)}</td>
                  </tr>,
                ]
              : []),
          ])}
        </tbody>
      </table>
      <div className="callout-warn">
        These are Anthropic's list prices as of {PRICES_CHECKED_LABEL}, built into this version of the app. Prices may have changed since. Your Anthropic Console billing page has the exact amount you were charged.
        <div style={{ marginTop: 4 }}>
          <a href={PRICING_URL} target="_blank" rel="noreferrer">
            Check Anthropic's current prices ↗
          </a>{' '}
          <span className="faint">Opens platform.claude.com in your browser.</span>
        </div>
      </div>
    </div>
  )
}
