# xpi-superplan：决策驱动的持久化计划工作流

## 摘要

将 `xpi-superplan` 定位为 Pi 内原生的**决策编排器**：复用 `pi-design-deck` 完成方案对比与用户选型，复用 `pi-plan-mode` 完成只读规划、结构化提问、计划确认和受控实施；由本项目负责把全过程持久化为不可覆盖的 Markdown 工作流档案，并把选型结果映射为 OpenSpec 风格的规范工件。

核心承诺：**卡片降低决策成本，Markdown 抵抗上下文丢失，OpenSpec 保证规范完整，pi-plan-mode 保证执行边界，xpi-superplan 保证全生命周期可追溯。**

## 明确边界

- 不引入 Next.js、React、FastAPI、浏览器专属 API 或独立 Web 后端。
- 不复制 `pi-design-deck` 的网页运行时；只生成其标准 Deck JSON、调用其已注册工具并持久化选择结果。
- 不复制 `pi-plan-mode` 的计划状态机、工具策略或计划重新注入机制；将其作为可选协作依赖/底层能力。
- 不重写 OpenSpec；生成兼容其思路和目录语义的 Markdown 工件，并在本机存在 OpenSpec CLI 时提供适配/校验入口。
- 小任务允许直接执行，不强制启动完整工作流；多步骤、跨模块、有选型或需要长期恢复的任务才进入 Superplan。

## 工作流生命周期

```text
需求输入
  → 项目/任务范围判断
  → 调研与候选方案
  → Design Deck 卡片选型
  → 决策与理由固化
  → proposal/specs/design/tasks 生成
  → 用户审查并确认计划
  → 规划模型交接给执行模型
  → 按任务执行、验证、记录
  → 暂停/恢复或修订
  → 归档
  → 从归档创建 child change 继续演进
```

状态至少包括：`draft`、`researching`、`decision_pending`、`planned`、`implementing`、`paused`、`completed`、`archived`。状态变更写入档案索引和 Pi session entry，不能只保存在内存中。

## 持久化档案结构

默认根目录为项目内 `.pi/superplan/`，遵守 Project Trust；档案应纳入 Git，密钥和敏感用户数据不得写入。

```text
.pi/superplan/
└── workflows/
    └── <date>-<slug>/
        ├── manifest.md          # id、标题、状态、父变更、版本、模型、时间线
        ├── decision.md          # 候选方案、用户选择、理由、未采纳项、决策约束
        ├── research.md          # 调研结论、来源、已验证事实、未解决问题
        ├── proposal.md          # 背景、目标、范围、非目标、风险
        ├── design.md            # 架构、接口、数据流、失败处理、兼容性
        ├── plan.md              # 有序任务、依赖、验收标准、验证命令
        ├── references/          # URL、文档、论文、源码引用和必要摘要
        ├── scripts/             # 用户确认可复用的代码/配置/命令脚本
        ├── assets/              # Deck 快照、导出 HTML、图表、架构图
        ├── revisions/           # 每次计划修订的完整只读快照
        └── timeline.md          # 关键操作、状态变更、暂停、恢复和归档记录
```

规则：

- 每次计划修订生成新的 `revisions/<revision>/` 快照；当前文件是指向当前版本的工作副本。
- 禁止用单一根目录 `PLAN.md` 作为默认持久化目标，避免不同任务互相覆盖。
- 提供显式导出到用户指定的 `docs/` 或其他路径；导出目标已存在时默认拒绝覆盖。
- 调研中发现的脚本、配置、源码片段只有在用户确认或规则明确允许时复制到 `scripts/`/`references/`；记录来源、许可证、摘要和用途，避免无边界复制整个仓库。
- 大型或敏感内容保存引用、摘要和路径，而不是把完整内容注入 Markdown 或模型上下文。

## 与 pi-design-deck 的集成

### 检测和缺失策略

- 启动工作流时检查有效的 `design_deck` 工具是否已注册并可调用。
- 已安装：直接复用原生 `design_deck`，包括 `previewBlocks`、`previewHtml`、图片、Mermaid、生成更多选项、保存快照和导出 HTML。
- 未安装：通过 `ctx.ui.confirm` 请求用户确认安装；不得静默安装或自动克隆源码仓库。
- 安装流程必须使用 Pi 实际支持的包管理/安装接口，先读取当前版本类型定义并做可用性校验；不能凭命令假设安装 API。
- 用户拒绝、安装失败或工具仍不可用：退化到 Pi 原生 `ctx.ui.select/custom` 选择，工作流不能因此丢失，仍生成完整档案并记录退化原因。
- 安装是显式用户操作；不把 `pi-design-deck` 强行内置为源码依赖，降低供应链、版本耦合和维护成本。

