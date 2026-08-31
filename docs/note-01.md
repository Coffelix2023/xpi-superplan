# 笔记

### xpi-superplan的任务流程:
1.1  目标探索模式: 类似/opsx-explore和/deck,利用brainstrom和grilling与用户以视觉可视化的交互问答, 引导用户做最佳决策和选型指导.

1.2  任务构建模式: 类似/opsx-propose和pi-plan-mode的plan export, Agent将上一阶段的调研与选型成果落地,形成markdown 优先权的文档集(包括不仅仅只是一个
PLAN.md, 而是一套文档+数据, 文档是任务和计划编排, 数据是可复用的资料/参考/脚本, 是目标探索阶段有价值产物的留存,不能将一系列的调研仅仅停留在上下文, 而是应
该珍惜且充分利用), 构建得到的目录结构可以参考openspec的目录架构(但需要改进,目录和文件名称的语义要清晰明了)

1.3  开发模式: 基于 1.2 阶段获得的文档集, 开始正式开发(包括开发/调试/跑git流程)
  1.3.1  markdown 文档优先权的重要作用体现: 当任务开发超过上下文窗口限制的 70%,通常伴随而来的是agent数据垃圾成山,tokens爆炸, 幻觉出现, 目标偏移,所以要
 随时将每个任务的开发结论保存为物理文档, 确保无论用户何时切换新对话窗口, agent都能够快速衔接任务开发.
  1.3.2  models的切换: 不同供应商的不同模型往往擅长不同的任务, 规划型/编码型/审核型等, 简单任务交给小模型, 搞不定时上大模型. 而且都应该是隔离或者不同
 的窗口(避免不同供应商模型在同一窗口中执行工具不兼容导致失败)

1.4  归档: 产品正式上线/发布后,将任务归档, 但并不意味着未来不再修改, 所以需要给修改留着接口备用(需要你设计, 类似opsx-update)

**Question-1**
目标: 开发pi扩展工具,实现将`pi-design-deck(https://github.com/nicobailon/pi-design-deck)` 与`openspec(https://github.com/Fission-AI/OpenSpec/)`的功能特性和优势结合,规避各自的短板, 形成一个可以与用户交互,帮助用户选型/决策/开发流并形成落地计划文档且严格按计划任务文档执行的现代智能工作流.
 请你根据目标需求,制定一套开发逻辑+流程

**Answer-1**
针对你提出的将 `pi-design-deck` 与 `OpenSpec` 融合的目标，我将基于第一性原理（First Principles）为你剖析两者的本质，并设计一套现代化的**“视觉规范驱动工作流（VSDW, Visual Spec-Driven Workflow）”**。

### TL;DR
本方案的核心在于构建一个 **“视觉意图到机器规范”的无缝映射桥梁**。利用 `pi-design-deck` 解决 AI 开发前期的“意图模糊”问题（通过视觉对比辅助决策），利用 `OpenSpec` 解决后期的“执行发散”问题（通过 SDD 规范约束代码生成）。最终产出包含：交互式决策 Deck（幻灯片）、自动化 Spec（规范）转换器、以及带原子回滚能力的 Agent 执行引擎。

---

### 一、 第一性原理与边界试探 (First Principles & Boundary Testing)

1. **第一性原理分析**
   - **开发本质**：将“模糊的人类意图”转化为“确定的机器指令”。
   - **pi-design-deck 本质**：解决“意图对齐”。它通过多幻灯片的高保真预览（High-fidelity previews），让人类在做架构/UI 选型时有直观的视觉依据，避免 AI 凭空捏造 UI。
   - **OpenSpec 本质**：解决“指令精确”。它是一种规范驱动开发（SDD, Spec-Driven Development）框架，强制 AI 在写代码前先写规范，杜绝 AI 幻觉（Hallucination）。
   - **融合逻辑**：视觉选择的结果，必须能够 1:1 映射为结构化的 Spec Schema（数据契约）。

2. **边界试探 (Boundary Testing)**
   - *边界情况 1*：如果用户在 Agent 执行阶段中途修改了视觉 Deck 中的选型，怎么办？
     *对策*：引入**状态机模式（State Machine）**。任何中途修改触发 OpenSpec 的 Diff（差异对比），自动暂停当前任务，生成新的增量 Spec，并强制 Git 回滚到上一个稳定 Commit。
   - *边界情况 2*：视觉方案很完美，但 OpenSpec 无法解析某些复杂的自定义 UI 逻辑？
     *对策*：在 Deck 的卡片设计中，强制要求“视觉组件”必须绑定 ShadcnUI 或标准 TailwindCSS 4 的原子类，禁止脱离组件库的魔法代码（Magic Code）。

---

### 二、 工具短板与规避策略

| 工具 | 优势 | 短板 | 规避策略 (结合方案) |
| :--- | :--- | :--- | :--- |
| **pi-design-deck** | 交互性强，视觉对比直观，适合选型。 | 缺乏代码约束力，选完型后仍需人工或 AI 重新理解上下文，容易在实现时偏离初衷。 | 将 Deck 的 JSON 配置扩展，使其不仅包含视觉预览，还包含**依赖包声明**和**架构元数据**。 |
| **OpenSpec** | 严格约束 AI，保证代码质量，杜绝幻觉。 | 纯文本/Schema 驱动，对需要直观 UI 决策的场景不够友好，非技术人员难以参与前期设计。 | 在前端使用 NextJS 16 渲染一个“Spec 可视化看板”，将枯燥的 OpenSpec 转化为带进度条的视觉 Deck 状态。 |

