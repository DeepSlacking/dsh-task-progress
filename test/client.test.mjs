import assert from 'node:assert/strict'
import test from 'node:test'

/** A tiny React stand-in: enough hooks to drive the dock's render branches. */
function makeFakeReact() {
  let hooks = []
  let cursor = 0
  let external = null
  const Fragment = Symbol('Fragment')
  const React = {
    Fragment,
    createElement(type, props, ...children) {
      const merged = { ...(props ?? {}) }
      if (children.length === 1) merged.children = children[0]
      else if (children.length > 1) merged.children = children
      return { type, props: merged }
    },
    useState(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
      return [
        hooks[index],
        (next) => {
          hooks[index] = typeof next === 'function' ? next(hooks[index]) : next
        },
      ]
    },
    useEffect() {},
    useSyncExternalStore(_subscribe, getSnapshot) {
      const snapshot = getSnapshot()
      if (external !== null && snapshot !== null && typeof snapshot === 'object' && 'sessions' in snapshot) {
        return external
      }
      return snapshot
    },
  }
  return {
    React,
    beginRender() {
      cursor = 0
    },
    reset() {
      hooks = []
      cursor = 0
      external = null
    },
    setExternal(store) {
      external = store
    },
  }
}

/** Text content of a rendered tree. */
function textOf(node) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf(node.props?.children)
}

/** Every element with the given class name. */
function byClass(node, className, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const item of node) byClass(item, className, out)
    return out
  }
  const classes = String(node.props?.className ?? '').split(/\s+/u)
  if (classes.includes(className)) out.push(node)
  byClass(node.props?.children, className, out)
  return out
}

/** The open turn's task and its milestone rail. */
function fixture() {
  const now = Date.now()
  return {
    progress: {
      v: 3,
      turn: 4,
      step: 10,
      percent: 40,
      source: 'model',
      phase: 'execute',
      milestone: '改客户端样式',
      next: '验证悬停与节点',
      etaMin: 5,
      revised: false,
      todoDone: 0,
      todoTotal: 0,
      done: false,
      startedAt: now - 600_000,
      updatedAt: now - 60_000,
    },
    store: {
      sessions: {},
      rails: {
        'session-1': {
          turn: 4,
          steps: [
            {
              label: '定位问题',
              percent: 15,
              phase: 'plan',
              at: now - 600_000,
              endedAt: now - 300_000,
              durationMs: 300_000,
            },
            {
              label: '改客户端样式',
              percent: 40,
              phase: 'execute',
              at: now - 300_000,
              endedAt: 0,
              durationMs: 0,
            },
          ],
        },
      },
      style: null,
    },
  }
}

/**
 * Load the browser half against the fake React and return a render function.
 * @param store - the polled evaluator/rail store the dock should read.
 * @returns {{ render: () => object }}
 */
async function loadDock(store) {
  const fake = makeFakeReact()
  globalThis.window = {
    __ModuleLoader__: {
      load(spec) {
        globalThis.__dockPlugin = spec
      },
    },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
  }
  globalThis.document = { documentElement: { lang: 'zh-CN' }, visibilityState: 'visible' }
  await import('../client.js')
  const plugin = globalThis.__dockPlugin
  assert.ok(plugin, 'client.js registered a module')
  const registered = {}
  const ctx = {
    effect(fn) {
      try {
        return fn()
      } catch {
        return undefined
      }
    },
    locale: { register: () => () => {} },
    slots: {
      inject: (_name, fn) => fn(),
      register: (spec, component) => {
        registered[spec.name] = component
        return () => {}
      },
    },
    sessions: {
      list: {
        subscribe: () => () => {},
        getSnapshot: () => ({ byId: {}, projectionsBySession: {} }),
      },
    },
  }
  plugin.factory((id) => {
    assert.equal(id, 'react')
    return fake.React
  }).apply(ctx)
  const Dock = registered['conversation.input.dock']
  assert.ok(Dock, 'dock registered')
  fake.reset()
  fake.setExternal(store)
  const { progress } = fixture()
  return {
    render: () => {
      fake.beginRender()
      return Dock({
        t: undefined,
        session: { sessionId: 'session-1', running: true },
        useProjection: () => progress,
      })
    },
  }
}

test('the bar shows the open task percent with one node per closed milestone', async () => {
  const { progress, store } = fixture()
  const { render } = await loadDock(store)
  const tree = render()
  const nodes = byClass(tree, 'dtp-node')
  assert.deepEqual(nodes.map(node => node.props.style.left), ['15%', '40%'])
  assert.equal(nodes[1].props.className, 'dtp-node dtp-node-current')
  assert.match(textOf(tree), new RegExp(`${progress.percent}%`))
  assert.equal(byClass(tree, 'dtp-tip').length, 0)
})

test('hovering a closed milestone shows its label, duration, and finish time', async () => {
  const { store } = fixture()
  const { render } = await loadDock(store)
  let tree = render()
  byClass(tree, 'dtp-node')[0].props.onMouseEnter()
  tree = render()
  const tips = byClass(tree, 'dtp-tip')
  assert.equal(tips.length, 1)
  const text = textOf(tips[0])
  assert.match(text, /节点 0/)
  assert.match(text, /定位问题/)
  assert.match(text, /耗时 5 分钟/)
  assert.match(text, /已完成/)
  byClass(tree, 'dtp-node')[0].props.onMouseLeave()
  assert.equal(byClass(render(), 'dtp-tip').length, 0)
})

test('a completed node beyond the current fill is hidden, not marked done', async () => {
  const { store } = fixture()
  const now = Date.now()
  store.rails['session-1'].steps = [
    {
      label: '已完成的前一步', percent: 15, phase: 'plan',
      at: now - 600_000, endedAt: now - 400_000, durationMs: 200_000,
    },
    {
      label: '未来的一步', percent: 90, phase: 'execute',
      at: now - 400_000, endedAt: now - 300_000, durationMs: 100_000,
    },
    {
      label: '改客户端样式', percent: 40, phase: 'execute',
      at: now - 300_000, endedAt: 0, durationMs: 0,
    },
  ]
  const { render } = await loadDock(store)
  const nodes = byClass(render(), 'dtp-node')
  assert.deepEqual(nodes.map(node => node.props.style.left), ['15%', '40%'])
})

test('the current milestone is an outlined node with its elapsed time and next step', async () => {
  const { store } = fixture()
  const { render } = await loadDock(store)
  let tree = render()
  byClass(tree, 'dtp-node')[1].props.onMouseEnter()
  tree = render()
  const text = textOf(byClass(tree, 'dtp-tip')[0])
  assert.match(text, /节点 1/)
  assert.match(text, /进行中/)
  assert.match(text, /改客户端样式/)
  assert.match(text, /下一步：验证悬停与节点/)
  assert.match(text, /已用/)
})
