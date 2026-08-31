## Purpose

归档能力把已完成的工作流固化为只读档案,同时通过 child workflow 机制为后续修改保留显式入口,使产品演进历史成链、可审计。

## ADDED Requirements

### Requirement: 不可变归档

系统 SHALL 支持归档 completed 状态的工作流。归档是状态而非删除;已归档工作流 MUST 保持只读,任何直接修改 MUST 被拒绝。归档时 MUST 生成归档索引并记录 `timeline.md`。

#### Scenario: 归档后拒绝修改

- **WHEN** 用户或系统尝试写入已归档工作流的任何文件
- **THEN** 系统拒绝写入并提示创建 child workflow

### Requirement: child workflow 演进

系统 SHALL 支持从归档工作流创建 child workflow:child 的 `README.md` MUST 记录 `parent: <archived-id>`,仅复制必要的已确认上下文;child 走完整生命周期并可独立归档。系统 SHALL 提供父子链、状态与归档时间的列表视图。

#### Scenario: 创建 child

- **WHEN** 用户从归档卡片选择"创建后续变更"
- **THEN** 系统创建 child workflow,继承必要上下文,生成 revision 1,父档案保持不变

#### Scenario: 父子链可追溯

- **WHEN** 用户查看工作流列表
- **THEN** 系统展示父子关系、各节点状态与归档时间,支持从任意节点恢复审查

### Requirement: 操作幂等

归档、恢复、导出、child 创建等命令 MUST 幂等:重复执行不得覆盖已有快照、不得误操作其他工作流。所有命令 MUST 先解析当前工作流,fail-closed。

#### Scenario: 重复归档

- **WHEN** 对已归档工作流再次执行归档
- **THEN** 系统提示已是归档状态,不产生任何变更
