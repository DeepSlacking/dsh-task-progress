import assert from 'node:assert/strict'
import test from 'node:test'

import { blankRail, closeRail, observeRail, railNeedsRescale, rescaleRail, RAIL_MAX } from '../lib/steps.js'

/** Observe one milestone on a rail. */
function observe(rail, label, percent, phase, at, startedAt = 1_000) {
  return observeRail(rail, { turn: 1, label, percent, phase, at, startedAt })
}

test('the first milestone starts when it is first observed', () => {
  const rail = observe(undefined, '定位问题', 10, 'plan', 20_000)
  assert.equal(rail.turn, 1)
  assert.equal(rail.steps.length, 1)
  assert.equal(rail.steps[0].label, '定位问题')
  assert.equal(rail.steps[0].at, 20_000, 'a rail that starts mid-turn does not claim earlier time')
  assert.equal(rail.steps[0].endedAt, 0)
})

test('the same milestone moves its percent without adding a node', () => {
  let rail = observe(undefined, '定位问题', 10, 'plan', 20_000)
  rail = observe(rail, '定位问题', 35, 'execute', 40_000)
  assert.equal(rail.steps.length, 1)
  assert.equal(rail.steps[0].percent, 35)
  assert.equal(rail.steps[0].phase, 'execute')
  assert.equal(rail.steps[0].endedAt, 0)
})

test('a new milestone closes the previous one with its duration', () => {
  let rail = observe(undefined, '定位问题', 10, 'plan', 20_000)
  rail = observe(rail, '定位问题', 30, 'execute', 40_000)
  rail = observe(rail, '改客户端', 55, 'execute', 90_000)
  assert.equal(rail.steps.length, 2)
  assert.deepEqual(
    {
      label: rail.steps[0].label,
      percent: rail.steps[0].percent,
      endedAt: rail.steps[0].endedAt,
      durationMs: rail.steps[0].durationMs,
    },
    { label: '定位问题', percent: 0, endedAt: 90_000, durationMs: 70_000 },
  )
  assert.equal(rail.steps[0].originalPercent, 0, 'node 0 has no recorded work behind it')
  assert.equal(rail.steps[1].label, '改客户端')
  assert.equal(rail.steps[1].at, 90_000)
  assert.equal(rail.steps[1].endedAt, 0)
})

test('an empty label does not touch the rail', () => {
  const first = observe(undefined, '定位问题', 10, 'plan', 20_000)
  assert.equal(observe(first, '', -1, 'plan', 30_000), first)
  assert.equal(observe(undefined, '', -1, 'plan', 30_000).steps.length, 0)
})

test('closeRail closes the open step once and records closedAt', () => {
  let rail = observe(undefined, '定位问题', 100, 'deliver', 20_000)
  rail = observe(rail, '验证', 95, 'verify', 50_000)
  rail = closeRail(rail, 80_000)
  assert.equal(rail.steps[rail.steps.length - 1].endedAt, 80_000)
  assert.equal(rail.steps[rail.steps.length - 1].durationMs, 30_000)
  assert.equal(rail.closedAt, 80_000)
  const again = closeRail(rail, 90_000)
  assert.equal(again, rail, 'already closed rails keep their reference')
})

test('a new turn starts a fresh rail', () => {
  const first = observe(undefined, '定位问题', 10, 'plan', 20_000)
  const next = observeRail(first, {
    turn: 2, label: '新任务', percent: 5, phase: 'plan', at: 200_000, startedAt: 199_000,
  })
  assert.equal(next.turn, 2)
  assert.equal(next.steps.length, 1)
  assert.equal(next.steps[0].label, '新任务')
  assert.equal(next.steps[0].at, 200_000)
})

test('the rail is bounded to the newest milestones', () => {
  let rail = blankRail(1, 1_000)
  for (let index = 0; index < RAIL_MAX + 5; index += 1) {
    rail = observe(rail, `里程碑 ${index}`, index * 5, 'execute', 10_000 + index * 10_000)
  }
  assert.equal(rail.steps.length, RAIL_MAX)
  assert.equal(rail.steps[rail.steps.length - 1].label, `里程碑 ${RAIL_MAX + 4}`)
  assert.ok(rail.steps[0].endedAt > 0)
})