---

### 三、 开发逻辑与技术栈选型 (基于你的偏好)

为了支撑这个智能工作流，我们采用模块化设计，并严格遵循你的技术栈要求：

#### 1. 核心架构模块 (Modular Architecture)
- **前端决策层 (Deck-UI)**: 基于 NextJS 16 (App Router) + TailwindCSS 4 + ShadcnUI + Biome 2.5+ 构建。用于本地启动一个 Web 服务，展示多套方案。
- **后端规范层 (Spec-Engine)**: 基于 Python 3.12 + FastAPI + Uv。负责接收 Deck 的选择结果，调用 LLM（大语言模型）生成符合 OpenSpec 标准的 `spec.md`。
- **记忆与上下文 (Memory)**: 接入 HindSight (本地容器 `app-hindsight`)，存储历史选型决策和用户偏好，避免重复沟通。

#### 2. 环境配置 (遵循 XDG 规范)
- 使用 **Mise** 管理 Node v24.12+ 和 Python v3.12+ 版本。
- 配置文件存放在 `$XDG_CONFIG_HOME/pi-spec-deck/`。
- 使用 **Podman** 隔离代码执行的沙盒环境。

---

### 四、 现代智能工作流全流程设计 (The VSDW Process)

以下是指导你开发的 4 步核心工作流：

#### 阶段 1：视觉提案与选型 (Visual Pitch & Selection)
- **流程**：用户输入模糊需求（如：“帮我做一个带拖拽看板的 Dashboard”）。系统通过 LLM 生成 3 套不同的技术方案，并通过 `pi-design-deck` 渲染成 3 张幻灯片。
  - *卡片 A*：NextJS Server Actions + ShadcnUI (推荐，最轻量)。
  - *卡片 B*：tRPC + Zustand + DND-Kit (适合复杂前端状态)。
- **目的**：让用户“看到”技术选型的视觉差异与性能差异，辅助决策。
- **输出**：用户在 Deck 中点击选中卡片 A。

#### 阶段 2：规范自动生成 (Automated Spec Generation)
- **流程**：系统拦截卡片 A 的选择，将卡片绑定的元数据（Metadata）注入 OpenSpec 的 Prompt 模板中。
- **API 契约**：前端通过 WebSocket 将选择结果发送给 Python 后端。
- **同步更新**：后端生成 `spec.md` 和 `openapi.json`，并自动更新相关的类型定义（Types）。**注意：任何新增/修改的 API 必须同步更新调用方和文档。**

#### 阶段 3：落地计划与任务拆解 (Actionable Plan Breakdown)
- **流程**：OpenSpec 引擎根据 `spec.md` 自动拆解为可执行的 Task List（任务清单）。
- **计划文档**：生成 `PLAN.md`，包含严格的步骤（如：1. 初始化 Biome 配置 -> 2. 创建 DB Schema -> 3. 实现 Server Action）。
- **不可变约束**：每个 Task 必须包含明确的**验收标准（Acceptance Criteria）**，并且所有变更必须遵循“小粒度提交”。

#### 阶段 4：严格执行与原子回滚 (Strict Execution & Atomic Rollback)
- **流程**：Pi Agent 读取 `PLAN.md` 开始执行代码编写。
- **可回滚机制**：
  - 每完成一个 Task，Agent 自动执行 `git commit`（遵循 Conventional Commits 规范）。
  - 如果 Biome 检查失败，或 Ruff (Python Linter) 报错，Agent 必须自动执行 `git reset --hard` 回滚到该 Task 之前的状态，并重新生成代码，绝不把脏代码推入主分支。
- **状态反馈**：执行进度实时反映在 NextJS 的 Web 界面中，卡片 A 上的进度条逐渐填满。

---

### 五、 开发实施步骤 (Action Plan)

1. **环境初始化**：
   ```bash
   # 使用 mise 创建项目环境
   mise use node@24.12 python@3.12
   mkdir pi-spec-deck && cd pi-spec-deck
   pnpm init && pnpm add next@16 shadcn@latest
   uv init backend
   ```
2. **定义数据契约 (API & Types)**：
   创建 `packages/shared-types`，严格定义 Deck Card 和 OpenSpec Schema 之间的映射关系。确保任何 API 变动，前后端类型同步更新。
3. **集成 HindSight**：
   在 Python 后端中，编写 RAG（检索增强生成）逻辑，将当前需求向量化，从 Hindsight 中寻找用户过往偏好的 UI 风格或架构模式。
4. **编写 Pi Agent Skill**：
   参考 Pi 的 Skill 标准，编写一个 `spec-deck-executor` 技能，让 Pi 知道如何读取 `PLAN.md` 并按顺序执行，同时集成 Biome 2.5 进行代码校验。

### 导师总结
这套逻辑将**视觉的感性（Deck）** 与**代码的理性（OpenSpec）** 完美闭环。它既满足了人类“眼见为实”的决策安全感，又满足了机器“照章办事”的执行高效率。建议你先从**阶段 2（规范自动生成）** 开始编写 MVP（最小可行性产品），跑通数据流后再完善视觉 Deck 的交互。

如果有特定模块（如 OpenSpec 的 Schema 设计或 NextJS 16 的 Server Actions 通信）需要深入探讨，请随时告知。
