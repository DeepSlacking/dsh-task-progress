import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
async function loadDock(store, sessionState = { byId: {}, projectionsBySession: {} }, progressOverride) {
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
  // The Host's client-module loader keys factories by the package name; a
  // stale id here makes it silently skip this half of the plugin.
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(plugin.id, manifest.name, 'client module id must equal the package name')
  const registered = {}
  const tabTypes = []
  const ctx = {
    effect(fn) {
      try {
        return fn()
      } catch {
        return undefined
      }
    },
    locale: {
      register: () => () => {},
      bind: () => (key, params) => key,
    },
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
        getSnapshot: () => sessionState,
      },
    },
    sidebarRightTabs: {
      register: definition => {
        tabTypes.push(definition)
        return () => {}
      },
    },
    sidebarRight: {
      openTabIn: () => {},
      openTabs: { getSnapshot: () => [] },
    },
    layout: { openRightbar: () => {} },
  }
  // Stand-in for the Harness primitives: the tooltip receives one anchor child,
  // which the fake React keeps in `children`.
  const FakeTooltip = props => props.children
  const FakeSwitch = props => props.children
  plugin.factory((id) => {
    if (id === 'react') return fake.React
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return { Tooltip: FakeTooltip, Switch: FakeSwitch }
    throw new Error('unexpected module: ' + id)
  }).apply(ctx)
  const Dock = registered['conversation.input.dock']
  const Settings = registered['settings.section']
  const TabPanel = registered['sidebar.right.pane.tab']
  const SettingsIcon = registered['settings.section.icon']
  assert.ok(Dock, 'dock registered')
  assert.ok(Settings, 'settings registered')
  assert.ok(TabPanel, 'node panel registered')
  assert.ok(SettingsIcon, 'settings icon registered')
  assert.equal(tabTypes.length, 1)
  assert.equal(tabTypes[0].id, 'task-progress')
  assert.equal(tabTypes[0].kind, 'task-progress')
  fake.reset()
  fake.setExternal(store)
  const { progress: fixtureProgress } = fixture()
  const progress = progressOverride ?? fixtureProgress
  return {
    render: () => {
      fake.beginRender()
      return Dock({
        t: undefined,
        session: { sessionId: 'session-1', running: true },
        useProjection: () => progress,
      })
    },
    renderSettings: () => {
      fake.beginRender()
      return Settings({ t: undefined })
    },
    renderPanel: (sessionId = 'session-1') => {
      fake.beginRender()
      return TabPanel({ t: undefined, sessionId })
    },
    renderSettingsIcon: () => {
      fake.beginRender()
      return SettingsIcon({ size: 16, active: true })
    },
  }
}

test('the DSH Settings nav icon is the progress glyph', async () => {
  const { store } = fixture()
  const { renderSettingsIcon } = await loadDock(store)
  const tree = renderSettingsIcon()
  const glyph = tree.type(tree.props)
  assert.equal(glyph.type, 'svg')
  assert.equal(glyph.props.viewBox, '0 0 1024 1024')
  assert.equal(glyph.props.fill, 'currentColor')
  assert.equal(glyph.props.width, 16)
  assert.ok(Array.isArray(glyph.props.children))
  assert.equal(glyph.props.children.length, 2)
})

