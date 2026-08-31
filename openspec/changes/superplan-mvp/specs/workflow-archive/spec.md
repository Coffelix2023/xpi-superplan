## Purpose

工作流档案是 xpi-superplan 的唯一真相来源:以 Markdown 文档集 + 数据层的形式持久化每个工作流,保障跨会话、跨上下文压缩的可恢复性与可审计性。

## ADDED Requirements

### Requirement: 工作流档案创建

系统 SHALL 在项目内 `.pi/superplan/workflows/<date>-<slug>/` 创建档案目录,包含 `README.md`、`decisions.md`、`research.md`、`proposal.md`、`design.md`、`tasks.md`、`timeline.md` 及 `revisions/`、`references/`、`scripts/`、`assets/` 子目录。仅在项目受信任(Project Trust)时启用;不受信任时 MUST fail-closed 并提示。

#### Scenario: 正常创建

- **WHEN** 用户在受信任项目中发起新工作流
- **THEN** 系统创建完整目录与最小合法 Markdown,`README.md` 记录 id/标题/状态/版本/模型,并向 `timeline.md` 追加创建记录

#### Scenario: 非法 workflow id

- **WHEN** 请求创建的 id 含路径遍历(`..`、`/`)、非法字符或不符合 `<date>-<slug>` 格式
- **THEN** 系统拒绝创建,不写入任何文件,并返回可读错误

### Requirement: 原子写入与 revision 不可覆盖

所有档案写入 MUST 校验目标路径位于对应工作流目录内,使用临时文件 + rename 原子写入。每次计划修订 MUST 生成新的 `revisions/<n>/` 快照;历史 revision MUST NOT 被覆盖或修改。

#### Scenario: 修订生成新快照

- **WHEN** 已存在 revision 1,用户修订 `tasks.md`
- **THEN** 系统创建 `revisions/2/` 完整快照,更新当前工作副本,revision 1 内容保持不变

#### Scenario: 写入路径越界

- **WHEN** 任何写入目标解析到工作流目录之外
- **THEN** 系统拒绝写入并记录到 `timeline.md`

### Requirement: 跨会话恢复

系统 SHALL 通过 session entry 记录 `{workflowId, revision, 当前任务, 状态}`。恢复时 MUST 仅从 `README.md`、`tasks.md` 与当前任务状态恢复,不依赖原始对话全文。

#### Scenario: 上下文压缩后恢复

- **WHEN** 会话压缩或重启后用户继续工作流
- **THEN** 系统读取 session entry 定位工作流,从磁盘重读核心文件并呈现当前任务与状态

### Requirement: 导出保护

系统 SHALL 支持导出档案到用户指定路径(如 `docs/`);目标已存在时 MUST 默认拒绝覆盖,除非用户显式确认。

#### Scenario: 导出目标已存在

- **WHEN** 用户导出 `proposal.md` 到已存在的 `docs/proposal.md`
- **THEN** 系统拒绝覆盖并请求用户确认或更换路径
