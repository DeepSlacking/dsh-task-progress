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
  v: 4,
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
  /** Tool calls made in this turn; any call disqualifies a turn from simple. */
  tools: 0,
  /** Characters of the turn's user requests. */
  taskChars: 0,
  /** Characters of the turn's newest assistant message (its final reply). */
  replyChars: 0,
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

/** Sum the text characters of one message's content blocks. */
function contentChars(content) {
  if (!Array.isArray(content)) return 0
  let total = 0
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      total += block.text.length
    }
  }
  return total
}

/**
 * Whether an open turn reads as a simple question: no tool call, no model
 * report, and short enough in time and text that evaluating it would be waste.
 * Exported so the Host sweep and the tests share one rule.
 * @param state - the turn's folded progress state.
 * @param now - wall clock in epoch ms.
 * @param options - mode, seconds and chars; mode 'off' disables the rule.
 * @returns true when the turn counts as simple.
 */
export function isSimpleTurn(state, now, options = {}) {
  if (state === null || state === undefined || state.turn <= 0) return false
  if (options.mode === 'off') return false
  if (state.modelPercent >= 0) return false
  if ((state.tools ?? 0) > 0) return false
  const chars = (state.taskChars ?? 0) + (state.replyChars ?? 0)
  if (chars > (options.chars ?? 1200)) return false
  const seconds = Number(options.seconds ?? 30)
  if (!(seconds > 0)) return false
  if (!(state.startedAt > 0)) return false
  const enteredAt = state.done === true && state.updatedAt > 0 ? state.updatedAt : now
  const elapsed = enteredAt - state.startedAt
  return elapsed >= 0 && elapsed <= seconds * 1000
}

/**
 * Validate one report_progress argument object.
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
    case 'user/message': {
      const data = event.data !== null && typeof event.data === 'object' ? event.data : {}
      if (data.source === null || typeof data.source !== 'object' || data.source.kind !== 'user') return current
      const chars = contentChars(data.content)
      if (chars === 0) return current
      return { ...current, taskChars: current.taskChars + chars }
    }
    case 'assistant/message': {
      const data = event.data !== null && typeof event.data === 'object' ? event.data : {}
      // Some logs carry the turn on the event, some only on the message; a
      // message replayed before the next turn/start must not count.
      if (data.turn !== undefined && data.turn !== current.turn) return current
      if (current.turn <= 0 || current.done === true) return current
      const message = data.message !== null && typeof data.message === 'object' ? data.message : data
      const chars = contentChars(message.content)
      if (chars === current.replyChars) return current
      return { ...current, replyChars: chars }
    }
    case 'tool/call': {
      const data = event.data !== null && typeof event.data === 'object' ? event.data : {}
      if ((data.turn ?? -1) !== current.turn) return current
      const tools = current.tools + 1
      if (data.name !== 'report_progress') return { ...current, tools }
      let args
      try {
        args = JSON.parse(data.arguments ?? '')
      } catch {
        return { ...current, tools }
      }
      const report = normalizeReport(args)
      if (report === null) return { ...current, tools }
      // A silent large drop is almost always a fresh look at the same work;
      // keep the change visible but bounded unless the model said it re-planned.
      const floor = current.modelPercent - MAX_SILENT_DROP
      const percent = !report.revised && current.modelPercent >= 0 && report.percent < floor
        ? floor
        : report.percent
      return derive({
        ...current,
        tools,
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
