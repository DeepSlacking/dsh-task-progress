# Task progress

Shows how far the task a session is running has got, both in the conversation and in the sidebar; tasks from the same session accumulate on one bar.

## What it shows

- **Above the composer** (`conversation.input.dock`): two rows. The first row is the full-width bar with the percentage; the second row carries the phase, the current milestone, the next node, and the estimated time left. The block follows the conversation's own width axis (`--dsh-chat-content-width`), so dragging the conversation width handle or resizing the window reflows it. It appears while the session is running, stays briefly after the turn ends, and is absent for history and for idle sessions.
- **On the session row** (`sidebar.session.row.trailing`): a small ring and percentage beside the row's time; the ring uses the same color as the bar. Only a running, non-blank, non-subagent session with an estimate shows it; finished sessions never do.

### Cumulative session progress

The bar no longer shows only the open task's 0–100%; it shows the **session's cumulative progress**:

- Every completed task owns an equal slice of the bar, and the open task owns the last slice.
- The large percentage is the cumulative value; a muted "this task xx%" beside it keeps the open task's own progress visible.
- With no completed tasks the cumulative value equals the task percentage, exactly as before.
- When the open task finishes, its slice fills to 100%; the strip hides after the usual linger, and the next task receives a fresh last slice.

### Completed-task nodes

A small dot marks every completed task at its relative boundary. With two completed tasks and a third running, the dots sit at 1/3 and 2/3 and the open task fills from 2/3 to the right edge.

- Hovering a dot opens a detail card: the task number, the milestone (or the user request when no milestone was recorded), the request text, the completion time, and **how long that task took**.
- Hovering the bar itself grows it vertically inside 0.2 s and adds a soft glow; moving away restores it. Nodes share that hover hit area.
- Nodes are keyboard-focusable and show the same card on focus.
- An interrupted turn (`turn/end` with a reason other than `completed`) still closes the strip but leaves no node: the rail only records delivered tasks.

At most the **last 10** completed tasks are kept; older ones drop off the rail.

## Who evaluates, and how

The evaluator is always **the session's own model**, through two channels:

1. **An in-session tool, `report_progress`** (preferred). It takes `percent` (0–100), `phase` (`plan` / `execute` / `verify` / `deliver`), `milestone`, optional `next`, `eta_min`, and `revised`. Its description fixes the rubric — 0 not started, 25 plan settled, 50 half the work done, 75 done and verifying, 100 delivered and verified. The call lands in the session log and is folded by the projection.
2. **A side-channel evaluator** (fallback). Models often never call a telemetry tool, so while a turn is open and the last checkpoint is stale, the host asks **the session's own current route** (the provider/model of its newest request) for one short completion. Input is a bounded digest **scoped to that one turn** — the turn's user request, todo list, last 8 tool calls, last assistant line, and elapsed minutes — at most about 900 tokens; output is forced to one JSON line `{percent, phase, milestone, next, eta_min}` with a 1.2k-token cap and the route's lowest reasoning effort. Results live in memory and the page polls a read-only route every 2 seconds.

The digest is cut at `turn/start` / `turn/end`. In a continued session, the previous turn's request, assistant output, and todos never enter the new digest, so the evaluator cannot answer with the previous task's "next" node. Merge also rejects an estimate derived for another turn, or produced before the current turn began.

Precedence: **model checkpoint (fresh, under 3 minutes) > evaluator estimate > todo ratio > none**. With none of them the strip shows an evaluating state with the elapsed time instead of inventing a number.

## Key behaviours

- The projection is the durable record: `turn/start` opens a task (and clears the previous milestone, next node, and percent), `report_progress` updates it, `todo/write` feeds the fallback, `turn/end` closes it and appends the completed task to `history`. It replays after a reload and survives reconnect.
- **Task titles:** the first real user message of each turn is kept (60 characters) as `task`, the fallback label for a node and its "request" line. A milestone, when present, wins as the node title.
- **History:** up to 10 entries of `{turn, task, milestone, phase, percent, startedAt, endedAt, durationMs}`, published with the projection, so nodes survive a page refresh.
- **Todo fallback:** with no report but a todo list, the bar uses `completed / total` (capped at 95% while running) and marks the value with `≈`. That costs no tokens.
- **Long tasks:** the evaluator refreshes at most every two minutes (configurable 30 s – 10 min), so a long stretch without a report still moves; a fresh model report makes the evaluator skip.
- **Long single steps:** a model cannot report while it waits on its own tool call; after 12 seconds with no result the strip shows the evaluating state and a clock.
- **Scope changes:** a silent drop of more than 10 points is clamped unless the report sets `revised`.

## Appearance settings

**Settings → Task progress** exposes three fields that apply immediately and stay on this machine:

- **Bar height** — 2–24 px, default 6.
- **Bar color** — picker or any CSS color (`#hex`, `rgb()`, `var(--x)`); clear it to follow the theme accent. The same color paints the sidebar ring and the completed-task nodes.
- **Explanation size** — the line under the bar, 9–24 px, default 12.

The section ends with a live preview (including two sample nodes) and **Reset to defaults**. Values live in this browser's localStorage, so they follow the machine rather than the repository and need no restart.

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
- The projection, the evaluating state, and the node history cost no model tokens.

## Limitations

- The percentage is a model judgement, not a measurement; the rubric, the `revised` flag, and the second opinion reduce but do not remove optimism.
- The evaluator only sees the current turn's digest, not the code; it answers "roughly how far", not "is it correct".
- A task finished in one step may report on that step, but the choice belongs to the model; ordinary one-step answers usually skip it, so nothing is shown.
- Node widths are equal shares of the session, not proportions of real duration: a 2-minute task and a 40-minute task get the same slice.
- The sidebar ring hides while the row is hovered (the host's rule for trailing decorations) and sits in the trailing seat by design, not over the leading status dot.
- Evaluator estimates are in memory only: after a restart they return with the next evaluation. Self-reports, todos, and completed-task history are in the log/projection and survive.
