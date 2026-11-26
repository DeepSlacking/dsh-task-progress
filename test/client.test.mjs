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
  assert.ok(textOf(tree).includes('.dtp-set-preview-bar .dtp-set-track:hover{transform:scale(1.015,1.5)'), 'the track grows on hover')
  assert.ok(!textOf(tree).includes('.dtp-set-preview-bar:hover{'), 'hovering a sample node does not grow the bar')
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
  assert.match(textOf(cards[0]), /15%/)
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
  assert.match(textOf(cards[1]), /40%/)
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
  assert.match(textOf(tree), /约 4–7 分钟/)
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
  assert.match(textOf(rows[1]), /15%/)
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

test('a re-estimated turn never moves a later node left of an earlier one', async () => {
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
  // The rail must not spread nodes evenly by count: the first ten keep the
  // percentage recorded when they closed, and the re-estimated run holds after
  // node 9 instead of jumping left of it.
  assert.deepEqual(lefts.slice(0, 10), [0, 5, 10, 15, 20, 25, 30, 35, 40, 45])
  for (let i = 10; i <= 17; i += 1) {
    assert.ok(lefts[i] > 45 && lefts[i] < 65, 're-estimated node ' + i + ' stays after node 9')
  }
  for (let i = 1; i < lefts.length; i += 1) {
    assert.ok(lefts[i] >= lefts[i - 1], 'node ' + i + ' sits left of node ' + (i - 1))
  }
  assert.equal(lefts[18], 65)
})

test('the strip stays hidden until the model answers or calls a tool', async () => {
  const { store } = fixture()
  const now = Date.now()
  const progress = {
    ...fixture().progress,
    turn: 6,
    percent: -1,
    source: 'none',
    modelPercent: -1,
    milestone: '',
    next: '',
    done: false,
    startedAt: now - 20_000,
    updatedAt: 0,
    tools: 0,
    taskChars: 40,
    replyChars: 0,
  }
  const { render } = await loadDock(store, { byId: {}, projectionsBySession: {} }, progress)
  assert.equal(render(), null, 'nothing is drawn while the model is still thinking')
})

