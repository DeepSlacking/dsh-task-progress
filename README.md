# dsh-task-progress · 会话任务进度

中文 · [English](README.en.md)

DeepSeek Harness（DSH）插件：在会话里和侧栏上显示「当前任务做到哪一步」。同一轮里模型每换一个节点，上一个节点就在进度条上留一个节点，悬停可看详情与耗时。

![任务进度](https://img.shields.io/badge/DSH-0.2.2--rc.1-4176e6) ![license](https://img.shields.io/badge/license-MIT-green)

## 功能

| 位置 | 显示 |
| --- | --- |
| 输入框上方（`conversation.input.dock`） | 两行：第一行整条进度条、百分比和本轮节点；第二行阶段、当前节点、下一节点、预计剩余时间。宽度跟随会话内容区（宿主共享的 `--dsh-chat-content-width`），拖动宽度控制柄或缩放窗口时一起变化 |
| 会话行上（`sidebar.session.row.trailing`） | 行尾时间旁的小圆环和百分比，颜色与进度条一致；只有「运行中、非空白、非子代理、且有估算」的会话才显示 |

只在会话运行中出现，结束后短暂保留；历史会话和空闲会话不显示。

### 本轮节点

进度条的大号百分比是**当前这一轮任务**的 0–100%，节点只属于这一轮，不记录前面几轮会话：

- 模型自评或旁路评估每给出一个新的「当前节点」，上一个节点就算完成，在它最后一次被看到的百分比处留一个实心节点。
- 当前节点是落在进度条当前百分比处的空心节点；悬停显示内容、阶段、已用时间和「下一步」。
- 已完成节点悬停显示：第几个节点、节点内容、阶段、完成时刻，以及**这一段耗时**（从它出现到被下一个节点替换）。
- 鼠标移到进度条上会纵向放大并带光晕，节点共用这个热区；节点也支持 Tab 聚焦查看详情。
- 本轮最多保留最近 **10 个**节点，更早的从轨道上淡出。
- 节点编号从 **0** 开始：第一个完成的节点是「节点 0」，当前节点排在其后。
- 同一位置附近有多个节点时会左右错开，保证每一个都能悬停查看。
- 节点位置取该节点最后一次被看到时的百分比。已完成节点只在当前填充范围内显示：如果评估把百分比下调，超出当前填充的节点会暂时隐藏，等进度追上再出现。

轨道由宿主在旁路评估器的内存里维护（每 15 秒观察一次有效节点），刷新页面后节点仍在；换到下一轮时自动清空。一轮结束时最后一个节点会在 `turn/end` 处收尾，并短暂保留。

## 进度是怎么来的

评估者始终是**该会话自己的模型**，两条通道：

1. **会话内自评工具 `report_progress`**（首选）：`percent`、`phase`（plan / execute / verify / deliver）、`milestone`、可选的 `next`、`eta_min`、`revised`。工具描述里写死了标尺：0 未开始、25 计划确定、50 核心工作完成一半、75 主体完成并在验证、100 已交付并验证。
2. **旁路评估器**（兜底）：模型经常不调这类「遥测」工具，所以当某一轮开着而上次自评已过期时，宿主用该会话当前的模型路由发一次短请求——输入是**只属于当前这一轮**的压缩摘要（用户请求、待办、最近 8 次工具调用、最后一段助手输出、已用分钟数），上限约 900 tokens；输出强制成一行 JSON。结果存在内存，页面每 2 秒从只读路由取一次；节点轨道也随这个路由下发。

合并优先级：**模型自评（3 分钟内新鲜）> 旁路评估 > 待办比例 > 无**。三者都没有时显示「评估中」和已进行时间，而不是编一个数；节点轨道也按同一优先级取当前正在显示的节点。

摘要按 `turn/start` / `turn/end` 切分，继续会话时不会把上一轮的请求或「下一步」带进新任务。

## 安装

方式一（插件管理器，本地目录）：

```text
plugin_manager action=install_bundle target=D:\\DSH-workspace\\dsh-task-progress
```

方式二（profile 目录手动安装）：

```bash
cd C:/Users/<you>/.dsh/profiles/desktop
npm install "file:D:/DSH-workspace/dsh-task-progress"
# 再把 "@local/dsh-task-progress" 加进 package.json 的 dsh.profile.bundles，
# 并在 cordis.patch.yml 加一行（name 必须与 package.json 的包名一致）：
#   - insert:
#       - id: task-progress
#         name: '@local/dsh-task-progress'
```

发布成独立 npm 包后，把上面的 `@local/dsh-task-progress` 换成实际包名即可。安装后重启 DSH 桌面端加载插件。

## 外观配置

**设置 → 任务进度** 里三项，改完立即生效，保存在本机 localStorage：

- 进度条高度：2–24 px，默认 6
- 进度条颜色：任意 CSS 颜色（`#hex`、`rgb()`、`var(--x)`），清空跟随主题强调色；同时用于侧栏圆环和节点
- 说明文字字号：9–24 px，默认 12

优先级：**设置页 > 行配置 > 主题默认**。行配置写在 profile 的 `cordis.patch.yml`：

```yaml
- id: task-progress
  name: '@local/dsh-task-progress'
  config:
    barHeight: 8
    barColor: '#7c5cff'
    textFontSize: 14
```

其余字段：`enableTool`、`minStep`、`todoBaseline`、`judge`、`judgeIntervalMs`（改完需在「插件」里重载）。也可直接设 CSS 变量 `--dtp-bar-height` / `--dtp-bar-color` / `--dtp-font-size`。

## 目录

```text
dsh-task-progress/
├─ package.json        dsh 清单：bundle patch + client 平台/注入顺序
├─ cordis.patch.yml    一条 insert 宿主行
├─ index.js            Host 半：投影、旁路评估、节点轨道、只读路由
├─ lib/progress.js     进度合并、待办兜底
├─ lib/steps.js        本轮节点轨道的纯 reducer（标签变化 → 关闭上一步）
├─ lib/judge.js        旁路评估摘要与 JSON 契约
├─ client.js           浏览器半：进度条、节点、侧栏圆环、设置页
├─ locale/{zh,en}.json 插件管理器显示用的标题/描述
├─ docs/               详细设计与实现说明
└─ test/               node --test 单元测试
```

## 成本与限制

- 工具 schema 约 150–200 tokens/请求（`minStep` 可调高）。
- 每次旁路评估：输入约 600–900 tokens，输出上限 1.2k（实际几十个），每个运行中的会话最多每 2 分钟一次；模型自评新鲜时完全跳过。
- 百分比是模型的判断而非测量，可能偏乐观；标尺、`revised` 和旁路复核只能缓解。旁路评估只看当前轮摘要，不知道代码细节。
- 节点耗时是**观察区间**（宿主每 15 秒观察一次），分辨率是十几秒；旁路评估换一种措辞描述同一件事时会多出一个内容相近的节点。
- 轨道只存在宿主内存里，DSH 重启后从当前节点重新开始；投影和自评仍在会话日志里。

## 许可

MIT License，Copyright (c) 2026 dsh-task-progress contributors。

本插件在 MIT 许可下自由使用、修改与分发；完整条款见 [LICENSE](LICENSE)。
