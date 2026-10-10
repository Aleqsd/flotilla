import { describe, expect, mock, test } from 'claude-code/testing'

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
  test('a spawned agent shows in the pane, collapses to one line and expands above the prompt', async ($, on) => {
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
      expect(await pane.find({ type: 'Text', text: /^ haiku$/ })).toBeDefined()
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

  test('a finished agent shows its answer and cost; a silent one is flagged', async ($, on) => {
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

  test('workflow agents group under one row that opens, and the timeline draws bars', async ($, on) => {
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
})
