import { atom, read, update } from 'claude-code'
import type { AgentSpawnInput, AgentStatus, Color, ElementTable, EngineInterface, Register } from 'claude-code'

import type { FleetAgent, FleetUsage, FleetView, FleetWorkflowName } from '../types'

const PANE = 'flotilla'
const TITLE = 'Flotilla'
const SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
const TICK_MS = 250
const SPARK = 12
const LINGER_MS = 15_000
const STUCK_MS = 60_000
const MAX_ROWS = 80

const fleet = atom({ plugin: 'flotilla', key: 'fleet' } as const, [])
const view = atom({ plugin: 'flotilla', key: 'view' } as const, 'above')
const layout = atom({ plugin: 'flotilla', key: 'layout' } as const, 'list')
const paneShown = atom({ plugin: 'flotilla', key: 'paneShown' } as const, false)
const hideDone = atom({ plugin: 'flotilla', key: 'hideDone' } as const, false)
const clock = atom({ plugin: 'flotilla', key: 'clock' } as const, { frame: 0, now: 0 })
const workflowNames = atom({ plugin: 'flotilla', key: 'workflowNames' } as const, [])
const openRuns = atom({ plugin: 'flotilla', key: 'openRuns' } as const, [])

type El = Pick<ElementTable, 'Box' | 'Text' | 'Button'>
type Ctx = { frame: number; now: number; cols: number }
type Group = { runId: string; name: string; members: FleetAgent[]; isOpen: boolean }
type Item = { kind: 'agent'; agent: FleetAgent; depth: number } | ({ kind: 'group' } & Group)

const ZERO: FleetUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

const TYPE_COLORS: Record<string, Color> = {
  Explore: 'suggestion',
  Plan: 'planMode',
  'general-purpose': 'claude',
  fork: 'merged',
  teammate: 'autoAccept',
}

// ---- Status -------------------------------------------------------------

const isLive = (s: AgentStatus) =>
  s === 'pending' || s === 'running' || s === 'waiting' || s === 'idle'
const isBusy = (s: AgentStatus) => s === 'pending' || s === 'running'
const isStuck = (a: FleetAgent, now: number) =>
  a.status === 'running' && a.inFlight === 0 && now - a.lastActivityAt > STUCK_MS

function icon(a: FleetAgent, frame: number, now: number): { glyph: string; color: Color } {
  if (isStuck(a, now)) return { glyph: '⚠', color: 'warning' }
  if (isBusy(a.status)) return { glyph: SPINNER[(frame + a.tools) % SPINNER.length] ?? '•', color: 'claude' }
  if (a.status === 'waiting' || a.status === 'idle') return { glyph: '◌', color: 'inactive' }
  if (a.status === 'completed') return { glyph: '✓', color: 'success' }
  if (a.status === 'failed') return { glyph: '✗', color: 'error' }

  return { glyph: '■', color: 'warning' }
}

function groupIcon(members: FleetAgent[], frame: number, now: number): { glyph: string; color: Color } {
  if (members.some(a => isStuck(a, now))) return { glyph: '⚠', color: 'warning' }
  if (members.some(a => isBusy(a.status))) return { glyph: SPINNER[frame % SPINNER.length] ?? '•', color: 'claude' }
  if (members.some(a => a.status === 'failed')) return { glyph: '✗', color: 'error' }
  if (members.some(a => isLive(a.status))) return { glyph: '◌', color: 'inactive' }

  return { glyph: '✓', color: 'success' }
}

// ---- Language -----------------------------------------------------------

type Lang = 'en' | 'fr'

