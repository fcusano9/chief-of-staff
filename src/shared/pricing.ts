/**
 * Claude list prices, used only to estimate what requests cost. They are built into the app and
 * don't update themselves: when Anthropic changes prices, update this table and PRICES_CHECKED.
 * Anthropic's billing (the Console) is always the real figure.
 */

/** When these prices were last checked against Anthropic's pricing page. */
export const PRICES_CHECKED = '2026-11-04'
/** PRICES_CHECKED as people read it. */
export const PRICES_CHECKED_LABEL = '4 Nov 2026'
/** Anthropic's pricing page, linked from the AI spending screen so prices can be checked. */
export const PRICING_URL = 'https://platform.claude.com/docs/en/about-claude/pricing'

export interface ModelPrice {
  /** US dollars per million input tokens. */
  input: number
  /** US dollars per million output tokens (thinking is billed as output). */
  output: number
  /** A higher price for requests whose prompt is over `aboveTokens` input tokens. */
  long?: { aboveTokens: number; input: number; output: number }
}

export const CLAUDE_PRICES: Record<string, ModelPrice> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, long: { aboveTokens: 100_000, input: 0.5, output: 2.5 } },
}

/** Estimated cost in US dollars of one request, or null when the model's price isn't known. */
export function estimateCost(model: string | null | undefined, inputTokens: number, outputTokens: number): number | null {
  const price = model ? CLAUDE_PRICES[model] : undefined
  if (!price) return null
  const p = price.long && inputTokens > price.long.aboveTokens ? price.long : price
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000
}

/** "$2.54", or three decimals under a dollar ("$0.067") so small runs can be told apart. */
export function formatCost(dollars: number): string {
  if (dollars === 0) return '$0.00'
  if (dollars < 0.001) return 'under $0.001'
  return `$${dollars.toFixed(dollars < 1 ? 3 : 2)}`
}

/** "$4.00", "$0.10": a per-million-token price. */
export const usd = (n: number): string => `$${n.toFixed(2)}`

/** "$4 / $20 per million tokens", for the model picker. */
export function priceLabel(model: string): string {
  const p = CLAUDE_PRICES[model]
  const d = (n: number) => (Number.isInteger(n) ? `$${n}` : usd(n))
  return p ? `${d(p.input)} / ${d(p.output)} per million tokens` : ''
}

/** "$4.00 in / $20.00 out per million tokens", for tooltips. */
export function describePrice(model: string): string | null {
  const p = CLAUDE_PRICES[model]
  if (!p) return null
  const long = p.long ? ` (${usd(p.long.input)} / ${usd(p.long.output)} for requests over ${p.long.aboveTokens.toLocaleString('en-US')} tokens)` : ''
  return `${usd(p.input)} in / ${usd(p.output)} out per million tokens${long}`
}
