# dsh-task-progress · Session Task Progress

[中文](README.md) · English

A DeepSeek Harness (DSH) plugin that shows how far the current task has got, both in the session and on the sidebar row. Each time the model moves to a new milestone within the current turn, the previous milestone leaves a node on the progress bar.

![dsh-task-progress](https://img.shields.io/badge/DSH-0.2.2--rc.1-4176e6) ![license](https://img.shields.io/badge/license-MIT-green)

## Features

| Where | What it shows |
| --- | --- |
| Above the composer (`conversation.input.dock`) | Two rows: the first has the bar, the percentage and this turn's milestone nodes; the second has the phase, current milestone, next step and estimated time left. Width follows the chat content area (the host's `--dsh-chat-content-width`) and tracks resizing |
| On the session row (`sidebar.session.row.trailing`) | A small ring and percentage next to the timestamp, colored like the bar; shown only for a running, non-empty, non-subagent session that has an estimate |

It appears only while a session runs and lingers briefly after it ends; history and idle sessions show nothing. The large percentage is always **this turn's** 0–100% and never accumulates across turns.

### Milestone nodes for the current turn

Nodes belong to the current turn only and do not record earlier turns:

- Whenever model self-report or the side-channel evaluator names a new "current milestone", the previous milestone counts as finished and leaves a **filled node** at the percentage where it was last seen.
- The current milestone is an **outlined node** at the bar's current percentage.
- Hovering any node opens a detail card: which milestone, finished / in progress, its label and phase; finished nodes show the completion time and how long that segment took (from appearing to being replaced), the current node shows elapsed time and the *next step*.
- Nodes are Tab-focusable and show the same detail on focus.
- At most **10** milestone nodes are kept per turn; older ones fade off the rail.

The rail is maintained in the host's evaluator memory (it observes the effective milestone every 15 seconds), so nodes survive a page reload and reset on the next turn. When a turn ends, the last milestone is closed at `turn/end` and stays visible briefly.

## Where the number comes from

The evaluator is always **the session's own model**, through two channels:

1. **In-session tool `report_progress`** (preferred): `percent`, `phase` (plan / execute / verify / deliver), `milestone`, optional `next`, `eta_min`, `revised`. The tool description pins a scale: 0 not started, 25 plan settled, 50 half the work done, 75 verifying, 100 delivered and verified.
2. **Side-channel evaluator** (fallback): models often ignore such "telemetry" tools, so while a turn is open and the last self-report is stale, the host sends one short request on the session's current model route. The input is a compressed digest of **this turn only** (user request, todos, last 8 tool calls, last assistant output, minutes elapsed), capped at ~900 tokens; the output is forced to a single JSON line. Results live in memory and the page reads them every 2 seconds from a read-only route.

Merge priority: **fresh model self-report (within 3 minutes) > side-channel evaluation > todo ratio > nothing**. When none exists the bar shows "evaluating" and elapsed time instead of inventing a number. The milestone rail uses the same priority to pick the milestone on display.

## Install

Option 1 (plugin manager):

```text
plugin_manager action=install_bundle target=D:\DSH-workspace\dsh-task-progress
```

Option 2 (manual, in the profile directory):

```bash
cd C:/Users/<you>/.dsh/profiles/desktop
npm install "file:D:/DSH-workspace/dsh-task-progress"
# then add "dsh-task-progress" to dsh.profile.bundles in package.json,
# and add a row to cordis.patch.yml:
#   - insert:
#       - id: task-progress
#         name: dsh-task-progress
```

Restart the DSH desktop app afterwards to load the plugin.

## Appearance

**Settings → Task progress** offers three options, applied immediately and stored in the browser's localStorage:

- Bar height: 2–24 px, default 6
- Bar color: any CSS color (`#hex`, `rgb()`, `var(--x)`); empty follows the theme accent. Also used by the sidebar ring and the nodes
- Caption font size: 9–24 px, default 12

Precedence: **settings page > row config > theme default**. Row config lives in the profile's `cordis.patch.yml`:

```yaml
- id: task-progress
  name: dsh-task-progress
  config:
    barHeight: 8
    barColor: '#7c5cff'
    textFontSize: 14
```

Other fields: `enableTool`, `minStep`, `todoBaseline`, `judge`, `judgeIntervalMs` (reload the plugin after changing them). You can also set the CSS variables `--dtp-bar-height` / `--dtp-bar-color` / `--dtp-font-size`.

## Layout

```text
dsh-task-progress/
├─ package.json       dsh manifest: bundle patch + client platform/injection order
├─ cordis.patch.yml   a single insert host row
├─ index.js           Host half: projection, side-channel evaluator, milestone observation, read-only route
├─ lib/progress.js    progress merging and the todo fallback
├─ lib/judge.js       evaluator digest and JSON contract
├─ lib/steps.js       milestone rail reducer (max 10 steps per turn)
├─ client.js          browser half: bar, nodes, sidebar ring, settings page
├─ locale/{zh,en}.json titles/descriptions shown by the plugin manager
├─ docs/              design and implementation notes
└─ test/              node --test unit tests
```

## Cost and limits

- Tool schema is about 150–200 tokens per request (`minStep` can raise it).
- Each side-channel evaluation: ~600–900 input tokens, output capped at 1.2k (usually a few dozen), at most once per 2 minutes per running session; skipped entirely while a model self-report is fresh.
- The percentage is the model's judgement, not a measurement, and may be optimistic; the scale, `revised` and the side-channel check only mitigate that. The evaluator sees this turn's digest only, not the code.

## License

MIT License, Copyright (c) 2026 dsh-task-progress contributors.

Free to use, modify and redistribute under the MIT license; see [LICENSE](LICENSE) for the full text.
