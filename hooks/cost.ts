import type { FleetAgent, FleetUsage } from '../types'
import { isTask } from './status'

// $ per million tokens; cache writes at the 5-minute rate (1.25x input).
type Price = { input: number; output: number; cacheRead: number; cacheWrite: number }
const price = (input: number, output: number, cacheRead: number): Price =>
  ({ input, output, cacheRead, cacheWrite: input * 1.25 })
const PRICES: [RegExp, Price][] = [
  [/fable|mythos/, price(10, 50, 0.25)],
  [/opus-5-5|^opus$/, price(4, 20, 0.2)],
  [/opus/, price(5, 25, 0.5)],
  [/sonnet-5|^sonnet$/, price(2, 10, 0.2)],
  [/sonnet/, price(3, 15, 0.3)],
  [/haiku-5|^haiku$/, price(0.1, 0.5, 0.01)],
  [/haiku/, price(1, 5, 0.1)],
]

export function costOf(a: FleetAgent): number | undefined {
  const model = a.model?.toLowerCase()
  const p = model === undefined ? undefined : PRICES.find(([re]) => re.test(model))?.[1]
  if (p === undefined) return undefined
  const u = a.usage

  return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1e6
}

export const tokensOf = (u: FleetUsage) => u.input + u.output + u.cacheRead + u.cacheWrite
export const family = (model?: string) => /fable|mythos|opus|sonnet|haiku/.exec(model?.toLowerCase() ?? '')?.[0]

export function dollars(n: number | undefined): string {
  if (n === undefined) return ''
  if (n === 0) return '$0'
  if (n < 0.01) return '<$0.01'

  return `$${n.toFixed(2)}`
}

// Tokens and estimated cost of the agents in a list; background tasks cost nothing.
export function totals(all: FleetAgent[]): { tokens: number; cost: string } {
  const list = all.filter(a => !isTask(a))
  const costs = list.map(costOf)
  const known = costs.filter((c): c is number => c !== undefined)
  const sum = known.reduce((s, c) => s + c, 0)
  const cost = known.length === 0 ? '' : `≈${dollars(sum)}${known.length < costs.length ? '+' : ''}`

  return { tokens: list.reduce((s, a) => s + tokensOf(a.usage), 0), cost }
}
