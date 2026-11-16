/**
 * dsh-task-progress — per-turn milestone rail.
 *
 * The evaluator names the milestone the open turn is on. When it names a new
 * one, the previous milestone is finished; this reducer turns that sequence
 * into a bounded list of steps with the time each step took. It is pure, and
 * the Host keeps the result in memory so a page refresh re-reads the same rail.
 */

/** How many milestones one turn keeps on its rail. */
export const RAIL_MAX = 10

/** One open step before any milestone is known. */
export function blankRail(turn, startedAt) {
  return { turn, startedAt: startedAt > 0 ? startedAt : 0, steps: [] }
}

/** Build one open step, clamping whatever the evaluator supplied. */
function newStep(label, percent, phase, at) {
  const value = Number(percent)
  return {
    label,
    percent: Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0,
    phase: typeof phase === 'string' && phase !== '' ? phase : 'execute',
    at,
    endedAt: 0,
    durationMs: 0,
  }
}

/**
 * Fold one observation of the effective milestone into the turn's rail.
 *
 * A step starts when it is first observed, and a changed label closes the
 * open step at `at` and opens the next one there. Time before the first
 * milestone was named belongs to no step, so a restart mid-turn cannot make
 * the first node claim the whole turn.
 *
 * @param rail - the turn's current rail, or undefined for a new turn.
 * @param observation - `{turn, label, percent, phase, at, startedAt}`.
 * @returns a rail; the same reference when the observation changed nothing.
 */
export function observeRail(rail, observation) {
  const { turn, label, percent, phase, at, startedAt } = observation
  const base = rail !== null && rail !== undefined && rail.turn === turn
    ? rail
    : blankRail(turn, startedAt)
  if (typeof label !== 'string' || label === '') return base
  const steps = base.steps
  if (steps.length === 0) {
    return { ...base, steps: [newStep(label, percent, phase, at)] }
  }
  const open = steps[steps.length - 1]
  if (open.label === label) {
    const nextPercent = Number.isFinite(Number(percent)) && percent >= 0 ? Math.round(percent) : open.percent
    if (nextPercent === open.percent && phase === open.phase) return base
    return { ...base, steps: [...steps.slice(0, -1), { ...open, percent: nextPercent, phase }] }
  }
  const closed = {
    ...open,
    endedAt: at,
    durationMs: at > open.at ? at - open.at : 0,
  }
  const next = [...steps.slice(0, -1), closed, newStep(label, percent, phase, at)]
  return { ...base, steps: next.slice(-RAIL_MAX) }
}

/**
 * Close the open step when the turn ends. Idempotent, and records `closedAt`
 * so the Host can drop an idle turn's rail after its linger.
 * @param rail - the turn's rail.
 * @param at - epoch ms of the turn end.
 * @returns a rail; the same reference when it was already closed.
 */
export function closeRail(rail, at) {
  if (rail === null || rail === undefined || rail.steps.length === 0) return rail
  const open = rail.steps[rail.steps.length - 1]
  if (open.endedAt > 0) {
    return rail.closedAt === undefined ? { ...rail, closedAt: open.endedAt } : rail
  }
  const endedAt = at > open.at ? at : open.at
  return {
    ...rail,
    closedAt: endedAt,
    steps: [...rail.steps.slice(0, -1), { ...open, endedAt, durationMs: endedAt - open.at }],
  }
}