test('the current-step text carries the Harness tooltip only when clipped', async () => {
  const { store } = fixture()
  const { render } = await loadDock(store)
  const tree = render()
  let found = null
  const walk = node => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (node.props !== null && typeof node.props === 'object' && node.props.onlyWhenClipped === true) found = node
    walk(node.props?.children)
  }
  walk(tree)
  assert.ok(found, 'the strip text is wrapped in a clipping tooltip')
  assert.match(String(found.props.label), /改客户端样式/)
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

test('a completed node tooltip carries its final percentage', async () => {
  const { store } = fixture()
  const { render } = await loadDock(store)
  let tree = render()
  byClass(tree, 'dtp-node')[0].props.onMouseEnter()
  tree = render()
  assert.match(textOf(byClass(tree, 'dtp-tip')[0]), /15%/)
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

test('the node panel shows final percentages and expands to the correction history', async () => {
  const { store } = fixture()
  const rail = store.rails['session-1']
  rail.steps[0].originalPercent = 10
  rail.steps[0].corrections = 2
  rail.steps[0].correctionHistory = [{ from: 10, to: 18 }, { from: 18, to: 15 }]
  const { renderPanel } = await loadDock(store)
  let tree = renderPanel()
  const cards = byClass(tree, 'dtp-card')
  assert.match(textOf(cards[0]), /15%/)
  assert.doesNotMatch(textOf(tree), /已矫正/)
  cards[0].props.onClick()
  tree = renderPanel()
  const opened = byClass(tree, 'dtp-card')
  assert.match(textOf(opened[0]), /已矫正 2 次/)
  assert.match(textOf(opened[0]), /第 1 次矫正，校正前 10%，矫正后 18%/)
  assert.match(textOf(opened[0]), /第 2 次矫正，校正前 18%，矫正后 15%/)
  assert.doesNotMatch(textOf(opened[1]), /已矫正/, 'only completed cards carry correction details')
})

test('a completed node without corrections says so when expanded', async () => {
  const { store } = fixture()
  store.rails['session-1'].steps[0].corrections = 0
  const { renderPanel } = await loadDock(store)
  let tree = renderPanel()
  byClass(tree, 'dtp-card')[0].props.onClick()
  tree = renderPanel()
  assert.match(textOf(byClass(tree, 'dtp-card')[0]), /无需矫正/)
})

test('the node panel numbers nodes with the Host seq', async () => {
  const { store } = fixture()
  store.rails['session-1'].steps[0].seq = 105
  const { renderPanel } = await loadDock(store)
  assert.match(textOf(byClass(renderPanel(), 'dtp-card')[0]), /节点 105/)
})

test('the node panel header shows the task total duration', async () => {
  const { store } = fixture()
  const now = Date.now()
  store.rails['session-1'].startedAt = now - 600_000
  const { renderPanel } = await loadDock(store, {
    byId: {
      'session-1': {
        projectionValues: {
          taskProgress: { v: 4, turn: 4, percent: 40, done: false, startedAt: now - 600_000, updatedAt: now },
        },
      },
    },
    projectionsBySession: {},
  })
  assert.match(textOf(renderPanel()), /总用时 1[01]分/)
})

test('more than a hundred nodes collapse crowded positions into counted clusters', async () => {
  const { store } = fixture()
  const now = Date.now()
  const steps = []
  for (let index = 0; index < 120; index += 1) {
    steps.push({
      label: `里程碑 ${index}`,
      percent: Math.min(90, Math.round(index / 2)),
      phase: 'execute',
      at: now - 500_000 + index * 1_000,
      endedAt: now - 400_000 + index * 1_000,
      durationMs: 1_000,
      seq: 100 + index,
    })
  }
  steps.push({ label: '当前', percent: 90, phase: 'execute', at: now, endedAt: 0, durationMs: 0, seq: 220 })
  store.rails['session-1'] = { turn: 4, startedAt: now - 600_000, steps }
  const { render } = await loadDock(store)
  let tree = render()
  const nodes = byClass(tree, 'dtp-node')
  assert.ok(nodes.length < 60, 'crowded nodes are collapsed')
  const clusters = byClass(tree, 'dtp-node-cluster')
  assert.ok(clusters.length > 0, 'cluster nodes rendered')
  assert.ok(byClass(tree, 'dtp-node-count').length > 0, 'clusters carry a count')
  for (const node of nodes) {
    const left = parseFloat(String(node.props.style.left))
    assert.ok(left >= 0 && left <= 100, 'every node stays on the rail')
  }
  clusters[0].props.onMouseEnter()
  tree = render()
  const tip = byClass(tree, 'dtp-tip')[0]
  assert.ok(tip, 'cluster hover card')
  assert.match(textOf(tip), /个节点/)
  assert.match(textOf(tip), /节点 1\d\d/, 'members keep their stable numbers')
})

test('the Settings preview carries the running-node gap rule too', async () => {
  const { store } = fixture()
  const { renderSettings } = await loadDock(store)
  const tree = renderSettings()
  const text = textOf(tree)
  assert.ok(text.includes('0 0 0 1px var(--dsw-alias-bg-layer-1'), 'preview shares the dock CSS')
  const live = byClass(tree, 'dtp-node-current')
  assert.equal(live.length, 1, 'the preview renders a running node')
})

test('the Settings page exposes node size and the four node colors', async () => {
  const { store } = fixture()
  const { renderSettings } = await loadDock(store)
  const text = textOf(renderSettings())
  assert.match(text, /节点大小/)
  assert.match(text, /已完成节点边缘/)
  assert.match(text, /已完成节点中心/)
  assert.match(text, /进行中节点边缘/)
  assert.match(text, /进行中节点中心/)
  assert.ok(text.includes('--dtp-node-size'), 'the preview carries the node size variable')
})

test('the node center/edge settings show the bar color as their default', async () => {
  const { store } = fixture()
  store.style = { barColor: '#8b3ffd' }
  const { renderSettings } = await loadDock(store)
  const tree = renderSettings()
  const inputs = byClass(tree, 'dtp-set-color')
  const centered = inputs.find(input => String(input.props['aria-label'] ?? '').includes('已完成节点中心'))
  const edge = inputs.find(input => String(input.props['aria-label'] ?? '').includes('进行中节点边缘'))
  assert.ok(centered && edge, 'both settings rendered')
  assert.equal(centered.props.value, '#8b3ffd')
  assert.equal(edge.props.value, '#8b3ffd')
  assert.ok(byClass(tree, 'dtp-set-swatch').length >= 2, 'the bar color is shown beside them')
  const text = textOf(tree)
  assert.match(text, /默认与进度条同色/)
  assert.match(text, /默认 6/)
})

test('a completed rail keeps its total time instead of growing', async () => {
  const { store } = fixture()
  const now = Date.now()
  store.rails['session-1'].startedAt = now - 120_000
  store.rails['session-1'].closedAt = now - 60_000
  const { renderPanel } = await loadDock(store, {
    byId: {
      'session-1': {
        projectionValues: {
          taskProgress: { v: 4, turn: 4, percent: 100, done: true, startedAt: now - 120_000, updatedAt: now },
        },
      },
    },
    projectionsBySession: {},
  })
  assert.match(textOf(renderPanel()), /总用时 1分/)
})

test('the node-count badge shows the true total past the retained 100 nodes', async () => {
  const { store } = fixture()
  const now = Date.now()
  const steps = []
  for (let index = 0; index < 100; index += 1) {
    steps.push({
      label: `里程碑 ${index}`,
      percent: index,
      phase: 'execute',
      at: now - 100_000 + index,
      endedAt: index < 99 ? now - 90_000 + index : 0,
      durationMs: 1_000,
      seq: 100 + index,
    })
  }
  store.rails['session-1'] = { turn: 4, startedAt: now - 200_000, steps }
  const { render } = await loadDock(store)
  const badge = byClass(render(), 'dtp-expand-badge')[0]
  assert.ok(badge, 'badge rendered')
  assert.equal(textOf(badge), '200')
})

test('the node panel header counts every node past the retained limit', async () => {
  const { store } = fixture()
  const now = Date.now()
  const steps = []
  for (let index = 0; index < 100; index += 1) {
    steps.push({
      label: `里程碑 ${index}`,
      percent: index,
      phase: 'execute',
      at: now - 100_000 + index,
      endedAt: now - 90_000 + index,
      durationMs: 1_000,
      seq: 100 + index,
    })
  }
  store.rails['session-1'] = { turn: 4, startedAt: now - 200_000, closedAt: now - 1_000, steps }
  const { renderPanel } = await loadDock(store)
  assert.match(textOf(renderPanel()), /200 个节点/)
})

test('the running node keeps a 1px gap from the rail', async () => {
  const { store } = fixture()
  const { render } = await loadDock(store)
  assert.ok(textOf(render()).includes('0 0 0 1px var(--dsw-alias-bg-layer-1'))
})

test('the stale hint dims only the text, never the bar or its nodes', async () => {
  const { store } = fixture()
  const { render } = await loadDock(store)
  const css = textOf(render())
  assert.ok(css.includes('.dtp-dock[data-stale] .dtp-meta{opacity:.72}'))
  assert.ok(!css.includes('.dtp-dock[data-stale]{opacity:.72}'))
})
