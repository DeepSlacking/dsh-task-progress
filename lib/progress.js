/**
 * dsh-task-progress — pure progress fold.
 *
 * One turn is one task. The fold keeps a plain-JSON state that doubles as the
 * wire payload the Client reads (via the `taskProgress` session projection), so
 * everything here stays synchronous, replayable, and reference-stable: an event
 * this unit does not care about returns the same state object.
 */

/** Phase vocabulary shared with the tool schema and the Client. */
export const PHASES = ['plan', 'execute', 'verify', 'deliver']

/** Maximum characters kept from a model-written milestone or next-node line. */
const LABEL_MAX = 60

/** State before any turn, and the reset template for a new turn. */
export const BLANK = Object.freeze({
  v: 3,
  turn: 0,
  step: 0,
  /** The model's own last report, -1 before the first one. */
  modelPercent: -1,
  /** Effective percent shown to people, -1 when unknown. */
  percent: -1,
  /** Where the effective percent came from. */
  source: 'none',
  phase: 'plan',
  milestone: '',
  next: '',
  /** Model estimate of remaining minutes, 0 when not supplied. */
  etaMin: 0,
  /** The model lowered its estimate on purpose (scope discovered). */
  revised: false,
  todoDone: 0,
  todoTotal: 0,
  done: false,
  /** Epoch ms of the turn start, or 0. */
  startedAt: 0,
  /** Epoch ms of the newest fact folded, or 0. */
  updatedAt: 0,
})

/** Report drops larger than this need `revised`; otherwise they are clamped. */
const MAX_SILENT_DROP = 10

/** Todo-derived estimates stop here so a running task never reads as finished. */
const TODO_CEILING = 95

/** Clamp an unknown value into an integer range, or return `null`. */
function intIn(value, min, max) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return null
  const rounded = Math.round(number)
  if (rounded < min || rounded > max) return null
  return rounded
}

/** Trim one model-written label to a bounded single line. */
function label(value) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/gu, ' ').trim().slice(0, LABEL_MAX)
}

/**
 * Validate one `report_progress` argument object.
 * @param args - parsed tool arguments (unknown shape).
 * @returns the canonical report, or null when the call must be ignored.
 */
export function normalizeReport(args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return null
  const percent = intIn(args.percent, 0, 100)
  if (percent === null) return null
  const phase = PHASES.includes(args.phase) ? args.phase : 'execute'
  return {
    percent,
    phase,
    milestone: label(args.milestone),
    next: label(args.next),
    etaMin: intIn(args.eta_min, 1, 600) ?? 0,
    revised: args.revised === true,
  }
}

/**
 * Recompute the effective percent from the model report and the todo list.
 * @param state - state whose inputs changed.
 * @returns the same reference when the derived pair did not change.
 */
function derive(state) {
  let percent = -1
  let source = 'none'
  if (state.done) {
    percent = 100
    source = 'done'
  } else if (state.modelPercent >= 0) {
    percent = state.modelPercent
    source = 'model'
  } else if (state.todoTotal > 0) {
    percent = Math.min(TODO_CEILING, Math.round((state.todoDone / state.todoTotal) * 100))
    source = 'todo'
  }
  if (percent === state.percent && source === state.source) return state
  return { ...state, percent, source }
}

/**
 * Fold one session event into the progress state.
 * @param state - state covering every earlier event.
 * @param event - the next committed session event.
 * @param options - deployment switches (`todoBaseline: false` disables the fallback).
 * @returns the next state, or the same reference when the event is not ours.
 */
export function applyProgress(state, event, options = {}) {
  const todoBaseline = options.todoBaseline !== false
  const current = state ?? BLANK
  switch (event.type) {
    case 'turn/start': {
      const turn = event.data?.turn ?? 0
      if (current.turn === turn && !current.done) return current
      return derive({
        ...BLANK,
        turn,
        step: 0,
        startedAt: event.time ?? 0,
        updatedAt: event.time ?? 0,
        phase: 'plan',
      })
    }
    case 'step/start': {
      if ((event.data?.turn ?? -1) !== current.turn) return current
      const step = event.data?.step ?? 0
      if (current.step === step) return current
      return { ...current, step }
    }
    case 'todo/write': {
      if (!todoBaseline) return current
      const todos = event.data?.todos
      if (!Array.isArray(todos)) return current
      let done = 0
      for (const item of todos) {
        if (item !== null && typeof item === 'object' && item.status === 'completed') done += 1
      }
      if (done === current.todoDone && todos.length === current.todoTotal) return current
      return derive({
        ...current,
        todoDone: done,
        todoTotal: todos.length,
        updatedAt: event.time ?? current.updatedAt,
      })
    }
    case 'tool/call': {
      if (event.data?.name !== 'report_progress') return current
      if ((event.data?.turn ?? -1) !== current.turn) return current
      let args
      try {
        args = JSON.parse(event.data?.arguments ?? '')
      } catch {
        return current
      }
      const report = normalizeReport(args)
      if (report === null) return current
      // A silent large drop is almost always a fresh look at the same work;
      // keep the change visible but bounded unless the model said it re-planned.
      const floor = current.modelPercent - MAX_SILENT_DROP
      const percent = !report.revised && current.modelPercent >= 0 && report.percent < floor
        ? floor
        : report.percent
      return derive({
        ...current,
        modelPercent: percent,
        phase: report.phase,
        milestone: report.milestone || current.milestone,
        next: report.next || current.next,
        etaMin: report.etaMin,
        revised: report.revised,
        updatedAt: event.time ?? current.updatedAt,
      })
    }
    case 'turn/end': {
      if ((event.data?.turn ?? -1) !== current.turn || current.done) return current
      return {
        ...current,
        done: true,
        percent: 100,
        source: 'done',
        updatedAt: event.time ?? current.updatedAt,
      }
    }
    default:
      return current
  }
}

/** Passthrough schema: state is produced here and replayed from our own cache. */
export const progressSchema = Object.freeze({
  parse(value) {
    return value ?? BLANK
  },
})

/**
 * Whether the report tool participates in one step.
 * @param state - the session's current progress state (may be undefined).
 * @param minStep - first step of a turn that offers the tool (1 = any step).
 * @returns true when the turn is open and its step reached the gate.
 */
export function shouldOfferProgressTool(state, minStep) {
  if ((state?.turn ?? 0) <= 0) return false
  // `minStep <= 1` means "any step of an open turn": the first pre-step of a
  // turn can run before its `step/start`, so counting steps would hide the
  // tool on exactly the step this setting exists for.
  return minStep <= 1 || (state?.step ?? 0) >= minStep
}
