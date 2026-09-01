import { appendTimeline } from "../archive/store.ts";
import type { DecisionPoint, Selection } from "../domain/types.ts";
import { appendDecision } from "./record.ts";

/** ctx.ui 子集,TUI 退化路径所需最小面。 */
export interface PromptUI {
  input(title: string, placeholder?: string): Promise<string | undefined>;
  notify(message: string, type?: "info" | "warning" | "error"): void;
  select(title: string, options: string[]): Promise<string | undefined>;
}

/** 用户取消或输入非法 id 时返回 undefined,由调用方决定重试或中断。 */
export async function promptSelection(
  ui: PromptUI,
  point: DecisionPoint,
): Promise<Pick<Selection, "candidateId" | "note"> | undefined> {
  const options = point.candidates.map((c) => `${c.id} ${c.title}`);
  const picked = await ui.select(`决策: ${point.question}`, options);
  if (picked === undefined) {
    return undefined;
  }
  const candidateId = picked.split(" ")[0];
  if (!point.candidates.some((c) => c.id === candidateId)) {
    ui.notify(`非法候选 id: ${picked}`, "warning");
    return undefined;
  }
  const note = await ui.input("备注(可留空)");
  return {
    candidateId,
    note: note || undefined,
  };
}

/**
 * TUI 退化路径:promptSelection -> 落盘 -> timeline。
 * 用户取消(返回 undefined)时记录 skipped,不写入决策。
 */
export async function decideViaTui(
  workflowDir: string,
  ui: PromptUI,
  point: DecisionPoint,
  revision: number,
): Promise<boolean> {
  const selection = await promptSelection(ui, point);
  if (!selection) {
    await appendTimeline(
      workflowDir,
      "decision-skipped",
      `决策点 ${point.id} 用户取消`,
    );
    ui.notify(`决策点 ${point.id} 已跳过`, "warning");
    return false;
  }
  await appendDecision(workflowDir, point, {
    ...selection,
    revision,
  });
  ui.notify(`决策 ${point.id} 已落盘: ${selection.candidateId}`);
  return true;
}
