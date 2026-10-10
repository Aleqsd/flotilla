import { atom, read, update } from 'claude-code'
import type { AgentSpawnInput, AgentStatus, EngineInterface, Register } from 'claude-code'

import type { FleetAgent, FleetKind, FleetView } from '../types'
import { totals } from './cost'
import { elapsed, kilo, oneLine, summarize, targetOf } from './format'
import { headline, itemsOf, listRows, timelineRows } from './rows'
import {
  IDLE_HINT_MS, LINGER_MS, MAX_ROWS, PANE, patch, SPARK, SPINNER, TASK_TOOLS, TICK_MS, TITLE, ZERO,
} from './state'
import type { Ctx } from './state'
import { icon, isBusy, isLive, isStuck, isTask } from './status'
import { asLang, setLang, t } from './strings'
import type { Lang } from './strings'
import { notified } from './tasks'
import type { Ended, InFlight } from './tasks'

// The state the drawings read. The validator lists every `$.state` key a module
// touches, so the atoms are declared here, in the module's own file.
const fleet = atom({ plugin: 'flotilla', key: 'fleet' } as const, [])
const view = atom({ plugin: 'flotilla', key: 'view' } as const, 'above')
const layout = atom({ plugin: 'flotilla', key: 'layout' } as const, 'list')
const paneShown = atom({ plugin: 'flotilla', key: 'paneShown' } as const, false)
const hideDone = atom({ plugin: 'flotilla', key: 'hideDone' } as const, false)
const clock = atom({ plugin: 'flotilla', key: 'clock' } as const, { frame: 0, now: 0 })
const workflowNames = atom({ plugin: 'flotilla', key: 'workflowNames' } as const, [])
const openRuns = atom({ plugin: 'flotilla', key: 'openRuns' } as const, [])
const idleHintUntil = atom({ plugin: 'flotilla', key: 'idleHintUntil' } as const, 0)

// Every function that takes `$` lives in this file too: the validator follows `$`
// only through functions declared here. The other modules are pure.

// ---- Language -----------------------------------------------------------

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

// Said after a view change while nothing is running, so an empty band isn't a mystery;
// the band shows its "nothing running" line for a moment too.
async function quietNote($: EngineInterface) {
  if ((await read($, fleet)).some(a => isLive(a.status))) return ''
  await showIdleHint($)

  return `\n${t.noneRunning}`
}

async function showIdleHint($: EngineInterface) {
  const until = (await $.clock.now()) + IDLE_HINT_MS
  await update($, idleHintUntil, () => until)
}

// ---- Views --------------------------------------------------------------

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

// ---- Agents -------------------------------------------------------------

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

