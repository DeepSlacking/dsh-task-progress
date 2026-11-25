/**
 * dsh-task-progress — per-turn milestone rail.
 *
 * The evaluator names the milestone the open turn is on. When it names a new
 * one, the previous milestone is finished; this reducer turns that sequence
 * into a bounded list of steps with the time each step took. It is pure, and
 * the Host keeps the result in memory so a page refresh re-reads the same rail.
 */

/** How many nodes one turn keeps on its rail (the expanded list shows all of them). */
export const RAIL_MAX = 100

/** One open step before any milestone is known. */
export function blankRail(turn, startedAt) {
  return { turn, startedAt: startedAt > 0 ? startedAt : 0, steps: [] }
}

/** Build one open step, clamping whatever the evaluator supplied. */
function newStep(label, percent, phase, at, seq) {
  const value = Number(percent)
  const number = Number(seq)
  return {
    label,
    percent: Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0,
    phase: typeof phase === 'string' && phase !== '' ? phase : 'execute',
    at,
    endedAt: 0,
    durationMs: 0,
    seq: Number.isFinite(number) ? number : 0,
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
    return { ...base, steps: [newStep(label, percent, phase, at, 0)] }
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
    originalPercent: open.originalPercent ?? open.percent,
    corrections: open.corrections ?? 0,
  }
  if (steps.length === 1) {
    // Node 0 exists before any work has been recorded (only the task
    // description is known), so it always sits at 0%.
    closed.percent = 0
    closed.originalPercent = 0
    closed.corrections = 0
    closed.correctionHistory = []
  }
  const nextSeq = (Number.isFinite(Number(open.seq)) ? Number(open.seq) : steps.length - 1) + 1
  const next = [...steps.slice(0, -1), closed, newStep(label, percent, phase, at, nextSeq)]
  return { ...base, steps: next.slice(-RAIL_MAX) }
}

/**
 * Close the open step when the turn ends. Idempotent, and records `closedAt`
 * so the Host can drop an idle turn's rail after its linger.
 * @param rail - the turn's rail.
 * @param at - epoch ms of the turn end.
 * @returns a rail; the same reference when it was already closed.
 */
/**
 * Whether the newest milestone did not rise above the one before it. That
 * comparison is what asks the Host for a history rescale; only a strict rise
 * means the rail moved forward on its own.
 * @param rail - the turn's rail.
 * @returns true when the last step's percent is below its predecessor's.
 */
export function railNeedsRescale(rail) {
  if (rail === null || rail === undefined || !Array.isArray(rail.steps) || rail.steps.length < 2) return false
  const last = rail.steps[rail.steps.length - 1]
  const prev = rail.steps[rail.steps.length - 2]
  if (last === null || last === undefined || prev === null || prev === undefined) return false
  const lastPercent = Number(last.percent)
  const prevPercent = Number(prev.percent)
  if (!Number.isFinite(lastPercent) || !Number.isFinite(prevPercent)) return false
  return lastPercent <= prevPercent
}

/**
 * Map the completed history onto a re-estimated plan so the newest closed node
 * lands at the anchor. Earlier nodes keep their relative spacing; the open node
 * is untouched and the anchor is clamped to it, which removes the inversion.
 * @param rail - the turn's rail.
 * @param anchor - the evaluator's share (0-100) of the current plan already done.
 * @returns a rail; the same reference when nothing changed.
 */
export function rescaleRail(rail, anchor) {
  if (rail === null || rail === undefined || !Array.isArray(rail.steps) || rail.steps.length === 0) return rail
  const value = Number(anchor)
  if (!Number.isFinite(value)) return rail
  let refIndex = -1
  for (let index = rail.steps.length - 1; index >= 0; index -= 1) {
    const step = rail.steps[index]
    if (step !== null && step !== undefined && step.endedAt > 0) {
      refIndex = index
      break
    }
  }
  if (refIndex < 0) return rail
  const ref = Number(rail.steps[refIndex].percent)
  if (!(ref > 0)) return rail
  const open = rail.steps[rail.steps.length - 1]
  const head = open !== null && open !== undefined && open.endedAt === 0 ? Number(open.percent) : 100
  const target = Math.max(0, Math.min(Number.isFinite(head) ? head : 100, Math.round(value)))
  const scale = target / ref
  if (!(scale > 0) || Math.abs(scale - 1) < 1e-3) return rail
  let changed = false
  const steps = rail.steps.map((step, index) => {
    if (index > refIndex || step === null || step === undefined || step.endedAt <= 0) return step
    const next = Math.max(0, Math.min(100, Math.round(Number(step.percent) * scale)))
    if (next === step.percent) return step
    changed = true
    const history = Array.isArray(step.correctionHistory) ? step.correctionHistory : []
    const from = Number(step.percent)
    return {
      ...step,
      percent: next,
      originalPercent: Number.isFinite(Number(step.originalPercent)) ? Number(step.originalPercent) : from,
      corrections: (Number(step.corrections) || 0) + 1,
      correctionHistory: [...history, { from, to: next }],
    }
  })
  return changed ? { ...rail, steps } : rail
}

export function closeRail(rail, at) {
  if (rail === null || rail === undefined || rail.steps.length === 0) return rail
  const open = rail.steps[rail.steps.length - 1]
  if (open.endedAt > 0) {
    return rail.closedAt === undefined ? { ...rail, closedAt: open.endedAt } : rail
  }
  const endedAt = at > open.at ? at : open.at
  const closed = {
    ...open,
    endedAt,
    durationMs: endedAt - open.at,
    originalPercent: open.originalPercent ?? open.percent,
    corrections: open.corrections ?? 0,
  }
  if (rail.steps.length === 1) {
    closed.percent = 0
    closed.originalPercent = 0
    closed.corrections = 0
    closed.correctionHistory = []
  }
  return { ...rail, closedAt: endedAt, steps: [...rail.steps.slice(0, -1), closed] }
}
