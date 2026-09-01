# superplan-mvp 设计

## Context

本仓库是 Pi 扩展(无构建步骤,Pi 直接加载 `src/index.ts`)。探针已验证的 Pi API 事实(pi-coding-agent 0.84.4 类型定义):

- `ExtensionAPI` 无程序化工具调用接口;工具的唯一调用方是模型。
- 可用能力:`getAllTools()`/`getActiveTools()` 检测工具注册;`sendMessage`/`sendUserMessage` 注入指令;`on("tool_result")` 拦截工具返回;`setModel()`/`setThinkingLevel()`;`appendEntry()` 会话持久化;`on("session_before_compact")` 压缩前钩子。
- `pi-design-deck` 返回 `selections: Record<slideId, label>` + notes 的结构化 details。

## Goals / Non-Goals

**Goals:**

- Markdown 档案是唯一真相;任何上下文压缩/会话重启后,仅读 `README.md` + `tasks.md` + 当前任务状态即可恢复。
- deck/plan-mode/OpenSpec CLI 全部可选,核心档案流程零外部依赖。
- 每期交付可冒烟的纵向切片,不做水平分层大提交。

**Non-Goals:**

- 不复制 deck 网页运行时、不复制 plan-mode 状态机、不复制 OpenSpec 命令与目录。
- 不做自动模型路由、逐任务模型编排、向量记忆、后台数据库。
- 不默认自动 `git commit/push/reset`;破坏性 Git 操作遵守 `docs/GIT-WORKFLOW.md` 且需人工确认。

## Decisions

### D1: deck 采用"模型编排 + 扩展兜底"(路径 B)

扩展不直接调用 deck(Pi 无此 API)。流程:扩展备好 `DecisionPoint` JSON → `sendMessage` 指示模型调用 `design_deck` → `on("tool_result")` 拦截返回 → 校验并原子写入 `decisions.md`。

备选:fork pi-design-deck 或 import 其内部模块——拒绝,违反非目标且引入版本耦合。

### D2: plan-mode 降级为可选增强,不做主路径

`plan_mode_question` 契约限定 plan mode 激活时可用,扩展上下文调用不可靠(且同样只能由模型调用)。主路径用 `ctx.ui` 自实现结构化提问;检测到 plan-mode 可用时才桥接。**不维护两套"当前计划"**:superplan 档案是工作流真相,plan-mode 仅是当前会话的计划安全控制器;冲突时以档案为准,恢复时以磁盘 Markdown 重放。

### D3: 档案目录与命名(自解释优先)

```text
.pi/superplan/workflows/<date>-<slug>/
├── README.md        # id/标题/状态/父子/版本/模型(目录入口,人读第一份)
├── decisions.md     # 候选/选择/理由/未采纳
├── research.md      # 调研结论/来源/未决问题
├── proposal.md      # 背景/目标/范围/非目标/风险
├── design.md        # 架构/接口/数据流/失败处理
├── tasks.md         # 有序任务/依赖/验收标准/验证命令
├── timeline.md      # 状态变更/暂停/恢复流水
├── revisions/       # 每次修订的只读快照,不可覆盖
├── references/      # 调研留存(来源/许可证/摘要)
├── scripts/         # 用户确认可复用的脚本
└── assets/          # deck 快照/导出 HTML/图
```

OpenSpec 兼容靠内容语义(SHALL/WHEN/THEN),不靠文件名。

### D4: 写入纪律(横切)

所有写入:校验 workflow id(`<date>-<slug>`,拒绝路径遍历与非法字符)→ 临时文件 + rename 原子写 → 新 revision 快照,不覆盖历史 → 追加 timeline → 返回有界摘要。fail-closed:slug/状态/路径解析失败即拒绝,不误操作其他工作流。

### D5: 模型策略 = 阶段级 + 手动升降档(方案 B)

`README.md` 记录 planningModel/executionModel/reviewModel 及 thinking level。切换前用 Pi 模型目录校验存在性、认证、思考级别;失败则要求用户选可用模型或显式退化,不静默替换。用户可对当前任务手动升降档(命令触发,记录 timeline);不做自动路由。跨供应商工具兼容不可保证时,新建会话并传入 workflow id + revision + `tasks.md` 路径。

### D6: 恢复协议

`appendEntry` 保存 `{workflowId, revision, 当前任务id, 状态}`。恢复/压缩后优先重读 `README.md` + `tasks.md` + 任务状态,不重新注入调研全文。`session_before_compact` 触发任务状态快照落盘——压缩前必落盘是主动机制,不是阈值触发。

### D7: 实施分期(纵向切片)

```text
M1 档案核心     domain 类型 + 档案 CRUD + 原子写 + revision + 恢复
M2 决策闭环     TUI 退化先行 → deck 检测/指令/tool_result 捕获/回写
M3 工件生成     proposal/design/tasks 模板 + 完整性校验
M4 执行恢复     任务状态机 + 暂停/恢复 + 压缩前快照
M5 模型配置     阶段模型校验 + 手动升降档 + plan-mode 可选桥
M6 归档演进     不可变归档 + child workflow + 父子链
M7 质量门禁     单测/集成/冒烟补齐,门禁稳定可重复
```

M2 先做 TUI 退化路径(保底真相),后挂 deck 增强——任何时刻产品完整可用。M3 之后本仓库自身开发改用 superplan 管理(dogfood)。

## Risks / Trade-offs

- [tool_result 中 details.selections 结构未实测] → M2 用一次真实 deck 调用确认;拿不到结构化数据则解析文本返回(格式稳定:"Design deck completed. Selections: ...")。
- [模型可能不调 deck 或漏写档案] → 扩展在 `tool_result`/turn 边界校验"有选择无落盘"并强制补写;档案落盘由扩展保证,不依赖模型自觉。
- [plan-mode 集成价值存疑] → 降级为可选增强,核心路径不依赖;M5 验证后再决定保留与否。
- [`.pi/superplan/` 纳入 Git 可能污染用户仓库] → 提供显式导出到 `docs/` 的入口;是否 gitignore 由用户项目决定,文档说明。
- [阶段模型切换的会话一致性] → 切换失败或跨供应商时新建会话交接,不在原会话硬切。

## Open Questions

- ~~`tool_result` 事件中 deck 返回的 details 是否完整保留 `selections`~~ **已实测确认(2026-08-31, pi 0.84.4 + pi-design-deck)**:完整保留。`CustomToolResultEvent.details` 为 `{ status: "completed", url: string, selections: Record<slideId, optionLabel>, notes?: Record<slideId, note>, finalNotes?: string }`;`content[0].text` 为稳定文本 `"Design deck completed.\n\nSelections:\n- <slideId>: <label>"`,无需文本解析器。注意 `selections` 值是 option **label**(`"<candidateId> <title>"`),回写 decisions.md 时按首个空格拆出 candidateId。
- OpenSpec CLI 的实际可选适配范围(`verify`/`archive` 映射是否值得做,M3 后评估)。
