# Task progress

Shows how far the task a session is running has got. Every time the evaluator moves the current milestone, the previous milestone leaves a node on the bar.

## What it shows

- **Above the composer** (`conversation.input.dock`): two rows. The first row is the bar with its percentage and the turn's milestone nodes; the second row carries the phase, the current milestone, the next node, and the estimated time left. The block follows the conversation's own width axis (`--dsh-chat-content-width`), so dragging the conversation width handle or resizing the window reflows it. It appears while the session is running, stays briefly after the turn ends, and is absent for history and for idle sessions.
- **On the session row** (`sidebar.session.row.trailing`): a small ring and percentage beside the row's time; the ring uses the same color as the bar. Only a running, non-blank, non-subagent session with an estimate shows it; finished sessions never do.

The large percentage is always the **open turn's own 0–100%**; it does not accumulate across turns.

### Per-turn milestone nodes

Nodes belong to the open turn; earlier turns are never drawn:

- Whenever the model report or the side-channel evaluator names a new "current milestone", the previous one counts as finished and leaves a filled node at the last percentage it was seen at.
- The current milestone is the outlined node at the bar's current percentage. Hovering it shows its text, phase, elapsed time, and the next node.
- Hovering any node opens a detail card:
  - the milestone number and `Done` / `In progress`;
  - its text and phase;
  - a finished node shows the completion time and **how long that milestone took** (from when it appeared until the next milestone replaced it);
  - the current node shows its **elapsed time** and the next node.
- Hovering the bar grows it vertically inside 0.2 s with a soft glow; nodes share that hover hit area.
- Nodes are keyboard-focusable and show the same card on focus.
- At most the **last 10** milestones are kept; older ones drop off the rail.

The Host keeps the rail in the evaluator's memory (observed every 15 seconds), so a page refresh re-reads the same nodes. A new turn resets it. When the turn ends, the last milestone is closed at `turn/end` and kept for a short while.

## Who evaluates, and how

The evaluator is always **the session's own model**, through two channels:

1. **An in-session tool, `report_progress`** (preferred). It takes `percent` (0–100), `phase` (`plan` / `execute` / `verify` / `deliver`), `milestone`, optional `next`, `eta_min`, and `revised`. Its description fixes the rubric — 0 not started, 25 plan settled, 50 half the work done, 75 done and verifying, 100 delivered and verified. The call lands in the session log and is folded by the projection.
2. **A side-channel evaluator** (fallback). Models often never call a telemetry tool, so while a turn is open and the last checkpoint is stale, the host asks **the session's own current route** (the provider/model of its newest request) for one short completion. Input is a bounded digest **scoped to that one turn** — the turn's user request, todo list, last 8 tool calls, last assistant line, and elapsed minutes — at most about 900 tokens; output is forced to one JSON line `{percent, phase, milestone, next, eta_min}` with a 1.2k-token cap and the route's lowest reasoning effort. Results live in memory and the page polls a read-only route every 2 seconds.

The digest is cut at `turn/start` / `turn/end`. In a continued session, the previous turn's request, assistant output, and todos never enter the new digest, so the evaluator cannot answer with the previous task's "next" node. Merge also rejects an estimate derived for another turn, or produced before the current turn began.

Precedence: **model checkpoint (fresh, under 3 minutes) > evaluator estimate > todo ratio > none**. The milestone rail uses the same precedence to decide which milestone is "on screen".

## Key behaviours

- The projection is the durable record: `turn/start` opens a task (and clears the previous milestone, next node, and percent), `report_progress` updates it, `todo/write` feeds the fallback, `turn/end` closes it. It replays after a reload and survives reconnect.
- **Milestone rail:** every 15 seconds the Host hands the effective milestone to the pure reducer in `lib/steps.js`. A changed label closes the previous step (recording `endedAt` / `durationMs`) and opens a new one; the same label only updates its percentage and phase. The rail is capped at 10 steps, isolated per turn, and published on the read-only route.
- **Todo fallback:** with no report but a todo list, the bar uses `completed / total` (capped at 95% while running) and marks the value with `≈`. That costs no tokens.
- **Long tasks:** the evaluator refreshes at most every two minutes (configurable 30 s – 10 min), so a long stretch without a report still moves and its milestone still turns into a node; a fresh model report makes the evaluator skip.
- **Long single steps:** a model cannot report while it waits on its own tool call; after 12 seconds with no result the strip shows the evaluating state and a clock.
- **Scope changes:** a silent drop of more than 10 points is clamped unless the report sets `revised`.

## Appearance settings

**Settings → Task progress** exposes three fields that apply immediately and stay on this machine:

- **Bar height** — 2–24 px, default 6.
- **Bar color** — picker or any CSS color (`#hex`, `rgb()`, `var(--x)`); clear it to follow the theme accent. The same color paints the sidebar ring and the milestone nodes.
- **Explanation size** — the line under the bar, 9–24 px, default 12.

The section ends with a live preview (one completed node plus the current node) and **Reset to defaults**. Values live in this browser's localStorage, so they follow the machine rather than the repository and need no restart.

Three layers, highest first: **settings page > row config > theme default**. The row config still works for defaults shipped with a setup:

```yaml
- id: task-progress
  name: '@local/dsh-task-progress'
  config:
    barHeight: 8
    barColor: '#7c5cff'
    textFontSize: 14
```

Other fields: `enableTool`, `minStep`, `todoBaseline`, `judge`, `judgeIntervalMs` (reload the plugin from **Plugins** after changing those). The same three values can be set as CSS variables (`--dtp-bar-height`, `--dtp-bar-color`, `--dtp-font-size`); the plugin only overrides a variable when the settings page or the row config sets it.

## Cost

- Tool schema: roughly 150–200 tokens per request (`minStep` raises the gate).
- One self-report: a short tool call plus a short result.
- One evaluator call: about 600–900 input tokens and up to 1.2k output (in practice a few dozen), at most once per two minutes per running session, skipped entirely while the model's own checkpoint is fresh.
- The milestone rail, the bar, and the evaluating state cost no model tokens.

## Limitations

- The percentage is a model judgement, not a measurement; the rubric, the `revised` flag, and the second opinion reduce but do not remove optimism.
- A node's duration is an **observation interval**: the Host observes the effective milestone every 15 seconds, so durations resolve to tens of seconds, not exact timing.
- The evaluator sometimes paraphrases the same work differently; a paraphrase counts as a new milestone and can leave two near-identical nodes.
- The rail lives in Host memory; after a DSH restart it starts again from the current milestone. The projection, self-reports, and todos remain in the log.
- A task finished in one step may report on that step, but the choice belongs to the model; ordinary one-step answers usually skip it, so nothing is shown.
- The sidebar ring hides while the row is hovered (the host's rule for trailing decorations) and sits in the trailing seat by design, not over the leading status dot.
