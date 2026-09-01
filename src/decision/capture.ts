/**
 * 2.5 tool_result 捕获与强制回写,见 design.md D1:
 * 扩展在 on("tool_result") 边界校验并落盘,不依赖模型自觉。
 * 实测结构(design.md Open Questions,2026-08-31):
 * details.selections = Record<slideId, optionLabel>,label 为 "<candidateId> <title>"。
 */

import { appendTimeline } from "../archive/store.ts";
import type { DecisionPoint, Selection } from "../domain/types.ts";
import { appendDecision } from "./record.ts";

/** pi-design-deck tool_result details 的实测面。 */
export interface DeckDetails {
  notes?: Record<string, string>;
  selections?: Record<string, string>;
  status?: string;
}

/** tool_result 事件中本扩展关心的最小面。 */
export interface ToolResultLike {
  details: unknown;
  toolName: string;
}

/** design_deck completed 结果才有效;取消/超时/错误均无 selections。 */
export function isCompletedDeckResult(
  event: ToolResultLike,
): event is ToolResultLike & {
  details: DeckDetails;
} {
  if (event.toolName !== "design_deck") {
    return false;
  }
  const d = event.details as DeckDetails | undefined;
  return (
    typeof d === "object" &&
    d !== null &&
    d.status === "completed" &&
    typeof d.selections === "object" &&
    d.selections !== null
  );
}

/** label "<candidateId> <title>" 拆出 candidateId;与 TUI 路径同一约定。 */
function candidateIdFromLabel(point: DecisionPoint, label: string): string | undefined {
  const id = label.split(" ")[0];
  return point.candidates.some((c) => c.id === id) ? id : undefined;
}

/**
 * 从 completed details 提取本决策点的 selection。
 * selections 不含本决策点(可能多 slide 混合)时返回 undefined。
 * label 无法映射回候选时抛错(fail-closed),由调用方退化 TUI 重新收集。
 */
export function selectionFromDetails(
  point: DecisionPoint,
  details: DeckDetails,
  revision: number,
): Selection | undefined {
  const label = details.selections?.[point.id];
  if (label === undefined) {
    return undefined;
  }
  const candidateId = candidateIdFromLabel(point, label);
  if (!candidateId) {
    throw new Error(
      `决策点 ${point.id} 的 label 无法映射回候选: ${JSON.stringify(label)}`,
    );
  }
  return {
    at: new Date().toISOString(),
    candidateId,
    note: details.notes?.[point.id],
    pointId: point.id,
    revision,
  };
}

/**
 * tool_result 边界的强制回写:有选择则落盘(补写拦截点),无则返回 false。
 * 返回 true 表示 decisions.md 已包含该决策点的记录。
 */
export async function captureDeckSelection(
  workflowDir: string,
  point: DecisionPoint,
  revision: number,
  event: ToolResultLike,
): Promise<boolean> {
  if (!isCompletedDeckResult(event)) {
    return false;
  }
  const selection = selectionFromDetails(point, event.details, revision);
  if (!selection) {
    return false;
  }
  await appendDecision(workflowDir, point, selection);
  await appendTimeline(
    workflowDir,
    "decision-captured",
    `决策点 ${point.id} 从 deck tool_result 强制回写,选中 ${selection.candidateId}`,
  );
  return true;
}
