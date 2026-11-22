import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyProgress,
  BLANK,
  isSimpleTurn,
  normalizeReport,
  progressSchema,
} from '../lib/progress.js'
import { buildDigest, buildJudgeInput, JUDGE_SYSTEM, parseJudgement } from '../lib/judge.js'

/** One turn/start event. */
function turnStart(turn, time) {
  return { type: 'turn/start', time, data: { turn } }
}

/** One real user message event. */
function userMessage(text, time) {
  return {
    type: 'user/message',
    time,
    data: { source: { kind: 'user' }, content: [{ type: 'text', text }] },
  }
}

/** One report_progress tool call. */
function report(turn, time, args) {
  return {
    type: 'tool/call',
    time,
    data: { turn, name: 'report_progress', arguments: JSON.stringify(args) },
  }
}

/** One assistant message event (the text lives under `message`). */
function assistant(text, turn, step, time) {
  return {
    type: 'assistant/message',
    time,
    data: { turn, step, message: { role: 'assistant', content: [{ type: 'text', text }] } },
  }
}

/** Fold a list of events from a blank state. */
function fold(events, start = BLANK) {
  return events.reduce((state, event) => applyProgress(state, event), start)
}

test('a new turn clears the previous task labels and percent', () => {
  const afterFirst = fold([
    turnStart(1, 1_000),
    userMessage('安装三个插件', 1_100),
    report(1, 1_200, { percent: 80, phase: 'deliver', milestone: '插件已安装', next: '向用户汇报' }),
    { type: 'turn/end', time: 2_000, data: { turn: 1, reason: { kind: 'completed' } } },
  ])
  assert.equal(afterFirst.done, true)
  assert.equal(afterFirst.next, '向用户汇报')

  const afterSecond = applyProgress(afterFirst, turnStart(2, 9_000))
  assert.equal(afterSecond.turn, 2)
  assert.equal(afterSecond.next, '', 'the previous next node must not leak into the new task')
  assert.equal(afterSecond.milestone, '')
  assert.equal(afterSecond.percent, -1)
  assert.equal(afterSecond.done, false)
})

test('a report updates milestone, next, phase, and eta', () => {
  const state = fold([
    turnStart(1, 1_000),
    report(1, 1_500, { percent: 40, phase: 'execute', milestone: '改客户端', next: '验证', eta_min: 6 }),
  ])
  assert.deepEqual(
    { percent: state.percent, source: state.source, phase: state.phase, milestone: state.milestone, next: state.next, etaMin: state.etaMin },
    { percent: 40, source: 'model', phase: 'execute', milestone: '改客户端', next: '验证', etaMin: 6 },
  )
})

test('the todo list is the fallback while no report exists', () => {
  const state = fold([
    turnStart(1, 1_000),
    {
      type: 'todo/write',
      time: 1_500,
      data: {
        todos: [
          { status: 'completed', content: 'a' },
          { status: 'completed', content: 'b' },
          { status: 'pending', content: 'c' },
        ],
      },
    },
  ])
  assert.equal(state.percent, 67)
  assert.equal(state.source, 'todo')
})

test('interrupted turns still close the bar', () => {
  const state = fold([
    turnStart(1, 1_000),
    userMessage('长任务', 1_100),
    { type: 'turn/end', time: 5_000, data: { turn: 1, reason: { kind: 'aborted' } } },
  ])
  assert.equal(state.done, true)
  assert.equal(state.percent, 100)
})

test('an old cache still parses and folds', () => {
  const old = { ...BLANK, v: 2, history: [], task: '旧字段' }
  assert.equal(progressSchema.parse(old), old)
  const state = applyProgress(old, turnStart(2, 2_000))
  assert.equal(state.turn, 2)
  assert.equal(state.history, undefined)
})

test('report validation is unchanged', () => {
  assert.deepEqual(normalizeReport({ percent: 42, phase: 'execute', milestone: 'm', next: 'n' }), {
    percent: 42,
    phase: 'execute',
    milestone: 'm',
    next: 'n',
    etaMin: 0,
    revised: false,
  })
  assert.equal(normalizeReport({ percent: 101, phase: 'execute' }), null)
  assert.equal(normalizeReport({ percent: 10, phase: 'bogus' }).phase, 'execute')
})

test('digest describes only the requested turn in a continued session', () => {
  const events = [
    turnStart(1, 1_000),
    userMessage('安装三个插件', 1_100),
    assistant('旧任务的回答', 1, 1, 1_200),
    { type: 'turn/end', time: 2_000, data: { turn: 1, reason: { kind: 'completed' } } },
    turnStart(2, 10_000),
    userMessage('调整任务进度条插件', 10_100),
    report(2, 10_500, { percent: 20, phase: 'plan', milestone: '已定位问题', next: '改三处逻辑' }),
    assistant('新任务的回答', 2, 1, 10_600),
  ]
  const digest = buildDigest(events, 2)
  assert.equal(digest.task, '调整任务进度条插件')
  assert.equal(digest.lastAssistant, '新任务的回答')
  assert.equal(digest.minutes, 0)
  assert.deepEqual(digest.tools, ['report_progress({"percent":20,"phase":"plan","milestone":"已定位问题","next":"改三处逻辑"})'])
})

