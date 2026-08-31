# xpi-superplan 计划任务文档

> 基于 `docs/note-01.md`、`docs/PLAN.md` 以及本轮访谈结论整理。  
> 本文档是本次调研与决策的执行计划，不覆盖原有 `docs/PLAN.md` 的预备计划。

## 1. 目标与产品定位

`xpi-superplan` 是一个面向 Pi Coding Agent 的决策驱动工作流扩展，核心目标是把“可视化选型、Markdown 数据主权、持久任务管理、执行防漂移”串成一个可恢复、可审计、可持续演进的流程。

核心定位：

- 用 `pi-design-deck` 做方案对比与用户选型
- 用 Markdown 工作流档案保存最终事实
- 用持久任务与 revision 机制抵抗上下文丢失
- 用浅集成的 `pi-plan-mode` 提升提问质量，但不让它接管执行状态机
- 用 `OpenSpec` 的流程与规范思想约束产物，但保留本项目自己的目录、命名和编排方式

## 2. 已确认决策

以下结论来自本轮访谈，作为后续实现合同：

- 主要用户是**单人作者**，最终拍板权在当前操作者手中
- 产品主隐喻是**控制台**，不是任务软件，也不是纯 TUI
- **Markdown 工作流档案**是最终事实来源
- 恢复依赖**少量核心文件**，不是完整会话历史回放
- 持久化采用**版本化快照**，历史 revision 不可覆盖
- `pi-design-deck` 是主可视化入口
- TUI 仅作为**纯后备**
- `OpenSpec` 只借鉴流程、规范与思想，不复制命令、目录或文件格式
- `pi-plan-mode` 默认集成，但只复用 `plan_mode_question`，属于**浅集成**
- UI 风格以 **shadcn + Tailwind** 为主语气
- Deck 的最终输出应当**推荐明确**，而不是只展示差异

## 3. 非目标

本项目当前明确不做：

- 通用任务管理软件
- 独立 Web / Next.js / FastAPI 平台
- OpenSpec 的复制品
- `pi-design-deck` 的运行时复制
- 让 `pi-plan-mode` 接管执行安全状态机
- 向量记忆、后台数据库、逐任务模型编排作为 MVP
- 纯 TUI 主体验

## 4. 生命周期

目标生命周期如下：

```text
需求
  → 调研
  → Deck 选型
  → 决策记录
  → proposal/spec/design/plan
  → 用户确认
  → 执行
  → 验证
  → 暂停/恢复/修订
  → 归档
```

状态模型：

- `draft`
- `researching`
- `decision_pending`
- `planned`
- `implementing`
- `paused`
- `completed`
- `archived`

## 5. 档案布局

默认工作流目录：

```text
.pi/superplan/workflows/<id>/
  manifest.md
  decision.md
  research.md
  proposal.md
  design.md
  plan.md
  revisions/
  timeline.md
  references/
  assets/
```

说明：

- `manifest.md` 记录 id、标题、状态、父子关系、版本、模型、时间线
- `decision.md` 记录候选、选择、理由、未采纳项
- `research.md` 记录调研结论、来源和待解决问题
- `proposal.md` 记录背景、目标、范围、非目标、风险
- `design.md` 记录架构、接口、数据流、失败处理、兼容性
- `plan.md` 记录有序任务、依赖、验收标准、验证命令
- `revisions/` 保存每次修订快照
- `timeline.md` 记录关键操作和状态变化

## 6. 模块边界

建议模块拆分：

- `src/domain`：工作流、决策、候选、任务、revision 类型
- `src/archive`：路径安全、创建、读取、快照、归档、child change
- `src/artifacts`：Markdown 模板、解析、完整性校验、导出
- `src/deck`：工具检测、Deck 输入转换、选择解析、TUI 退化
- `src/openspec`：OpenSpec 工件映射和 CLI 能力检测
- `src/plan`：`pi-plan-mode` 检测、规划交接、计划上下文压缩
- `src/model`：模型目录筛选、认证/思考级别校验、阶段配置
- `src/commands`：菜单和兼容命令，只调用领域服务

## 7. 集成策略

### 7.1 `design_deck`

- 启动时检测 `design_deck` 是否可用
- 可用则复用原生 Deck
- 不可用则先请求用户确认是否安装
- 用户拒绝或安装失败时退化到 TUI
- Deck 选择结果必须回写 Markdown，不能只依赖返回值

### 7.2 `pi-plan-mode`

- 启动规划入口时检测 `plan_mode_question`
- 可用时复用结构化提问
- 不可用时退化到 `ctx.ui`
- 只复用提问，不复制计划状态机
- `plan_mode_complete` 不作为当前主方案的核心依赖

### 7.3 OpenSpec

- 生成兼容其语义的 Markdown 工件
- OpenSpec CLI 仅作为可选检测/适配目标
- 不把 OpenSpec CLI 设为运行时硬依赖

