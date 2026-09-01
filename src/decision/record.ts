import { atomicWrite } from "../archive/store.ts";
import type { DecisionPoint, Selection } from "../domain/types.ts";

/** 追加一条决策记录到 decisions.md;不重写历史。 */
export async function appendDecision(
  workflowDir: string,
  point: DecisionPoint,
  selection: Pick<Selection, "candidateId" | "note" | "revision">,
): Promise<void> {
  const chosen = point.candidates.find((c) => c.id === selection.candidateId);
  if (!chosen) {
    throw new Error(`决策点 ${point.id} 无候选 ${selection.candidateId},拒绝写入`);
  }
  const rejected = point.candidates
    .filter((c) => c.id !== selection.candidateId)
    .map((c) => `- ${c.id}: ${c.risks.join("; ") || "无具体风险说明"}`)
    .join("\n");
  const lines = [
    `## ${point.id} — ${point.question}`,
    "",
    `- 时间: ${new Date().toISOString()}`,
    `- revision: ${selection.revision}`,
    "- 全部候选:",
    ...point.candidates.map((c) => `  - ${c.id} ${c.title}: ${c.summary}`),
    `- 选中项: **${chosen.id}** ${chosen.title}`,
    `- 备注: ${selection.note ?? "(无)"}`,
    "- 未采纳项及理由:",
    rejected || "  - (单候选)",
    "",
  ];
  await atomicWrite(workflowDir, "decisions.md", `${lines.join("\n")}\n`);
}
