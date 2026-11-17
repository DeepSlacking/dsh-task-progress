/**
 * dsh-task-progress — Host half.
 *
 * Three cooperating pieces, all bounded:
 *
 * 1. `taskProgress`, a session projection that folds the open turn's progress
 *    out of the session log (model checkpoints, todo list, turn boundaries).
 *    It is replayable and is published to the Client through `wire.summary`.
 * 2. `report_progress`, a tool the working model can call at milestones. When
 *    it does, that report is the best signal and wins over everything else.
 * 3. A side-channel evaluator: models often never call a telemetry tool, so
 *    while a turn is open the plugin asks the session's own model route for a
 *    strict JSON estimate from a compact digest. Results live in memory and are
 *    served to the page at `GET /api/dsh-task-progress/judgements`.
 *
 * This file deliberately imports no Harness package: a bundle installed from a
 * local directory is linked in place, so bare `@deepseek-ai/*` specifiers would
 * resolve against the workspace rather than the running installation. The tool
 * definition is written as the registry's plain JSON shape instead.
 */

import { applyProgress, BLANK, PHASES, progressSchema, shouldOfferProgressTool } from './lib/progress.js'
import { buildDigest, buildJudgeInput, JUDGE_SYSTEM, parseJudgement } from './lib/judge.js'
import { closeRail, observeRail } from './lib/steps.js'

export const name = 'dsh-task-progress'

/** The projection is the state store; the tool writes into the log it folds. */
export const inject = ['tools', 'sessionProjections']

/** Route serving the evaluator's current estimates to the page. */
const JUDGE_ROUTE = '/api/dsh-task-progress/judgements'

/** How often the sweep looks for turns that need an estimate. */
const SWEEP_MS = 15_000

/** Deadline of one evaluator call. */
const JUDGE_TIMEOUT_MS = 25_000

/** Output cap of one evaluator call. */
const JUDGE_MAX_TOKENS = 1_200

/** A model checkpoint younger than this outranks the evaluator, same as the page. */
const MODEL_FRESH_MS = 180_000

/** An idle turn's rail is dropped this long after it closed. */

/** One-line model-facing contract; kept short because it rides every request. */
const TOOL_DESCRIPTION = [
  'Record this task\'s progress for the session UI.',
  'Call it after finishing a milestone or changing phase — not on every step, and skip it for a task you will finish in one reply.',
  'Anchors: 0 = not started, 25 = plan settled, 50 = half the work done, 75 = verifying, 100 = delivered and verified.',
  'Keep milestone and next under 40 characters; do not mention the call to the user.',
].join(' ')

/** Model-facing parameter schema (the registry's supported JSON Schema subset). */
const TOOL_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    percent: {
      type: 'integer',
      description: 'Overall progress of the current task, 0-100. Be honest, not optimistic.',
    },
    phase: {
      type: 'string',
      enum: PHASES,
      description: 'Current phase of the task (plan | execute | verify | deliver).',
    },
    milestone: {
      type: 'string',
      description: 'What is now finished or actively being worked on, one short line.',
    },
    next: {
      type: 'string',
      description: 'The next expected node, one short line (optional).',
    },
    eta_min: {
      type: 'integer',
      description: 'Estimated minutes still needed, 1-600 (optional, omit when unsure).',
    },
    revised: {
      type: 'boolean',
      description: 'Set true only when the estimate went DOWN on purpose (new scope discovered).',
    },
  },
  required: ['percent', 'phase', 'milestone'],
}

/** Call result schema: what the model sees after a checkpoint. */
const TOOL_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    percent: { type: 'integer' },
    phase: { type: 'string' },
  },
  required: ['ok', 'percent', 'phase'],
}

/** Integer guard shared by the tool body and the transcript card. */
function clampInt(value, min, max, fallback) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

