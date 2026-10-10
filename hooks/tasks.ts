import type { AgentStatus } from 'claude-code'

export type Ended = { id: string; status: AgentStatus }

/** One entry of the background work the engine lists at a turn's end (`classic.Stop`). */
export type InFlight = { id: string; type: string; status: string; description: string; command?: string }

// A task notification names its task and how it ended, as Claude Code writes it:
//   <task-notification>
//   <task-id>bcduz1ph2</task-id>
//   <tool-use-id>…</tool-use-id>
//   <output-file>…</output-file>
//   <status>failed</status>
//   <summary>Background command "…" failed with exit code 3</summary>
//   </task-notification>
export function notified(text: string): Ended[] {
  const out: Ended[] = []
  for (const block of text.split(/<\/task-notification>/)) {
    const id = /<task-id>\s*([^<\s]+)\s*<\/task-id>/.exec(block)?.[1]
    if (id === undefined) continue
    const word = /<status>\s*([a-z_]+)\s*<\/status>/i.exec(block)?.[1]?.toLowerCase() ?? 'completed'
    const exitCode = Number(/exit code (-?\d+)/i.exec(block)?.[1] ?? 0)
    const status: AgentStatus = word === 'failed' || word === 'error' || exitCode !== 0 ? 'failed'
      : word === 'killed' || word === 'stopped' ? 'killed'
      : 'completed'
    out.push({ id, status })
  }

  return out
}
