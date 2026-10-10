# Changelog

## 1.0.0 (2026-10-10)

First public release.

- Live agent list above the prompt, side pane, and one-line compact view (`/flotilla`, `side`, `compact`)
- Agent tree: subagents nested under the agent that spawned them
- Stuck-agent alert after 60 s without tool activity, with long tool calls not flagged
- First sentence of each finished agent's answer
- Model badge and estimated cost per agent and in total, at API list prices
- Workflow agents grouped into one collapsible row with a progress bar
- Timeline view (`/flotilla timeline`)
- Status line entry: running/total agents and estimated cost
- Picks up agents started before the mod loaded, through `$.agent.list()`
