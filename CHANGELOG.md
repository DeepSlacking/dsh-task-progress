# Changelog

All notable changes to `dsh-task-progress` are documented here. GitHub Releases are created from the matching section of this file by the `Release` workflow.

## [0.8.2] - 2026-11-26

### Changed

- The plugin detail document that DSH's Plugins page shows is refreshed for 0.8.x — node appearance, stable numbers, clustering, correction history, subagent rails and the remaining-time range are all covered.
- Both detail documents now embed the two preview images with paths relative to the package (`images/scene-progress.png` and `images/scene-completed.png`), so the detail page can render them from the installed plugin or from the npm CDN copy.
- The scene mockup page in `docs/mockups` is regenerated from the same CSS scenes used for the preview images.

## [0.8.1] - 2026-11-26

### Fixed

- The node-count badge on the expanded-list button (and the Right Sidebar header) now shows the turn's true node total from the stable `seq`; the retained rail's 100-node limit no longer caps the number.

### Changed

- The running node now keeps a 1px gap from the rail (a 1px background ring before its glow), so its edge no longer blends into the bar.

## [0.8.0] - 2026-11-25

### Added

- Settings → Task progress: a node-size control (4–16 px) and four node colors — finished node edge and center, running node edge and center.
- The running node carries a slow pulse ripple.
- Node numbers use a stable `seq` from the Host, so they keep counting after the 100-node trim instead of restarting at 0.
- A crowded rail groups nodes that share a narrow percent window into one counted node; hovering it lists the members instead of pushing dots outside the rail.
- Finished sessions keep their rail (bounded cache of 400), so opening a finished subagent still shows the nodes it recorded; the sweep now samples every 4 s and closes a retained rail at the last time that session was seen.
- The Right Sidebar total duration is computed from the rail's own turn clock and only appears when a rail exists, so a completed task keeps a fixed total instead of growing.

### Changed

- Node size now defaults to 6 px (was 8).
- The finished-node center and the running-node edge default to the bar color; their Settings rows show that color as a swatch and say "same as the bar".
- Hovering a node no longer enlarges the strip; the bar grows only when the pointer is on the rail itself.
- Nodes keep their own size and stay centered on the rail, so a node smaller than a tall bar sits inside the bar instead of matching its height.

### Fixed

- The running node's edge no longer follows the finished node's ring color: its border, glow and pulse all use the running-edge color.

## [0.7.0] - 2026-11-24

### Added

- Completed nodes carry their final percentage: in the bar's hover card, in the expanded node list, and on the Right Sidebar cards.
- The Right Sidebar card for a completed node replaces the "Done" badge with its percentage; expanding it shows the correction history — "无需矫正" when nothing was rescaled, or "已矫正 N 次" followed by one "第 X 次矫正，校正前 A%，矫正后 B%" line per rescale.
- The Right Sidebar header shows the task's total duration next to the node count, formatted with only the units actually used (for example "14分51秒" or "1时14分51秒").
- The remaining-time estimate is now a range around the evaluator's estimate (for example `约 4–7 分钟`); the span is capped at twice the range's average.

### Changed

- Node 0 is always shown at 0%: it covers the time before any work was recorded, when only the task description was known.
- The stale hint no longer fades the whole strip: when no checkpoint has arrived for 90 seconds only the text row dims, while the bar and its nodes stay fully opaque.

## [0.6.2] - 2026-11-22

### Changed

- The current/next-step text under the progress strip now uses the Harness `Tooltip` (shown only when the text is actually clipped).
- The session row's progress ring is thicker: 2.25px stroke instead of 1.75px.

### Fixed

- The side-channel evaluator's auxiliary model call now declares its `purpose` (`task-progress-judge`), following the same shape as DSH's own auxiliary model calls, so it is not indistinguishable from an ordinary conversation request on that session.
- Simple-task character tracking stops once a turn calls a tool or reports progress, so a normal task's `taskProgress` projection no longer republishes the session row on every message.

## [0.6.1] - 2026-11-21

### Added

- Hybrid history rescale for the node rail. When the newest milestone's percentage does not rise above the previous one, the Host attaches the turn's node list to its next side-channel evaluation and asks the model for an `anchor` — the share of the revised plan the completed work represents — then proportionally rescales the completed nodes onto it. The ordinary evaluator call is unchanged; only a rescale request carries the extra list, and attempts are rate-limited (`rescore: auto|off`, `rescoreIntervalMs`, default 120s). Without an anchor the rail keeps the local monotonic hold.

### Changed

- Nodes sit at the percentage recorded when their step closed instead of being spread evenly across the rail by node count. When a re-estimate lowers the percentage, the affected nodes hold the highest percentage seen so far and spread toward the next node, so a later node never sits left of an earlier one (the old "node 9 next to the head" symptom cannot return). Positions stay clamped to the bar and the fill head, and a finished turn no longer stretches the rail to 100%.

### Fixed

- The simple-task line no longer flashes at the start of a turn: while the model has not answered yet and has not called a tool, the strip stays hidden instead of showing `✓ 简单任务，无需评估` and then switching to a progress bar when the first token is slow.

## [0.6.0] - 2026-11-20

### Added