/** Keep a configured CSS color short and free of rule-breaking characters. */
function safeColor(value) {
  if (typeof value !== 'string') return ''
  const color = value.trim().slice(0, 40)
  if (color === '') return ''
  return /^[#a-zA-Z0-9(),.%\s-]+$/u.test(color) ? color : ''
}

/** Keep a model-written label on one bounded line. */
function oneLine(value, max) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/gu, ' ').trim().slice(0, max)
}

/** The compact transcript card for one checkpoint. */
function cardTitle(args) {
  const percent = clampInt(args?.percent, 0, 100, 0)
  const note = oneLine(args?.milestone, 60)
  return note === '' ? `Progress ${percent}%` : `${percent}% · ${note}`
}

/** The model route recorded by the session's newest request. */
function routeOf(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.type !== 'request/header') continue
    const config = event.data !== null && typeof event.data === 'object' && event.data.header !== null
      && typeof event.data.header === 'object' ? event.data.header.config : undefined
    if (config !== null && typeof config === 'object'
      && typeof config.provider === 'string' && config.provider !== ''
      && typeof config.model === 'string' && config.model !== '') {
      return { provider: config.provider, model: config.model }
    }
    return undefined
  }
  return undefined
}

/**
 * Register the projection, the report tool, and the side-channel evaluator.
 * @param ctx - Host context carrying the projection, tool, session, and LLM services.
 * @param config - optional row config (`enableTool`, `minStep`, `todoBaseline`,
 * `judge`, `judgeIntervalMs`).
 */
