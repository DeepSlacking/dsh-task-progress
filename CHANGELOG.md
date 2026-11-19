# Changelog

All notable changes to `dsh-task-progress` are documented here. GitHub Releases are created from the matching section of this file by the `Release` workflow.

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
