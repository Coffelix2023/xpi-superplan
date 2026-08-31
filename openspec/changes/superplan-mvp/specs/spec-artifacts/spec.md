## Purpose

工件能力把已确认的决策与调研映射为 OpenSpec 风格、语义自解释的 Markdown 文档集,并对文档集做完整性校验,保证进入执行阶段的计划是可验收、可验证的。

## ADDED Requirements

### Requirement: 文档集生成

系统 SHALL 从决策记录与调研结论生成 `proposal.md`(背景/目标/范围/非目标/风险)、`design.md`(架构/接口/数据流/失败处理)、`tasks.md`(有序任务/依赖/验收标准/验证命令)。需求描述 MUST 使用 SHALL 语义,行为场景 MUST 使用 WHEN/THEN 格式。

#### Scenario: 从决策生成文档集

- **WHEN** 关键决策已确认且用户批准进入计划阶段
- **THEN** 系统生成三份文档,每项任务含输入、输出、依赖、验收标准与验证命令

### Requirement: 完整性校验

系统 SHALL 校验文档集:缺必需文档、任务重复、任务无验收标准、依赖成环时 MUST 校验失败并给出可读诊断,不进入执行状态。

#### Scenario: 依赖成环

- **WHEN** `tasks.md` 中任务 A 依赖 B 且 B 依赖 A
- **THEN** 校验失败,报告成环任务链

#### Scenario: 任务缺验收标准

- **WHEN** 某任务缺少验收标准或验证命令
- **THEN** 校验失败并指出具体任务

### Requirement: OpenSpec CLI 可选适配

系统 SHALL 检测本机 OpenSpec CLI;可用时提供 verify/archive 适配入口,不可用时 MUST 执行本地 Markdown/README 校验。OpenSpec CLI MUST NOT 成为运行时硬依赖。

#### Scenario: CLI 不存在

- **WHEN** 本机无 OpenSpec CLI
- **THEN** 系统执行本地校验并提示适配功能不可用,工作流不受影响
