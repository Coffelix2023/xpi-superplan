# superplan-mvp 任务

> 每期(M)结束后运行 `pnpm typecheck && pnpm -w run lint && pnpm test` 三条门禁,全绿才可合并;每期一个分支一个 PR。

## 1. M1 档案核心

- [x] 1.1 定义 domain 类型(Workflow/DecisionPoint/Candidate/Selection/Task/Revision/状态机),验证 `pnpm typecheck` 通过且状态机拒绝非法状态转换(单测)
- [x] 1.2 实现 workflow id 与路径校验(`<date>-<slug>`、路径遍历拒绝),验证非法 id/路径遍历单测全部拒绝
- [x] 1.3 实现档案创建(完整目录 + 最小合法 Markdown + README.md + timeline 记录),验证创建后目录结构与 design.md D3 一致(单测)
- [x] 1.4 实现原子写入(临时文件+rename)与 revision 快照,验证修订生成新 revision 且历史快照字节不变(单测)
- [x] 1.5 实现 `appendEntry` 恢复锚点与核心文件重读,验证模拟重启后仅从 README.md + tasks.md 恢复状态(单测)
- [x] 1.6 冒烟:`pi -e ./src/index.ts` 下创建→写入→恢复全链路手动跑通

## 2. M2 决策闭环(TUI 先行)

- [ ] 2.1 实现 `ctx.ui` TUI 选型路径(候选展示/选择/备注),验证无 deck 环境下决策完整写入 decisions.md(单测)
- [ ] 2.2 实现 deck 检测(`getAllTools`)与缺失时确认安装/拒绝退化分支,验证拒绝安装时退化 TUI 且 timeline 记录原因(单测)
- [ ] 2.3 实现 DecisionPoint→deck JSON 转换与 sendMessage 指令生成,验证输出 JSON 符合 deck-schema(单测)
- [ ] 2.4 实测一次真实 deck 调用,确认 `tool_result` 中 `details.selections` 结构;结果记录到 design.md Open Questions(若需解析文本则补解析器)
- [ ] 2.5 实现 `tool_result` 捕获 + 强制回写 decisions.md(含未采纳理由/revision),验证"有选择无落盘"被拦截补写(单测)

## 3. M3 工件生成

- [ ] 3.1 实现 proposal/design/tasks 模板生成(SHALL + WHEN/THEN),验证从 decisions.md 生成三文档且含验收标准与验证命令(单测)
- [ ] 3.2 实现完整性校验(缺文档/重复任务/无验收标准/依赖成环),验证四类缺陷各自校验失败且诊断可读(单测)
- [ ] 3.3 实现 OpenSpec CLI 检测与本地校验退化,验证无 CLI 环境本地校验通过(单测)
- [ ] 3.4 起 dogfood:本仓库后续开发改用 superplan 档案管理,验证走通一次真实小任务

## 4. M4 执行与恢复

- [ ] 4.1 实现任务状态机(待办/进行/完成/失败)+ 状态落盘 + timeline,验证状态变更重启后可读回(单测)
- [ ] 4.2 实现暂停/恢复命令,验证新会话从磁盘定位下一个待办任务(单测)
- [ ] 4.3 实现 session_before_compact 快照落盘,验证压缩钩子触发时任务状态先写盘(单测)
- [ ] 4.4 冒烟:上下文压缩后继续执行,无进度丢失

## 5. M5 模型配置与提问桥

- [ ] 5.1 实现阶段模型配置读写(README.md 中 planning/execution/review + thinking level),验证非法模型/未认证/思考级别不兼容 fail-closed(单测)
- [ ] 5.2 实现手动升降档命令(setModel + 校验 + timeline 记录),验证跨供应商时给出新会话交接提示(单测)
- [ ] 5.3 实现 plan_mode_question 检测与可选桥接,验证不可用时 ctx.ui 路径产出一致的内部答案模型(单测)

## 6. M6 归档与演进

- [ ] 6.1 实现归档(只读标记 + 归档索引 + timeline),验证归档后任何写入被拒(单测)
- [ ] 6.2 实现 child workflow 创建(parent 记录 + 必要上下文复制 + revision 1),验证父档案字节不变(单测)
- [ ] 6.3 实现父子链/状态/归档时间列表视图,验证可从任意节点恢复审查(冒烟)
- [ ] 6.4 验证归档/恢复/导出/child 创建重复执行幂等(单测)

## 7. M7 质量门禁与收尾

- [ ] 7.1 补齐集成冒烟:无依赖全流程、有 deck 全流程、压缩恢复、归档 child 四场景(集成测试)
- [ ] 7.2 验证 `pnpm typecheck && pnpm -w run lint && pnpm test` 连续三次稳定全绿
- [ ] 7.3 同步 docs/PLAN-SUPERPLAN.md 与新命名(README/decisions/tasks/timeline)及 M 分期,验证文档与实现一致
- [ ] 7.4 `openspec validate superplan-mvp` 通过,准备归档