### Deck 数据契约

xpi-superplan 维护最小的内部决策模型，并转换为 Deck 输入：

- `DecisionPoint`：唯一 id、问题、上下文、约束、候选项、推荐项；
- `Candidate`：标题、说明、优缺点、风险、成本/复杂度、预览块、引用和可复用资产；
- `Selection`：选中项、用户备注、时间、工作流 revision；
- `DecisionRecord`：所有候选、最终选择、理由、未采纳理由、后续影响。

Deck 的选择结果不是最终真相；必须在返回后写入 `decision.md`，并要求用户在进入计划阶段前确认关键决策。

## 与 OpenSpec 的集成

将选型结果映射为 OpenSpec 风格工件：

- `proposal.md`：从需求和用户目标生成；明确范围与非目标。
- `specs/<capability>/spec.md`：从已确认行为生成 SHALL 需求和 WHEN/THEN 场景。
- `design.md`：包含被选方案、架构边界、接口/类型、数据流、风险、迁移和失败处理。
- `plan.md`：将任务拆为有序、可恢复的小步骤，每项包含输入、输出、依赖、验收标准和验证命令。
- `decision.md`：补足 OpenSpec 默认不强调的选型过程、候选比较和用户理由。
- 归档时保留完整工作流目录，并生成归档索引；若 OpenSpec CLI 可用，提供 `verify`/`archive` 适配，否则执行本地 Markdown/manifest 校验。

命令交互以卡片和菜单为主，不要求用户记忆 `opsx-explore`、`opsx-update`、`opsx-apply` 等命令。仍可提供兼容命令，但所有命令应先解析当前工作流并 fail-closed，禁止因 slug、状态或路径错误误操作其他工作流。

## 与 pi-plan-mode 的集成

### 复用策略

- 规划入口优先检测 `plan_mode_question` 与 `plan_mode_complete` 是否可用。
- 可用时：将 Superplan 的调研、Deck 选择和档案上下文作为规划输入，交给 `pi-plan-mode` 负责只读工具限制、提问、计划完成、保存、恢复和实施入口。
- 不可用时：xpi-superplan 提供最小退化流程：只读阶段使用扩展自己的工具调用拦截，用户通过 `ctx.ui` 确认计划，再发送实施消息；退化状态写入档案。
- 不得同时维护两套互相竞争的“当前计划”；xpi-superplan 是工作流档案真相，pi-plan-mode 是当前 Pi 会话的计划安全控制器。
- 执行前必须把工作流 id、当前 revision、`plan.md` 路径和验收标准传递给执行阶段；不要把全部调研原文重复注入模型上下文。

### 计划防覆盖和恢复

- 默认使用工作流唯一目录与 revision，不使用固定 `PLAN.md`。
- `/plan export` 如被使用，默认目标应由 xpi-superplan 提供为当前工作流目录内的 `plan.md` 或用户明确指定的路径；已存在目标拒绝覆盖。
- Pi session 通过 `pi.appendEntry()` 保存当前 workflow id、revision、状态和模型配置，恢复时从磁盘重新读取 Markdown。
- 上下文压缩后优先重新读取 `manifest.md`、`plan.md` 和当前任务状态，而不是重新注入全部历史调研。

## 归档与持续演进

- 归档是状态，不是删除，也不是禁止未来修改。
- 已归档工作流本身保持不可变。
- 需要补丁、版本升级或新增功能时，用户从归档卡片选择“创建后续变更”，生成新的 child workflow：
  - `manifest.md` 记录 `parent: <archived-workflow-id>`；
  - 只复制必要的已确认上下文，避免重复膨胀；
  - 新 child 重新进行受影响的决策、规范和计划；
  - 父档案继续只读，子档案完成后可单独归档。
- 提供父子链、状态、当前版本和归档时间的列表/卡片视图，支持从任意节点恢复审查。

## 阶段模型策略

采用“阶段级模型配置”，不做每个任务节点单独配置：

```text
planningModel:   <provider/model pattern>
executionModel:  <provider/model pattern>
```

- 规划入口支持选择或配置规划模型，执行入口支持选择或配置执行模型；思考级别也按阶段配置。
- 使用 Pi 的当前模型目录、认证状态和可用模型集合进行校验；模型不存在、未认证或不支持请求的思考级别时，不静默替换，要求用户选择可用模型或明确采用当前模型作为退化方案。
- 当前会话切换与新会话交接均以 Pi 实际 API 为准：若安全且可用则切换；若不能保证计划上下文和模型状态一致，则创建新实施会话，并传入工作流 id、revision 和计划路径。
- 不在源码中写死用户举例的模型名；`gpt5.6-sol`、`gpt5.6-luna` 只能作为配置示例，实际以 Pi provider/model catalogue 为准。
- `manifest.md` 记录规划模型、执行模型、思考级别和交接结果，便于复盘成本与质量。

