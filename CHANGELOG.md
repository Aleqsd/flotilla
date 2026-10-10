# Changelog

## 1.3.1 (2026-10-10)

Fixes found while recording the demo in a real session:

- An agent whose turn ended while it still holds background work (a monitor, a subagent) reads "◌ waiting on its background work" instead of "starting…"
- Between tools, an agent that already worked reads "thinking…" instead of "starting…"
- The headline counts waiting agents (`● 1 agent · 1 waiting · 1 task`), uses the right plural, and no longer says "0 agent" over a list of tasks
- A band too short to list the rows (3 lines or fewer) falls back to the one-line view instead of one row and "+5 more"
- No "0 tokens" when only tasks are shown
- The README shows a real recording (`docs/demo.gif`)

## 1.3.0 (2026-10-10)

- For a few seconds after a session starts or after `/flotilla`, the band says "Flotilla is on · nothing running" when nothing runs, so you can see that it's loaded
- Task notifications: the parser is checked against notifications captured from real Claude Code runs, and a non-zero exit code counts as failed
- Lighter clock: 4 frames a second only while something is busy, 1 while rows wait or linger, none when nothing is left to draw; the status line uses a still dot and changes only when the counts do; the agent roster is polled every 10 s when nothing runs
- The code is split into pure modules (`state`, `strings`, `status`, `format`, `cost`, `rows`, `tasks`) around `register.tsx`

## 1.2.0 (2026-10-10)

- Background tasks show up next to the agents: background shell commands (`Bash`/`PowerShell`, Ctrl+B included) and `Monitor` watches, with their command and running time
- Tasks end on `TaskStop`, on their task notification, or when the turn-end list of background work no longer has them; tasks started before Flotilla loaded are picked up there
- Tasks started by a subagent are nested under it
- The band and status line count running tasks (`⠋ 2 agents · 1 task`)

## 1.1.2 (2026-10-10)

- `/flotilla` says so when no subagent is running, and that background shell commands aren't tracked, instead of announcing a view that stays empty

## 1.1.1 (2026-10-10)

- Fix: in a narrow band, the agent type and model no longer shrink ("Expl", "hai") or wrap onto a second line; only the description and details give way

## 1.1.0 (2026-10-10)

- English interface, alongside French
- New `language` option: `auto` (default), `en` or `fr`. `auto` follows Claude Code's `language` setting, then the locale, and falls back to English
- `/flotilla lang en|fr|auto` sets it from the prompt

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