const STRINGS = {
  en: {
    active: (n: number) => `${n} active`,
    done: (n: number) => `${n} done`,
    tools: (n: number) => `${n} tool${n === 1 ? '' : 's'}`,
    toolCalls: (n: number) => `${n} tool call${n === 1 ? '' : 's'}`,
    more: (n: number) => `+${n} more · /flotilla side to see all`,
    idleFor: (d: string) => `⚠ no activity for ${d}`,
    starting: 'starting…',
    empty: 'No agents yet. They show up here as soon as one starts.',
    ago: (d: string) => `${d} ago`,
    now: 'now',
    list: 'List',
    timeline: 'Timeline',
    pane: 'Side pane',
    above: 'Above prompt',
    collapse: 'Collapse',
    expand: 'Expand',
    hideDone: 'Hide done',
    showDone: 'Show done',
    clear: 'Clear',
  },
  fr: {
    active: (n: number) => `${n} actif${n > 1 ? 's' : ''}`,
    done: (n: number) => `${n} terminé${n > 1 ? 's' : ''}`,
    tools: (n: number) => `${n} outil${n > 1 ? 's' : ''}`,
    toolCalls: (n: number) => `${n} appel${n > 1 ? 's' : ''} d'outils`,
    more: (n: number) => `+${n} autre${n > 1 ? 's' : ''} · /flotilla side pour tout voir`,
    idleFor: (d: string) => `⚠ aucune activité depuis ${d}`,
    starting: 'démarrage…',
    empty: "Aucun agent en cours. Ils apparaissent ici dès qu'un agent démarre.",
    ago: (d: string) => `il y a ${d}`,
    now: 'maintenant',
    list: 'Liste',
    timeline: 'Chronologie',
    pane: 'Panneau',
    above: 'Au-dessus du prompt',
    collapse: 'Réduire',
    expand: 'Agrandir',
    hideDone: 'Masquer terminés',
    showDone: 'Afficher terminés',
    clear: 'Vider',
  },
}

// The words every drawing uses; set from the `language` option, or detected.
let t: (typeof STRINGS)[Lang] = STRINGS.en

const asLang = (value: unknown): Lang | undefined =>
  typeof value !== 'string' ? undefined : /^(fr|french|fran[cç]ais)/i.test(value) ? 'fr' : /^(en|english)/i.test(value) ? 'en' : undefined

// `auto`: Claude Code's own `language` setting, then the locale variables.
async function detectLang($: EngineInterface): Promise<Lang> {
  const settings = (await $.settings.read().catch(() => ({}))) as Record<string, unknown>
  const fromSettings = asLang(settings.language)
  if (fromSettings !== undefined) return fromSettings
  const locale = (await $.env.get('LC_ALL').catch(() => undefined))
    ?? (await $.env.get('LC_MESSAGES').catch(() => undefined))
    ?? (await $.env.get('LANG').catch(() => undefined))

  return asLang(locale) ?? 'en'
}

async function setLanguage($: EngineInterface, value: string) {
  return $.config.set({ key: 'flotilla.language', value })
}

// ---- Formatting ---------------------------------------------------------

function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}`

  return `${Math.floor(s / 3600)}h${String(Math.floor(s / 60) % 60).padStart(2, '0')}`
}

const kilo = (n: number) => (n < 1000 ? String(n) : n < 1e6 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1e6).toFixed(2)}M`)

function spark(activity: number[]): string {
  const bars = '▁▃▅▆█'
  const padded = [...Array(Math.max(0, SPARK - activity.length)).fill(0), ...activity.slice(-SPARK)]

  return padded.map(v => bars[Math.min(bars.length - 1, v)]).join('')
}

function progress(done: number, total: number, width = 8): string {
  const filled = total === 0 ? 0 : Math.round((done / total) * width)

  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}