## 推荐实现分期

1. **档案核心**：目录生成、manifest、revision、Markdown 工件、脚本/引用登记、session entry 恢复。
2. **决策流程**：候选模型、Deck JSON 适配、选择回写、无 Deck 时的 TUI 退化。
3. **规范生成**：proposal/spec/design/plan 模板和状态校验，OpenSpec CLI 可选适配。
4. **计划集成**：检测并复用 pi-plan-mode，处理 plan complete/save/export/implement 的边界和回退流程。
5. **执行与归档**：阶段模型校验、任务状态、验证结果、暂停恢复、不可变归档和 child change。
6. **体验完善**：卡片式工作流列表、归档演进入口、导出、错误提示和兼容命令。

每期保持可运行；不在第一期实现独立 Web UI、后台数据库、向量记忆、全自动源码抓取或逐任务模型编排。

## 公共接口与模块建议

内部模块按职责拆分：

- `src/domain/`：工作流、决策、候选、任务、revision 类型。
- `src/archive/`：路径安全、创建、读取、快照、归档、child change。
- `src/artifacts/`：Markdown 模板、解析、完整性校验、导出。
- `src/deck/`：工具检测、Deck 输入转换、选择解析、TUI 退化。
- `src/openspec/`：OpenSpec 工件映射和 CLI 能力检测。
- `src/plan/`：pi-plan-mode 检测、规划交接、计划上下文压缩策略。
- `src/model/`：模型目录筛选、认证/思考级别校验、阶段配置。
- `src/commands/`：用户菜单和兼容命令；只调用领域服务，不直接拼文件路径。

所有写入操作都必须：校验工作流 id/path、使用原子临时文件+rename、拒绝覆盖历史 revision、记录 timeline，并返回有界摘要。

## 测试与验收

### 单元测试

- 工作流 slug、路径遍历和非法 id 被拒绝。
- 新建工作流生成完整目录与最小合法 Markdown。
- revision 不覆盖旧快照；当前版本指针正确更新。
- 归档后创建 child workflow，父档案保持不变并正确建立 parent 关系。
- 缺失 Deck、用户拒绝安装、安装失败时都能退化到 TUI 并保留决策记录。
- Deck 选择结果、备注、未采纳方案和 revision 正确写入 `decision.md`。
- OpenSpec 工件缺失、重复任务、无验收标准或无序依赖时校验失败。
- 脚本复制只允许明确来源和安全目标，拒绝覆盖既有文件。
- 模型不存在、认证缺失、思考级别不兼容时 fail-closed；可用模型选择成功。
- session entry 恢复后能重新定位工作流和当前任务。

### 集成/冒烟场景

1. 无任何可选依赖：创建需求 → TUI 选型 → 生成完整档案 → 导出计划。
2. 已安装 `pi-design-deck`：展示两张方案卡 → 选择并备注 → 生成 Deck 快照和 OpenSpec 工件。
3. 已安装 `pi-plan-mode`：只读调研 → 结构化问题 → 完成计划 → 保存/恢复 → 进入执行模型。
4. 上下文压缩或会话重启后：从 `.pi/superplan/workflows/<id>/` 恢复，不依赖原始对话全文。
5. 已归档工作流：从归档卡片创建 child patch，验证父档案不可变。
6. 重复执行导出、归档、安装或恢复命令：操作幂等且不会覆盖或误操作其他工作流。

### 仓库质量门禁

实现每个阶段后都运行：

```bash
pnpm typecheck
pnpm -w run lint
pnpm test
```

并使用 `lens_diagnostics(mode="all")` 确认已编辑文件无阻塞诊断；不引入 `any`、新构建步骤或未验证的 Pi API。

## 明确假设

- `.pi/superplan/` 是默认档案位置，项目级配置和档案仅在项目受信任时生效。
- 归档采用不可变父档案 + child change 链，而不是直接改写归档历史。
- Deck 缺失时需用户明确确认安装；不静默克隆源码或安装第三方扩展。
- `pi-design-deck` 与 `pi-plan-mode` 均为可选能力；核心 Markdown 档案流程不能依赖它们存在。
- 模型按规划/执行两个阶段配置；实际 provider、model id、认证和思考级别由 Pi 运行时决定。
- OpenSpec 作为工件语义和可选 CLI 适配目标，不把其 CLI 作为 xpi-superplan 的硬运行时依赖。
- 自动提交、自动 `git reset --hard`、自动推送不属于第一阶段；任何 Git 破坏性操作必须遵守仓库现有 Git 安全规范并保留人工确认。
