import type { FleetAgent, FleetWorkflowName } from '../types'
import { costOf, dollars, family, tokensOf, totals } from './cost'
import { elapsed, kilo, progress, spark } from './format'
import { SPARK, SPINNER, TYPE_COLORS } from './state'
import type { Ctx, El, Group, Item } from './state'
import { groupIcon, icon, isBusy, isLive, isStuck, isTask } from './status'
import { t } from './strings'

type Toggle = (runId: string) => void

// What a row says under its name: the tool at work, the command, or what it found.
export function detail(a: FleetAgent, now: number): string {
  if (isTask(a)) {
    const what = a.target ?? a.description

    return isLive(a.status) ? `$ ${what}` : `${t.ended(a.status)} · $ ${what}`
  }
  if (isStuck(a, now)) return t.idleFor(elapsed(now - a.lastActivityAt))
  // Its turn is over but it holds background work (a monitor, a subagent): say so.
  if ((a.status === 'waiting' || a.status === 'idle') && a.inFlight === 0) return t.waitingOn
  if (isLive(a.status)) {
    const running = a.inFlight > 0 && now - a.lastActivityAt > 10_000 ? ` (${elapsed(now - a.lastActivityAt)})` : ''

    // Between tools (or after a turn, before the next) an agent that already worked is thinking.
    if (a.tool === undefined) return `↳ ${a.tools === 0 ? t.starting : t.thinking}`

    return `↳ ${a.tool}${a.target ? ` ${a.target}` : ''}${running}`
  }
  const cost = costOf(a)
  const counts = `${t.tools(a.tools)} · ${kilo(tokensOf(a.usage))} tokens${cost === undefined ? '' : ` · ${dollars(cost)}`}`

  return a.summary ? `${counts} — ${a.summary}` : counts
}

// `⠋ 2 agents · 1 waiting · 1 task`: running agents, agents waiting on their
// own background work, then running tasks; each only when there are any.
// `frame` is the spinner frame to draw, or undefined for a still dot.
export function headline(list: FleetAgent[], frame: number | undefined, withTotal: boolean): string {
  const agents = list.filter(a => !isTask(a))
  const busyAgents = agents.filter(a => isBusy(a.status)).length
  const waitingAgents = agents.filter(a => isLive(a.status) && !isBusy(a.status)).length
  const busyTasks = list.filter(a => isTask(a) && isBusy(a.status)).length
  const isBusyNow = busyAgents + waitingAgents + busyTasks > 0
  const glyph = !isBusyNow ? '✓' : frame === undefined ? '●' : SPINNER[frame % SPINNER.length]
  const agentPart = withTotal ? t.agents(agents.length).replace(/^\d+/, `${busyAgents}/${agents.length}`) : t.agents(busyAgents)
  const parts = [
    ...(busyAgents > 0 || (withTotal && agents.length > 0) ? [agentPart] : []),
    ...(waitingAgents > 0 ? [t.waiting(waitingAgents)] : []),
    ...(busyTasks > 0 ? [t.tasks(busyTasks)] : []),
  ]

  const tasks = list.filter(a => isTask(a)).length
  const idle = agents.length === 0 && tasks > 0 ? t.tasks(tasks) : t.agents(agents.length)

  return `${glyph} ${parts.length > 0 ? parts.join(' · ') : idle}`
}

