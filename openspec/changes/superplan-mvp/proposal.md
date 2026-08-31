# superplan-mvp 提案

## Why

Pi 生态里,`pi-design-deck` 擅长可视化选型但不留档案,OpenSpec 擅长规范工件但无交互选型,`pi-plan-mode` 擅长计划安全但不持久化调研成果。三者各自短板导致:调研结论随上下文压缩丢失、选型理由无处可查、长任务跨会话无法恢复。xpi-superplan 把"视觉选型、Markdown 数据主权、持久任务管理、执行防漂移"串成可恢复、可审计、可持续演进的完整工作流。

## What Changes

本 change 从空仓库交付 xpi-superplan 的 MVP,覆盖四段任务流程:

1. **目标探索**:复用 brainstorming/grilling 类对话收敛需求,决策点(≥2 个互斥候选且含可预览差异)升级为 `design_deck` 卡片选型;选择结果经 `tool_result` 钩子兜底捕获并强制回写 `decisions.md`;deck 缺失/拒绝/失败时退化到 `ctx.ui`,不丢决策。
2. **任务构建**:把调研与选型成果落地为 Markdown 优先的文档集(决策/调研/提案/设计/任务),并保留数据层(参考资料/脚本/快照),不只留一个 PLAN.md。
3. **开发执行**:从 `tasks.md` 加载任务,维护持久任务状态;压缩前自动快照(`session_before_compact`),新会话仅从少量核心文件恢复;阶段级模型配置(规划/执行/审核)+ 用户手动触发的任务级升降档,不做自动路由。
4. **归档演进**:归档后父档案只读;后续修改通过 child workflow 挂父链,父档案永不被改写。

横切合同:所有写入校验 workflow id/path、原子写入(临时文件+rename)、历史 revision 不可覆盖、操作记录 timeline、返回有界摘要。

## Capabilities

### New Capabilities

- `workflow-archive`: 工作流档案的创建、读取、原子写入、revision 快照、timeline 记录与跨会话恢复。
- `decision-deck`: 决策点建模、`design_deck` 检测与 Deck JSON 适配、选择结果捕获回写、TUI 退化路径。
- `spec-artifacts`: OpenSpec 风格工件(proposal/design/tasks/decisions)的模板生成与完整性校验,OpenSpec CLI 可选适配。
- `plan-execution`: 任务状态机、依赖与验收校验、暂停/恢复、压缩前快照、阶段模型校验与手动升降档。
- `archive-lifecycle`: 不可变归档、归档索引、child workflow 创建与父子链。

### Modified Capabilities

(无,本仓库无既有 specs。)

## Impact

- **代码**:`src/` 从 stub 扩展为 `domain/ archive/ artifacts/ deck/ openspec/ plan/ model/ commands/` 模块结构;入口 `src/index.ts` 注册命令与钩子。
- **依赖**:不新增运行时硬依赖;`pi-design-deck`、`pi-plan-mode`、OpenSpec CLI 均为可选能力,缺失时退化,fail-closed。
- **用户数据**:默认写入项目内 `.pi/superplan/workflows/<date>-<slug>/`,遵守 Project Trust;档案纳入 Git;密钥与敏感数据不写入。
- **Pi API 约束**:工具只能由模型调用,扩展通过 `sendMessage` 指令 + `tool_result` 钩子编排 deck;模型切换用 `setModel`,跨供应商不兼容时新建会话交接。
