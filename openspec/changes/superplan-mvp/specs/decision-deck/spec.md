## Purpose

决策能力把调研收敛为可视化的方案对比与用户选型,并将选择结果、理由与未采纳项强制固化到 `decisions.md`,使选型过程可审计、可追溯。

## ADDED Requirements

### Requirement: 决策点升级规则

系统 SHALL 区分对话式澄清与决策点:仅当存在 ≥2 个互斥候选且候选间有可预览差异(代码/架构/UI)时,MUST 升级为卡片选型;纯事实澄清 MUST 使用 `ctx.ui` 对话,不得滥用卡片。

#### Scenario: 互斥方案触发卡片

- **WHEN** 调研收敛出 3 个互斥技术方案且各有架构差异
- **THEN** 系统构建 DecisionPoint(含候选项、推荐项、约束)并发起卡片选型

#### Scenario: 事实澄清不触发卡片

- **WHEN** 仅需确认一个事实性问题(如目标目录)
- **THEN** 系统通过 `ctx.ui` 提问,不发起卡片

### Requirement: 选择结果强制落盘

卡片或 TUI 的选择结果不是最终真相。系统 MUST 在返回后将选中项、用户备注、全部候选、未采纳理由与当前 revision 写入 `decisions.md`;关键决策 MUST 经用户确认后才进入计划阶段。

#### Scenario: 选择回写

- **WHEN** 用户在卡片中选定方案 A 并填写备注
- **THEN** `decisions.md` 记录全部候选、A 为选中项、备注、未采纳项理由、时间与 revision

### Requirement: 卡片工具缺失退化

系统 SHALL 在工作流启动时检测卡片工具可用性。未安装时 MUST 请求用户确认后安装,禁止静默安装;用户拒绝、安装失败或调用失败时 MUST 退化到 `ctx.ui` 选择,工作流不中断,决策记录不丢失,退化原因 MUST 记录到 `timeline.md`。

#### Scenario: 用户拒绝安装

- **WHEN** 卡片工具未安装且用户拒绝安装
- **THEN** 系统退化到 TUI 选择,正常完成决策并记录退化原因

#### Scenario: 卡片调用失败

- **WHEN** 卡片工具调用抛出错误或超时
- **THEN** 系统保留 DecisionPoint,退化到 TUI 重新收集选择,决策记录完整落盘
