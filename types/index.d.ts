export type FleetStatus = 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'

/** Token counts as the API reports them, summed over the agent's turns. */
export type FleetUsage = { input: number; output: number; cacheRead: number; cacheWrite: number }

/** What a row tracks: a subagent, or a background task (shell command, monitor). */
export type FleetKind = 'agent' | 'shell' | 'monitor'

export type FleetAgent = {
  id: string
  /** Absent on rows written before tasks were tracked: an agent. */
  kind?: FleetKind
  type: string
  description: string
  parentId?: string
  /** The model id the agent runs on, when known. */
  model?: string
  /** The workflow run that started it, and the Workflow tool call of that run. */
  workflowRun?: string
  workflowCall?: string
  startedAt: number
  endedAt?: number
  /** Last tool call started or finished, or the spawn. */
  lastActivityAt: number
  /** Tool calls running right now. */
  inFlight: number
  status: FleetStatus
  tools: number
  tool?: string
  target?: string
  /** Tool calls per second, newest last. */
  activity: number[]
  usage: FleetUsage
  /** First sentence of the agent's final answer. */
  summary?: string
}

/** Where the fleet shows: a detailed list above the prompt, the side pane, or one compact line. */
export type FleetView = 'above' | 'side' | 'compact'

/** How the agents are drawn: rows with details, or bars on a time axis. */
export type FleetLayout = 'list' | 'timeline'

export type FleetWorkflowName = { toolUseId: string; name: string }

export type FleetClock = { frame: number; now: number }

declare module 'claude-code' {
  interface PluginState {
    'flotilla': {
      fleet: FleetAgent[]
      view: FleetView
      layout: FleetLayout
      paneShown: boolean
      hideDone: boolean
      clock: FleetClock
      workflowNames: FleetWorkflowName[]
      openRuns: string[]
      /** Until when the band shows the "nothing running" line (ms since epoch; 0 for never). */
      idleHintUntil: number
    }
  }
}
