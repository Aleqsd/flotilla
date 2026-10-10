import { SPARK } from './state'

export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}`

  return `${Math.floor(s / 3600)}h${String(Math.floor(s / 60) % 60).padStart(2, '0')}`
}

export const kilo = (n: number) => (n < 1000 ? String(n) : n < 1e6 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1e6).toFixed(2)}M`)

export function spark(activity: number[]): string {
  const bars = '▁▃▅▆█'
  const padded = [...Array(Math.max(0, SPARK - activity.length)).fill(0), ...activity.slice(-SPARK)]

  return padded.map(v => bars[Math.min(bars.length - 1, v)]).join('')
}

export function progress(done: number, total: number, width = 8): string {
  const filled = total === 0 ? 0 : Math.round((done / total) * width)

  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}

export const oneLine = (text: string) => {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat
}

// What a tool call works on, short enough for one row.
export function targetOf(input: unknown): string | undefined {
  const fields = input as Record<string, unknown>
  for (const key of ['file_path', 'path', 'pattern', 'command', 'url', 'query', 'description', 'skill']) {
    const value = fields[key]
    if (typeof value !== 'string' || value === '') continue
    const flat = value.replace(/\s+/g, ' ').trim()
    const isPath = /[\\/]/.test(flat) && !flat.includes(' ')
    const short = isPath ? flat.split(/[\\/]/).slice(-2).join('/') : flat

    return short.length > 60 ? `${short.slice(0, 59)}…` : short
  }

  return undefined
}

// The first sentence of a final answer, markdown stripped.
export function summarize(answer: string): string | undefined {
  const flat = answer
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*(?:[-*>]|\d+\.)\s+/gm, '')
    .replace(/[#*`_|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (flat === '') return undefined
  const sentence = /^(.{20,}?[.!?])(?:\s|$)/.exec(flat)?.[1] ?? flat

  return sentence.length > 140 ? `${sentence.slice(0, 139)}…` : sentence
}
