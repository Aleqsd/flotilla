# Flotilla

A Claude Code mod (a plugin of function hooks) that shows running subagents and background tasks above the prompt, in a side pane, or on one line. Public repo: https://github.com/Aleqsd/flotilla

## Layout

- `hooks/register.tsx`: the hooks, the `$.state` atoms, and every function that takes `$` (bookkeeping for agents and tasks, the clock, view changes). The render hooks draw the `AbovePrompt` band and the `Pane`.
- Pure modules, with no `$`: `state.ts` (constants, shared types, colors), `strings.ts` (`STRINGS`, `t`, `setLang`), `status.ts` (`isLive`, `isStuck`, icons), `format.ts` (durations, sparkline, summaries), `cost.ts` (`PRICES`, totals), `rows.tsx` (row drawing; buttons get callbacks, never `$`), `tasks.ts` (the task-notification parser).
- `types/index.d.ts`: the `$.state` contract. Every key the module reads or writes must be declared here, self-contained, with no imports.
- `hooks/flotilla.test.ts`: tests run with `claude plugin test`. The kit needs a bottom for each event the plugin passes on: `mock.clock(on)`, `ui.open`, `ui.close`, `turn.complete`, `classic.Stop`, `tool.call`.
- `.claude-plugin/plugin.json` (manifest, `userConfig.language`) and `.claude-plugin/marketplace.json` (marketplace `aleqs-mods`, source `./`).

## Checks

Run all three before committing. CI runs the last two on Claude Code 2.1.293 and on latest.

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

The type-check needs the API declarations. The engine writes them to `.claude-plugin/types/` (gitignored) once it has loaded the mod from this folder; `tsc -p .` then uses the `tsconfig.json` it lays.

## Rules the validator enforces

- Any function that takes `$` must be declared at the top level of `register.tsx`, not inside `register`, and not in another module.
- `atom(...)` refs must be consts in `register.tsx`: the scan only reads atoms declared in the module's own file.
- Hooks that can gate (`tool.call`, `agent.spawn`, `prompt.submit`, `classic.Stop`, `ui.close`) end with `.catch(($, e, next) => next(e))`, so Flotilla fails open and never blocks the session.
- Render hooks never write state; writes happen in handlers or other events.

## Local install

The user-scope install reads straight from this folder (marketplace `aleqs-mods` → `D:\Code\Repos\flotilla`). After an edit, `/reload-plugins` or a new session picks it up, with no reinstall.

On this machine the desktop app's `claude.exe` is virtualized. From a plain terminal it lives under `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude-code\<version>\`.

## Release

1. Bump `version` in `.claude-plugin/plugin.json` and add an entry at the top of `CHANGELOG.md`.
2. Commit, then `git tag -a vX.Y.Z -m "Flotilla X.Y.Z"` and `git push origin main vX.Y.Z`.
3. `gh release create vX.Y.Z --repo aleqsd/flotilla --title … --notes …`.

## Conventions

- The UI strings live in `STRINGS` (`en`, `fr`). Add every new label in both languages.
- Cost uses API list prices from the `PRICES` table. Update it when model prices change.
- Commit messages end with a `Co-Authored-By: Claude …` line.
