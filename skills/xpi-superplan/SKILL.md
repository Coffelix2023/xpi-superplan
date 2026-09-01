---
name: xpi-superplan
description: xpi-superplan 工作流的 start/grillme/save/fix/fix-fast 行为流程。收到 `[xpi-superplan] mode: ...` 调度消息,或用户要求开始计划/盘问需求/保存结论/修改开发任务决策时使用。严格按对应模式执行,不跳过决策落盘。
---

# xpi-superplan 行为流程

调度消息格式:

```
[xpi-superplan] mode: <start|grillme|save|fix|fix-fast>
workflow: <工作流 id>
dir: <工作流目录绝对路径>
用户反馈: <fix/fix-fast 的反馈原文>
```

收到后按 mode 执行下面对应流程。所有档案写入都在 `dir` 内,遵守:历史不可覆盖,revision 由命令层管理,你只写当前核心文件(`decisions.md` / `research.md` / `proposal.md` / `design.md` / `tasks.md`)。

## 通用规则

1. **交互选型**:存在多个具象方案时用 `design_deck` 呈现候选;单问题用结构化面板(`interview` / `ask_user_question`)。`design_deck` 工具不可用时退化为结构化面板 + 文字候选列表,不中断流程。
2. **决策落盘**:走 `design_deck` 的决策由扩展在 tool_result 边界自动回写原始记录(slideId/选中项/备注)到 `decisions.md`,你**不要重复记录**,只需在记录下方补充候选分析与拒绝理由。非 deck 路径(结构化面板/文字候选)的决策由你手写完整记录,格式:

   ```markdown
   ## D<n> — <问题>
   - 时间: <ISO 时间>
   - revision: <当前 revision,见 dir/README.md frontmatter>
   - 全部候选:
     - <id> <标题>: <摘要>
   - 选中项: **<id>** <标题>
   - 备注: <用户备注或 "(无)">
   - 未采纳项及理由:
     - <id>: <风险/拒绝理由>
   ```

3. **取消诚实**:用户取消或中断时,不写入"已完成"状态的决策或任务;已推进的部分如实说明。
4. **任务文件**:`tasks.md` 中的任务含 id、标题、验收标准(acceptance)、验证方式(verify)、依赖(dependsOn)、状态(pending/in_progress/done/failed)。
5. **固化版本**:任何修改了核心文件的流程(save/fix/fix-fast)收尾都必须调用 `xpi_superplan_finalize` 工具(带 summary 参数),生成包含修改成果的新 revision 快照;已归档工作流会被该工具拒绝,需先走 fix 派生 child。

## start(初始化 + 引导教程)

1. 简要讲解各模式用途,让用户知道后续可用:`grillme`(盘问需求)、`save`(保存结论与任务)、`archive`(归档)、`fix`/`fix-fast`(反馈修订)。
2. 用结构化面板问用户切入点:直接盘问需求 / 已有方案要做选型 / 先调研。
3. 沿用户选择推进:需求不清 → 盘问(见 grillme);多方案选型 → `design_deck` 逐决策点呈现;调研 → 结论写入 `research.md`。
4. 每个决策点结束即按通用规则落盘;阶段性产出 tasks 草稿写入 `tasks.md`。
5. 全程主动提示下一步可用哪个命令模式,让用户在实践中熟悉命令。

## grillme(盘问模式)

1. 读 `dir` 内现有核心文件,避免重问已确认内容。
2. 参考 `grilling` 技能深度盘问:一次一个问题,追问动机、约束、边界、失败场景,直至需求无实质歧义。
3. 出现具象方案分歧时用 `design_deck` 让用户选型;每轮决策立即落盘 `decisions.md`。
4. 盘问收敛后,将结论汇总进 `proposal.md` / `design.md`(按需),并提示用户可 `/xpi-superplan save` 固化。

## save(保存结论)

1. 综合当前会话与 `dir` 现有内容,把已确认的决策补全到 `decisions.md`(不重复已记录条目)。
2. 生成/更新 `tasks.md`:任务按依赖排序,含验收与验证方式。
3. 收尾调用 `xpi_superplan_finalize` 固化(见通用规则 5),然后汇报:新增决策数、任务数、新 revision,提示可 `/xpi-superplan archive`(需状态为 completed)或继续 `fix`。

## fix(反馈修订,深度)

1. 命令层已建好可写目标(活动工作流记 `fix-request` timeline;已归档则派生 child),你在该目标的当前核心文件上修改,**绝不触碰历史 revision 与已归档目录**。revision 快照**不会**在派发时生成。
2. 围绕「用户反馈」深度盘问(同 grillme),摸清真实意图与边界,再更新 `decisions.md`(追加新决策记录,标注取代关系,不删旧记录)与 `tasks.md`。
3. **收尾必须调用 `xpi_superplan_finalize` 工具**(带 summary),把修改成果固化为新 revision 快照;未 finalize 的修改不进版本历史。完成后汇报变更摘要与新 revision。

## fix-fast(反馈修订,快速)

1. 版本规则同 fix。
2. **不扩展盘问**:仅针对反馈字面范围做最小修改,直接更新 `decisions.md`(追加)/`tasks.md`。
3. 反馈本身有歧义时,最多问一个澄清问题;答完即改。
4. 收尾同样调用 `xpi_superplan_finalize` 固化(见通用规则 5)。
