# xpi-superplan

面向 [Pi Coding Agent](https://github.com/earendil-works) 的决策驱动工作流扩展:把**可视化选型、Markdown 档案主权、持久任务管理、执行防漂移**串成一个可恢复、可审计的工作流。

## 它解决什么问题

长任务跨会话/上下文压缩后,调研结论丢失、选型理由无处可查、任务进度不可续。xpi-superplan 用项目内的 Markdown 档案(`.pi/superplan/workflows/<date>-<slug>/`)作为唯一真相:任何重启、压缩之后,只读少量核心文件即可恢复现场。

## 安装

前提:Node.js 22+,pi 0.84.4+。

```bash
pi install git:github.com/Coffelix2023/xpi-superplan
```

Pi 会把仓库克隆到 `~/.pi/agent/git/github.com/Coffelix2023/xpi-superplan/` 并注册为扩展(跟踪默认分支 `main`)。

更新到最新版:

```bash
pi update git:github.com/Coffelix2023/xpi-superplan
```

卸载:

```bash
pi uninstall git:github.com/Coffelix2023/xpi-superplan
```

无需构建——Pi 直接加载 `src/index.ts` TypeScript 源码。不要用软链(`ln -s`)指向本地仓库:软链会让"已安装的版本"与开发中的工作区悄然耦合,正式环境调试时极易忘记摘除,产生难以排查的版本漂移。开发调试请用一次性加载:`pi -e ./src/index.ts`。

## 快速上手

在**受信任的项目**里启动 Pi(`pi -e /path/to/xpi-superplan/src/index.ts`,或装好扩展后直接 `pi`):

### 1. 创建工作流

```
/xpi-superplan create 用户认证重构
```

会在项目内生成:

```
.pi/superplan/workflows/2026-09-01-user-auth/
├── README.md        # 元信息(id/状态/revision/阶段模型),人读第一份
├── decisions.md     # 决策点、候选、选中理由、未采纳项
├── research.md      # 调研结论与来源
├── proposal.md      # 背景/目标/范围/非目标
├── design.md        # 架构/接口/数据流/失败处理
├── tasks.md         # 有序任务 + 验收标准(SHALL) + 验证命令
├── timeline.md      # 全部状态变更流水
└── revisions/1/     # revision 快照,历史不可覆盖
```

同时写入会话锚点(`appendEntry`):上下文压缩前,扩展自动把当前任务状态落盘(`session_before_compact` 钩子),压缩不丢进度。

### 2. 让 agent 在档案上工作

把档案交给会话中的 agent 作为工作合同,典型指令:

> 读取 `.pi/superplan/workflows/<id>/` 下的 README.md 与 tasks.md,按任务推进;重要技术选型先写入 decisions.md 再动手。

工作流约定(状态机,非法跳转会被拒绝):

```
draft → researching → decision_pending → planned → implementing → completed → archived
                                        ↕ paused(可恢复到任意活动状态)
```

- **决策点升级**:≥2 个互斥候选且有可预览差异时,agent 应构建选型卡片(`design_deck`);卡片缺失/失败时退化 `ctx.ui` 终端选择,决策记录不丢。
- **选择强制落盘**:deck 返回后扩展在 `tool_result` 边界校验并回写 `decisions.md`,不依赖模型自觉。
- **任务状态**:agent 改任务状态时写入 `tasks.md` 的 `- 状态:` 行并记 timeline;`failed` 须先回 `pending` 才能重做。
- **阶段模型**(可选):README.md 的 `planningModel/executionModel/reviewModel/thinkingLevel` 字段记录各阶段模型;切换前经模型目录校验(存在性/认证/思考级别),失败即拒绝,不静默替换。

### 3. 暂停与恢复

直接结束会话即可——档案在磁盘,不依赖会话。下次:

```
/xpi-superplan resume                # 恢复最新工作流
/xpi-superplan resume 2026-09-01-user-auth
```

扩展重读 README.md + tasks.md,通知当前状态与下一个待办任务,接着干。

### 4. 查看列表

```
/xpi-superplan list                  # 或 /xpi-superplan(无参数)
```

### 5. 归档与演进

工作流到达 `completed` 后可归档(状态 → `archived`,生成归档索引 `.pi/superplan/archive-index.md`):

- 归档后**只读**:任何写入被拒绝,提示创建 child workflow。
- 后续修改通过 child workflow 挂父链:`README.md` 记录 `parent: <archived-id>`,复制已确认上下文(decisions/research/proposal/design),父档案字节不变。
- 父子链可追溯:从任意节点回溯整条演进链,归档节点带时间戳。

## 数据在哪,怎么处置

- 全部数据在项目内 `.pi/superplan/`,纯 Markdown + 快照,无数据库、无网络写入。
- 是否纳入 Git 由你的项目决定;不想提交就在 `.gitignore` 加一行 `.pi/superplan/`。
- `revisions/` 下的历史快照不可覆盖,误删工作流可从最近快照恢复内容。

## 设计约束(为什么它长这样)

- **档案是唯一真相**:Pi 的 `appendEntry` 会话锚点 + timeline 双写,重启只重放磁盘,不回放会话历史。
- **fail-closed**:workflow id 校验(`<date>-<slug>`,拒绝路径遍历)、状态机拒绝非法跳转、模型校验失败不降级、归档只读。解析不了就拒绝,不误操作别的档案。
- **原子写入**:所有写盘走临时文件 + rename,不留半写状态。
- **外部能力全部可选**:deck、OpenSpec CLI、plan-mode 缺失时退化,核心档案流程零依赖。

## 开发

```bash
pnpm typecheck        # tsc --noEmit
pnpm -w run lint      # biome check .
pnpm test             # vitest run
```

冒烟:`pi -e ./src/index.ts`(一次性加载,不支持热载);日常开发在本仓库工作区直接 `pnpm test` 验证后走提交流程。

## License

MIT