// Roots and workflow groups by start time, each followed by its children.
export function itemsOf(list: FleetAgent[], names: FleetWorkflowName[], open: string[]): Item[] {
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

function groupRow(el: El, g: Group, ctx: Ctx, onToggle: Toggle) {
  const { Box, Text, Button } = el
  const mark = groupIcon(g.members, ctx.frame, ctx.now)
  const f = groupFacts(g, ctx.now)

  // Fixed parts never shrink: only the name gives way to a narrow column.
  return (
    <Box key={`wf-${g.runId}`} flexDirection="row" gap={1}>
      <Box flexShrink={0} flexDirection="row" gap={1}>
        <Button key={`wf-${g.runId}`} label={g.isOpen ? '▾' : '▸'} plain onPress={() => onToggle(g.runId)} />
        <Text color={mark.color}>{mark.glyph}</Text>
        <Text color="merged" bold>workflow</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="truncate-end">{g.name}</Text>
      </Box>
      <Box flexShrink={0} flexDirection="row" gap={1}>
        <Text color={f.done === f.total ? 'success' : 'claude'}>{progress(f.done, f.total)}</Text>
        <Text dimColor>
          {f.done}/{f.total}{f.cost ? ` · ${f.cost}` : ''}
        </Text>
        <Box width={6} justifyContent="flex-end">
          <Text dimColor>{elapsed(f.end - f.start)}</Text>
        </Box>
      </Box>
    </Box>
  )
}

const activityOf = (a: FleetAgent) => (isTask(a) ? ' '.repeat(SPARK) : spark(a.activity))

// Two lines an agent: what it is, then what it does or what it found.
function paneRow(el: El, a: FleetAgent, depth: number, ctx: Ctx) {
  const { Box, Text } = el
  const mark = icon(a, ctx.frame, ctx.now)
  const live = isLive(a.status)
  const indent = depth > 0 ? `${'   '.repeat(depth - 1)}└─ ` : ''
  const model = family(a.model)

  return (
    <Box key={a.id} flexDirection="row" gap={1}>
      <Box flexShrink={0}>
        <Text color={mark.color}>{mark.glyph}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Box flexDirection="row" gap={1}>
          <Box flexShrink={0} flexDirection="row" gap={1}>
            {indent !== '' && <Text dimColor>{indent.trimEnd()}</Text>}
            <Text color={TYPE_COLORS[a.type] ?? 'remember'} bold>{a.type}</Text>
            {model !== undefined && <Text dimColor>{model}</Text>}
          </Box>
          <Box flexShrink={1}>
            <Text dimColor={!live} wrap="truncate-end">{a.description}</Text>
          </Box>
        </Box>
        <Text color={isStuck(a, ctx.now) ? 'warning' : undefined} dimColor={!isStuck(a, ctx.now)} wrap="truncate-end">
          {' '.repeat(indent.length)}{detail(a, ctx.now)}
        </Text>
      </Box>
      <Box flexShrink={0} flexDirection="row" gap={1}>
        {ctx.cols >= 52 && <Text color={isBusy(a.status) ? 'claude' : 'inactive'}>{activityOf(a)}</Text>}
        <Box width={6} justifyContent="flex-end">
          <Text dimColor>{elapsed((a.endedAt ?? ctx.now) - a.startedAt)}</Text>
        </Box>
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
      <Box flexShrink={0} flexDirection="row" gap={1}>
        <Text color={mark.color}>{mark.glyph}</Text>
        {depth > 0 && <Text dimColor>{`${'   '.repeat(depth - 1)}└─`}</Text>}
        <Text color={TYPE_COLORS[a.type] ?? 'remember'} bold>{a.type}</Text>
        {model !== undefined && <Text dimColor>{model}</Text>}
      </Box>
      <Box width={Math.max(12, Math.floor(ctx.cols * 0.28))} flexShrink={1}>
        <Text dimColor={!live} wrap="truncate-end">{a.description}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text color={isStuck(a, ctx.now) ? 'warning' : undefined} dimColor={!isStuck(a, ctx.now)} wrap="truncate-end">
          {detail(a, ctx.now)}
        </Text>
      </Box>
      <Box flexShrink={0} flexDirection="row" gap={1}>
        {ctx.cols >= 90 && <Text color={isBusy(a.status) ? 'claude' : 'inactive'}>{activityOf(a)}</Text>}
        <Box width={6} justifyContent="flex-end">
          <Text dimColor>{elapsed((a.endedAt ?? ctx.now) - a.startedAt)}</Text>
        </Box>
      </Box>
    </Box>
  )
}

// A bar on the time axis for each agent, task or closed workflow.
export function timelineRows(el: El, items: Item[], ctx: Ctx, onToggle: Toggle) {
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
            <Button key={`wf-${item.runId}`} label={item.isOpen ? '▾' : '▸'} plain onPress={() => onToggle(item.runId)} />
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

export function listRows(el: El, items: Item[], ctx: Ctx, isOneLine: boolean, onToggle: Toggle) {
  return items.map(item =>
    item.kind === 'group'
      ? groupRow(el, item, ctx, onToggle)
      : isOneLine
        ? lineRow(el, item.agent, item.depth, ctx)
        : paneRow(el, item.agent, item.depth, ctx),
  )
}
