import assert from 'node:assert/strict'
import test from 'node:test'

import { blankRail, closeRail, observeRail, RAIL_MAX } from '../lib/steps.js'

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
    { label: '定位问题', percent: 30, endedAt: 90_000, durationMs: 70_000 },
  )
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