test('the settings preview grows on hover and opens a sample node card', async () => {
  const { store } = fixture()
  const { renderSettings } = await loadDock(store)
  let tree = renderSettings()
  const bar = byClass(tree, 'dtp-set-preview-bar')[0]
  assert.ok(bar, 'preview bar rendered')
  assert.ok(textOf(tree).includes('.dtp-set-preview-bar:hover .dtp-set-track{transform:scaleY(1.5)'), 'preview hover scale css')
  assert.ok(textOf(tree).includes('.dtp-set-preview-bar:hover{transform:scale(1.015)'), 'preview grows as a whole')
  assert.ok(textOf(tree).includes('rgba(255,255,255,.55)'), 'preview hover carries a white glow')
  const nodes = byClass(tree, 'dtp-node')
  assert.equal(nodes.length, 2)
  nodes[0].props.onMouseEnter()
  tree = renderSettings()
  let tip = byClass(tree, 'dtp-tip')[0]
  assert.ok(tip, 'finished sample card')
  assert.match(textOf(tip), /节点 0/)
  assert.match(textOf(tip), /已完成/)
  assert.match(textOf(tip), /预览：节点已完成/)
  assert.match(textOf(tip), /耗时 2 分 10 秒/)
  assert.match(textOf(tip), /14:32 完成/)
  byClass(tree, 'dtp-node')[1].props.onMouseEnter()
  tree = renderSettings()
  tip = byClass(tree, 'dtp-tip')[0]
  assert.ok(tip, 'live sample card')
  assert.match(textOf(tip), /节点 1/)
  assert.match(textOf(tip), /进行中/)
  assert.match(textOf(tip), /下一步：检查节点详情卡/)
})

test('the right Sidebar panel lists every node as a card in time order', async () => {
  const { store } = fixture()
  const { renderPanel } = await loadDock(store)
  const tree = renderPanel()
  const cards = byClass(tree, 'dtp-card')
  assert.equal(cards.length, 2)
  assert.match(textOf(cards[0]), /节点 0/)
  assert.match(textOf(cards[0]), /已完成/)
  assert.match(textOf(cards[0]), /定位问题/)
  assert.match(textOf(cards[0]), /耗时 5 分钟/)
  assert.match(textOf(cards[0]), /完成/)
  assert.match(textOf(cards[1]), /节点 1/)
  assert.match(textOf(cards[1]), /进行中/)
  assert.match(textOf(cards[1]), /改客户端样式/)
  assert.match(textOf(tree), /本次任务节点/)
  assert.match(textOf(tree), /2 个节点/)
})

test('the node panel shows the last node as completed once the turn is done', async () => {
  const { store } = fixture()
  const now = Date.now()
  const { renderPanel } = await loadDock(store, {
    byId: {
      'session-1': {
        projectionValues: {
          taskProgress: { v: 3, turn: 4, percent: 100, done: true, updatedAt: now },
        },
      },
    },
    projectionsBySession: {},
  })
  const tree = renderPanel()
  const cards = byClass(tree, 'dtp-card')
  assert.equal(cards.length, 2)
  assert.match(textOf(cards[1]), /节点 1/)
  assert.match(textOf(cards[1]), /已完成/)
  assert.doesNotMatch(textOf(cards[1]), /进行中/)
  assert.match(textOf(cards[1]), /完成/)
})

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