- Simple-task mode. A turn with no tool call, no `report_progress`, short text and a short duration is not evaluated and gets no node rail: the strip shows one quiet `✓ 简单任务，无需评估` line, and the sidebar ring, footer glyph and node page stay hidden. The Settings page configures the switch (`auto` / `off`) and both thresholds, and the Host receives them over `POST /api/dsh-task-progress/settings` so its sweep skips the evaluator entirely. A later tool call switches the turn back to normal progress.
- Session icons now use the Harness `Tooltip` from `@deepseek-ai/dsh-client-ui-primitives` (footer glyph, sidebar ring, node-list toggle), with the native title as the fallback.

### Changed

- The right sidebar node cards inherit the Harness theme font family and size instead of a fixed 11px.
- Settings gained a card for simple tasks: the group sits below the live preview under the title **简单任务模式**, with the Harness `Switch` primitive on the title row (black track, white thumb) and inline duration/character fields.
- The Settings heading is larger and shows the running plugin version on the right; the Host reads its own `package.json` and ships the version on the read-only route, so the badge follows every release.
- The progress bar's hover state now scales the whole bar slightly (`scale(1.015)`) instead of only stretching its height; vertical growth is softened (`scaleY(1.9)` → `scaleY(1.5)`) and a layered white glow plus an inner top highlight give the pill more material. The Settings preview mirrors the same effect.

### Fixed

- Node positions stay honest: when a re-estimate makes the recorded percentages out of order, the rail lays the completed nodes out evenly across the filled span (no old node next to the head), a finished turn stretches its rail to the full 100%, and dots are kept inside the rail ends.

## [0.5.13] - 2026-11-19

### Fixed

- The node rail stays in completion order. A downward re-estimate used to place later nodes left of earlier ones, so the last completed node before the head could be an old one (node 9 while node 18 was current) and a node from an earlier, higher estimate vanished. Every completed node now stays on the rail, positions are monotonic and capped at the fill head, and a run lifted by a re-estimate spreads across the space up to the next node.

## [0.5.12] - 2026-11-17

### Changed

- Published as `@deepslacker/dsh-task-progress`. `dsh-task-progress` on npm belongs to an unrelated package, so the plugin now ships under its author's scope; `client.js`'s module id and the `cordis.patch.yml` row name follow the new package name.

### Added

- Registry installs: devices install from npm and the Plugins page offers version updates (`BundleInfo.update === 'registry'`), which a `link:` install never shows.

## [0.5.11] - 2026-11-17

### Changed

- The **Task progress** entry in the DSH Settings navigation now shows the custom progress glyph. It is registered through `settings.section.icon` with the same id as `settings.section`; replacing `icon.svg` alone only changed the plugin-list icon.

## [0.5.10] - 2026-11-17

### Changed

- The completed-task glyph in a reply footer now sits after the context action and before the branch action, instead of after the usage/time. The extra action uses a high slot order so it stays the last extra action.

## [0.5.9] - 2026-11-17

> 0.5.8 was an unreleased internal build; 0.5.9 supersedes it.

### Added

- A gray progress glyph in the footer of the latest completed reply. It opens the **Nodes** tab in the Right Sidebar.
- A Right Sidebar **Nodes** tab that shows every node of the completed task as a card in time order: status, label, phase, duration and finish time.
- New plugin icon (`icon.svg`), using the custom progress glyph.

### Changed

- Completed turn rails are retained until the next turn's first observation (previously deleted 60 seconds after `turn/end`).
- The footer glyph and the Right Sidebar panel mark the last node as completed as soon as `taskProgress.done` arrives, even before the Host's next sweep.

## [0.5.7] - 2026-11-17

### Added

- A **Node list font size** option in Settings → Task progress (9–24 px, default 11), also configurable as `listFontSize` and `--dtp-list-font-size`.

### Changed

- The expanded node list now has a fixed 180 px height and scrolls internally, so it no longer changes the composer's layout as nodes arrive.

## [0.5.6] - 2026-11-17

### Added

- An expandable node list at the left of the second row, with a count badge: the current node first, then every completed node in time order.
- An interactive Settings preview: hovering the bar enlarges it and hovering a sample node opens its detail card.

### Fixed

- Clicking a bar node no longer leaves the bar enlarged after the pointer leaves (removed the sticky `:focus-within` scale and prevented mouse-down focus).

## [0.5.5] - 2026-11-17

### Fixed

- The browser half's `__ModuleLoader__.load` id now equals the package name, so the Host cannot silently skip the client half.
- Install docs and config examples use the public package name `dsh-task-progress`.

## [0.5.4] - 2026-11-16

### Fixed

- Bar nodes are sorted by their last-seen percentage.
- Coincident nodes are nudged apart so each one remains hoverable.

## [0.5.3] - 2026-11-16

### Changed

- Milestones are named nodes in the UI and docs.
- Nodes are numbered from 0 and completed nodes beyond the current fill are hidden until progress catches up.

## [0.5.2] - 2026-11-16

### Fixed

- Step timing starts at the first observation instead of turn start.
- Phase fallback when a judge result omits the phase.

## [0.5.0] - 2026-11-16

### Added

- Per-turn node rail in the composer, progress ring on the session row, the `report_progress` tool, and the side-channel evaluator.
