/**
 * dsh-task-progress — side-channel evaluator helpers.
 *
 * The in-session tool is the best signal but models often ignore it, and the
 * todo fallback only says what the plan claims. This module builds the small,
 * bounded digest and the strict JSON contract for one auxiliary model call that
 * estimates the same task from the outside, so a percentage exists even when
 * the working model never reports.
 *
 * The digest is scoped to ONE turn. A continued session keeps the whole log, so
 * "the first user message" or "the last assistant message" would otherwise
 * describe an earlier task and the evaluator would answer with that task's
 * milestone/next node — exactly the stale label this module must not produce.
 */

import { PHASES } from './progress.js'

/** Per-field character caps; together they keep the input under ~900 tokens. */
const CAP = Object.freeze({
  task: 400,
  assistant: 400,
  toolArg: 80,
  todoContent: 80,
  todos: 10,
  tools: 8,
})

/** Clamp one integer into a range. */
function intIn(value, min, max, fallback) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

/** Join one message's text blocks into a single trimmed line. */
function textOf(message) {
  const content = message && Array.isArray(message.content) ? message.content : []
  return content
    .filter(block => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** Keep one model-written label short and single-line. */
function short(value, max = 60) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/gu, ' ').trim().slice(0, max)
}

/**
 * Build the bounded digest of the turn's work.
 * @param events - the session's committed events, in order.
 * @param turn - the open turn to describe.
 * @returns the digest, or null when the turn has nothing to describe yet.
 */
export function buildDigest(events, turn) {
  if (!Array.isArray(events) || events.length === 0) return null
  let task = ''
  let lastAssistant = ''
  let todos = null
  let steps = 0
  let startedAt = 0
  let lastTime = 0
  let inTurn = false
  const tools = []
  for (const event of events) {
    if (event === null || typeof event !== 'object') continue
    const data = event.data !== null && typeof event.data === 'object' ? event.data : {}
    if (event.type === 'turn/start') {
      inTurn = data.turn === turn
      if (!inTurn) continue
      startedAt = typeof event.time === 'number' ? event.time : 0
      lastTime = startedAt
      // Forget everything the log carries from earlier turns.
      task = ''
      lastAssistant = ''
      todos = null
      continue
    }
    if (event.type === 'turn/end') {
      if (data.turn === turn) inTurn = false
      continue
    }
    if (!inTurn) continue
    if (typeof event.time === 'number') lastTime = event.time
    if (event.type === 'step/start' && data.turn === turn) steps += 1
    if (event.type === 'user/message' && task === ''
      && data.source !== null && typeof data.source === 'object' && data.source.kind === 'user') {
      const text = textOf(data)
      if (text !== '') task = text.slice(0, CAP.task)
    }
    if (event.type === 'todo/write' && Array.isArray(data.todos)) todos = data.todos
    if (event.type === 'tool/call' && data.turn === turn) {
      tools.push(`${String(data.name)}(${short(data.arguments, CAP.toolArg)})`)
    }
    if (event.type === 'assistant/message') {
      // The message body sits under `message`; `data` itself carries only turn/step.
      const message = data.message !== null && typeof data.message === 'object' ? data.message : data
      const text = textOf(message)
      if (text !== '') lastAssistant = text.slice(0, CAP.assistant)
    }
  }
  if (task === '' && lastAssistant === '') return null
  const done = todos === null ? 0 : todos.filter(item => item !== null && typeof item === 'object' && item.status === 'completed').length
  return {
    task,
    minutes: startedAt > 0 && lastTime > startedAt ? Math.round((lastTime - startedAt) / 60000) : 0,
    steps,
    todos: todos === null
      ? []
      : todos.slice(0, CAP.todos).map(item => `${String(item.status)}: ${short(item.content, CAP.todoContent)}`),
    todosDone: done,
    todoTotal: todos === null ? 0 : todos.length,
    tools: tools.slice(-CAP.tools),
    lastAssistant,
  }
}

/** The fixed system instruction of the evaluator call. */
export const JUDGE_SYSTEM = [
  'Estimate how far a coding agent has got on the task described by the JSON.',
  'Reply with ONLY one JSON object: {"percent":0-100,"phase":"plan|execute|verify|deliver","milestone":"...","next":"...","eta_min":0}.',
  'Anchors: 0 not started, 25 plan settled, 50 half the work done, 75 the work is done and being verified, 100 delivered and verified.',
  'Judge only what the digest shows; never assume work it does not list.',
  'The digest describes exactly one turn. milestone and next must describe THAT turn; never reuse an earlier task from the session history.',
  'milestone and next are one short line (<= 40 characters) in the task\'s language; eta_min is whole minutes, or 0 when unsure.',
  'When the input carries a nodes array, also return "anchor": the percentage (0-100) of the current plan that the work completed before the newest node represents, never above percent; omit anchor when there is no nodes array.',
].join(' ')

/**
 * Frame the digest as one JSON line.
 * @param digest - output of {@link buildDigest}.
 * @returns the user-facing input text.
 */
export function buildJudgeInput(digest, nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return JSON.stringify(digest)
  return JSON.stringify({ ...digest, nodes })
}

/**
 * Parse the evaluator's answer strictly.
 * @param text - raw model output (may carry prose or code fences).
 * @returns the canonical judgement, or null when the output is unusable.
 */
export function parseJudgement(text) {
  if (typeof text !== 'string') return null
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let raw
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const percent = Number(raw.percent)
  // Reject rather than clamp: an out-of-range answer is a bad answer, and the
  // previous estimate must survive it.
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null
  return {
    percent: Math.round(percent),
    phase: PHASES.includes(raw.phase) ? raw.phase : 'execute',
    milestone: short(raw.milestone, 60),
    next: short(raw.next, 60),
    etaMin: intIn(raw.eta_min, 0, 600, 0),
    anchor: intIn(raw.anchor, 0, 100, null),
  }
}
