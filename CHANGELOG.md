# Changelog

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