## 8. 执行安全

执行阶段的安全原则：

- 读文件、分析、校验命令可以自动化
- 写文件可自动化，但要原子写入
- 自动提交 Git 可纳入策略，但必须记录提交与验证结果
- `git reset --hard` 不能默认自动执行
- 所有破坏性 Git 操作必须遵守 `docs/GIT-WORKFLOW.md`
- 计划修订必须生成新的 revision，不可覆盖历史

## 9. 实施阶段

### Phase 0：契约和边界

**目标**：定义领域模型、状态规则、最小 Markdown schema。  
**依赖**：无。  
**输出**：类型定义、状态转换规则、非法路径与 workflow id 拒绝规则。  
**验收标准**：非法状态、非法 workflow id、路径遍历均被拒绝。  
**验证命令**：

```bash
pnpm typecheck
pnpm lint
pnpm test
```

### Phase 1：档案核心

**目标**：实现安全路径解析、workflow 创建、读取、revision 快照、timeline。  
**依赖**：Phase 0。  
**输出**：可创建的工作流目录、原子写入、可恢复的核心工件。  
**验收标准**：新建档案完整；历史 revision 不可覆盖；重启可从核心文件恢复。  
**验证命令**：

```bash
pnpm typecheck
pnpm lint
pnpm test
```

### Phase 2：决策与 Deck 适配

**目标**：将 `DecisionPoint` 转成 `design_deck` JSON，解析选择与备注。  
**依赖**：Phase 1。  
**输出**：`decision.md` 写回、Deck 退化路径、TUI 备份路径。  
**验收标准**：Deck 缺失、安装拒绝、调用失败都不丢失决策记录。  
**验证命令**：

```bash
pnpm typecheck
pnpm lint
pnpm test
```

### Phase 3：OpenSpec 风格工件

**目标**：生成 `proposal.md`、`specs/<capability>/spec.md`、`design.md`、`plan.md`。  
**依赖**：Phase 2。  
**输出**：具备 SHALL 需求、WHEN/THEN 场景、验收标准和验证命令的 Markdown 工件。  
**验收标准**：缺工件、重复任务、无验收标准、依赖成环时校验失败。  
**验证命令**：

```bash
pnpm typecheck
pnpm lint
pnpm test
```

### Phase 4：pi-plan-mode 提问桥

**目标**：检测并复用 `plan_mode_question`，不可用时退化到 `ctx.ui`。  
**依赖**：Phase 2。  
**输出**：一致的内部答案模型、提问记录、计划确认记录。  
**验收标准**：两种路径产生一致的内部答案模型。  
**验证命令**：

```bash
pnpm typecheck
pnpm lint
pnpm test
```

### Phase 5：计划执行和任务状态

**目标**：从 `plan.md` 加载任务，维护持久化任务状态、依赖、验收和验证结果。  
**依赖**：Phase 3、Phase 4。  
**输出**：暂停、恢复、失败记录和 revision 支持。  
**验收标准**：上下文压缩或会话重启后，仅读取 `manifest.md`、`plan.md` 和当前任务状态即可继续。  
**验证命令**：

```bash
pnpm typecheck
pnpm lint
pnpm test
```

### Phase 6：归档和 child workflow

**目标**：归档后父 workflow 保持只读，支持从归档创建 child workflow。  
**依赖**：Phase 5。  
**输出**：父子链、修订历史、归档索引。  
**验收标准**：父档案不变，child 能继承必要上下文并生成新 revision。  
**验证命令**：

```bash
pnpm typecheck
pnpm lint
pnpm test
```

### Phase 7：质量门禁

**目标**：添加单元、集成和冒烟测试。  
**依赖**：Phase 0–6。  
**输出**：覆盖依赖缺失、路径安全、Deck 失败、恢复、归档和幂等操作的测试。  
**验收标准**：质量门禁可重复执行且结果稳定。  
**验证命令**：

```bash
pnpm typecheck
pnpm lint
pnpm test
```

## 10. 当前实现状态

当前仓库里，`src/index.ts` 仍只是一个状态命令入口，尚未实现本文档中的工作流能力。  
因此本文档描述的是**下一阶段的执行计划**，不是现状说明。

## 11. 待验证项

以下内容需要后续实现或实际运行后再确认：

- `design_deck` 的真实启动与可视页面能力
- `pi-plan-mode` 在当前 Pi 环境中的可用注册状态
- Deck 安装/缺失/拒绝时的真实退化路径
- OpenSpec CLI 的实际可选适配范围
- 自动 Git 提交策略是否最终启用

## 12. 最小结论

这份计划的核心不是“再做一个任务软件”，而是：

- 用 Deck 降低选型沟通成本
- 用 Markdown 抵抗上下文丢失
- 用版本化快照保障可恢复
- 用浅集成的 plan-mode 提高提问质量
- 用 OpenSpec 风格约束产物，但保留 xpi-superplan 自己的编排
