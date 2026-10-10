import type { AgentStatus, Color } from 'claude-code'

import type { FleetAgent } from '../types'
import { SPINNER, STUCK_MS } from './state'

export const isLive = (s: AgentStatus) =>
  s === 'pending' || s === 'running' || s === 'waiting' || s === 'idle'
export const isBusy = (s: AgentStatus) => s === 'pending' || s === 'running'
export const isTask = (a: FleetAgent) => a.kind !== undefined && a.kind !== 'agent'
export const isStuck = (a: FleetAgent, now: number) =>
  !isTask(a) && a.status === 'running' && a.inFlight === 0 && now - a.lastActivityAt > STUCK_MS

export function icon(a: FleetAgent, frame: number, now: number): { glyph: string; color: Color } {
  if (isStuck(a, now)) return { glyph: '⚠', color: 'warning' }
  if (isBusy(a.status)) return { glyph: SPINNER[(frame + a.tools) % SPINNER.length] ?? '•', color: 'claude' }
  if (a.status === 'waiting' || a.status === 'idle') return { glyph: '◌', color: 'inactive' }
  if (a.status === 'completed') return { glyph: '✓', color: 'success' }
  if (a.status === 'failed') return { glyph: '✗', color: 'error' }

  return { glyph: '■', color: 'warning' }
}

export function groupIcon(members: FleetAgent[], frame: number, now: number): { glyph: string; color: Color } {
  if (members.some(a => isStuck(a, now))) return { glyph: '⚠', color: 'warning' }
  if (members.some(a => isBusy(a.status))) return { glyph: SPINNER[frame % SPINNER.length] ?? '•', color: 'claude' }
  if (members.some(a => a.status === 'failed')) return { glyph: '✗', color: 'error' }
  if (members.some(a => isLive(a.status))) return { glyph: '◌', color: 'inactive' }

  return { glyph: '✓', color: 'success' }
}