type UsageInput = {
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

async function finished($: EngineInterface, agentId: string, e: { answer: string; isAborted: boolean; reason: string; usage?: UsageInput }) {
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

// ---- Background tasks ---------------------------------------------------

async function taskStarted($: EngineInterface, kind: Exclude<FleetKind, 'agent'>, input: unknown, output: unknown, parentId: string | undefined) {
  const out = (output ?? {}) as Record<string, unknown>
  const id = typeof out.backgroundTaskId === 'string' ? out.backgroundTaskId
    : kind === 'monitor' && typeof out.taskId === 'string' ? out.taskId
    : undefined
  if (id === undefined) return
  const fields = input as Record<string, unknown>
  const command = typeof fields.command === 'string' && fields.command !== '' ? oneLine(fields.command) : undefined
  const description = typeof fields.description === 'string' && fields.description !== '' ? fields.description : (command ?? kind)
  const now = await $.clock.now()
  const row: FleetAgent = {
    id, kind, type: kind, description, parentId, target: command,
    startedAt: now, lastActivityAt: now, inFlight: 0, status: 'running',
    tools: 0, activity: [], usage: ZERO,
  }
  await update($, fleet, list => [...list.filter(a => a.id !== id), row].slice(-MAX_ROWS))
  await update($, clock, c => ({ frame: c.frame, now }))
}

async function tasksEnded($: EngineInterface, ended: Ended[]) {
  if (ended.length === 0) return
  const now = await $.clock.now()
  await update($, fleet, list => list.map(a => {
    const end = ended.find(x => x.id === a.id)

    return end !== undefined && isTask(a) && isLive(a.status) ? { ...a, status: end.status, endedAt: now } : a
  }))
}

// At each turn's end the engine lists the background work still in flight:
// tracked tasks missing from it have ended; shells and monitors never seen starting are added.
async function syncTasks($: EngineInterface, inFlight: readonly InFlight[]) {
  const now = await $.clock.now()
  const ids = new Set(inFlight.map(x => x.id))
  await update($, fleet, list => {
    const known = new Set(list.map(a => a.id))
    const ended = list.map(a => (isTask(a) && isLive(a.status) && !ids.has(a.id) ? { ...a, status: 'completed' as const, endedAt: now } : a))
    const added: FleetAgent[] = inFlight
      .filter(x => (x.type === 'shell' || x.type === 'monitor') && !known.has(x.id))
      .map(x => ({
        id: x.id,
        kind: x.type === 'shell' ? 'shell' : 'monitor',
        type: x.type,
        description: x.description || x.command || x.type,
        target: x.command === undefined ? undefined : oneLine(x.command),
        startedAt: now, lastActivityAt: now, inFlight: 0, status: 'running',
        tools: 0, activity: [], usage: ZERO,
      }))

    return [...ended, ...added].slice(-MAX_ROWS)
  })
}

// ---- Clock --------------------------------------------------------------

let ticks = 0
let lastStatus: string | undefined

// Four frames a second while something is busy (the spinners), one a second
// while rows only wait or linger, none when nothing is left to draw. The
// status line carries a still dot, so it changes only when the counts do.
async function tick($: EngineInterface) {
  ticks += 1
  const list = await read($, fleet)
  const isAnyLive = list.some(a => isLive(a.status))
  const isAnyBusy = list.some(a => isBusy(a.status))
  if (ticks % (isAnyLive ? 8 : 40) === 1) await reconcile($, await $.clock.now())

  const hintUntil = await read($, idleHintUntil)
  if (hintUntil !== 0 && (await $.clock.now()) >= hintUntil) await update($, idleHintUntil, () => 0)

  const { cost } = totals(list)
  const status = list.length === 0 ? undefined : `${headline(list, undefined, true)}${cost ? ` · ${cost}` : ''}`
  if (status !== lastStatus) {
    lastStatus = status
    $.ui.status(status)
  }

  const now = await $.clock.now()
  const isLingering = list.some(a => a.endedAt !== undefined && now - a.endedAt < LINGER_MS + 1000)
  if (!isAnyLive && !isLingering) return
  const isSecond = ticks % 4 === 0
  if (!isAnyBusy && !isSecond) return

  if (isSecond && isAnyBusy) {
    await update($, fleet, all =>
      all.map(a => (isLive(a.status) && !isTask(a) ? { ...a, activity: [...a.activity, 0].slice(-SPARK) } : a)),
    )
  }
  await update($, clock, c => ({ frame: c.frame + 1, now }))
}

// ---- Hooks --------------------------------------------------------------

export const register: Register = (on, options) => {
  const chosen = asLang(options.language)
  setLang(chosen ?? 'en')

  on('session.start', async ($, e, next) => {
    if (chosen === undefined) {
      setLang(await detectLang($))
      $.ui.invalidate('ui.render')
    }
    await $.command.register({
      name: 'flotilla',
      description: 'Show running agents above the prompt, in the side pane (`side`) or on one line (`compact`)',
      argumentHint: '[above | side | compact | timeline | list | clear | lang en|fr|auto]',
    })
    $.clock.every(TICK_MS, () => void tick($).catch(() => undefined))
    void showIdleHint($).catch(() => undefined)
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

      return { text: `Flotilla shown on one line above the prompt.${await quietNote($)}` }
    }
    await showIn($, 'above')

    return { text: `Flotilla shown above the prompt.${await quietNote($)}` }
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    const started = result as { agentId?: string; model?: string }
    if (started.agentId === undefined) return result

    await track($, e, started.agentId, started.model ?? e.model ?? e.parentModel).catch(() => undefined)

    return result
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const tool = e.tool as string
    if (tool === 'Workflow') await noteWorkflow($, e.tool_use_id, e).catch(() => undefined)
    const agentId = e.agentId
    const taskKind = TASK_TOOLS[tool]
    if (agentId === undefined && taskKind === undefined && tool !== 'TaskStop') return next(e)

    if (agentId !== undefined) await toolStarted($, agentId, e.tool, targetOf(e)).catch(() => undefined)
    try {
      const ran = await next(e)
      const output = (ran as { result?: unknown }).result
      if (taskKind !== undefined) await taskStarted($, taskKind, e, output, agentId).catch(() => undefined)
      if (tool === 'TaskStop') {
        const stopped = (output as { task_id?: unknown } | undefined)?.task_id
        if (typeof stopped === 'string') await tasksEnded($, [{ id: stopped, status: 'killed' }]).catch(() => undefined)
      }

      return ran
    } finally {
      if (agentId !== undefined) void toolEnded($, agentId).catch(() => undefined)
    }
  }).catch(($, e, next) => next(e))

  on('prompt.submit', ($, e, next) => {
    if (e.origin.kind === 'task-notification') void tasksEnded($, notified(e.text)).catch(() => undefined)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.Stop', async ($, e, next) => {
    await syncTasks($, e.background_tasks ?? []).catch(() => undefined)

    return next(e)
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
    const onToggle = (runId: string) => void toggleRun($, runId)
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
          {items.length > 0 && (isTimeline ? timelineRows(el, items, ctx, onToggle) : listRows(el, items, ctx, false, onToggle))}
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
    if (shown.length === 0) {
      if (now >= (await read($, idleHintUntil))) return next(e)
      const { Text } = $.ui.resolve(e)

      return <Text dimColor>{t.idleLine}</Text>
    }

    const el = $.ui.resolve(e)
    const { Box, Text, Button } = el
    const busy = shown.filter(a => isBusy(a.status)).length
    const head = headline(shown, frame, false)
    const onToggle = (runId: string) => void toggleRun($, runId)

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
          {isTimeline ? timelineRows(el, visible, ctx, onToggle) : listRows(el, visible, ctx, true, onToggle)}
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