test('expanding the node list shows the current node first and completed nodes in time order', async () => {
  const { store } = fixture()
  const { render } = await loadDock(store)
  let tree = render()
  const trigger = byClass(tree, 'dtp-expand')[0]
  assert.ok(trigger, 'expand trigger rendered')
  assert.equal(textOf(trigger), '▸节点2')
  assert.equal(trigger.props['aria-expanded'], false)
  trigger.props.onClick()
  tree = render()
  assert.equal(byClass(tree, 'dtp-expand')[0].props['aria-expanded'], true)
  const rows = byClass(tree, 'dtp-list-row')
  assert.equal(rows.length, 2)
  assert.match(textOf(rows[0]), /节点 1/)
  assert.match(textOf(rows[0]), /进行中/)
  assert.match(textOf(rows[0]), /改客户端样式/)
  assert.match(textOf(rows[0]), /已用/)
  assert.match(textOf(rows[1]), /节点 0/)
  assert.match(textOf(rows[1]), /已完成/)
  assert.match(textOf(rows[1]), /定位问题/)
  assert.match(textOf(rows[1]), /耗时 5 分钟/)
  assert.equal(byClass(tree, 'dtp-list-rule').length, 1)
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

test('a completed node beyond the current fill waits at the fill head instead of vanishing', async () => {
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
  // Both completed nodes stay on the rail; the one from the earlier, higher
  // estimate sits at the fill head instead of being dropped.
  assert.deepEqual(nodes.map(node => node.props.style.left), ['15%', '40%', '40%'])
  assert.match(nodes[1].props['aria-label'], /节点 1/)
  assert.match(nodes[2].props['aria-label'], /节点 2/)
})

test('a re-estimated turn keeps every node in order and ends on the latest one', async () => {
  const { store } = fixture()
  const now = Date.now()
  const steps = []
  for (let i = 0; i < 18; i += 1) {
    // Node 9 was reported at 45%, then the evaluator re-estimated downward.
    const percent = i < 10 ? i * 5 : 20 + (i - 10) * 2
    steps.push({
      label: '里程碑 ' + i, percent, phase: 'execute',
      at: now - (40 - i) * 60_000, endedAt: now - (40 - i) * 60_000 + 30_000, durationMs: 30_000,
    })
  }
  steps.push({ label: '当前这一步', percent: 65, phase: 'execute', at: now - 60_000, endedAt: 0, durationMs: 0 })
  store.rails['session-1'].steps = steps
  const progress = {
    ...fixture().progress,
    percent: 65,
    milestone: '当前这一步',
    next: '收尾',
    updatedAt: now - 30_000,
  }
  const { render } = await loadDock(store, { byId: {}, projectionsBySession: {} }, progress)
  const nodes = byClass(render(), 'dtp-node')
  assert.equal(nodes.length, 19)
  const labels = nodes.map(node => node.props['aria-label'])
  assert.match(labels[17], /节点 17/)
  assert.match(labels[18], /节点 18/)
  const lefts = nodes.map(node => Number.parseFloat(node.props.style.left))
  for (let i = 1; i < lefts.length; i += 1) {
    assert.ok(lefts[i] >= lefts[i - 1], 'node ' + i + ' sits left of node ' + (i - 1))
  }
  assert.equal(lefts[18], 65)
  assert.ok(lefts[17] < 65 && lefts[17] > 45, 'the last completed node spreads toward the head')
})

test('a simple Q&A shows the quiet note instead of a progress bar', async () => {
  const { store } = fixture()
  const now = Date.now()
  const progress = {
    ...fixture().progress,
    turn: 5,
    percent: -1,
    source: 'none',
    modelPercent: -1,
    milestone: '',
    next: '',
    done: false,
    startedAt: now - 20_000,
    updatedAt: 0,
    tools: 0,
    taskChars: 30,
    replyChars: 12,
  }
  const { render } = await loadDock(store, { byId: {}, projectionsBySession: {} }, progress)
  const tree = render()
  assert.match(textOf(tree), /简单任务/)
  assert.equal(byClass(tree, 'dtp-track').length, 0, 'no progress bar is drawn')
})

test('one tool call disqualifies a simple-looking turn', async () => {
  const { store } = fixture()
  const now = Date.now()
  const progress = {
    ...fixture().progress,
    turn: 5,
    percent: -1,
    source: 'none',
    modelPercent: -1,
    milestone: '',
    next: '',
    done: false,
    startedAt: now - 20_000,
    updatedAt: 0,
    tools: 1,
    taskChars: 30,
    replyChars: 12,
  }
  const { render } = await loadDock(store, { byId: {}, projectionsBySession: {} }, progress)
  const text = textOf(render())
  assert.doesNotMatch(text, /简单任务/)
})

test('the Settings heading shows the running plugin version', async () => {
  const { store } = fixture()
  store.version = '9.9.9'
  const { renderSettings } = await loadDock(store)
  const text = textOf(renderSettings())
  assert.match(text, /v9\.9\.9/)
})

test('the Settings page carries the simple-task switch and thresholds', async () => {
  const { store } = fixture()
  const { renderSettings } = await loadDock(store)
  const text = textOf(renderSettings())
  assert.match(text, /简单任务/)
  assert.match(text, /最长用时/)
  assert.match(text, /最长字符数/)
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
