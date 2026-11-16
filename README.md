# dsh-task-progress · 会话任务进度

DeepSeek Harness（DSH）插件：在会话里和侧栏上显示「当前任务做到哪一步」。同一次会话里的多个任务会累计到同一条进度条上。

![任务进度](https://img.shields.io/badge/DSH-0.2.2--rc.1-4176e6) ![license](https://img.shields.io/badge/license-MIT-green)

## 功能

| 位置 | 显示 |
| --- | --- |
| 输入框上方（`conversation.input.dock`） | 两行：第一行整条进度条和百分比；第二行阶段、当前里程碑、下一节点、预计剩余时间。宽度跟随会话内容区（宿主共享的 `--dsh-chat-content-width`），拖动宽度控制柄或缩放窗口时一起变化 |
| 会话行上（`sidebar.session.row.trailing`） | 行尾时间旁的小圆环和百分比，颜色与进度条一致；只有「运行中、非空白、非子代理、且有估算」的会话才显示 |

只在会话运行中出现，结束后短暂保留；历史会话和空闲会话不显示。

### 会话累计进度

进度条表示**本次会话累计进度**，不是单个任务的 0–100%：

- 每个已完成的任务占进度条的一等份，当前任务占最后一份。
- 大号百分比是会话累计值；右侧另有一行小字「当前任务 xx%」。
- 还没有已完成任务时，累计值就等于当前任务进度。

已完成任务的节点支持 Tab 聚焦查看详情；历史最多保留最近 **10 个**，更早的从进度条上淡出。被中断的任务（`turn/end` 的 reason 不是 `completed`）会收起进度条，但不留节点——节点只记录真正完成并交付的任务。

## 进度是怎么来的

评估者始终是**该会话自己的模型**，两条通道：

1. **会话内自评工具 `report_progress`**（首选）：`percent`、`phase`（plan / execute / verify / deliver）、`milestone`、可选的 `next`、`eta_min`、`revised`。工具描述里写死了标尺：0 未开始、25 计划确定、50 核心工作完成一半、75 主体完成并在验证、100 已交付并验证。
2. **旁路评估器**（兜底）：模型经常不调这类「遥测」工具，所以当某一轮开着而上次自评已过期时，宿主用该会话当前的模型路由发一次短请求——输入是**只属于当前这一轮**的压缩摘要（用户请求、待办、最近 8 次工具调用、最后一段助手输出、已用分钟数），上限约 900 tokens；输出强制成一行 JSON。结果存在内存，页面每 2 秒从只读路由取一次。

合并优先级：**模型自评（3 分钟内新鲜）> 旁路评估 > 待办比例 > 无**。三者都没有时显示「评估中」和已进行时间，而不是编一个数。

## 安装

方式一（插件管理器）：

```text
plugin_manager action=install_bundle target=D:\DSH-workspace\dsh-task-progress
```

方式二（profile 目录手动安装）：

```bash
cd C:/Users/<you>/.dsh/profiles/desktop
npm install "file:D:/DSH-workspace/dsh-task-progress"
# 再把 "dsh-task-progress" 加进 package.json 的 dsh.profile.bundles，
# 并在 cordis.patch.yml 加一行：
#   - insert:
#       - id: task-progress
#         name: dsh-task-progress
```

安装后重启 DSH 桌面端加载插件。

## 外观配置

**设置 → 任务进度** 里三项，改完立即生效，保存在本机 localStorage：

- 进度条高度：2–24 px，默认 6
- 进度条颜色：任意 CSS 颜色（`#hex`、`rgb()`、`var(--x)`），清空跟随主题强调色；同时用于侧栏圆环和已完成节点
- 说明文字字号：9–24 px，默认 12

优先级：**设置页 > 行配置 > 主题默认**。行配置写在 profile 的 `cordis.patch.yml`：

```yaml
- id: task-progress
  name: dsh-task-progress
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
├─ index.js            Host 半：投影、旁路评估、只读路由
├─ lib/progress.js     进度合并、节点历史、待办兜底
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

## License

MIT