// What a tool call works on, short enough for one row.
function targetOf(input: unknown): string | undefined {
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
function summarize(answer: string): string | undefined {
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

// ---- Models and cost ----------------------------------------------------

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

function costOf(a: FleetAgent): number | undefined {
  const model = a.model?.toLowerCase()
  const p = model === undefined ? undefined : PRICES.find(([re]) => re.test(model))?.[1]
  if (p === undefined) return undefined
  const u = a.usage

  return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1e6
}

const tokensOf = (u: FleetUsage) => u.input + u.output + u.cacheRead + u.cacheWrite
const family = (model?: string) => /fable|mythos|opus|sonnet|haiku/.exec(model?.toLowerCase() ?? '')?.[0]

function dollars(n: number | undefined): string {
  if (n === undefined) return ''
  if (n === 0) return '$0'
  if (n < 0.01) return '<$0.01'

  return `$${n.toFixed(2)}`
}

function totals(list: FleetAgent[]): { tokens: number; cost: string } {
  const costs = list.map(costOf)
  const known = costs.filter((c): c is number => c !== undefined)
  const sum = known.reduce((s, c) => s + c, 0)
  const cost = known.length === 0 ? '' : `≈${dollars(sum)}${known.length < costs.length ? '+' : ''}`

  return { tokens: list.reduce((s, a) => s + tokensOf(a.usage), 0), cost }
}

// ---- Rows ---------------------------------------------------------------

function detail(a: FleetAgent, now: number): string {
  if (isStuck(a, now)) return t.idleFor(elapsed(now - a.lastActivityAt))
  if (isLive(a.status)) {
    const running = a.inFlight > 0 && now - a.lastActivityAt > 10_000 ? ` (${elapsed(now - a.lastActivityAt)})` : ''

    return `↳ ${a.tool ?? t.starting}${a.target ? ` ${a.target}` : ''}${running}`
  }
  const cost = costOf(a)
  const counts = `${t.tools(a.tools)} · ${kilo(tokensOf(a.usage))} tokens${cost === undefined ? '' : ` · ${dollars(cost)}`}`

  return a.summary ? `${counts} — ${a.summary}` : counts
}

// Roots and workflow groups by start time, each followed by its children.
function itemsOf(list: FleetAgent[], names: FleetWorkflowName[], open: string[]): Item[] {
  const ids = new Set(list.map(a => a.id))
  const byStart = [...list].sort((x, y) => x.startedAt - y.startedAt)
  const isRoot = (a: FleetAgent) => a.parentId === undefined || !ids.has(a.parentId)
  const runs = new Map<string, FleetAgent[]>()
  const tops: { start: number; item: FleetAgent | string }[] = []
  for (const a of byStart) {
    if (!isRoot(a)) continue
    if (a.workflowRun === undefined) {
      tops.push({ start: a.startedAt, item: a })
    } else if (runs.has(a.workflowRun)) {
      runs.get(a.workflowRun)?.push(a)
    } else {
      runs.set(a.workflowRun, [a])
      tops.push({ start: a.startedAt, item: a.workflowRun })
    }
  }

  const out: Item[] = []
  const walk = (a: FleetAgent, depth: number) => {
    out.push({ kind: 'agent', agent: a, depth })
    for (const child of byStart) if (child.parentId === a.id) walk(child, depth + 1)
  }
  for (const { item } of tops) {
    if (typeof item !== 'string') {
      walk(item, 0)
      continue
    }
    const members = runs.get(item) ?? []
    const call = members[0]?.workflowCall
    const name = names.find(w => w.toolUseId === call)?.name ?? `workflow ${item.replace(/^wf_/, '').slice(0, 8)}`
    const isOpen = open.includes(item)
    out.push({ kind: 'group', runId: item, name, members, isOpen })
    if (isOpen) for (const m of members) walk(m, 1)
  }

  return out
}

function groupFacts(g: Group, now: number) {
  const done = g.members.filter(a => !isLive(a.status)).length
  const start = Math.min(...g.members.map(a => a.startedAt))
  const isAnyLive = g.members.some(a => isLive(a.status))
  const end = isAnyLive ? now : Math.max(...g.members.map(a => a.endedAt ?? now))

  return { done, total: g.members.length, start, end, ...totals(g.members) }
}

function groupRow($: EngineInterface, el: El, g: Group, ctx: Ctx) {
  const { Box, Text, Button } = el
  const mark = groupIcon(g.members, ctx.frame, ctx.now)
  const f = groupFacts(g, ctx.now)

  return (
    <Box key={`wf-${g.runId}`} flexDirection="row" gap={1}>
      <Button
        key={`wf-${g.runId}`}
        label={g.isOpen ? '▾' : '▸'}
        plain
        onPress={() => toggleRun($, g.runId)}
      />
      <Text color={mark.color}>{mark.glyph}</Text>
      <Text color="merged" bold>workflow</Text>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="truncate-end">{g.name}</Text>
      </Box>
      <Text color={f.done === f.total ? 'success' : 'claude'}>{progress(f.done, f.total)}</Text>
      <Text dimColor>
        {f.done}/{f.total}{f.cost ? ` · ${f.cost}` : ''}
      </Text>
      <Box width={6} justifyContent="flex-end">
        <Text dimColor>{elapsed(f.end - f.start)}</Text>
      </Box>
    </Box>
  )
}

// Two lines an agent: what it is, then what it does or what it found.
function paneRow(el: El, a: FleetAgent, depth: number, ctx: Ctx) {
  const { Box, Text } = el
  const mark = icon(a, ctx.frame, ctx.now)
  const live = isLive(a.status)
  const indent = depth > 0 ? `${'   '.repeat(depth - 1)}└─ ` : ''
  const model = family(a.model)

  return (
    <Box key={a.id} flexDirection="row" gap={1}>
      <Text color={mark.color}>{mark.glyph}</Text>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Box flexDirection="row">
          <Text dimColor>{indent}</Text>
          <Text color={TYPE_COLORS[a.type] ?? 'remember'} bold>{a.type}</Text>
          {model !== undefined && <Text dimColor> {model}</Text>}
          <Text> </Text>
          <Text dimColor={!live} wrap="truncate-end">{a.description}</Text>
        </Box>
        <Text color={isStuck(a, ctx.now) ? 'warning' : undefined} dimColor={!isStuck(a, ctx.now)} wrap="truncate-end">
          {' '.repeat(indent.length)}{detail(a, ctx.now)}
        </Text>
      </Box>
      {ctx.cols >= 52 && <Text color={isBusy(a.status) ? 'claude' : 'inactive'}>{spark(a.activity)}</Text>}
      <Box width={6} justifyContent="flex-end">
        <Text dimColor>{elapsed((a.endedAt ?? ctx.now) - a.startedAt)}</Text>
      </Box>
    </Box>
  )
}

// One line an agent, for the band above the prompt.
function lineRow(el: El, a: FleetAgent, depth: number, ctx: Ctx) {
  const { Box, Text } = el
  const mark = icon(a, ctx.frame, ctx.now)
  const live = isLive(a.status)
  const model = family(a.model)

  return (
    <Box key={a.id} flexDirection="row" gap={1}>
      <Text color={mark.color}>{mark.glyph}</Text>
      {depth > 0 && <Text dimColor>{`${'   '.repeat(depth - 1)}└─`}</Text>}
      <Text color={TYPE_COLORS[a.type] ?? 'remember'} bold>{a.type}</Text>
      {model !== undefined && <Text dimColor>{model}</Text>}
      <Box width={Math.max(12, Math.floor(ctx.cols * 0.28))}>
        <Text dimColor={!live} wrap="truncate-end">{a.description}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text color={isStuck(a, ctx.now) ? 'warning' : undefined} dimColor={!isStuck(a, ctx.now)} wrap="truncate-end">
          {detail(a, ctx.now)}
        </Text>
      </Box>
      {ctx.cols >= 90 && <Text color={isBusy(a.status) ? 'claude' : 'inactive'}>{spark(a.activity)}</Text>}
      <Box width={6} justifyContent="flex-end">
        <Text dimColor>{elapsed((a.endedAt ?? ctx.now) - a.startedAt)}</Text>
      </Box>
    </Box>
  )
}

// A bar on the time axis for each agent or closed workflow.
function timelineRows($: EngineInterface, el: El, items: Item[], ctx: Ctx) {
  const { Box, Text, Button } = el
  const spans = items.map(item =>
    item.kind === 'agent'
      ? { start: item.agent.startedAt, end: item.agent.endedAt ?? ctx.now }
      : groupFacts(item, ctx.now),
  )
  const t0 = spans.length === 0 ? ctx.now : Math.min(...spans.map(s => s.start))
  const t1 = Math.max(t0 + 1000, ...spans.map(s => s.end))
  const labelWidth = Math.max(14, Math.min(30, Math.floor(ctx.cols * 0.35)))
  const barWidth = Math.max(8, ctx.cols - labelWidth - 10)
  const place = (start: number, end: number) => {
    const from = Math.min(barWidth - 1, Math.floor(((start - t0) / (t1 - t0)) * barWidth))
    const to = Math.min(barWidth, Math.max(from + 1, Math.ceil(((end - t0) / (t1 - t0)) * barWidth)))

    return { pad: ' '.repeat(from), bar: to - from, rest: ' '.repeat(barWidth - to) }
  }

  const rows = items.map((item, i) => {
    const span = spans[i] ?? { start: t0, end: t1 }
    const { pad, bar, rest } = place(span.start, span.end)
    if (item.kind === 'group') {
      const mark = groupIcon(item.members, ctx.frame, ctx.now)

      return (
        <Box key={`tl-wf-${item.runId}`} flexDirection="row" gap={1}>
          <Box width={labelWidth} flexDirection="row" gap={1}>
            <Button key={`wf-${item.runId}`} label={item.isOpen ? '▾' : '▸'} plain onPress={() => toggleRun($, item.runId)} />
            <Text color={mark.color}>{mark.glyph}</Text>
            <Text color="merged" wrap="truncate-end">{item.name}</Text>
          </Box>
          <Text>{pad}</Text>
          <Text color={mark.color}>{'▓'.repeat(bar)}</Text>
          <Text>{rest}</Text>
          <Box width={6} justifyContent="flex-end">
            <Text dimColor>{elapsed(span.end - span.start)}</Text>
          </Box>
        </Box>
      )
    }
    const a = item.agent
    const mark = icon(a, ctx.frame, ctx.now)
    const indent = item.depth > 0 ? `${' '.repeat(item.depth - 1)}└` : ''

    return (
      <Box key={`tl-${a.id}`} flexDirection="row" gap={1}>
        <Box width={labelWidth} flexDirection="row" gap={1}>
          <Text color={mark.color}>{indent}{mark.glyph}</Text>
          <Text color={TYPE_COLORS[a.type] ?? 'remember'} bold>{a.type}</Text>
          <Text dimColor={!isLive(a.status)} wrap="truncate-end">{a.description}</Text>
        </Box>
        <Text>{pad}</Text>
        <Text color={mark.color}>{(isLive(a.status) ? '█' : '━').repeat(bar)}</Text>
        <Text>{rest}</Text>
        <Box width={6} justifyContent="flex-end">
          <Text dimColor>{elapsed(span.end - span.start)}</Text>
        </Box>
      </Box>
    )
  })
  const startLabel = t.ago(elapsed(ctx.now - t0))
  const axis = (
    <Box key="tl-axis" flexDirection="row" gap={1}>
      <Box width={labelWidth}>
        <Text> </Text>
      </Box>
      <Text dimColor>{startLabel.padEnd(Math.max(startLabel.length + 1, barWidth - t.now.length))}{t.now}</Text>
    </Box>
  )

  return [...rows, axis]
}

function listRows($: EngineInterface, el: El, items: Item[], ctx: Ctx, isOneLine: boolean) {
  return items.map(item =>
    item.kind === 'group'
      ? groupRow($, el, item, ctx)
      : isOneLine
        ? lineRow(el, item.agent, item.depth, ctx)
        : paneRow(el, item.agent, item.depth, ctx),
  )
}

// ---- Actions ------------------------------------------------------------

const patch = (list: FleetAgent[], id: string, fn: (a: FleetAgent) => FleetAgent) =>
  list.map(a => (a.id === id ? fn(a) : a))

async function openPane($: EngineInterface) {
  const opened = await $.ui.open({ id: PANE, title: TITLE })
  await update($, paneShown, () => opened.isPlaced)
}

async function showIn($: EngineInterface, where: FleetView) {
  await update($, view, () => where)
  if (where === 'side') await openPane($)
  else await $.ui.close({ id: PANE })
}

async function toggleRun($: EngineInterface, runId: string) {
  await update($, openRuns, runs => (runs.includes(runId) ? runs.filter(r => r !== runId) : [...runs, runId]))
}

async function toggleLayout($: EngineInterface) {
  await update($, layout, l => (l === 'list' ? 'timeline' : 'list'))
}

async function clearDone($: EngineInterface) {
  await update($, fleet, list => list.filter(a => isLive(a.status)))
}

// Brings statuses in line with the engine's roster and picks up agents
// started before this module loaded.
async function reconcile($: EngineInterface, now: number) {
  const roster = await $.agent.list()
  await update($, fleet, list => {
    let next = list
    for (const info of roster) {
      const known = next.find(a => a.id === info.id)
      if (known === undefined) {
        next = [...next, {
          id: info.id,
          type: info.type,
          description: info.description || info.name || info.type,
          parentId: info.parentId,
          startedAt: now,
          endedAt: isLive(info.status) ? undefined : now,
          lastActivityAt: now,
          inFlight: 0,
          status: info.status,
          tools: 0,
          activity: [],
          usage: ZERO,
        }]
      } else if (known.status !== info.status) {
        next = patch(next, info.id, a => ({
          ...a,
          status: info.status,
          endedAt: isLive(info.status) ? undefined : (a.endedAt ?? now),
        }))
      }
    }

    return next.slice(-MAX_ROWS)
  })
}

let ticks = 0
let lastStatus: string | undefined

async function tick($: EngineInterface) {
  ticks += 1
  const now = await $.clock.now()
  if (ticks % 8 === 1) await reconcile($, now)

  const list = await read($, fleet)
  const busy = list.filter(a => isBusy(a.status)).length
  const { cost } = totals(list)
  const { frame } = await read($, clock)
  const status = list.length === 0
    ? undefined
    : `${busy > 0 ? SPINNER[frame % SPINNER.length] : '✓'} ${busy}/${list.length} agents${cost ? ` · ${cost}` : ''}`
  if (status !== lastStatus) {
    lastStatus = status
    $.ui.status(status)
  }

  const isAnyLive = list.some(a => isLive(a.status))
  const isLingering = list.some(a => a.endedAt !== undefined && now - a.endedAt < LINGER_MS)
  if (!isAnyLive && !isLingering) return

  if (ticks % 4 === 0 && isAnyLive) {
    await update($, fleet, all =>
      all.map(a => (isLive(a.status) ? { ...a, activity: [...a.activity, 0].slice(-SPARK) } : a)),
    )
  }
  await update($, clock, c => ({ frame: c.frame + 1, now }))
}

async function track($: EngineInterface, e: AgentSpawnInput, agentId: string, model: string) {
  const now = await $.clock.now()
  const row: FleetAgent = {
    id: agentId,
    type: e.subagentType,
    description: e.description || e.name || e.subagentType,
    parentId: e.parentAgentId,
    model,
    workflowRun: e.workflow?.runId || undefined,
    workflowCall: e.workflow ? e.tool_use_id : undefined,
    startedAt: now,
    lastActivityAt: now,
    inFlight: 0,
    status: 'running',
    tools: 0,
    activity: [],
    usage: ZERO,
  }
  await update($, fleet, list => [...list.filter(a => a.id !== agentId), row].slice(-MAX_ROWS))
  await update($, clock, c => ({ frame: c.frame, now }))
  if ((await read($, view)) === 'side' && !(await read($, paneShown))) void openPane($).catch(() => undefined)
}

async function toolStarted($: EngineInterface, agentId: string, tool: string, target: string | undefined) {
  const now = await $.clock.now()
  await update($, fleet, list =>
    patch(list, agentId, a => ({
      ...a,
      status: 'running',
      endedAt: undefined,
      lastActivityAt: now,
      inFlight: a.inFlight + 1,
      tools: a.tools + 1,
      tool,
      target,
      activity: [...a.activity.slice(0, -1), (a.activity.at(-1) ?? 0) + 1],
    })),
  )
}

async function toolEnded($: EngineInterface, agentId: string) {
  const now = await $.clock.now()
  await update($, fleet, list =>
    patch(list, agentId, a => ({ ...a, lastActivityAt: now, inFlight: Math.max(0, a.inFlight - 1) })),
  )
}

async function noteWorkflow($: EngineInterface, toolUseId: string, input: unknown) {
  const fields = input as Record<string, unknown>
  const script = typeof fields.script === 'string' ? fields.script : ''
  const name = typeof fields.name === 'string' && fields.name !== ''
    ? fields.name
    : /name:\s*['"]([^'"]+)['"]/.exec(script)?.[1]
  if (name === undefined) return
  await update($, workflowNames, names => [...names.filter(w => w.toolUseId !== toolUseId), { toolUseId, name }].slice(-20))
}

async function finished($: EngineInterface, agentId: string, e: { answer: string; isAborted: boolean; reason: string; usage?: FleetUsageInput }) {
  const now = await $.clock.now()
  const u = e.usage
  const status: AgentStatus = e.isAborted ? 'killed' : e.reason === 'error' ? 'failed' : 'completed'
  const summary = summarize(e.answer)
  await update($, fleet, list =>
    patch(list, agentId, a => ({
      ...a,
      status,
      endedAt: now,
      inFlight: 0,
      tool: undefined,
      target: undefined,
      model: a.model ?? u?.model,
      summary: summary ?? a.summary,
      usage: u === undefined ? a.usage : {
        input: a.usage.input + u.input_tokens,
        output: a.usage.output + u.output_tokens,
        cacheRead: a.usage.cacheRead + u.cache_read_input_tokens,
        cacheWrite: a.usage.cacheWrite + u.cache_creation_input_tokens,
      },
    })),
  )
}

type FleetUsageInput = {
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

// ---- Hooks --------------------------------------------------------------

export const register: Register = (on, options) => {
  const chosen = asLang(options.language)
  t = STRINGS[chosen ?? 'en']

  on('session.start', async ($, e, next) => {
    if (chosen === undefined) {
      t = STRINGS[await detectLang($)]
      $.ui.invalidate('ui.render')
    }
    await $.command.register({
      name: 'flotilla',
      description: 'Show running agents above the prompt, in the side pane (`side`) or on one line (`compact`)',
      argumentHint: '[above | side | compact | timeline | list | clear | lang en|fr|auto]',
    })
    $.clock.every(TICK_MS, () => void tick($).catch(() => undefined))
    if ((await read($, view)) !== 'side') void $.ui.close({ id: PANE }).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'flotilla' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const lang = /^lang(?:uage)?\s+(en|fr|auto)$/.exec(arg)?.[1]
    if (lang !== undefined) {
      const { deny } = await setLanguage($, lang)

      return { text: deny === undefined ? `Flotilla language set to ${lang}.` : `Couldn't set the language: ${deny}` }
    }
    if (arg === 'clear') {
      await clearDone($)

      return { text: 'Finished agents cleared from the flotilla.' }
    }
    if (arg === 'timeline' || arg === 'list') {
      await update($, layout, () => (arg === 'timeline' ? 'timeline' : 'list'))

      return { text: `Flotilla drawn as a ${arg}.` }
    }
    if (arg === 'side' || arg === 'pane' || arg === 'panneau') {
      await showIn($, 'side')

      return { text: 'Flotilla shown in the side pane.' }
    }
    if (arg === 'compact' || arg === 'band') {
      await showIn($, 'compact')

      return { text: 'Flotilla shown on one line above the prompt.' }
    }
    await showIn($, 'above')

    return { text: 'Flotilla shown above the prompt.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    const started = result as { agentId?: string; model?: string }
    if (started.agentId === undefined) return result

    await track($, e, started.agentId, started.model ?? e.model ?? e.parentModel).catch(() => undefined)

    return result
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if ((e.tool as string) === 'Workflow') await noteWorkflow($, e.tool_use_id, e).catch(() => undefined)
    const agentId = e.agentId
    if (agentId === undefined) return next(e)

    await toolStarted($, agentId, e.tool, targetOf(e)).catch(() => undefined)
    try {
      return await next(e)
    } finally {
      void toolEnded($, agentId).catch(() => undefined)
    }
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) await finished($, e.agentId, e).catch(() => undefined)

    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      // Closing the pane by hand collapses to one line rather than hiding the flotilla.
      const isByHand = e.origin.kind === 'person'
      await update($, paneShown, () => false)
        .then(async () => (isByHand && (await read($, view)) === 'side' ? update($, view, () => 'compact') : undefined))
        .catch(() => undefined)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    const { Box, Text, Button } = el
    const all = await read($, fleet)
    const isHidingDone = await read($, hideDone)
    const isTimeline = (await read($, layout)) === 'timeline'
    const { frame } = await read($, clock)
    const now = await $.clock.now()
    const ctx: Ctx = { frame, now, cols: e.props.bodyColumns }
    const shown = isHidingDone ? all.filter(a => isLive(a.status)) : all
    const items = itemsOf(shown, await read($, workflowNames), await read($, openRuns))
    const busy = all.filter(a => isBusy(a.status)).length
    const done = all.filter(a => !isLive(a.status)).length
    const tools = all.reduce((sum, a) => sum + a.tools, 0)
    const { tokens, cost } = totals(all)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Box flexDirection="row" gap={1}>
            <Text color={busy > 0 ? 'claude' : 'success'}>{busy > 0 ? SPINNER[frame % SPINNER.length] : '✓'}</Text>
            <Text bold>{TITLE}</Text>
          </Box>
          <Text dimColor>
            {t.active(busy)} · {t.done(done)}
          </Text>
        </Box>
        <Box flexDirection="column" marginY={1}>
          {items.length === 0 && (
            <Text dimColor>{t.empty}</Text>
          )}
          {items.length > 0 && (isTimeline ? timelineRows($, el, items, ctx) : listRows($, el, items, ctx, false))}
        </Box>
        <Text dimColor>
          {kilo(tokens)} tokens{cost ? ` · ${cost}` : ''} · {t.toolCalls(tools)}
        </Text>
        <Box flexDirection="row" gap={1} marginTop={1} flexWrap="wrap">
          <Button key="layout" label={isTimeline ? t.list : t.timeline} hotkey="t" onPress={() => toggleLayout($)} />
          <Button key="above" label={t.above} hotkey="a" onPress={() => showIn($, 'above')} />
          <Button key="collapse" label={t.collapse} hotkey="r" onPress={() => showIn($, 'compact')} />
          <Button
            key="hide-done"
            label={isHidingDone ? t.showDone : t.hideDone}
            hotkey="h"
            onPress={() => update($, hideDone, v => !v)}
          />
          <Button key="clear" label={t.clear} hotkey="c" onPress={() => clearDone($)} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const where = await read($, view)
    if (where === 'side' && (await read($, paneShown))) return next(e)

    const { frame } = await read($, clock)
    const now = await $.clock.now()
    const isHidingDone = await read($, hideDone)
    const shown = (await read($, fleet)).filter(
      a => isLive(a.status) || (!isHidingDone && a.endedAt !== undefined && now - a.endedAt < LINGER_MS),
    )
    if (shown.length === 0) return next(e)

    const el = $.ui.resolve(e)
    const { Box, Text, Button } = el
    const busy = shown.filter(a => isBusy(a.status)).length
    const head = `${busy > 0 ? SPINNER[frame % SPINNER.length] : '✓'} ${busy} agent${busy > 1 ? 's' : ''}`

    if (where === 'above') {
      const ctx: Ctx = { frame, now, cols: e.props.bodyColumns }
      const isTimeline = (await read($, layout)) === 'timeline'
      const items = itemsOf(shown, await read($, workflowNames), await read($, openRuns))
      const room = Math.max(1, e.props.maxRows - (isTimeline ? 2 : 1))
      const visible = items.length > room ? items.slice(0, room - 1) : items
      const hidden = items.length - visible.length
      const done = shown.filter(a => !isLive(a.status)).length
      const { tokens, cost } = totals(shown)

      return (
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Box flexDirection="row" gap={2}>
              <Text color={busy > 0 ? 'claude' : 'success'} bold>{head}</Text>
              <Text dimColor>
                {t.done(done)} · {kilo(tokens)} tokens{cost ? ` · ${cost}` : ''}
              </Text>
            </Box>
            <Box flexDirection="row" gap={1}>
              <Button key="layout" label={isTimeline ? t.list : t.timeline} hotkey="t" onPress={() => toggleLayout($)} />
              <Button key="side" label={t.pane} hotkey="p" onPress={() => showIn($, 'side')} />
              <Button key="collapse" label={t.collapse} hotkey="r" onPress={() => showIn($, 'compact')} />
              <Button
                key="hide-done"
                label={isHidingDone ? t.showDone : t.hideDone}
                hotkey="h"
                onPress={() => update($, hideDone, v => !v)}
              />
            </Box>
          </Box>
          {isTimeline ? timelineRows($, el, visible, ctx) : listRows($, el, visible, ctx, true)}
          {hidden > 0 && <Text dimColor>  {t.more(hidden)}</Text>}
        </Box>
      )
    }

    let room = e.props.bodyColumns - head.length - 14
    const chips: { agent: FleetAgent; text: string }[] = []
    for (const a of [...shown].sort((x, y) => Number(isLive(y.status)) - Number(isLive(x.status)))) {
      const words = a.description.split(/\s+/).slice(0, 3).join(' ')
      const text = `${a.type} ${words} ${elapsed((a.endedAt ?? now) - a.startedAt)}`
      if (text.length + 4 > room) break
      room -= text.length + 4
      chips.push({ agent: a, text })
    }
    const hidden = shown.length - chips.length

    return (
      <Box flexDirection="row" gap={2}>
        <Text color={busy > 0 ? 'claude' : 'success'} bold>{head}</Text>
        {chips.map(({ agent: a, text }) => {
          const mark = icon(a, frame, now)

          return (
            <Box key={a.id} flexDirection="row" gap={1}>
              <Text color={mark.color}>{isBusy(a.status) && !isStuck(a, now) ? '●' : mark.glyph}</Text>
              <Text dimColor={!isLive(a.status)}>{text}</Text>
            </Box>
          )
        })}
        {hidden > 0 && <Text dimColor>+{hidden}</Text>}
        <Button key="expand" label={t.expand} hotkey="e" onPress={() => showIn($, 'above')} />
      </Box>
    )
  })
}
