import { describe, expect, mock, test } from 'claude-code/testing'

import type { FleetAgent } from '../types'
import { detail, headline } from './rows'
import { notified } from './tasks'

const PANE_PROPS = {
  title: 'Flotilla',
  isFocused: false,
  bodyColumns: 100,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
} as const

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: true,
  maxRows: 12,
  bodyColumns: 140,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
} as const

const SPAWN = {
  prompt: 'Do it.',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-opus-5-5',
  background: true,
  fork: false,
} as const

describe('flotilla', () => {
  test('a spawned agent shows in the pane, collapses to one line and expands above the prompt', { options: { language: 'fr' } }, async ($, on) => {
    mock.clock(on)
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.close', () => ({ value: undefined }))
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'agent-1' }))
    await $.agent.spawn({ ...SPAWN, tool_use_id: 'toolu_1', description: 'Map the auth module', subagentType: 'Explore' })

    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await $.ui.mount({
        plugin: 'flotilla', surface, component: 'Pane', requestId: 'flotilla', props: PANE_PROPS,
      })
      expect(await pane.find({ type: 'Text', text: /Map the auth module/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /1 actif/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /^haiku$/ })).toBeDefined()
      await pane.press({ key: 'collapse' })
      await pane.unmount()

      const band = await $.ui.mount({ plugin: 'flotilla', surface, component: 'AbovePrompt', props: BAND_PROPS })
      expect(await band.find({ type: 'Text', text: /1 agent/ })).toBeDefined()
      expect(await band.find({ type: 'Text', text: /Explore Map the auth/ })).toBeDefined()
      await band.press({ key: 'expand' })
      await band.unmount()

      const above = await $.ui.mount({ plugin: 'flotilla', surface, component: 'AbovePrompt', props: BAND_PROPS })
      expect(await above.find({ type: 'Text', text: /^Map the auth module$/ })).toBeDefined()
      expect(await above.find({ key: 'side' })).toBeDefined()
      await above.unmount()
    }
  })

  test('a finished agent shows its answer and cost; a silent one is flagged', { options: { language: 'fr' } }, async ($, on) => {
    const clock = mock.clock(on)
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.close', () => ({ value: undefined }))
    on('agent.list', () => ({ value: [] }))
    on('turn.complete', (_, e) => ({ text: e.answer }))
    let next = 0
    on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `agent-${(next += 1)}` }))
    await $.agent.spawn({ ...SPAWN, tool_use_id: 'toolu_1', description: 'Find the bug', subagentType: 'general-purpose' })
    await $.agent.spawn({ ...SPAWN, tool_use_id: 'toolu_2', description: 'Stare at the wall', subagentType: 'Explore' })

    await $.turn.complete({
      agentId: 'agent-1',
      answer: 'The bug is in session.ts line 42. More details follow.',
      durationMs: 5000,
      isAborted: false,
      reason: 'answer',
      turnId: 'turn-1',
      usage: {
        model: 'claude-sonnet-5-5',
        input_tokens: 100_000,
        output_tokens: 10_000,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    })
    await clock.advance(61_000)

    const pane = await $.ui.mount({
      plugin: 'flotilla', surface: 'terminal', component: 'Pane', requestId: 'flotilla', props: PANE_PROPS,
    })
    // 100k in at $2 + 10k out at $10 = $0.30
    expect(await pane.find({ type: 'Text', text: /\$0\.30 — The bug is in session\.ts line 42\.$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /aucune activité depuis 1m0/ })).toBeDefined()
    await pane.unmount()
  })

  test('workflow agents group under one row that opens, and the timeline draws bars', { options: { language: 'fr' } }, async ($, on) => {
    mock.clock(on)
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.close', () => ({ value: undefined }))
    let next = 0
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: `wf-agent-${(next += 1)}` }))
    for (const agentIndex of [1, 2, 3]) {
      await $.agent.spawn({
        ...SPAWN,
        tool_use_id: 'toolu_wf',
        description: `Review file ${agentIndex}`,
        subagentType: 'Explore',
        workflow: { runId: 'wf_abc123', agentIndex },
      })
    }

    const above = await $.ui.mount({ plugin: 'flotilla', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await above.find({ type: 'Text', text: /^workflow abc123$/ })).toBeDefined()
    expect(await above.find({ type: 'Text', text: /^Review file 2$/ })).toBeUndefined()
    await above.press({ key: 'wf-wf_abc123' })
    expect(await above.find({ type: 'Text', text: /^Review file 2$/ })).toBeDefined()
    await above.press({ key: 'layout' })
    expect(await above.find({ type: 'Text', text: /█/ })).toBeDefined()
    expect(await above.find({ type: 'Text', text: /maintenant$/ })).toBeDefined()
    await above.unmount()
  })

  test('it speaks English when asked, and auto falls back to English', async ($, on) => {
    mock.clock(on)
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.close', () => ({ value: undefined }))
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'agent-en' }))
    await $.agent.spawn({ ...SPAWN, tool_use_id: 'toolu_en', description: 'Map the auth module', subagentType: 'Explore' })

    const pane = await $.ui.mount({
      plugin: 'flotilla', surface: 'terminal', component: 'Pane', requestId: 'flotilla', props: PANE_PROPS,
    })
    expect(await pane.find({ type: 'Text', text: /^1 active · 0 done$/ })).toBeDefined()
    expect(await pane.find({ key: 'layout', text: 'Timeline' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /starting…/ })).toBeDefined()
    await pane.unmount()
  })

  test('the language option picks the words', { options: { language: 'en' } }, async ($, on) => {
    mock.clock(on)
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.close', () => ({ value: undefined }))
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'agent-en' }))
    await $.agent.spawn({ ...SPAWN, tool_use_id: 'toolu_en', description: 'Map the auth module', subagentType: 'Explore' })

    const above = await $.ui.mount({ plugin: 'flotilla', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await above.find({ key: 'side', text: 'Side pane' })).toBeDefined()
    expect(await above.find({ key: 'collapse', text: 'Collapse' })).toBeDefined()
    await above.unmount()
  })

  test('a background shell shows as a task, and ends when the turn says it is gone', { options: { language: 'en' } }, async ($, on) => {
    mock.clock(on)
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.close', () => ({ value: undefined }))
    on('classic.Stop', () => ({}))
    on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bash_1' } }))
    await $.tool.call({ tool: 'Bash', command: 'npm test -- --watch', description: 'Run the test watcher', run_in_background: true })

    const above = await $.ui.mount({ plugin: 'flotilla', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await above.find({ type: 'Text', text: /^shell$/ })).toBeDefined()
    expect(await above.find({ type: 'Text', text: /^Run the test watcher$/ })).toBeDefined()
    expect(await above.find({ type: 'Text', text: /^. 1 task$/ })).toBeDefined()
    await above.unmount()

    await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
    const pane = await $.ui.mount({
      plugin: 'flotilla', surface: 'terminal', component: 'Pane', requestId: 'flotilla', props: PANE_PROPS,
    })
    expect(await pane.find({ type: 'Text', text: /done · \$ npm test -- --watch/ })).toBeDefined()
    await pane.unmount()
  })

  test('tasks still in flight at a turn end are picked up', { options: { language: 'fr' } }, async ($, on) => {
    mock.clock(on)
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.close', () => ({ value: undefined }))
    on('classic.Stop', () => ({}))
    await $.classic.Stop({
      stop_hook_active: false,
      background_tasks: [{ id: 'mon_7', type: 'monitor', status: 'running', description: 'Watch the deploy', command: 'kubectl rollout status' }],
    })

    const pane = await $.ui.mount({
      plugin: 'flotilla', surface: 'desktop', component: 'Pane', requestId: 'flotilla', props: PANE_PROPS,
    })
    expect(await pane.find({ type: 'Text', text: /^Watch the deploy$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^\$ kubectl rollout status$/ })).toBeDefined()
    await pane.unmount()
  })

  test('task notifications are read as Claude Code writes them', async () => {
    // Both captured from real background commands in Claude Code 2.1.293.
    const ok = [
      '<task-notification>',
      '<task-id>bkfcwbcvq</task-id>',
      '<tool-use-id>toolu_013SToGv3dnvSGUCdwVigVbX</tool-use-id>',
      '<output-file>C:\Temp\tasks\bkfcwbcvq.output</output-file>',
      '<status>completed</status>',
      '<summary>Background command "Wait for the CI run to finish" completed (exit code 0)</summary>',
      '</task-notification>',
    ].join('\n')
    const failed = [
      '<task-notification>',
      '<task-id>bcduz1ph2</task-id>',
      '<tool-use-id>toolu_01QX5erS8X816QgatUf6aoX8</tool-use-id>',
      '<output-file>C:\Temp\tasks\bcduz1ph2.output</output-file>',
      '<status>failed</status>',
      '<summary>Background command "Run a failing background command" failed with exit code 3</summary>',
      '</task-notification>',
    ].join('\n')

    expect(notified(ok)).toEqual([{ id: 'bkfcwbcvq', status: 'completed' }])
    expect(notified(failed)).toEqual([{ id: 'bcduz1ph2', status: 'failed' }])
    expect(notified(`${ok}\n${failed}`)).toEqual([
      { id: 'bkfcwbcvq', status: 'completed' },
      { id: 'bcduz1ph2', status: 'failed' },
    ])
    expect(notified('no notification here')).toEqual([])
  })

  test('/flotilla says when nothing runs, and the band shows it for a moment', { options: { language: 'en' } }, async ($, on) => {
    const clock = mock.clock(on)
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.close', () => ({ value: undefined }))
    // Stands for the engine's own band, drawn once Flotilla passes it on.
    on('ui.render', (_, e) => _.ui.resolve(e).Text({ children: 'engine band' }))
    const reply = await $.command.run({
      command: 'flotilla', args: '', origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 120 },
    })
    expect(JSON.stringify(reply)).toContain('Nothing is running right now')

    const band = await $.ui.mount({ plugin: 'flotilla', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await band.find({ type: 'Text', text: 'Flotilla is on · nothing running' })).toBeDefined()
    await band.unmount()

    await clock.advance(9_000)
    const later = await $.ui.mount({ plugin: 'flotilla', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await later.find({ type: 'Text', text: 'Flotilla is on · nothing running' })).toBeUndefined()
    await later.unmount()
  })

  test('an agent waiting on its own background work says so, and the headline counts it', async () => {
    const base = { tools: 3, activity: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, startedAt: 0, lastActivityAt: 0, inFlight: 0 }
    const waiting: FleetAgent = { ...base, id: 'a1', type: 'general-purpose', description: 'Audit', status: 'waiting' }
    const monitor: FleetAgent = { ...base, id: 'm1', kind: 'monitor', type: 'monitor', description: 'Watch', parentId: 'a1', status: 'running' }

    expect(detail(waiting, 5_000)).toBe('◌ waiting on its background work')
    expect(headline([waiting, monitor], undefined, false)).toBe('● 1 waiting · 1 task')
    expect(headline([waiting, monitor], undefined, true)).toBe('● 0/1 agent · 1 waiting · 1 task')
    expect(headline([], undefined, false)).toBe('✓ 0 agents')
  })

  test('a band too short for the rows falls back to the one-line view', { options: { language: 'en' } }, async ($, on) => {
    mock.clock(on)
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.close', () => ({ value: undefined }))
    let next = 0
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: `agent-${(next += 1)}` }))
    for (const n of [1, 2, 3, 4]) {
      await $.agent.spawn({ ...SPAWN, tool_use_id: `toolu_${n}`, description: `Task number ${n}`, subagentType: 'Explore' })
    }

    const short = await $.ui.mount({
      plugin: 'flotilla', surface: 'terminal', component: 'AbovePrompt',
      props: { ...BAND_PROPS, maxRows: 3, scroll: { offset: 0, bodyRows: 3 } },
    })
    expect(await short.find({ key: 'expand' })).toBeDefined()
    expect(await short.find({ type: 'Text', text: /^4 agents$|^. 4 agents$/ })).toBeDefined()
    await short.unmount()

    const tall = await $.ui.mount({ plugin: 'flotilla', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await tall.find({ key: 'expand' })).toBeUndefined()
    expect(await tall.find({ type: 'Text', text: /^Task number 4$/ })).toBeDefined()
    await tall.unmount()
  })
})