test('a milestone below the previous one asks for a rescale', () => {
  let rail = observe(undefined, '定位问题', 20, 'execute', 20_000)
  rail = observe(rail, '定位问题', 60, 'execute', 30_000)
  rail = observe(rail, '改客户端', 60, 'execute', 40_000)
  rail = observe(rail, '验证', 40, 'execute', 50_000)
  assert.equal(rail.steps.length, 3)
  assert.equal(railNeedsRescale(rail), true)
  const fixed = rescaleRail(rail, 30)
  assert.equal(fixed.steps[1].percent, 30, 'the newest closed node maps to the anchor')
  assert.equal(fixed.steps[2].percent, 40, 'the open node keeps its estimate')
  assert.equal(railNeedsRescale(fixed), false)
})

test('the rescale anchor is clamped to the open node', () => {
  let rail = observe(undefined, 'a', 20, 'execute', 20_000)
  rail = observe(rail, 'a', 80, 'execute', 30_000)
  rail = observe(rail, 'b', 80, 'execute', 40_000)
  rail = observe(rail, 'c', 50, 'execute', 50_000)
  const clamped = rescaleRail(rail, 95)
  assert.equal(clamped.steps[1].percent, 50, 'a closed node cannot pass the open estimate')
  assert.equal(clamped.steps[2].percent, 50)
})

test('an equal percentage asks for a rescale, a strict rise does not', () => {
  let rail = observe(undefined, 'a', 40, 'execute', 20_000)
  rail = observe(rail, 'a', 60, 'execute', 30_000)
  rail = observe(rail, 'b', 60, 'execute', 40_000)
  assert.equal(railNeedsRescale(rail), false, 'node 0 to the open node rises')
  rail = observe(rail, 'c', 60, 'execute', 50_000)
  assert.equal(railNeedsRescale(rail), true, 'newest <= previous triggers the correction')
  const flat = observe(undefined, 'a', 10, 'plan', 20_000)
  const rising = observe(flat, 'b', 30, 'execute', 40_000)
  assert.equal(railNeedsRescale(rising), false)
})

test('a lone node is left alone', () => {
  const rail = observe(undefined, 'a', 10, 'plan', 20_000)
  assert.equal(railNeedsRescale(rail), false)
  assert.equal(rescaleRail(rail, 20), rail)
})

test('a rescale keeps the original percentage and records each correction', () => {
  let rail = observe(undefined, 'a', 20, 'execute', 20_000)
  rail = observe(rail, 'a', 60, 'execute', 30_000)
  rail = observe(rail, 'b', 60, 'execute', 40_000)
  rail = observe(rail, 'c', 40, 'execute', 50_000)
  assert.equal(rail.steps[1].originalPercent, 60)
  assert.equal(rail.steps[1].corrections, 0)
  const once = rescaleRail(rail, 30)
  assert.equal(once.steps[1].percent, 30)
  assert.equal(once.steps[1].originalPercent, 60)
  assert.equal(once.steps[1].corrections, 1)
  assert.deepEqual(once.steps[1].correctionHistory, [{ from: 60, to: 30 }])
  const twice = rescaleRail(once, 20)
  assert.equal(twice.steps[1].percent, 20)
  assert.equal(twice.steps[1].originalPercent, 60)
  assert.equal(twice.steps[1].corrections, 2)
  assert.deepEqual(twice.steps[1].correctionHistory, [{ from: 60, to: 30 }, { from: 30, to: 20 }])
})
test('node 0 stays at zero even when its milestone closed late', () => {
  let rail = observe(undefined, '定位问题', 10, 'plan', 20_000)
  rail = observe(rail, '定位问题', 30, 'execute', 40_000)
  rail = observe(rail, '改客户端', 55, 'execute', 90_000)
  assert.equal(rail.steps[0].percent, 0)
  assert.equal(rail.steps[0].originalPercent, 0)
  assert.equal(rail.steps[0].corrections, 0)
})
