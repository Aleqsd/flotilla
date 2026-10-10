import type { Color, ElementTable } from 'claude-code'

import type { FleetAgent, FleetKind, FleetUsage } from '../types'

export const PANE = 'flotilla'
export const TITLE = 'Flotilla'
export const SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
export const TICK_MS = 250
export const SPARK = 12
export const LINGER_MS = 15_000
export const STUCK_MS = 60_000
export const MAX_ROWS = 80

/** How long the "nothing running" line shows after the session starts or `/flotilla`. */
export const IDLE_HINT_MS = 8_000

export type El = Pick<ElementTable, 'Box' | 'Text' | 'Button'>
export type Ctx = { frame: number; now: number; cols: number }
export type Group = { runId: string; name: string; members: FleetAgent[]; isOpen: boolean }
export type Item = { kind: 'agent'; agent: FleetAgent; depth: number } | ({ kind: 'group' } & Group)

export const ZERO: FleetUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

export const TYPE_COLORS: Record<string, Color> = {
  Explore: 'suggestion',
  Plan: 'planMode',
  'general-purpose': 'claude',
  fork: 'merged',
  teammate: 'autoAccept',
  shell: 'bashBorder',
  monitor: 'permission',
}

// Tools whose result names a background task, and the kind of task it is.
export const TASK_TOOLS: Record<string, Exclude<FleetKind, 'agent'>> = { Bash: 'shell', PowerShell: 'shell', Monitor: 'monitor' }

export const patch = (list: FleetAgent[], id: string, fn: (a: FleetAgent) => FleetAgent) =>
  list.map(a => (a.id === id ? fn(a) : a))