test('digest never borrows an answer from the previous turn', () => {
  const events = [
    turnStart(1, 1_000),
    userMessage('旧任务', 1_100),
    assistant('旧回答', 1, 1, 1_200),
    { type: 'turn/end', time: 2_000, data: { turn: 1, reason: { kind: 'completed' } } },
    turnStart(2, 50_000),
    userMessage('新任务', 50_100),
  ]
  const digest = buildDigest(events, 2)
  assert.equal(digest.task, '新任务')
  assert.equal(digest.lastAssistant, '')
})

test('digest is null before the new turn has any work', () => {
  const events = [
    turnStart(1, 1_000),
    userMessage('旧任务', 1_100),
    assistant('旧回答', 1, 1, 1_200),
    { type: 'turn/end', time: 2_000, data: { turn: 1, reason: { kind: 'completed' } } },
    turnStart(2, 50_000),
  ]
  assert.equal(buildDigest(events, 2), null)
})

test('the evaluator can return the optional history anchor', () => {
  const parsed = parseJudgement('{"percent":55,"phase":"verify","milestone":"m","next":"n","eta_min":7,"anchor":30}')
  assert.equal(parsed.anchor, 30)
  assert.equal(parseJudgement('{"percent":55}').anchor, null)
  assert.equal(parseJudgement('{"percent":55,"anchor":120}').anchor, 100, 'an out-of-range anchor is clamped')
})

test('a rescale request carries the node list only when asked', () => {
  const digest = { task: 'x' }
  const nodes = [{ i: 0, p: 10, done: true, label: 'a' }]
  assert.equal(buildJudgeInput(digest), JSON.stringify(digest))
  assert.equal(JSON.parse(buildJudgeInput(digest, nodes)).nodes[0].label, 'a')
})

test('judge output parsing rejects unusable estimates', () => {
  assert.deepEqual(parseJudgement('{"percent":55,"phase":"verify","milestone":"m","next":"n","eta_min":7}'), {
    percent: 55,
    phase: 'verify',
    milestone: 'm',
    next: 'n',
    etaMin: 7,
    anchor: null,
  })
  assert.equal(parseJudgement('{"percent":120}'), null)
  assert.equal(parseJudgement('no json here'), null)
  assert.match(JUDGE_SYSTEM, /one turn/)
})

/** One arbitrary tool call in a turn. */
function toolCall(turn, time, name = 'bash') {
  return { type: 'tool/call', time, data: { turn, name, arguments: '{}' } }
}

test('the fold counts tool calls and message characters for simple-task detection', () => {
  const state = fold([
    turnStart(1, 1_000),
    userMessage('帮我查一下天气', 1_100),
    assistant('今天晴，二十度左右。', 1, 1, 2_000),
  ])
  assert.equal(state.tools, 0)
  assert.equal(state.taskChars, 7)
  assert.equal(state.replyChars, 10)
  const withTools = fold([
    turnStart(2, 1_000),
    toolCall(2, 1_100, 'bash'),
    toolCall(2, 1_200, 'report_progress'),
  ])
  assert.equal(withTools.tools, 2)
})

test('a new turn resets the simple-task counters', () => {
  const first = fold([
    turnStart(1, 1_000),
    userMessage('旧任务', 1_100),
    toolCall(1, 1_200),
    assistant('旧回答', 1, 1, 1_300),
    { type: 'turn/end', time: 2_000, data: { turn: 1, reason: { kind: 'completed' } } },
  ])
  const second = applyProgress(first, turnStart(2, 9_000))
  assert.equal(second.tools, 0)
  assert.equal(second.taskChars, 0)
  assert.equal(second.replyChars, 0)
})

test('character tracking stops once the turn can no longer be simple', () => {
  const long = 'x'.repeat(5000)
  const state = fold([
    turnStart(1, 1_000),
    userMessage('短问题', 1_100),
    toolCall(1, 1_200),
    userMessage(long, 1_300),
    assistant(long, 1, 1, 1_400),
  ])
  assert.equal(state.tools, 1)
  assert.equal(state.taskChars, 3, 'later user text is not folded after a tool call')
  assert.equal(state.replyChars, 0, 'assistant text is not folded after a tool call')
})

test('isSimpleTurn accepts a short tool-free turn and rejects every disqualifier', () => {
  const base = fold([
    turnStart(1, 1_000),
    userMessage('你好，简单解释一下闭包', 1_100),
    assistant('闭包是函数与其词法环境的组合。', 1, 1, 5_000),
  ])
  const options = { mode: 'auto', seconds: 30, chars: 1200 }
  assert.equal(isSimpleTurn(base, 10_000, options), true)
  assert.equal(isSimpleTurn(base, 10_000, { ...options, mode: 'off' }), false)
  assert.equal(isSimpleTurn(base, 40_000, options), false, 'slow turns are not simple')
  assert.equal(isSimpleTurn({ ...base, tools: 1 }, 10_000, options), false)
  assert.equal(isSimpleTurn({ ...base, modelPercent: 50 }, 10_000, options), false)
  assert.equal(isSimpleTurn({ ...base, taskChars: 5_000 }, 10_000, options), false)

  const done = fold([
    turnStart(1, 1_000),
    userMessage('你好', 1_100),
    assistant('在的。', 1, 1, 5_000),
    { type: 'turn/end', time: 12_000, data: { turn: 1, reason: { kind: 'completed' } } },
  ])
  assert.equal(isSimpleTurn(done, 100_000, options), true, 'a done turn uses its own end time')
})
