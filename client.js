/**
 * dsh-task-progress — browser half.
 *
 * Two occupants over the Host's `taskProgress` session projection:
 *  - `conversation.input.dock`: the running task's bar, phase, and next node
 *    above the composer, visible only while the task runs (plus a short
 *    completion hold). The bar shows the open turn's own 0–100%; every
 *    milestone the evaluator names during that turn becomes a node, and the
 *    milestone the page is showing right now is the outlined node at the head.
 *  - `sidebar.session.row.trailing`: a small progress ring on the session row,
 *    visible only for a running session and never for a finished one.
 *
 * Both read the projection the Host already publishes: the dock through the
 * session-scoped `useProjection` hook, the row through the session list's
 * projection store. The milestone rail arrives on the same read-only route as
 * the evaluator's estimates. No polling per component, no session-log folding
 * on the Client.
 */
window.__ModuleLoader__.load({
  id: '@deepslacker/dsh-task-progress',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // Harness primitives are optional here: the module is injected by the Host
    // when the package declares it, and a plain shell may not have it, so the
    // plugin degrades to the caller-provided title instead of failing to load.
    const primitives = (() => {
      try {
        return require('@deepseek-ai/dsh-client-ui-primitives')
      } catch {
        return null
      }
    })()
    const DshTooltip = primitives !== null && primitives !== undefined
      && typeof primitives.Tooltip === 'function' ? primitives.Tooltip : null
    const DshSwitch = primitives !== null && primitives !== undefined
      && typeof primitives.Switch === 'function' ? primitives.Switch : null

    /** Wrap one anchor with the Harness' own tooltip when it is available. */
    function withTooltip(label, anchor, side = 'top', extra) {
      if (DshTooltip !== null) {
        if (typeof label !== 'string' || label === '') return anchor
        return h(DshTooltip, { label, side, portal: true, ...(extra ?? {}) }, anchor)
      }
      // A shell without the primitives still gets a hover hint.
      if (typeof label === 'string' && label !== '' && anchor !== null && typeof anchor === 'object'
        && typeof React.cloneElement === 'function') {
        return React.cloneElement(anchor, { title: label })
      }
      return anchor
    }

    const NS = 'task-progress'
    /** A task is "stale" after this long without a new checkpoint while running. */
    const STALE_MS = 90_000
    /** How long the finished state stays on screen after the turn ends. */
    const LINGER_MS = 1500
    /** Before this long with no checkpoint the strip stays hidden instead of flashing. */
    const EVALUATING_AFTER_MS = 12_000
    /** A checkpoint from the working model younger than this outranks the evaluator. */
    const MODEL_FRESH_MS = 180_000
    /** Poll period of the evaluator store. */
    const JUDGE_POLL_MS = 2_000
    /** Host route serving the evaluator's estimates and the milestone rail. */
    const JUDGE_URL = '/api/dsh-task-progress/judgements'

    const DICT = {
      zh: {
        'phase.plan': '规划',
        'phase.execute': '执行',
        'phase.verify': '验证',
        'phase.deliver': '交付',
        'done': '已完成',
        'progress.aria': '任务进度',
        'progress.eta': '约 {n} 分钟',
        'progress.estimated': '按待办估算',
        'progress.next': '下一步：{x}',
        'progress.done': '任务已完成',
        'progress.evaluating': '评估中',
        'progress.elapsed': '已进行 {t}',
        'progress.analyzing': '正在分析本轮进展',
        'step.index': '节点 {n}',
        'step.node': '节点 {n}：{x}，耗时 {t}',
        'step.duration': '耗时 {t}',
        'step.finished': '{t} 完成',
        'step.running': '进行中',
        'step.elapsed': '已用 {t}',
        'list.title': '节点',
        'tab.title': '节点',
        'tab.heading': '本次任务节点',
        'tab.count': '{n} 个节点',
        'tab.empty': '本轮还没有节点记录。',
        'footer.view': '查看本次任务节点',
        'list.expand': '展开节点列表',
        'list.collapse': '收起节点列表',
        'list.aria': '节点列表',
        'list.colon': '：',
        'duration.sec': '{n} 秒',
        'duration.min': '{n} 分钟',
        'duration.minSec': '{m} 分 {s} 秒',
        'duration.hour': '{n} 小时',
        'duration.hourMin': '{h} 小时 {m} 分',
        'settings.title': '任务进度',
        'settings.lead': '进度条显示在输入框上方，这里调整它的外观；未改动的项跟随主题。',
        'settings.height': '进度条高度',
        'settings.height.desc': '2–24 像素，默认 6。',
        'settings.color': '进度条颜色',
        'settings.color.desc': '支持 #hex、rgb()、var(--xxx)；清空则跟随主题强调色。',
        'settings.color.value': '颜色值',
        'settings.color.auto': '跟随主题',
        'settings.font': '说明文字字号',
        'settings.font.desc': '进度条下方说明行的字号，9–24 像素，默认 12。',
        'settings.listFont': '节点列表字号',
        'settings.listFont.desc': '展开列表的行字号，9–24 像素，默认 11。',
        'settings.preview': '预览：执行中 · 接入事件 · 下一步：打磨',
        'settings.preview.done': '预览：节点已完成',
        'settings.preview.live': '预览：正在调整外观',
        'settings.preview.next': '检查节点详情卡',
        'settings.reset': '恢复默认',
        'simple.note': '简单任务，无需评估',
        'settings.simple': '简单任务模式',
        'settings.simple.desc': '没有工具调用、没有节点上报，且用时与字数都在下面阈值内时，不调用评估器、不显示进度。',
        'settings.simple.enabled': '启用简单任务检测',
        'settings.simple.seconds': '最长用时',
        'settings.simple.seconds.desc': '本轮超过这个秒数就不再按简单任务处理。',
        'settings.simple.chars': '最长字符数',
        'settings.simple.chars.desc': '用户消息与最终回复的字符数合计上限。',
        'settings.simple.unit.sec': '秒',
        'settings.simple.unit.chars': '字',
      },
      en: {
        'phase.plan': 'Planning',
        'phase.execute': 'Executing',
        'phase.verify': 'Verifying',
        'phase.deliver': 'Delivering',
        'done': 'Done',
        'progress.aria': 'Task progress',
        'progress.eta': '~{n} min left',
        'progress.estimated': 'estimated from todos',
        'progress.next': 'Next: {x}',
        'progress.done': 'Task complete',
        'progress.evaluating': 'Evaluating',
        'progress.elapsed': '{t} elapsed',
        'progress.analyzing': 'Reviewing this turn',
        'step.index': 'Node {n}',
        'step.node': 'Node {n}: {x}, took {t}',
        'step.duration': 'took {t}',
        'step.finished': 'finished {t}',
        'step.running': 'In progress',
        'step.elapsed': '{t} elapsed',
        'list.title': 'Nodes',
        'tab.title': 'Nodes',
        'tab.heading': 'Nodes for this task',
        'tab.count': '{n} nodes',
        'tab.empty': 'No nodes recorded for this turn yet.',
        'footer.view': "View this task's nodes",
        'list.expand': 'Expand node list',
        'list.collapse': 'Collapse node list',
        'list.aria': 'Node list',
        'list.colon': ': ',
        'duration.sec': '{n}s',
        'duration.min': '{n} min',
        'duration.minSec': '{m}m {s}s',
        'duration.hour': '{n} h',
        'duration.hourMin': '{h} h {m} min',
        'settings.title': 'Task progress',
        'settings.lead': 'The progress strip sits above the composer; adjust its appearance here. Untouched fields follow the theme.',
        'settings.height': 'Bar height',
        'settings.height.desc': '2–24 px, default 6.',
        'settings.color': 'Bar color',
        'settings.color.desc': 'Accepts #hex, rgb(), var(--x); clear it to use the theme accent.',
        'settings.color.value': 'Color value',
        'settings.color.auto': 'Theme accent',
        'settings.font': 'Explanation size',
        'settings.font.desc': 'Font size of the line under the bar, 9–24 px, default 12.',
        'settings.listFont': 'Node list font size',
        'settings.listFont.desc': 'Font size of the expanded list rows, 9–24 px, default 11.',
        'settings.preview': 'Preview: executing · wiring events · next: polish',
        'settings.preview.done': 'Preview: node finished',
        'settings.preview.live': 'Preview: tuning the appearance',
        'settings.preview.next': 'Check the node card',
        'settings.reset': 'Reset to defaults',
        'simple.note': 'Simple task, no evaluation needed',
        'settings.simple': 'Simple task mode',
        'settings.simple.desc': 'A turn with no tool call, no node report, and short duration and text is neither evaluated nor shown as progress.',
        'settings.simple.enabled': 'Detect simple tasks',
        'settings.simple.seconds': 'Max duration',
        'settings.simple.seconds.desc': 'Turns longer than this are no longer treated as simple.',
        'settings.simple.chars': 'Max characters',
        'settings.simple.chars.desc': 'Upper bound on the user message plus the final reply characters.',
        'settings.simple.unit.sec': 's',
        'settings.simple.unit.chars': 'chars',
      },
    }

    /** Current UI language, used only when the slot hands no translator. */
    function language() {
      const lang = String(
        (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) || 'en',
      ).toLowerCase()
      return lang.indexOf('zh') === 0 ? 'zh' : 'en'
    }

    /** Translate through the slot translator, falling back to this module's dictionary. */
    function tt(t, key, params) {
      if (typeof t === 'function') {
        const text = t(key, params)
        if (typeof text === 'string' && text !== key) return text
      }
      const dict = DICT[language()] || DICT.en
      const template = dict[key] !== undefined ? dict[key] : key
      if (params === undefined) return template
      return template.replace(/\{(\w+)\}/gu, (whole, name) => (params[name] === undefined ? whole : String(params[name])))
    }

    /** Keep a completed bar on screen briefly, then hide it. */
    function useLinger(active, ms) {
      const [held, setHeld] = React.useState(false)
      React.useEffect(() => {
        if (active) setHeld(true)
      }, [active])
      React.useEffect(() => {
        if (active) return undefined
        const timer = setTimeout(() => setHeld(false), ms)
        return () => clearTimeout(timer)
      }, [active, ms])
      return active || held
    }

    /** A coarse clock, ticking only while something is visible. */
    function useNow(enabled) {
      const [now, setNow] = React.useState(() => Date.now())
      React.useEffect(() => {
        if (!enabled) return undefined
        setNow(Date.now())
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [enabled])
      return now
    }

    const DOCK_CSS = [
      // Two rows on the composer's own width axis: the bar owns the first row,
      // the explanation the second. The width/centering formula is copied from
      // the host's dock cards (TodoPanel) so the strip lines up with the
      // conversation text column and follows the width handle exactly.
      '.dtp-dock{display:flex;flex-direction:column;gap:3px;box-sizing:border-box;',
      'width:calc(100% - var(--dsh-composer-side-clearance,16px) - var(--dsh-composer-side-clearance,16px)',
      ' - var(--dsh-composer-dock-inset,8px) - var(--dsh-composer-dock-inset,8px)',
      ' - var(--dsh-composer-dock-inset,8px) - var(--dsh-composer-dock-inset,8px));',
      'max-width:calc(var(--dsh-composer-card-max-width,100%)',
      ' - var(--dsh-composer-dock-inset,8px) - var(--dsh-composer-dock-inset,8px)',
      ' - var(--dsh-composer-dock-inset,8px) - var(--dsh-composer-dock-inset,8px));',
      'margin:0 auto;padding:2px 0 4px;font-size:12px;line-height:16px;',
      'color:var(--dsw-alias-label-secondary);}',
      '.dtp-dock[data-stale]{opacity:.72}',
      '.dtp-row{display:flex;align-items:center;gap:8px;min-width:0;width:100%;}',
      '.dtp-meta{font-size:var(--dtp-font-size,12px);line-height:1.45;}',
      // The wrapper owns a taller hover target than the 6px rail itself, and
      // negative margins keep the row's layout height unchanged while the
      // track grows vertically on hover.
      '.dtp-bar{position:relative;flex:1 1 auto;min-width:0;display:flex;align-items:center;',
      'padding-block:7px;margin-block:-7px;transform-origin:center;',
      'transition:transform .22s cubic-bezier(.2,.7,.3,1);}',
      '.dtp-track{position:relative;flex:1 1 auto;min-width:0;width:100%;height:var(--dtp-bar-height,6px);',
      'border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);overflow:hidden;',
      'transform-origin:center;transition:transform .22s cubic-bezier(.2,.7,.3,1),box-shadow .22s ease;}',
      // Hover: the whole bar grows a touch, the track grows less than it used to,
      // and a white glow plus a soft top highlight give the pill some material.
      '.dtp-bar:hover{transform:scale(1.015);z-index:1;}',
      '.dtp-bar:hover .dtp-track{transform:scaleY(1.5);',
      'box-shadow:0 0 0 2px rgba(255,255,255,.55),0 6px 20px -6px rgba(255,255,255,.9),',
      'inset 0 1px 0 rgba(255,255,255,.6),',
      '0 2px 12px -2px color-mix(in srgb,var(--dtp-bar-color,var(--dsw-alias-state-business-primary)) 40%,transparent);}',
      '.dtp-fill{position:absolute;inset-block:0;inset-inline-start:0;border-radius:999px;',
      'background:var(--dtp-bar-color,var(--dsw-alias-state-business-primary));transition:width .45s ease;}',
      '.dtp-dock[data-stale] .dtp-fill{animation:dtp-pulse 1.6s ease-in-out infinite;}',
      '.dtp-dock[data-evaluating] .dtp-fill{animation:dtp-pulse 1.6s ease-in-out infinite;}',
      '.dtp-scan{position:absolute;inset-block:0;inset-inline-start:0;width:34%;pointer-events:none;',
      'border-radius:999px;opacity:.45;',
      'background:linear-gradient(90deg,transparent,var(--dtp-bar-color,var(--dsw-alias-state-business-primary)),transparent);',
      'animation:dtp-slide 1.6s ease-in-out infinite;}',
      // Milestone nodes are a sibling overlay, so the track can keep its own
      // overflow clip for the fill.
      '.dtp-nodes{position:absolute;inset:0;pointer-events:none;}',
      '.dtp-node{position:absolute;top:50%;width:16px;height:16px;margin:-8px 0 0 -8px;padding:0;',
      'border:0;background:transparent;border-radius:50%;pointer-events:auto;cursor:pointer;',
      'display:inline-flex;align-items:center;justify-content:center;color:inherit;}',
      '.dtp-node:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;}',
      '.dtp-node-dot{display:block;width:8px;height:8px;border-radius:50%;box-sizing:border-box;',
      'background:var(--dtp-bar-color,var(--dsw-alias-state-business-primary));',
      'box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#fff));',
      'transition:transform .15s ease;}',
      '.dtp-node-current{z-index:2}',
      '.dtp-node-current .dtp-node-dot{width:9px;height:9px;',
      'background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1,#fff));',
      'border:2px solid var(--dtp-bar-color,var(--dsw-alias-state-business-primary));}',
      '.dtp-node:hover .dtp-node-dot,.dtp-node:focus-visible .dtp-node-dot{transform:scale(1.35);}',
      '.dtp-tip{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);',
      'display:flex;flex-direction:column;gap:3px;width:max-content;max-width:280px;padding:8px 10px;',
      'border-radius:10px;border:0.5px solid var(--dsw-alias-border-l1);',
      'background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1,#fff));',
      'box-shadow:0 8px 28px rgba(0,0,0,.18);color:var(--dsw-alias-label-primary);',
      'font-size:12px;line-height:1.5;pointer-events:none;z-index:20;text-align:left;white-space:normal;}',
      '.dtp-node[data-edge="start"] .dtp-tip{left:-4px;transform:none;}',
      '.dtp-node[data-edge="end"] .dtp-tip{left:auto;right:-4px;transform:none;}',
      '.dtp-tip-head{display:flex;align-items:center;gap:6px;font-size:11px;',
      'color:var(--dsw-alias-label-tertiary);}',
      '.dtp-tip-badge{flex:none;padding:0 5px;border-radius:999px;font-size:10px;line-height:16px;',
      'background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#16a34a) 14%,transparent);',
      'color:var(--dsw-alias-state-success-primary,#16a34a);}',
      '.dtp-tip-badge-live{background:color-mix(in srgb,var(--dtp-bar-color,var(--dsw-alias-state-business-primary)) 14%,transparent);',
      'color:var(--dtp-bar-color,var(--dsw-alias-state-business-primary));}',
      '.dtp-tip-main{font-size:13px;line-height:1.45;font-weight:600;overflow-wrap:anywhere;}',
      '.dtp-tip-sub{font-size:11px;line-height:1.45;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;}',
      '.dtp-tip-meta{font-size:11px;line-height:1.45;color:var(--dsw-alias-label-secondary);',
      'font-variant-numeric:tabular-nums;}',
      '.dtp-pct{flex:none;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;}',
      '.dtp-simple{display:flex;align-items:center;gap:6px;font-size:var(--dtp-font-size,12px);',
      'line-height:1.45;color:var(--dsw-alias-label-tertiary);}',
      '.dtp-simple-check{color:var(--dsw-alias-state-success-primary,#16a34a);font-weight:600;}',
      '.dtp-phase{flex:none;padding:0 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;',
      'font-size:calc(var(--dtp-font-size,12px) - 1px);line-height:1.35;color:var(--dsw-alias-label-tertiary);}',
      '.dtp-text{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dtp-eta{flex:none;margin-inline-start:auto;color:var(--dsw-alias-label-tertiary);',
      'font-variant-numeric:tabular-nums;}',
      '.dtp-expand{flex:none;display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 6px;',
      'border:0.5px solid var(--dsw-alias-border-l1);border-radius:999px;background:transparent;',
      'color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:11px;line-height:18px;',
      'font-variant-numeric:tabular-nums;}',
      '.dtp-expand:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',
      '.dtp-expand:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px;}',
      '.dtp-expand-arrow{font-size:10px;line-height:1;color:var(--dsw-alias-label-tertiary);}',
      '.dtp-expand-badge{min-width:16px;padding:0 4px;border-radius:999px;text-align:center;',
      'background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent);',
      'color:var(--dsw-alias-state-business-primary);font-size:10px;line-height:16px;}',
      '.dtp-list{margin-top:2px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:8px;',
      'background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#fff));padding:3px 0;',
      'box-sizing:border-box;height:180px;overflow:auto;',
      'font-size:var(--dtp-list-font-size,11px);line-height:1.5;}',
      '.dtp-list-row{display:flex;align-items:baseline;gap:5px;padding:2px 8px;min-width:0;}',
      '.dtp-list-row-live{background:color-mix(in srgb,var(--dtp-bar-color,var(--dsw-alias-state-business-primary)) 6%,transparent);}',
      '.dtp-list-index{flex:none;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;}',
      '.dtp-list-badge{flex:none;padding:0 5px;border-radius:999px;',
      'font-size:calc(var(--dtp-list-font-size,11px) - 1px);line-height:1.4;',
      'background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#16a34a) 14%,transparent);',
      'color:var(--dsw-alias-state-success-primary,#16a34a);}',
      '.dtp-list-badge-live{background:color-mix(in srgb,var(--dtp-bar-color,var(--dsw-alias-state-business-primary)) 14%,transparent);',
      'color:var(--dtp-bar-color,var(--dsw-alias-state-business-primary));}',
      '.dtp-list-colon{flex:none;color:var(--dsw-alias-label-tertiary);}',
      '.dtp-list-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
      'color:var(--dsw-alias-label-secondary);}',
      '.dtp-list-meta{flex:none;color:var(--dsw-alias-label-tertiary);',
      'font-size:calc(var(--dtp-list-font-size,11px) - 1px);font-variant-numeric:tabular-nums;white-space:nowrap;}',
      '.dtp-list-rule{height:1px;margin:3px 8px;background:var(--dsw-alias-border-l1);}',
      '@keyframes dtp-pulse{0%,100%{opacity:1}50%{opacity:.5}}',
      '@keyframes dtp-slide{0%{transform:translateX(-110%)}100%{transform:translateX(300%)}}',
      '@media (prefers-reduced-motion:reduce){',
      '.dtp-bar,.dtp-track,.dtp-node-dot,.dtp-set-preview-bar,.dtp-set-track{transition:none}',
      '.dtp-dock[data-stale] .dtp-fill,.dtp-dock[data-evaluating] .dtp-fill,.dtp-scan{animation:none}}',
    ].join('')

    /** Short clock for the evaluating state (`m:ss`). */
    function clock(ms) {
      const total = Math.max(0, Math.floor(ms / 1000))
      return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
    }

    /** Human duration of one milestone. */
    function durationText(t, ms) {
      const total = Math.max(0, Math.round((Number(ms) || 0) / 1000))
      if (total < 60) return tt(t, 'duration.sec', { n: total })
      const minutes = Math.floor(total / 60)
      const seconds = total % 60
      if (minutes < 60) {
        return seconds === 0
          ? tt(t, 'duration.min', { n: minutes })
          : tt(t, 'duration.minSec', { m: minutes, s: seconds })
      }
      const hours = Math.floor(minutes / 60)
      const rest = minutes % 60
      return rest === 0
        ? tt(t, 'duration.hour', { n: hours })
        : tt(t, 'duration.hourMin', { h: hours, m: rest })
    }

    /** Wall-clock `HH:MM` of a completion timestamp, or `''` when unknown. */
    function timeText(ts) {
      if (!(Number(ts) > 0)) return ''
      try {
        return new Intl.DateTimeFormat(language() === 'zh' ? 'zh-CN' : 'en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date(ts))
      } catch {
        return ''
      }
    }

    /** A node's horizontal position, kept inside the rounded rail. */
    function railPosition(value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return 0
      return Math.max(0, Math.min(99, Math.round(number * 10) / 10))
    }

    /** The open turn's milestone rail from the polled Host value. */
    function railStepsOf(store, sessionId, turn) {
      if (store === null || store === undefined || store.rails === null || store.rails === undefined) return []
      const rail = store.rails[sessionId]
      if (rail === null || rail === undefined || rail.turn !== turn || !Array.isArray(rail.steps)) return []
      return rail.steps
    }

    /** The plugin's task-progress glyph (the same paths as icon.svg), tinted by CSS. */
    const GLYPH_PATHS = [
      'M394.88 844.16a349.44 349.44 0 0 1-117.44-69.76 32 32 0 0 0-42.56 47.68 413.76 413.76 0 0 0 138.88 82.24 32 32 0 0 0 10.56 1.92 32 32 0 0 0 10.56-62.08zM489.28 873.28A32 32 0 0 0 480 896a32 32 0 0 0 2.56 12.16 37.12 37.12 0 0 0 6.72 10.56 36.8 36.8 0 0 0 10.56 6.72 30.08 30.08 0 0 0 24.32 0 28.8 28.8 0 0 0 17.28-17.28A32 32 0 0 0 544 896a32 32 0 0 0-54.72-22.72z',
      'M512 32v64A416 416 0 0 0 151.68 720a32 32 0 1 0 55.36-32A352 352 0 0 1 512 160v64a288 288 0 0 1 288 288h64a352 352 0 0 1-234.56 332.16 32 32 0 1 0 21.44 60.16A416 416 0 0 0 928 512h64A480 480 0 0 0 512 32z',
    ]

    function ProgressGlyph({ size = 16, className }) {
      return h(
        'svg',
        {
          className,
          width: size,
          height: size,
          viewBox: '0 0 1024 1024',
          fill: 'currentColor',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        GLYPH_PATHS.map((d, index) => h('path', { key: index, d })),
      )
    }

    /**
     * Polled store of the Host evaluator's estimates and milestone rails,
     * keyed by session id. It only polls while something subscribes and the
     * page is visible.
     */
    function createJudgementStore(url) {
      let snapshot = { sessions: {}, rails: {}, style: null, version: '' }
      let timer = null
      let inFlight = false
      const listeners = new Set()
      const emit = () => { for (const listener of listeners) listener() }
      const poll = async () => {
        if (inFlight) return
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
        inFlight = true
        try {
          const response = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' })
          if (!response.ok) return
          const body = await response.json()
          const value = body !== null && typeof body === 'object' && body.ok === true
            && body.value !== null && typeof body.value === 'object' ? body.value : undefined
          if (value === undefined) return
          const sessions = value.sessions !== null && typeof value.sessions === 'object' ? value.sessions : {}
          const rails = value.rails !== null && typeof value.rails === 'object' ? value.rails : {}
          const style = value.style !== null && typeof value.style === 'object' ? value.style : null
          const version = typeof value.version === 'string' ? value.version : ''
          const next = { sessions, rails, style, version }
          if (JSON.stringify(next) === JSON.stringify(snapshot)) return
          snapshot = next
          emit()
        } catch {
          // A failing endpoint degrades to the projection's own value.
        } finally {
          inFlight = false
        }
      }
      return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener)
          if (timer === null) {
            void poll()
            timer = setInterval(() => { void poll() }, JUDGE_POLL_MS)
          }
          return () => {
            listeners.delete(listener)
            if (listeners.size === 0 && timer !== null) {
              clearInterval(timer)
              timer = null
            }
          }
        },
      }
    }

    /** Defaults when neither the settings page, the Host row config, nor CSS set a knob. */
    const STYLE_DEFAULTS = Object.freeze({ barHeight: 6, barColor: '', textFontSize: 12, listFontSize: 11 })
    /** localStorage key of the appearance overrides edited in Settings. */
    const STYLE_KEY = 'dsh-task-progress.style.v1'

    /** Read the saved appearance overrides, discarding anything unusable. */
    function readStyleOverrides() {
      try {
        const raw = window.localStorage.getItem(STYLE_KEY)
        if (raw === null || raw === undefined || raw === '') return {}
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return {}
        const out = {}
        if (Number.isFinite(parsed.barHeight) && parsed.barHeight > 0) out.barHeight = Math.min(24, Math.round(parsed.barHeight))
        if (typeof parsed.barColor === 'string' && parsed.barColor !== '') out.barColor = parsed.barColor.slice(0, 40)
        if (Number.isFinite(parsed.textFontSize) && parsed.textFontSize > 0) out.textFontSize = Math.min(24, Math.round(parsed.textFontSize))
        if (Number.isFinite(parsed.listFontSize) && parsed.listFontSize > 0) out.listFontSize = Math.min(24, Math.max(9, Math.round(parsed.listFontSize)))
        return out
      } catch {
        return {}
      }
    }

    /** Observable store of the appearance overrides edited in Settings. */
    function createStyleStore() {
      let snapshot = readStyleOverrides()
      const listeners = new Set()
      const emit = () => { for (const listener of listeners) listener() }
      const persist = () => {
        try {
          if (Object.keys(snapshot).length === 0) window.localStorage.removeItem(STYLE_KEY)
          else window.localStorage.setItem(STYLE_KEY, JSON.stringify(snapshot))
        } catch {
          // Storage can be blocked; the in-memory value still applies.
        }
      }
      return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        set(patch) {
          const next = { ...snapshot }
          for (const key of Object.keys(patch)) {
            const value = patch[key]
            if (value === undefined || value === null || value === '' || value === 0) delete next[key]
            else next[key] = value
          }
          snapshot = next
          persist()
          emit()
        },
        reset() {
          snapshot = {}
          persist()
          emit()
        },
      }
    }

    /**
     * Merge the three layers of one presentation knob.
     * Settings (local) > Host row config > theme default. The `explicit*`
     * flags say whether a layer set the knob, so the strip only overrides the
     * CSS variable it actually owns and everything else keeps the theme.
     */
    function resolveStyle(host, local) {
      const h = host !== null && host !== undefined ? host : {}
      const l = local !== null && local !== undefined ? local : {}
      const height = l.barHeight > 0 ? l.barHeight : h.barHeight > 0 ? h.barHeight : 0
      const font = l.textFontSize > 0 ? l.textFontSize : h.textFontSize > 0 ? h.textFontSize : 0
      const listFont = l.listFontSize > 0 ? l.listFontSize : h.listFontSize > 0 ? h.listFontSize : 0
      const color = typeof l.barColor === 'string' && l.barColor !== ''
        ? l.barColor
        : typeof h.barColor === 'string' ? h.barColor : ''
      return {
        barHeight: height > 0 ? height : STYLE_DEFAULTS.barHeight,
        barColor: color,
        textFontSize: font > 0 ? font : STYLE_DEFAULTS.textFontSize,
        listFontSize: listFont > 0 ? listFont : STYLE_DEFAULTS.listFontSize,
        explicitHeight: height > 0,
        explicitColor: color !== '',
        explicitFont: font > 0,
        explicitListFont: listFont > 0,
      }
    }

    /** Defaults and storage for the simple-task rule. */
    const SIMPLE_DEFAULTS = Object.freeze({ mode: 'auto', seconds: 30, chars: 1200 })
    /** localStorage key of the simple-task overrides. */
    const SIMPLE_KEY = 'dsh-task-progress.simple.v1'
    /** Host route that carries these thresholds to the evaluator sweep. */
    const SIMPLE_ROUTE = '/api/dsh-task-progress/settings'

    /** Read the saved simple-task thresholds, discarding anything unusable. */
    function readSimpleSettings() {
      const fallback = { ...SIMPLE_DEFAULTS }
      try {
        const raw = window.localStorage.getItem(SIMPLE_KEY)
        if (raw === null || raw === undefined || raw === '') return fallback
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return fallback
        const seconds = Number(parsed.seconds)
        const chars = Number(parsed.chars)
        return {
          mode: parsed.mode === 'off' ? 'off' : 'auto',
          seconds: Number.isFinite(seconds) && seconds > 0 ? Math.min(3600, Math.round(seconds)) : fallback.seconds,
          chars: Number.isFinite(chars) && chars >= 0 ? Math.min(100_000, Math.round(chars)) : fallback.chars,
        }
      } catch {
        return fallback
      }
    }

    /** Hand the thresholds to the Host so its sweep skips the evaluator. */
    function syncSimpleSettings(settings) {
      try {
        fetch(SIMPLE_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mode: settings.mode, seconds: settings.seconds, chars: settings.chars }),
        }).catch(() => {})
      } catch {
        // The Host keeps its configured defaults when the route is unreachable.
      }
    }

    /** Observable store of the simple-task rule edited in Settings. */
    function createSimpleStore() {
      let snapshot = readSimpleSettings()
      const listeners = new Set()
      const emit = () => { for (const listener of listeners) listener() }
      const persist = () => {
        try {
          window.localStorage.setItem(SIMPLE_KEY, JSON.stringify(snapshot))
        } catch {
          // Storage can be blocked; the in-memory value still applies.
        }
      }
      return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        set(patch) {
          snapshot = { ...snapshot, ...patch }
          persist()
          syncSimpleSettings(snapshot)
          emit()
        },
        reset() {
          snapshot = { ...SIMPLE_DEFAULTS }
          persist()
          syncSimpleSettings(snapshot)
          emit()
        },
        overridden() {
          try {
            const raw = window.localStorage.getItem(SIMPLE_KEY)
            return raw !== null && raw !== undefined && raw !== ''
          } catch {
            return false
          }
        },
      }
    }

    /** Whether a turn reads as a simple question (mirror of the Host rule). */
    function simpleTurnOf(progress, now, settings) {
      if (progress === undefined || progress === null || progress.turn <= 0) return false
      if (settings === null || settings === undefined || settings.mode === 'off') return false
      if (progress.modelPercent >= 0) return false
      if ((progress.tools ?? 0) > 0) return false
      const chars = (progress.taskChars ?? 0) + (progress.replyChars ?? 0)
      if (chars > (settings.chars ?? 1200)) return false
      if (!(progress.startedAt > 0)) return false
      const seconds = Number(settings.seconds ?? 30)
      if (!(seconds > 0)) return false
      const enteredAt = progress.done === true
        ? (progress.updatedAt > 0 ? progress.updatedAt : now)
        : now
      const elapsed = enteredAt - progress.startedAt
      return elapsed >= 0 && elapsed <= seconds * 1000
    }

    /**
     * Overlay the evaluator's estimate on the projection value.
     * @param progress - the session's `taskProgress` projection value.
     * @param judgement - this session's evaluator entry, if any.
     * @param now - wall clock used for the freshness rule.
     * @returns the value the UI should show.
     */
    function mergeJudgement(progress, judgement, now) {
      if (progress === undefined || progress === null || progress.turn <= 0) return progress
      if (progress.done === true) return progress
      // The working model's own checkpoint is the best signal while it is fresh.
      if (progress.source === 'model' && now - progress.updatedAt < MODEL_FRESH_MS) return progress
      if (judgement === undefined || judgement === null || judgement.turn !== progress.turn) return progress
      // An estimate computed before this turn began describes the previous task,
      // even if a sweep raced it onto the new turn number.
      const at = typeof judgement.at === 'number' ? judgement.at : 0
      if (at < progress.startedAt) return progress
      if (!(judgement.percent >= 0)) return progress
      return {
        ...progress,
        percent: judgement.percent,
        source: 'judge',
        phase: judgement.phase || progress.phase,
        milestone: judgement.milestone || progress.milestone,
        next: judgement.next || progress.next,
        etaMin: judgement.etaMin > 0 ? judgement.etaMin : progress.etaMin,
        updatedAt: Math.max(progress.updatedAt, judgement.at || 0),
      }
    }

    /**
     * The running task's strip above the composer.
     * @param useJudgements - hook over the evaluator/rail store.
     * @param useStyle - hook over the appearance overrides.
     */
    function makeProgressDock(useJudgements, useStyle, useSimple) {
      return function ProgressDock(props) {
        const t = props.t
        const raw = props.useProjection('taskProgress')
        const store = useJudgements()
        // Every hook must run before the first early return: the strip mounts
        // hidden and becomes visible later, so a hook added below a `return`
        // would change the hook count between renders and crash the slot.
        const local = useStyle()
        const simpleSettings = useSimple()
        const [hovered, setHovered] = React.useState(null)
        const [listOpen, setListOpen] = React.useState(false)
        const entries = store !== null && store !== undefined && store.sessions !== null && store.sessions !== undefined
          ? store.sessions : {}
        const sessionId = props.session !== undefined && props.session !== null ? props.session.sessionId : undefined
        const progress = mergeJudgement(
          raw,
          sessionId !== undefined ? entries[sessionId] : undefined,
          Date.now(),
        )
        const running = props.session !== undefined && props.session !== null && props.session.running === true
        // A finished task stops counting as active immediately: the linger below
        // keeps the completed bar for a moment, then hides it even while the
        // session itself stays busy with background work.
        const active = running && progress !== undefined && progress !== null && progress.turn > 0 && progress.done !== true
        const visible = useLinger(active, LINGER_MS)
        const now = useNow(visible)
        if (!visible || progress === undefined || progress === null || progress.turn === 0) return null
        const done = progress.done === true
        const known = progress.percent >= 0
        const simple = simpleTurnOf(progress, now, simpleSettings)
        const elapsed = progress.startedAt > 0 ? now - progress.startedAt : 0
        // Until the model answers or calls a tool there is nothing to classify:
        // a slow first token must not flash the simple-task line (or a bar) and
        // then switch. The strip stays hidden during that wait.
        const awaitingModel = !done && !known && (progress.replyChars ?? 0) === 0 && (progress.tools ?? 0) === 0
        // A long first step (or a long tool batch) has no checkpoint yet: the
        // model is blocked and cannot report. Show that a task is under
        // evaluation instead of leaving the row blank or inventing a number.
        const evaluating = !awaitingModel && !simple && !done && !known && progress.startedAt > 0
          && elapsed >= EVALUATING_AFTER_MS
        // A simple Q&A gets one quiet line instead of a bar, but only once it is
        // answering (or the turn has ended).
        const showSimple = !awaitingModel && simple && (done || elapsed >= EVALUATING_AFTER_MS)
        if (awaitingModel || (!done && !known && !evaluating && !showSimple)) return null
        if (showSimple) {
          return h(
            React.Fragment,
            null,
            h('style', { key: 'dtp-style' }, DOCK_CSS),
            h(
              'div',
              { className: 'dtp-dock dtp-simple' },
              h('span', { className: 'dtp-simple-check', 'aria-hidden': 'true' }, '✓'),
              h('span', { className: 'dtp-simple-text' }, tt(t, 'simple.note')),
            ),
          )
        }
        const percent = done ? 100 : known ? progress.percent : 0
        const stale = running && !done && known && progress.updatedAt > 0 && now - progress.updatedAt > STALE_MS
        const phase = done ? tt(t, 'done') : known ? tt(t, `phase.${progress.phase}`) : tt(t, 'progress.evaluating')
        const next = progress.next || ''
        const detailParts = []
        if (progress.milestone !== '') detailParts.push(progress.milestone)
        if (next !== '') detailParts.push(tt(t, 'progress.next', { x: next }))
        const detail = evaluating ? tt(t, 'progress.analyzing') : detailParts.join(' · ')
        // Configured presentation rides CSS variables on the strip itself, so it
        // only overrides what the owner actually set; unset knobs keep the theme.
        const tuned = resolveStyle(
          store !== null && store !== undefined ? store.style : null,
          local,
        )
        const styleVars = {}
        if (tuned.explicitHeight) styleVars['--dtp-bar-height'] = `${tuned.barHeight}px`
        if (tuned.explicitColor) styleVars['--dtp-bar-color'] = tuned.barColor
        if (tuned.explicitFont) styleVars['--dtp-font-size'] = `${tuned.textFontSize}px`
        if (tuned.explicitListFont) styleVars['--dtp-list-font-size'] = `${tuned.listFontSize}px`
        const fill = Math.max(2, evaluating ? 0 : Math.min(100, percent))
        // The rail is per turn: a milestone the evaluator superseded is a
        // completed node; the milestone on screen now is the outlined head.
        const steps = sessionId !== undefined ? railStepsOf(store, sessionId, progress.turn) : []
        const allEntries = steps
          .map((step, index) => ({ step, index }))
          .filter(entry => entry.step !== null && typeof entry.step === 'object')
        const closedEntries = allEntries.filter(entry => entry.step.endedAt > 0)
        const currentPercent = known ? Math.max(0, Math.min(100, progress.percent)) : 100
        const ceiling = done ? 100 : currentPercent
        // A node's x is the percentage it was recorded at when its step was
        // superseded — never an even slice of the rail by node count. A
        // downward re-estimate must not push a later node left of an earlier
        // one (that is the old "node 9 next to the head" symptom), so those
        // nodes hold the highest percentage seen so far and spread toward the
        // next node. Positions stay clamped to the bar and the fill head.
        const placed = []
        let floor = 0
        for (const entry of closedEntries) {
          const value = Number(entry.step.percent)
          const raw = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : floor
          const position = Math.min(ceiling, Math.max(floor, raw))
          placed.push({ ...entry, position, held: raw < position })
          floor = position
        }
        for (let start = 0; start < placed.length;) {
          if (!placed[start].held) { start += 1; continue }
          let end = start
          while (end + 1 < placed.length && placed[end + 1].held && placed[end + 1].position === placed[start].position) {
            end += 1
          }
          const from = placed[start].position
          const next = end + 1 < placed.length ? placed[end + 1].position : ceiling
          const count = end - start + 1
          for (let step = 0; step < count; step += 1) {
            placed[start + step] = { ...placed[start + step], position: from + ((next - from) * (step + 1)) / (count + 1) }
          }
          start = end + 1
        }
        const positions = placed.map(entry => entry.position)
        // The bar is spatial, but node numbers stay chronological so the card and
        // the expanded list agree on which node is which.
        const closed = closedEntries.map((entry, index) => ({ ...entry, position: positions[index] }))
        const open = steps.length > 0 && steps[steps.length - 1] !== null && typeof steps[steps.length - 1] === 'object'
          ? { step: steps[steps.length - 1], index: steps.length - 1 }
          : undefined
        const currentIndex = open !== undefined ? open.index : steps.length
        const currentLabel = progress.milestone || ''
        const currentSince = open !== undefined && open.step.endedAt === 0 && open.step.label === currentLabel
          ? open.step.at
          : (progress.updatedAt > 0 ? progress.updatedAt : progress.startedAt)
        const showCurrent = !done && !evaluating && known && currentLabel !== ''
        const listCurrentLabel = currentLabel !== ''
          ? currentLabel
          : (open !== undefined && open.step.endedAt === 0 ? open.step.label : '')
        const listCurrent = !done && listCurrentLabel !== ''
          ? {
            index: currentIndex,
            label: listCurrentLabel,
            phase: currentLabel !== '' ? progress.phase : (open !== undefined ? open.step.phase : progress.phase),
            since: currentSince,
          }
          : undefined
        const listDone = closedEntries
        const listTotal = listDone.length + (listCurrent !== undefined ? 1 : 0)
        const bucketKey = value => Math.round(Number(value || 0) * 2) / 2
        const buckets = new Map()
        for (const entry of closed) {
          const key = bucketKey(entry.position)
          const bucket = buckets.get(key)
          if (bucket === undefined) buckets.set(key, [entry])
          else bucket.push(entry)
        }
        const currentKey = bucketKey(currentPercent)
        const nodeOffset = entry => {
          const key = bucketKey(entry.position)
          const bucket = buckets.get(key) ?? []
          const rank = bucket.indexOf(entry)
          let offset = (rank - (bucket.length - 1) / 2) * 16
          if (showCurrent && key === currentKey) offset -= 16
          // Never push a dot past the rounded rail's ends.
          if (entry.position >= 97.5 && offset > 0) offset = 0
          if (entry.position <= 2.5 && offset < 0) offset = 0
          return offset
        }
        const nodes = []
        const edge = position => (position < 16 ? 'start' : position > 84 ? 'end' : undefined)
        for (const entry of closed) {
          const { step, index } = entry
          const position = railPosition(entry.position)
          const label = step.label || ''
          const took = durationText(t, step.durationMs)
          const finished = timeText(step.endedAt)
          const meta = [tt(t, `phase.${step.phase}`)]
          meta.push(tt(t, 'step.duration', { t: took }))
          if (finished !== '') meta.push(tt(t, 'step.finished', { t: finished }))
          const key = `step-${index}`
          const activeNode = hovered === key
          nodes.push(h(
            'button',
            {
              key,
              type: 'button',
              className: 'dtp-node',
              style: {
                left: `${position}%`,
                transform: nodeOffset(entry) === 0 ? undefined : `translateX(${nodeOffset(entry)}px)`,
              },
              'data-edge': edge(position),
              'aria-label': tt(t, 'step.node', { n: index, x: label, t: took }),
              onMouseDown: event => event.preventDefault(),
              onMouseEnter: () => setHovered(key),
              onMouseLeave: () => setHovered(value => (value === key ? null : value)),
              onFocus: () => setHovered(key),
              onBlur: () => setHovered(value => (value === key ? null : value)),
            },
            h('span', { className: 'dtp-node-dot' }),
            activeNode
              ? h(
                'span',
                { className: 'dtp-tip', role: 'tooltip' },
                h(
                  'span',
                  { className: 'dtp-tip-head' },
                  h('span', null, tt(t, 'step.index', { n: index })),
                  h('span', { className: 'dtp-tip-badge' }, tt(t, 'done')),
                ),
                h('span', { className: 'dtp-tip-main' }, label),
                h('span', { className: 'dtp-tip-meta' }, meta.join(' · ')),
              )
              : null,
          ))
        }
        if (showCurrent) {
          const index = currentIndex
          const position = railPosition(progress.percent)
          const took = durationText(t, Math.max(0, now - currentSince))
          const key = 'current'
          const activeNode = hovered === key
          const meta = [tt(t, `phase.${progress.phase}`), tt(t, 'step.elapsed', { t: took })]
          nodes.push(h(
            'button',
            {
              key,
              type: 'button',
              className: 'dtp-node dtp-node-current',
              style: { left: `${position}%` },
              'data-edge': edge(position),
              'aria-label': tt(t, 'step.node', { n: index, x: currentLabel, t: took }),
              onMouseDown: event => event.preventDefault(),
              onMouseEnter: () => setHovered(key),
              onMouseLeave: () => setHovered(value => (value === key ? null : value)),
              onFocus: () => setHovered(key),
              onBlur: () => setHovered(value => (value === key ? null : value)),
            },
            h('span', { className: 'dtp-node-dot' }),
            activeNode
              ? h(
                'span',
                { className: 'dtp-tip', role: 'tooltip' },
                h(
                  'span',
                  { className: 'dtp-tip-head' },
                  h('span', null, tt(t, 'step.index', { n: index })),
                  h('span', { className: 'dtp-tip-badge dtp-tip-badge-live' }, tt(t, 'step.running')),
                ),
                h('span', { className: 'dtp-tip-main' }, currentLabel),
                next !== '' ? h('span', { className: 'dtp-tip-sub' }, tt(t, 'progress.next', { x: next })) : null,
                h('span', { className: 'dtp-tip-meta' }, meta.join(' · ')),
              )
              : null,
          ))
        }
        return h(
          React.Fragment,
          null,
          h('style', { key: 'dtp-style' }, DOCK_CSS),
          h(
            'div',
            {
              className: 'dtp-dock',
              style: styleVars,
              'data-stale': stale ? '' : undefined,
              'data-evaluating': evaluating ? '' : undefined,
            },
            // Row 1: the task's bar and its milestone rail.
            h(
              'div',
              { className: 'dtp-row' },
              h(
                'div',
                { className: 'dtp-bar' },
                h(
                  'div',
                  {
                    className: 'dtp-track',
                    role: 'progressbar',
                    'aria-label': tt(t, 'progress.aria'),
                    'aria-valuemin': 0,
                    'aria-valuemax': 100,
                    'aria-valuenow': evaluating ? undefined : percent,
                    'aria-busy': evaluating ? true : undefined,
                  },
                  h('div', {
                    className: 'dtp-fill',
                    style: { width: `${fill}%` },
                  }),
                  evaluating ? h('div', { className: 'dtp-scan' }) : null,
                ),
                nodes.length > 0 ? h('div', { className: 'dtp-nodes' }, nodes) : null,
              ),
              evaluating
                ? null
                : h(
                  'span',
                  { className: 'dtp-pct' },
                  `${!done && progress.source === 'todo' ? '≈' : ''}${percent}%`,
                ),
            ),
            // Row 2: what the number means — phase, current node, next node, time.
            h(
              'div',
              { className: 'dtp-row dtp-meta' },
              listTotal > 0
                ? withTooltip(listOpen ? tt(t, 'list.collapse') : tt(t, 'list.expand'), h(
                  'button',
                  {
                    type: 'button',
                    className: 'dtp-expand',
                    'aria-expanded': listOpen,
                    'aria-controls': 'dtp-node-list',
                    onClick: () => setListOpen(value => !value),
                  },
                  h('span', { className: 'dtp-expand-arrow' }, listOpen ? '▾' : '▸'),
                  h('span', { className: 'dtp-expand-label' }, tt(t, 'list.title')),
                  h('span', { className: 'dtp-expand-badge' }, String(listTotal)),
                ))
                : null,
              h('span', { className: 'dtp-phase' }, phase),
              detail === '' ? null : withTooltip(detail, h('span', { className: 'dtp-text' }, detail), 'top', { onlyWhenClipped: true }),
              evaluating
                ? h('span', { className: 'dtp-eta' }, tt(t, 'progress.elapsed', { t: clock(elapsed) }))
                : !done && progress.etaMin > 0
                  ? h('span', { className: 'dtp-eta' }, tt(t, 'progress.eta', { n: progress.etaMin }))
                  : null,
            ),
            listOpen && listTotal > 0
              ? h(
                'div',
                { className: 'dtp-list', id: 'dtp-node-list', role: 'region', 'aria-label': tt(t, 'list.aria') },
                listCurrent !== undefined
                  ? h(
                    'div',
                    { className: 'dtp-list-row dtp-list-row-live' },
                    h('span', { className: 'dtp-list-index' }, tt(t, 'step.index', { n: listCurrent.index })),
                    h('span', { className: 'dtp-list-badge dtp-list-badge-live' }, tt(t, 'step.running')),
                    h('span', { className: 'dtp-list-colon' }, tt(t, 'list.colon')),
                    h('span', { className: 'dtp-list-label', title: listCurrent.label }, listCurrent.label),
                    h('span', { className: 'dtp-list-meta' },
                      `${tt(t, `phase.${listCurrent.phase}`)} · ${tt(t, 'step.elapsed', { t: durationText(t, Math.max(0, now - listCurrent.since)) })}`),
                  )
                  : null,
                listCurrent !== undefined && listDone.length > 0
                  ? h('div', { className: 'dtp-list-rule', key: 'rule' })
                  : null,
                listDone.map(({ step, index }) => {
                  const finished = timeText(step.endedAt)
                  const meta = [
                    tt(t, `phase.${step.phase}`),
                    tt(t, 'step.duration', { t: durationText(t, step.durationMs) }),
                  ]
                  if (finished !== '') meta.push(tt(t, 'step.finished', { t: finished }))
                  return h(
                    'div',
                    { className: 'dtp-list-row', key: `list-${index}` },
                    h('span', { className: 'dtp-list-index' }, tt(t, 'step.index', { n: index })),
                    h('span', { className: 'dtp-list-badge' }, tt(t, 'done')),
                    h('span', { className: 'dtp-list-colon' }, tt(t, 'list.colon')),
                    h('span', { className: 'dtp-list-label', title: step.label }, step.label),
                    h('span', { className: 'dtp-list-meta' }, meta.join(' · ')),
                  )
                }),
              )
              : null,
          ),
        )
      }
    }

    /**
     * The ring beside the session row's time label.
     * @param sessions - client sessions service (list store).
     * @param useJudgements - hook over the evaluator store.
     */
    function makeRowTrailing(sessions, useJudgements, useStyle, useSimple) {
      return function RowTrailing(props) {
        const t = props.t
        const judgements = useJudgements()
        // Hooks stay above every early return (the row mounts only for some
        // sessions), so the ring can reuse the same appearance overrides.
        const local = useStyle()
        const simpleSettings = useSimple()
        const state = React.useSyncExternalStore(
          listener => sessions.list.subscribe(listener),
          () => sessions.list.getSnapshot(),
        )
        const summary = state !== null && state !== undefined && state.byId !== undefined
          ? state.byId[props.sessionId]
          : undefined
        if (summary === undefined || summary === null) return null
        if (summary.blank === true || summary.running !== true) return null
        if (summary.parentSessionId !== undefined || summary.origin === 'subagent') return null
        const live = state.projectionsBySession !== undefined && state.projectionsBySession[props.sessionId] !== undefined
          ? state.projectionsBySession[props.sessionId].values
          : undefined
        const raw = live !== undefined && live.taskProgress !== undefined
          ? live.taskProgress
          : summary.projectionValues !== undefined ? summary.projectionValues.taskProgress : undefined
        const progress = mergeJudgement(
          raw,
          judgements !== null && judgements !== undefined && judgements.sessions !== null && judgements.sessions !== undefined
            ? judgements.sessions[props.sessionId]
            : undefined,
          Date.now(),
        )
        if (progress === undefined || progress === null || progress.turn === 0) return null
        if (progress.done === true || !(progress.percent >= 0)) return null
        if (simpleTurnOf(progress, Date.now(), simpleSettings)) return null
        const percent = progress.percent
        // The ring follows the same configured color as the composer bar.
        const tuned = resolveStyle(
          judgements !== null && judgements !== undefined ? judgements.style : null,
          local,
        )
        const size = 13
        const stroke = 2.25
        const radius = (size - stroke) / 2
        const length = 2 * Math.PI * radius
        const tip = progress.milestone === ''
          ? tt(t, `phase.${progress.phase}`)
          : `${tt(t, `phase.${progress.phase}`)} · ${progress.milestone}`
        return withTooltip(tip + ' · ' + percent + '%', h(
          'span',
          {
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              marginInlineStart: '6px',
              color: 'var(--dsw-alias-label-tertiary)',
              fontSize: '11px',
              lineHeight: '14px',
              fontVariantNumeric: 'tabular-nums',
              ...(tuned.explicitColor ? { '--dtp-bar-color': tuned.barColor } : {}),
            },
          },
          h(
            'svg',
            { width: size, height: size, viewBox: `0 0 ${size} ${size}`, 'aria-hidden': true, style: { display: 'block' } },
            h('circle', {
              cx: size / 2, cy: size / 2, r: radius, fill: 'none',
              stroke: 'currentColor', strokeOpacity: 0.22, strokeWidth: stroke,
            }),
            h('circle', {
              cx: size / 2, cy: size / 2, r: radius, fill: 'none',
              stroke: 'var(--dtp-bar-color,var(--dsw-alias-state-business-primary))', strokeWidth: stroke, strokeLinecap: 'round',
              strokeDasharray: `${length} ${length}`,
              strokeDashoffset: length * (1 - percent / 100),
              transform: `rotate(-90 ${size / 2} ${size / 2})`,
              style: { transition: 'stroke-dashoffset .4s ease' },
            }),
          ),
          h('span', null, `${percent}%`),
        ))
      }
    }

    /** Settings-section styles, mirroring the host's row rhythm. */
    const SETTINGS_CSS = [
      '.dtp-set{display:flex;flex-direction:column;width:100%;max-width:680px;color:var(--dsw-alias-label-primary);}',
      '.dtp-set-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 0 2px;}',
      '.dtp-set-heading{margin:0;font-size:16px;font-weight:600;line-height:24px;}',
      '.dtp-set-version{flex:none;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;}',
      '.dtp-set-lead{margin:0 0 8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}',
      '.dtp-set-row{display:flex;align-items:center;gap:8px;padding:14px 0;',
      'border-bottom:0.5px solid var(--dsw-alias-border-l2);}',
      '.dtp-set-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;padding-right:24px;}',
      '.dtp-set-title{font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);}',
      '.dtp-set-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}',
      '.dtp-set-control{display:flex;align-items:center;gap:6px;flex:none;}',
      '.dtp-set-check{width:16px;height:16px;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer;}',
      '.dtp-simple-card{margin-top:16px;padding:14px 16px;display:flex;flex-direction:column;gap:12px;',
      'border:0.5px solid var(--dsw-alias-border-l2);border-radius:12px;',
      'background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#fff));}',
      '.dtp-simple-card-head{display:flex;flex-direction:column;gap:4px;}',
      '.dtp-simple-card-headline{display:flex;align-items:center;justify-content:space-between;gap:12px;}',
      '.dtp-simple-card-title{font-size:14px;line-height:22px;font-weight:600;color:var(--dsw-alias-label-primary);}',
      '.dtp-switch{position:relative;flex:none;width:36px;height:20px;padding:0;border:0;border-radius:999px;',
      'background:var(--dsw-alias-border-l2);cursor:pointer;transition:background .18s ease;}',
      '.dtp-switch[data-on]{background:#000;}',
      '.dtp-switch-slot{display:inline-flex;flex:none;align-items:center;}',
      '.dtp-switch-slot button[aria-checked="true"]{background:#000;}',
      '.dtp-switch-slot button[aria-checked="true"] span{background:#fff;}',
      '.dtp-switch-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;',
      'background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.28);transition:transform .18s ease;}',
      '.dtp-switch[data-on] .dtp-switch-knob{transform:translateX(16px);}',
      '.dtp-switch:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;}',
      '.dtp-simple-card-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}',
      '.dtp-simple-field{display:flex;align-items:center;justify-content:space-between;gap:16px;}',
      '.dtp-simple-field-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}',
      '.dtp-simple-field-label{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);}',
      '.dtp-simple-field-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}',
      '.dtp-simple-control{display:inline-flex;align-items:center;gap:6px;flex:none;}',
      '.dtp-set-num{width:78px;height:30px;box-sizing:border-box;padding:0 8px;border-radius:8px;',
      'border:0.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);',
      'font:inherit;font-size:13px;font-variant-numeric:tabular-nums;}',
      '.dtp-set-num:focus-visible,.dtp-set-text-input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px;}',
      '.dtp-set-unit{font-size:12px;color:var(--dsw-alias-label-tertiary);}',
      '.dtp-set-color{width:34px;height:30px;padding:2px;border-radius:8px;cursor:pointer;',
      'border:0.5px solid var(--dsw-alias-border-l2);background:transparent;}',
      '.dtp-set-text-input{width:150px;height:30px;box-sizing:border-box;padding:0 8px;border-radius:8px;',
      'border:0.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);',
      'font:inherit;font-size:13px;}',
      '.dtp-set-preview{display:flex;flex-direction:column;gap:4px;padding:14px 0;',
      'border-bottom:0.5px solid var(--dsw-alias-border-l2);}',
      '.dtp-set-track{position:relative;width:100%;border-radius:999px;',
      'background:var(--dsw-alias-interactive-bg-hover);overflow:hidden;}',
      '.dtp-set-fill{position:absolute;inset-block:0;inset-inline-start:0;border-radius:999px;}',
      '.dtp-set-preview-bar{position:relative;display:flex;align-items:center;',
      'padding-block:7px;margin-block:-7px;}',
      '.dtp-set-preview-bar .dtp-set-track{flex:1 1 auto;width:100%;transform-origin:center;',
      'transition:transform .22s cubic-bezier(.2,.7,.3,1),box-shadow .22s ease;}',
      '.dtp-set-preview-bar{transform-origin:center;transition:transform .22s cubic-bezier(.2,.7,.3,1);}',
      '.dtp-set-preview-bar:hover{transform:scale(1.015);}',
      '.dtp-set-preview-bar:hover .dtp-set-track{transform:scaleY(1.5);',
      'box-shadow:0 0 0 2px rgba(255,255,255,.55),0 6px 20px -6px rgba(255,255,255,.9),',
      'inset 0 1px 0 rgba(255,255,255,.6),',
      '0 2px 12px -2px color-mix(in srgb,var(--dtp-bar-color,var(--dsw-alias-state-business-primary)) 40%,transparent);}',
      '.dtp-set-nodes{position:absolute;inset:0;pointer-events:none;}',
      '@media (prefers-reduced-motion:reduce){.dtp-set-preview-bar .dtp-set-track{transition:none}}',
      '.dtp-set-caption{color:var(--dsw-alias-label-secondary);}',
      '.dtp-set-actions{display:flex;justify-content:flex-end;gap:8px;padding-top:14px;}',
      '.dtp-set-btn{height:30px;padding:0 14px;border-radius:8px;cursor:pointer;font:inherit;font-size:13px;',
      'border:0.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);}',
      '.dtp-set-btn:hover:enabled{background:var(--dsw-alias-interactive-bg-hover);}',
      '.dtp-set-btn:disabled{opacity:.45;cursor:default;}',
    ].join('')

    const PANEL_CSS = [
      '.dtp-panel{display:flex;flex-direction:column;gap:10px;height:100%;min-height:100%;',
      'box-sizing:border-box;padding:12px;overflow:auto;font:inherit;line-height:1.5;}',
      '.dtp-panel-head{display:flex;align-items:center;justify-content:space-between;gap:8px;}',
      '.dtp-panel-title{font-weight:600;color:var(--dsw-alias-label-primary);}',
      '.dtp-panel-count{flex:none;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;}',
      '.dtp-cards{display:flex;flex-direction:column;gap:8px;}',
      '.dtp-card{display:flex;gap:9px;padding:9px 10px;border:0.5px solid var(--dsw-alias-border-l1);',
      'border-radius:10px;background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#fff));}',
      '.dtp-card-live{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 45%,var(--dsw-alias-border-l1));',
      'background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 5%,var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#fff)));}',
      '.dtp-card-rail{flex:none;width:16px;display:flex;flex-direction:column;align-items:center;}',
      '.dtp-card-dot{width:8px;height:8px;margin-top:5px;border-radius:50%;',
      'background:var(--dsw-alias-state-success-primary,#16a34a);',
      'box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-success-primary,#16a34a) 18%,transparent);}',
      '.dtp-card-live .dtp-card-dot{background:var(--dsw-alias-state-business-primary);',
      'box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary) 18%,transparent);}',
      '.dtp-card-line{flex:1;width:1px;min-height:10px;margin-top:3px;background:var(--dsw-alias-border-l1);}',
      '.dtp-card-body{flex:1;min-width:0;}',
      '.dtp-card-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}',
      '.dtp-card-index{color:var(--dsw-alias-label-tertiary);font-size:.85em;font-variant-numeric:tabular-nums;}',
      '.dtp-card-badge{padding:0 6px;border-radius:999px;font-size:.8em;line-height:1.6;',
      'background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#16a34a) 14%,transparent);',
      'color:var(--dsw-alias-state-success-primary,#16a34a);}',
      '.dtp-card-badge-live{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent);',
      'color:var(--dsw-alias-state-business-primary);}',
      '.dtp-card-duration{margin-inline-start:auto;color:var(--dsw-alias-label-tertiary);',
      'font-size:.8em;font-variant-numeric:tabular-nums;}',
      '.dtp-card-label{margin-top:3px;color:var(--dsw-alias-label-primary);word-break:break-word;}',
      '.dtp-card-meta{margin-top:2px;color:var(--dsw-alias-label-tertiary);font-size:.85em;}',
      '.dtp-panel-empty{padding:18px 4px;text-align:center;color:var(--dsw-alias-label-tertiary);}',
    ].join('')

    const FOOTER_CSS = [
      '.dtp-footer-action{flex:none;width:28px;height:28px;padding:6px;border:0;',
      'border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);',
      'cursor:pointer;display:inline-flex;align-items:center;justify-content:center;}',
      '.dtp-footer-action:hover{background:var(--dsw-alias-interactive-bg-hover);',
      'color:var(--dsw-alias-label-secondary);}',
      '.dtp-footer-action:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);',
      'outline-offset:1px;}',
      '.dtp-footer-action svg{width:17px;height:17px;}',
    ].join('')

    /**
     * The Settings section: four rows plus a live preview.
     * @param store - appearance override store (set/reset).
     * @param useStyle - hook over the overrides.
     * @param useJudgements - hook over the evaluator store (carries the Host config).
     */
    function makeSettingsPage(store, useStyle, useJudgements, simpleStore, useSimple) {
      return function TaskProgressSettings(props) {
        const t = props.t
        const [hoveredPreview, setHoveredPreview] = React.useState(null)
        const local = useStyle()
        const judgements = useJudgements()
        const simple = useSimple()
        const tuned = resolveStyle(
          judgements !== null && judgements !== undefined ? judgements.style : null,
          local,
        )
        const version = judgements !== null && judgements !== undefined && typeof judgements.version === 'string' ? judgements.version : ''
        const overridden = Object.keys(local !== null && local !== undefined ? local : {}).length > 0 || simpleStore.overridden()
        const commitNumber = (key, min, max) => event => {
          const parsed = Math.round(Number(event.target.value))
          const value = Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : 0
          store.set({ [key]: value })
        }
        const commitColor = event => store.set({ barColor: String(event.target.value).slice(0, 40) })
        const blurOnEnter = event => { if (event.key === 'Enter') event.currentTarget.blur() }
        const color = tuned.barColor === '' ? 'var(--dsw-alias-state-business-primary)' : tuned.barColor
        const row = (title, desc, control) => h('div', { className: 'dtp-set-row', key: title },
          h('div', { className: 'dtp-set-text' },
            h('div', { className: 'dtp-set-title' }, title),
            h('div', { className: 'dtp-set-desc' }, desc),
          ),
          h('div', { className: 'dtp-set-control' }, control),
        )
        const previewDuration = seconds => tt(t, 'duration.minSec', { m: Math.floor(seconds / 60), s: seconds % 60 })
        const previewNode = (index, left, live) => {
          const key = `preview-${index}`
          const active = hoveredPreview === key
          const label = tt(t, live ? 'settings.preview.live' : 'settings.preview.done')
          const elapsed = previewDuration(live ? 65 : 130)
          const meta = live
            ? `${tt(t, 'phase.execute')} · ${tt(t, 'step.elapsed', { t: elapsed })}`
            : `${tt(t, 'phase.execute')} · ${tt(t, 'step.duration', { t: elapsed })} · ${tt(t, 'step.finished', { t: '14:32' })}`
          return h(
            'button',
            {
              key,
              type: 'button',
              className: live ? 'dtp-node dtp-node-current' : 'dtp-node',
              style: { left },
              'aria-label': tt(t, 'step.node', { n: index, x: label, t: elapsed }),
              onMouseDown: event => event.preventDefault(),
              onMouseEnter: () => setHoveredPreview(key),
              onMouseLeave: () => setHoveredPreview(value => (value === key ? null : value)),
              onFocus: () => setHoveredPreview(key),
              onBlur: () => setHoveredPreview(value => (value === key ? null : value)),
            },
            h('span', { className: 'dtp-node-dot' }),
            active
              ? h(
                'span',
                { className: 'dtp-tip', role: 'tooltip' },
                h(
                  'span',
                  { className: 'dtp-tip-head' },
                  h('span', null, tt(t, 'step.index', { n: index })),
                  h('span', { className: live ? 'dtp-tip-badge dtp-tip-badge-live' : 'dtp-tip-badge' }, tt(t, live ? 'step.running' : 'done')),
                ),
                h('span', { className: 'dtp-tip-main' }, label),
                live ? h('span', { className: 'dtp-tip-sub' }, tt(t, 'progress.next', { x: tt(t, 'settings.preview.next') })) : null,
                h('span', { className: 'dtp-tip-meta' }, meta),
              )
              : null,
          )
        }
        return h(
          React.Fragment,
          null,
          h('style', { key: 'dtp-set-style' }, DOCK_CSS + SETTINGS_CSS),
          h('div', { className: 'dtp-set' },
            h('div', { className: 'dtp-set-head' },
              h('h2', { className: 'dtp-set-heading' }, tt(t, 'settings.title')),
              version === '' ? null : h('span', { className: 'dtp-set-version' }, 'v' + version),
            ),
            h('p', { className: 'dtp-set-lead' }, tt(t, 'settings.lead')),
            row(tt(t, 'settings.height'), tt(t, 'settings.height.desc'), [
              h('input', {
                key: `h${tuned.barHeight}`, className: 'dtp-set-num', type: 'number',
                min: 2, max: 24, step: 1, defaultValue: tuned.barHeight,
                'aria-label': tt(t, 'settings.height'),
                onBlur: commitNumber('barHeight', 2, 24), onKeyDown: blurOnEnter,
              }),
              h('span', { key: 'u', className: 'dtp-set-unit' }, 'px'),
            ]),
            row(tt(t, 'settings.color'), tt(t, 'settings.color.desc'), [
              h('input', {
                key: 'swatch', className: 'dtp-set-color', type: 'color',
                value: /^#[0-9a-fA-F]{6}$/u.test(tuned.barColor) ? tuned.barColor : '#2f6df6',
                'aria-label': tt(t, 'settings.color'),
                onChange: event => store.set({ barColor: event.target.value }),
              }),
              h('input', {
                key: `c${tuned.barColor}`, className: 'dtp-set-text-input', type: 'text', spellCheck: false,
                defaultValue: tuned.barColor, placeholder: tt(t, 'settings.color.auto'),
                'aria-label': tt(t, 'settings.color.value'),
                onBlur: commitColor, onKeyDown: blurOnEnter,
              }),
            ]),
            row(tt(t, 'settings.font'), tt(t, 'settings.font.desc'), [
              h('input', {
                key: `f${tuned.textFontSize}`, className: 'dtp-set-num', type: 'number',
                min: 9, max: 24, step: 1, defaultValue: tuned.textFontSize,
                'aria-label': tt(t, 'settings.font'),
                onBlur: commitNumber('textFontSize', 9, 24), onKeyDown: blurOnEnter,
              }),
              h('span', { key: 'u', className: 'dtp-set-unit' }, 'px'),
            ]),
            row(tt(t, 'settings.listFont'), tt(t, 'settings.listFont.desc'), [
              h('input', {
                key: `l${tuned.listFontSize}`, className: 'dtp-set-num', type: 'number',
                min: 9, max: 24, step: 1, defaultValue: tuned.listFontSize,
                'aria-label': tt(t, 'settings.listFont'),
                onBlur: commitNumber('listFontSize', 9, 24), onKeyDown: blurOnEnter,
              }),
              h('span', { key: 'u', className: 'dtp-set-unit' }, 'px'),
            ]),
            h('div', { className: 'dtp-set-preview' },
              h(
                'div',
                { className: 'dtp-set-preview-bar', style: { '--dtp-bar-color': color } },
                h('div', { className: 'dtp-set-track', style: { height: `${tuned.barHeight}px` } },
                  h('div', {
                    className: 'dtp-set-fill',
                    style: { width: '74%', background: color },
                  }),
                ),
                h('div', { className: 'dtp-set-nodes' },
                  previewNode(0, '33.33%', false),
                  previewNode(1, '74%', true),
                ),
              ),
              h('div', { className: 'dtp-set-caption', style: { fontSize: `${tuned.textFontSize}px` } },
                tt(t, 'settings.preview')),
            ),
            h('div', { className: 'dtp-simple-card', key: 'simple-card' },
              h('div', { className: 'dtp-simple-card-head' },
                h('div', { className: 'dtp-simple-card-headline' },
                  h('div', { className: 'dtp-simple-card-title' }, tt(t, 'settings.simple')),
                  h('span', { className: 'dtp-switch-slot' },
                    DshSwitch !== null
                      ? h(DshSwitch, {
                        checked: simple.mode === 'auto',
                        onChange: next => simpleStore.set({ mode: next ? 'auto' : 'off' }),
                        label: tt(t, 'settings.simple'),
                      })
                      : h('button', {
                        type: 'button', role: 'switch', className: 'dtp-switch',
                        'aria-checked': simple.mode === 'auto',
                        'aria-label': tt(t, 'settings.simple'),
                        'data-on': simple.mode === 'auto' ? '' : undefined,
                        onClick: () => simpleStore.set({ mode: simple.mode === 'auto' ? 'off' : 'auto' }),
                      }, h('span', { className: 'dtp-switch-knob' })),
                  ),
                ),
                h('div', { className: 'dtp-simple-card-desc' }, tt(t, 'settings.simple.desc')),
              ),
              h('div', { className: 'dtp-simple-field' },
                h('div', { className: 'dtp-simple-field-text' },
                  h('div', { className: 'dtp-simple-field-label' }, tt(t, 'settings.simple.seconds')),
                  h('div', { className: 'dtp-simple-field-desc' }, tt(t, 'settings.simple.seconds.desc')),
                ),
                h('span', { className: 'dtp-simple-control' },
                  h('input', {
                    key: 'ss' + simple.seconds, className: 'dtp-set-num', type: 'number',
                    min: 1, max: 3600, step: 1, defaultValue: simple.seconds,
                    'aria-label': tt(t, 'settings.simple.seconds'),
                    onBlur: event => {
                      const parsed = Math.round(Number(event.target.value))
                      simpleStore.set({ seconds: Number.isFinite(parsed) ? Math.min(3600, Math.max(1, parsed)) : 30 })
                    },
                    onKeyDown: blurOnEnter,
                  }),
                  h('span', { className: 'dtp-set-unit' }, tt(t, 'settings.simple.unit.sec')),
                ),
              ),
              h('div', { className: 'dtp-simple-field' },
                h('div', { className: 'dtp-simple-field-text' },
                  h('div', { className: 'dtp-simple-field-label' }, tt(t, 'settings.simple.chars')),
                  h('div', { className: 'dtp-simple-field-desc' }, tt(t, 'settings.simple.chars.desc')),
                ),
                h('span', { className: 'dtp-simple-control' },
                  h('input', {
                    key: 'sc' + simple.chars, className: 'dtp-set-num', type: 'number',
                    min: 0, max: 100000, step: 50, defaultValue: simple.chars,
                    'aria-label': tt(t, 'settings.simple.chars'),
                    onBlur: event => {
                      const parsed = Math.round(Number(event.target.value))
                      simpleStore.set({ chars: Number.isFinite(parsed) ? Math.min(100000, Math.max(0, parsed)) : 1200 })
                    },
                    onKeyDown: blurOnEnter,
                  }),
                  h('span', { className: 'dtp-set-unit' }, tt(t, 'settings.simple.unit.chars')),
                ),
              ),
            ),
            h('div', { className: 'dtp-set-actions' },
              h('button', {
                type: 'button', className: 'dtp-set-btn', disabled: !overridden,
                onClick: () => { store.reset(); simpleStore.reset() },
              }, tt(t, 'settings.reset')),
            ),
          ),
        )
      }
    }

    /** The right Sidebar tab: every node of the completed turn as a card, in time order. */
    function makeNodePanel(useJudgements, sessions) {
      return function NodePanel(props) {
        const t = props.t
        const sessionId = props.sessionId
        const judgements = useJudgements()
        const state = React.useSyncExternalStore(
          listener => (sessions !== null && sessions !== undefined && sessions.list !== null
            && sessions.list !== undefined && typeof sessions.list.subscribe === 'function'
            ? sessions.list.subscribe(listener)
            : () => {}),
          () => (sessions !== null && sessions !== undefined && sessions.list !== null
            && sessions.list !== undefined && typeof sessions.list.getSnapshot === 'function'
            ? sessions.list.getSnapshot()
            : undefined),
        )
        const rail = sessionId !== undefined && judgements !== null && judgements !== undefined
          && judgements.rails !== null && judgements.rails !== undefined
          ? judgements.rails[sessionId]
          : undefined
        const summary = state !== null && state !== undefined && state.byId !== undefined
          ? state.byId[sessionId]
          : undefined
        const current = state !== null && state !== undefined && state.projectionsBySession !== undefined
          && state.projectionsBySession[sessionId] !== undefined
          ? state.projectionsBySession[sessionId].values
          : undefined
        const raw = current !== undefined && current.taskProgress !== undefined
          ? current.taskProgress
          : summary !== undefined && summary.projectionValues !== undefined
            ? summary.projectionValues.taskProgress
            : undefined
        const progress = mergeJudgement(
          raw,
          judgements !== null && judgements !== undefined && judgements.sessions !== undefined
            ? judgements.sessions[sessionId]
            : undefined,
          Date.now(),
        )
        // The Host closes the last node on its next sweep; the completed
        // turn's card should not read "in progress" in the meantime.
        const done = progress !== undefined && progress !== null && progress.done === true
          && rail !== null && rail !== undefined && progress.turn === rail.turn
        const doneAt = done ? (progress.updatedAt > 0 ? progress.updatedAt : Date.now()) : 0
        const steps = rail !== null && rail !== undefined && Array.isArray(rail.steps)
          ? rail.steps.filter(step => step !== null && typeof step === 'object')
          : []
        const cards = steps.map((step, index) => {
          const closed = step.endedAt > 0
          const live = !closed && !done
          const ended = closed ? step.endedAt : (done ? Math.max(step.at, doneAt) : 0)
          const took = closed ? step.durationMs : (live ? Math.max(0, Date.now() - step.at) : Math.max(0, ended - step.at))
          const meta = [tt(t, `phase.${step.phase}`)]
          if (!live) {
            const finished = timeText(ended)
            if (finished !== '') meta.push(tt(t, 'step.finished', { t: finished }))
          }
          return h(
            'div',
            { className: live ? 'dtp-card dtp-card-live' : 'dtp-card', key: `card-${index}` },
            h(
              'div',
              { className: 'dtp-card-rail' },
              h('span', { className: 'dtp-card-dot' }),
              h('span', { className: 'dtp-card-line' }),
            ),
            h(
              'div',
              { className: 'dtp-card-body' },
              h(
                'div',
                { className: 'dtp-card-head' },
                h('span', { className: 'dtp-card-index' }, tt(t, 'step.index', { n: index })),
                h(
                  'span',
                  { className: live ? 'dtp-card-badge dtp-card-badge-live' : 'dtp-card-badge' },
                  tt(t, live ? 'step.running' : 'done'),
                ),
                h(
                  'span',
                  { className: 'dtp-card-duration' },
                  live
                    ? tt(t, 'step.elapsed', { t: durationText(t, took) })
                    : tt(t, 'step.duration', { t: durationText(t, took) }),
                ),
              ),
              h('div', { className: 'dtp-card-label' }, step.label),
              h('div', { className: 'dtp-card-meta' }, meta.join(' · ')),
            ),
          )
        })
        return h(
          React.Fragment,
          null,
          h('style', { key: 'dtp-panel-style' }, PANEL_CSS),
          h(
            'div',
            { className: 'dtp-panel' },
            h(
              'div',
              { className: 'dtp-panel-head' },
              h('span', { className: 'dtp-panel-title' }, tt(t, 'tab.heading')),
              h('span', { className: 'dtp-panel-count' }, tt(t, 'tab.count', { n: steps.length })),
            ),
            steps.length === 0
              ? h('div', { className: 'dtp-panel-empty' }, tt(t, 'tab.empty'))
              : h('div', { className: 'dtp-cards' }, cards),
          ),
        )
      }
    }

    /** The tab chip's icon and label. */
    function NodeTabTitle(props) {
      return h(
        'span',
        { style: { display: 'inline-flex', alignItems: 'center', gap: '5px', minWidth: 0 } },
        h(ProgressGlyph, { size: 14 }),
        h('span', null, tt(props.t, 'tab.title')),
      )
    }

    /** The section icon in DSH Settings, addressed by the matching settings.section id. */
    function SettingsIcon(props) {
      const size = props !== null && props !== undefined && Number.isFinite(Number(props.size))
        ? Number(props.size) : 16
      return h(ProgressGlyph, {
        size,
        className: props !== null && props !== undefined ? props.className : undefined,
      })
    }

    /**
     * The progress glyph in a completed turn's action row. It is shown only
     * after the reply is final, only on the latest turn, and sits after the
     * context action and before the branch action (a high slot order).
     */
    function makeFooterNodeAction(useJudgements, sessions, openNodes, useSimple) {
      return function FooterNodeAction(props) {
        const t = props.t
        const sessionId = props.sessionId
        const judgements = useJudgements()
        const state = React.useSyncExternalStore(
          listener => (sessions !== null && sessions !== undefined && sessions.list !== null
            && sessions.list !== undefined && typeof sessions.list.subscribe === 'function'
            ? sessions.list.subscribe(listener)
            : () => {}),
          () => (sessions !== null && sessions !== undefined && sessions.list !== null
            && sessions.list !== undefined && typeof sessions.list.getSnapshot === 'function'
            ? sessions.list.getSnapshot()
            : undefined),
        )
        const simpleSettings = useSimple()
        const [turn, setTurn] = React.useState(null)
        const anchor = React.useCallback(node => {
          if (node === null || node === undefined) return
          const holder = typeof node.closest === 'function' ? node.closest('[data-turn-tail]') : null
          setTurn(holder !== null ? holder.getAttribute('data-turn-tail') : null)
        }, [])
        const summary = state !== null && state !== undefined && state.byId !== undefined
          ? state.byId[sessionId]
          : undefined
        const live = state !== null && state !== undefined && state.projectionsBySession !== undefined
          && state.projectionsBySession[sessionId] !== undefined
          ? state.projectionsBySession[sessionId].values
          : undefined
        const raw = live !== undefined && live.taskProgress !== undefined
          ? live.taskProgress
          : summary !== undefined && summary.projectionValues !== undefined
            ? summary.projectionValues.taskProgress
            : undefined
        const progress = mergeJudgement(
          raw,
          judgements !== null && judgements !== undefined && judgements.sessions !== undefined
            ? judgements.sessions[sessionId]
            : undefined,
          Date.now(),
        )
        const simple = sessionId !== undefined && progress !== undefined && progress !== null
          && simpleTurnOf(progress, Date.now(), simpleSettings)
        const known = sessionId !== undefined && progress !== undefined && progress !== null
          && progress.done === true && turn !== null && String(turn) === String(progress.turn) && !simple
        return h(
          React.Fragment,
          null,
          h('style', { key: 'dtp-footer-style' }, FOOTER_CSS),
          withTooltip(tt(t, 'footer.view'), h(
            'button',
            {
              key: 'dtp-footer-node',
              ref: anchor,
              type: 'button',
              className: 'dtp-footer-action',
              style: known ? undefined : { display: 'none' },
              'aria-label': tt(t, 'footer.view'),
              onClick: event => {
                event.preventDefault()
                event.stopPropagation()
                openNodes(sessionId)
              },
            },
            h(ProgressGlyph, { size: 17 }),
          ), 'bottom'),
        )
      }
    }

    return {
      inject: ['slots', 'locale', 'sessions', 'sidebarRightTabs', 'sidebarRight', 'layout'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICT), 'dsh-task-progress: dictionaries')
        const judgements = createJudgementStore(JUDGE_URL)
        const useJudgements = () => React.useSyncExternalStore(judgements.subscribe, judgements.getSnapshot)
        const styleStore = createStyleStore()
        const useStyle = () => React.useSyncExternalStore(styleStore.subscribe, styleStore.getSnapshot)
        const simpleStore = createSimpleStore()
        const useSimple = () => React.useSyncExternalStore(simpleStore.subscribe, simpleStore.getSnapshot)
        // Keep the Host sweep in step with the Settings thresholds from the first
        // render on, so a simple turn never spends an evaluation token.
        syncSimpleSettings(simpleStore.getSnapshot())
        const t = typeof ctx.locale.bind === 'function' ? ctx.locale.bind(NS) : (key, params) => tt(null, key, params)
        const ProgressDock = makeProgressDock(useJudgements, useStyle, useSimple)
        const RowTrailing = makeRowTrailing(ctx.sessions, useJudgements, useStyle, useSimple)
        const SettingsPage = makeSettingsPage(styleStore, useStyle, useJudgements, simpleStore, useSimple)
        const NodePanel = makeNodePanel(useJudgements, ctx.sessions)
        const openNodePanel = sessionId => {
          try { ctx.layout.openRightbar(true, false) } catch {}
          let attempts = 0
          const tryOpen = () => {
            try { ctx.sidebarRight.openTabIn(sessionId, 'task-progress', {}) } catch {}
            attempts += 1
            const tabs = ctx.sidebarRight.openTabs !== undefined
              && typeof ctx.sidebarRight.openTabs.getSnapshot === 'function'
              ? ctx.sidebarRight.openTabs.getSnapshot()
              : []
            const opened = Array.isArray(tabs) && tabs.some(tab => tab !== null && tab !== undefined
              && tab.sessionId === sessionId && tab.kind === 'task-progress')
            if (!opened && attempts < 6) setTimeout(tryOpen, 120)
          }
          tryOpen()
        }
        const FooterNodeAction = makeFooterNodeAction(useJudgements, ctx.sessions, openNodePanel, useSimple)
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'task-progress',
          order: 10,
          locale: NS,
        }, ProgressDock))
        ctx.slots.inject('sidebar.session.row.trailing', () => ctx.slots.register({
          name: 'sidebar.session.row.trailing',
          id: 'task-progress',
          order: 50,
          locale: NS,
        }, RowTrailing))
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'task-progress',
          order: 60,
          label: () => tt(null, 'settings.title'),
          locale: NS,
        }, SettingsPage))
        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: 'task-progress',
          kind: 'task-progress',
          title: () => tt(t, 'tab.title'),
          keepMounted: true,
        }), 'dsh-task-progress: node tab type')
        ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: 'task-progress',
          locale: NS,
          inject: sessionId => ({ sessionId }),
        }, NodePanel))
        ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab.title',
          key: 'task-progress',
          locale: NS,
        }, NodeTabTitle))
        ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
          name: 'conversation.chat.assistant-actions',
          id: 'task-progress',
          order: 1000,
          locale: NS,
          inject: sessionId => ({ sessionId }),
        }, FooterNodeAction))
        ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon',
          id: 'task-progress',
          order: 60,
          locale: NS,
        }, SettingsIcon))
      },
    }
  },
})
