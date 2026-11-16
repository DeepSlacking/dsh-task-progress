/**
 * dsh-task-progress — pure progress fold.
 *
 * One turn is one task. The fold keeps a plain-JSON state that doubles as the
 * wire payload the Client reads (via the `taskProgress` session projection), so
 * everything here stays synchronous, replayable, and reference-stable: an event
 * this unit does not care about returns the same state object.
 *
 * A continued session reuses the same projection. Completed turns are kept in
 * `history` so the Client can draw them as nodes on a session-level bar; the
 * open turn's own fields are reset at every `turn/start`, which is what stops a
 * previous task's labels from leaking into the next one.
 */

/** Phase vocabulary shared with the tool schema and the Client. */
export const PHASES = ['plan', 'execute', 'verify', 'deliver']

/** Maximum characters kept from a model-written milestone or next-node line. */
const LABEL_MAX = 60

/** How many completed tasks the fold keeps for the bar's history nodes. */
export const HISTORY_MAX = 10

/** State before any turn, and the reset template for a new turn. */
export const BLANK = Object.freeze({
  v: 2,
  turn: 0,
  step: 0,
  /** The model's own last report, -1 before the first one. */
  modelPercent: -1,
  /** Effective percent of the open task, -1 when unknown. */
  percent: -1,
  /** Where the effective percent came from. */
  source: 'none',
  phase: 'plan',
  milestone: '',
  next: '',
  /** First real user line of the open turn; labels a history entry. */
  task: '',
  /** Completed turns of this session, oldest first, at most HISTORY_MAX. */
  history: [],
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

/** Join a message's text blocks into one bounded single line. */
function textOf(message) {
  if (message === null || typeof message !== 'object' || !Array.isArray(message.content)) return ''
  return message.content
    .filter(block => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** The completed turns a (possibly older) state carries. */
function historyOf(state) {
  return Array.isArray(state.history) ? state.history : []
}

/** Validate one `report_progress` argument object. */
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
 * One completed task, reduced to what a history node needs.
 * @param state - the open task at the moment it ended.
 * @param endedAt - epoch ms of `turn/end`.
 * @returns a plain-JSON entry.
 */
function completedEntry(state, endedAt) {
  const startedAt = state.startedAt > 0 ? state.startedAt : endedAt
  return {
    turn: state.turn,
    task: state.task,
    milestone: state.milestone,
    phase: state.phase,
    percent: 100,
    startedAt,
    endedAt,
    durationMs: endedAt > startedAt ? endedAt - startedAt : 0,
  }
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
      // A new task always starts blank: no milestone, no next node, no percent
      // from the turn that just finished. Only the completed-task rail survives.
      return derive({
        ...BLANK,
        turn,
        step: 0,
        startedAt: event.time ?? 0,
        updatedAt: event.time ?? 0,
        phase: 'plan',
        history: historyOf(current),
      })
    }
    case 'step/start': {
      if ((event.data?.turn ?? -1) !== current.turn) return current
      const step = event.data?.step ?? 0
      if (current.step === step) return current
      return { ...current, step }
    }
    case 'user/message': {
      if (current.turn <= 0 || current.task !== '') return current
      const source = event.data?.source
      if (source === null || typeof source !== 'object' || source.kind !== 'user') return current
      const task = label(textOf(event.data))
      if (task === '') return current
      return { ...current, task, updatedAt: event.time ?? current.updatedAt }
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
      const endedAt = event.time ?? current.updatedAt
      const reason = event.data?.reason
      // Interrupted turns still close the bar, but only a completed turn earns
      // a history node: the rail describes delivered tasks.
      const completed = reason === null || reason === undefined || reason.kind === 'completed'
      const history = completed
        ? historyOf(current).concat([completedEntry(current, endedAt)]).slice(-HISTORY_MAX)
        : historyOf(current)
      return {
        ...current,
        done: true,
        percent: 100,
        source: 'done',
        history,
        updatedAt: endedAt,
      }
    }
    default:
      return current
  }
}

/** Passthrough schema: state is produced here and replayed from our own cache. */
export const progressSchema = Object.freeze({
  parse(value) {
    if (value === null || value === undefined) return BLANK
    // A cache written before `history` existed stays usable; the rail is just empty.
    if (!Array.isArray(value.history)) return { ...value, history: [] }
    return value
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