export async function apply(ctx, config) {
  const settings = {
    enableTool: config?.enableTool !== false,
    // 1 = offered from the first step of a turn, so a long task that starts
    // immediately can be reported on the same step. Raise it to trade the
    // per-request schema cost against that first-step coverage.
    minStep: clampInt(config?.minStep, 1, 999, 1),
    todoBaseline: config?.todoBaseline !== false,
    judge: config?.judge !== false,
    // Minimum gap between two evaluator calls for one session.
    judgeIntervalMs: clampInt(config?.judgeIntervalMs, 30_000, 600_000, 120_000),
    // Presentation knobs for the composer strip. 0 / '' means "inherit the
    // theme", so the defaults below never overwrite a host or user CSS value.
    style: {
      /** Bar thickness in CSS pixels (0 = theme default 6px). */
      barHeight: clampInt(config?.barHeight, 0, 24, 0),
      /** CSS color for the filled part ('' = theme accent). */
      barColor: safeColor(config?.barColor),
      /** Font size of the explanation row in CSS pixels (0 = theme default 12px). */
      textFontSize: clampInt(config?.textFontSize, 0, 24, 0),
      /** Font size of the expanded node list in CSS pixels (0 = default 11px). */
      listFontSize: clampInt(config?.listFontSize, 0, 24, 0),
    },
  }

  const unit = await ctx.sessionProjections.register({
    key: 'taskProgress',
    stateSchema: progressSchema,
    init: () => BLANK,
    apply: (state, event) => applyProgress(state, event, settings),
    // `view` returns the fold's own state, so an event that did not change it
    // republishes nothing; `summary` carries the value on every session row.
    wire: { viewSchema: progressSchema, view: state => state, summary: true },
    stateVersion: 3,
  })

  if (settings.enableTool) {
    const tool = {
      name: 'report_progress',
      description: TOOL_DESCRIPTION,
      parameters: TOOL_PARAMETERS,
      output: {
        schema: TOOL_OUTPUT,
        render: (_args, value) => [{
          type: 'text',
          text: `Progress checkpoint recorded at ${value.percent}% (${value.phase}).`,
        }],
      },
      presentCall: args => ({ card: 'generic', title: cardTitle(args), kind: 'other' }),
      presentResult: args => ({ card: 'generic', title: cardTitle(args) }),
      async execute(args) {
        // Without `defineTool` the registry hands the body the parsed arguments
        // unchanged, so the range and enum checks live here. A rejected call is
        // simply not folded: the projection validates the same arguments again
        // from the logged `tool/call` event.
        const percent = clampInt(args?.percent, 0, 100, -1)
        if (percent < 0) throw new Error('report_progress: percent must be an integer between 0 and 100')
        if (!PHASES.includes(args?.phase)) throw new Error('report_progress: phase must be one of ' + PHASES.join(', '))
        // The log entry is the durable record; this return value only feeds the card.
        return { ok: true, percent, phase: args.phase }
      },
    }

    // The tool is offered from `minStep` of every turn (default: the first
    // step), so a long task that starts immediately is not blind for one step.
    // The session is gated by its own turn instead of the global registry so a
    // session that has not started a turn yet never sees a dead tool.
    ctx.effect(
      () => ctx.tools.register(tool, {
        when: (context) => {
          try {
            return shouldOfferProgressTool(unit.stateOf(context.agent.session), settings.minStep)
          } catch {
            // A session the projection cannot read yet keeps the tool visible:
            // a missing progress card is cheaper than a missing capability.
            return true
          }
        },
      }),
      'dsh-task-progress: report tool',
    )
  }

  if (!settings.judge) return

  // ── side-channel evaluator ──────────────────────────────────────────────
  // One estimate per session, keyed by the turn it describes. The map is
  // deliberately in-memory: it is a derived second opinion, not session data,
  // and it must never pretend to be part of the log.
  const judgements = new Map()
  // One milestone rail per session, also keyed by turn. A new milestone closes
  // the open step, which is what the page draws as a completed node.
  const rails = new Map()
  const inFlight = new Set()
  const lastCallAt = new Map()
  let failures = 0
  let lastFailureAt = 0

  ctx.inject(['sessions', 'llm'], (child) => {
    const sessions = child.sessions
    const llm = child.llm

    /** Ask the session's own model route for one estimate. */
    const judge = async (session, state) => {
      const events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : []
      const digest = buildDigest(events, state.turn)
      if (digest === null) return
      const route = routeOf(events)
      if (route === undefined) return
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), JUDGE_TIMEOUT_MS)
      try {
        const call = await llm.prepareCall({
          provider: route.provider,
          model: route.model,
          maxTokens: JUDGE_MAX_TOKENS,
        }, controller.signal, (controls, info) => {
          // Keep the evaluator cheap: use the route's lowest reasoning effort
          // when it has one, so most of the budget goes to the JSON answer.
          const efforts = info !== null && typeof info === 'object' && info.reasoning !== undefined
            && Array.isArray(info.reasoning.efforts) ? info.reasoning.efforts : []
          const effort = efforts.length > 0 && efforts[0] !== null && typeof efforts[0] === 'object'
            ? efforts[0].id : undefined
          return typeof effort === 'string' && effort !== '' ? { ...controls, reasoningEffort: effort } : controls
        })
        let text = ''
        const options = {
          ...call.config,
          messages: [{ role: 'user', content: [{ type: 'text', text: buildJudgeInput(digest) }] }],
          system: JUDGE_SYSTEM,
          sessionId: session.id,
          signal: controller.signal,
        }
        for await (const chunk of call.stream(options)) {
          if (chunk === null || typeof chunk !== 'object') continue
          if (chunk.type === 'text-delta') text += chunk.text
          if (chunk.type === 'finish' && chunk.reason !== undefined
            && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
            throw new Error('judge request did not finish')
          }
        }
        const judgement = parseJudgement(text)
        if (judgement === null) return
        judgements.set(session.id, { turn: state.turn, ...judgement, at: Date.now() })
        failures = 0
      } finally {
        clearTimeout(timer)
      }
    }

    /** The milestone the page is showing, from the same precedence rule it uses. */
    const effectiveMilestone = (state, judgement, now) => {
      const freshModel = state.source === 'model' && now - state.updatedAt < MODEL_FRESH_MS
      const useJudge = !freshModel && judgement !== undefined && judgement !== null
        && judgement.turn === state.turn
      return {
        label: useJudge ? (judgement.milestone || state.milestone) : state.milestone,
        percent: useJudge && judgement.percent >= 0 ? judgement.percent : state.percent,
        phase: useJudge ? (judgement.phase || state.phase) : state.phase,
      }
    }

    /** Fold the milestone the page is showing into the session's turn rail. */
    const observe = (sessionId, state, now) => {
      const seen = effectiveMilestone(state, judgements.get(sessionId), now)
      rails.set(sessionId, observeRail(rails.get(sessionId), {
        turn: state.turn,
        label: seen.label,
        percent: seen.percent,
        phase: seen.phase,
        at: now,
        startedAt: state.startedAt,
      }))
    }

    /** One pass over the live sessions. */
    const sweep = async () => {
      const sweepStartedAt = Date.now()
      if (failures >= 3 && sweepStartedAt - lastFailureAt < 300_000) return
      let live
      try {
        live = sessions.list()
      } catch {
        return
      }
      const liveIds = new Set()
      for (const session of live) {
        liveIds.add(session.id)
        let state
        try {
          state = unit.stateOf(session)
        } catch {
          continue
        }
        if (state === undefined || state === null || state.turn <= 0) {
          judgements.delete(session.id)
          rails.delete(session.id)
          continue
        }
        if (state.done) {
          // Close the last node at the turn end and keep the rail: the completed
          // message footer and the right Sidebar read it after the turn is over.
          // The next turn's first observation replaces it.
          const rail = rails.get(session.id)
          if (rail !== undefined) {
            const closed = closeRail(rail, state.updatedAt > 0 ? state.updatedAt : Date.now())
            if (closed !== rail) rails.set(session.id, closed)
          }
          judgements.delete(session.id)
          continue
        }
        const now = Date.now()
        // A fresh checkpoint from the working model is better than a second
        // opinion, and skipping here is what keeps the evaluator cheap.
        const modelFresh = state.source === 'model' && now - state.updatedAt < settings.judgeIntervalMs
        if (!modelFresh
          && now - (lastCallAt.get(session.id) ?? 0) >= settings.judgeIntervalMs
          && !inFlight.has(session.id)) {
          inFlight.add(session.id)
          lastCallAt.set(session.id, now)
          try {
            await judge(session, state)
          } catch {
            failures += 1
            lastFailureAt = Date.now()
          } finally {
            inFlight.delete(session.id)
          }
        }
        // The rail follows whatever the page is showing, so a model report and
        // a judge estimate both become completed nodes.
        observe(session.id, state, Date.now())
      }
      for (const id of judgements.keys()) if (!liveIds.has(id)) judgements.delete(id)
      for (const id of rails.keys()) if (!liveIds.has(id)) rails.delete(id)
    }

    child.effect(() => {
      const timer = setInterval(() => { void sweep() }, SWEEP_MS)
      return () => clearInterval(timer)
    }, 'dsh-task-progress: judge timer')
  })

  // ── delivery ───────────────────────────────────────────────────────────
  ctx.inject(['webServer', 'connection'], (child) => {
    child.effect(() => child.webServer.register({
      kind: 'prefix',
      path: JUDGE_ROUTE,
      handler: (req, res) => {
        let rejected
        try {
          rejected = child.connection.requestRejection(req) !== undefined
        } catch {
          rejected = true
        }
        if (rejected) {
          res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
          res.end('{"ok":false}')
          return
        }
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        if (url.pathname !== JUDGE_ROUTE) {
          res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
          res.end('{"ok":false}')
          return
        }
        const sessions = {}
        for (const [id, value] of judgements) sessions[id] = value
        // The rail is separate from the estimate: a turn can have a rail
        // before the evaluator produced its first estimate (a model report).
        const railValues = {}
        for (const [id, rail] of rails) {
          if (rail.steps.length > 0) railValues[id] = { turn: rail.turn, steps: rail.steps }
        }
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(JSON.stringify({ ok: true, value: { sessions, rails: railValues, style: settings.style } }))
      },
    }), 'dsh-task-progress: judgements route')
  })
}
