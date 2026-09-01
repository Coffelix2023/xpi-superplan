/** M3 工件生成:从 decisions.md 决策生成 proposal/design/tasks 三文档,SHALL + WHEN/THEN 语义。 */

import { atomicWrite } from "../archive/store.ts";

const LIST_ITEM_RE = /^- /;

/** 生成输入:决策摘要(来自 decisions.md 记录)与调研要点。 */
export interface ArtifactInput {
  /** 决策点 id + 问题 + 选中项标题/理由(未采纳理由已落 decisions.md,此处引用 id 即可追溯)。 */
  decisions: Array<{
    candidateTitle: string;
    id: string;
    note?: string;
    pointId: string;
    question: string;
  }>;
  /** 调研结论要点,进 proposal 背景。 */
  research: string[];
  title: string;
}

/** 任务定义,生成 tasks.md 的最小结构。 */
export interface ArtifactTask {
  acceptance: string;
  dependsOn: string[];
  id: string;
  title: string;
  verify: string;
}

function decisionLines(input: ArtifactInput): string[] {
  return input.decisions.map((d) => {
    const note = d.note ? ` — ${d.note}` : "";
    return `- D(${d.pointId}): ${d.question} → **${d.candidateTitle}**${note}(详见 decisions.md ${d.pointId})`;
  });
}

export function renderProposal(input: ArtifactInput): string {
  const decisions = decisionLines(input);
  return [
    `# ${input.title} — 提案`,
    "",
    "## 背景",
    "",
    ...input.research.map((r) => `- ${r}`),
    "",
    "## 目标",
    "",
    ...decisions.map((d) => `- SHALL:${d.replace(LIST_ITEM_RE, "")}`),
    "",
    "## 范围",
    "",
    `- 覆盖 ${input.decisions.length} 个已确认决策点的落地实现。`,
    "",
    "## 非目标",
    "",
    "- 未在 decisions.md 中确认的方向不实现。",
    "",
    "## 风险",
    "",
    "- 决策与实现偏差:执行前以 decisions.md 为唯一真相校验。",
    "",
  ].join("\n");
}

export function renderDesign(input: ArtifactInput): string {
  return [
    `# ${input.title} — 设计`,
    "",
    "## 架构",
    "",
    "系统按已确认决策点分模块;模块边界以 decisions.md 的决策点为单位。",
    "",
    "## 接口",
    "",
    ...input.decisions.map(
      (d) =>
        `- 接口 SHALL 满足决策 ${d.pointId}:${d.question}(方案:${d.candidateTitle})`,
    ),
    "",
    "## 数据流",
    "",
    "- 输入:决策记录(decisions.md)+ 调研(research.md)。",
    "- 输入: 决策记录 (decisions.md) 与调研要点 (research.md)。",
    "",
    "## 失败处理",
    "",
    "- WHEN 决策约束无法满足 THEN 停止实现,回退到决策点重新选型,不得静默偏离。",
    "",
  ].join("\n");
}

export function renderTasks(tasks: ArtifactTask[], input: ArtifactInput): string {
  const lines: string[] = [
    `# ${input.title} — 任务计划`,
    "",
    ...input.decisions.map((d) => `- 依据决策 ${d.pointId}:${d.candidateTitle}`),
    "",
  ];
  for (const t of tasks) {
    lines.push(
      `## ${t.id} ${t.title}`,
      "",
      `- 依赖: ${t.dependsOn.length > 0 ? t.dependsOn.join(", ") : "(无)"}`,
      `- 验收标准: SHALL ${t.acceptance}`,
      `- 验证命令: \`${t.verify}\``,
      "",
    );
  }
  return lines.join("\n");
}

export interface GeneratedArtifacts {
  "design.md": string;
  "proposal.md": string;
  "tasks.md": string;
}

/** 生成三文档;写入由调用方经 atomicWrite 完成。 */
export function generateArtifacts(
  input: ArtifactInput,
  tasks: ArtifactTask[],
): GeneratedArtifacts {
  return {
    "design.md": renderDesign(input),
    "proposal.md": renderProposal(input),
    "tasks.md": renderTasks(tasks, input),
  };
}

/** 写入三文档(跳过 README/timeline 等核心文件以外的路径校验,atomicWrite 内部把关)。 */
export async function writeArtifacts(
  workflowDir: string,
  input: ArtifactInput,
  tasks: ArtifactTask[],
): Promise<void> {
  const artifacts = generateArtifacts(input, tasks);
  await Promise.all(
    Object.entries(artifacts).map(([file, content]) =>
      atomicWrite(workflowDir, file, content),
    ),
  );
}
