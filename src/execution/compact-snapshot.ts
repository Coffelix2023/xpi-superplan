/**
 * M4 压缩前快照:session_before_compact 钩子触发时,任务状态先写盘再放行压缩。
 * design.md D6:压缩前必落盘是主动机制,不是阈值触发。
 */

import { appendFileSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveWorkflowDir } from "../archive/paths.ts";
import { readManifest } from "../archive/store.ts";
import { SESSION_ANCHOR_TYPE } from "../domain/types.ts";
import { nextPendingTask, readTaskStates } from "./task-state.ts";

/** 压缩前快照内容:恢复所需最小面(D6 锚点 + 任务状态)。 */
export interface CompactSnapshot {
  currentTaskId?: string;
  pendingCount: number;
  reason: string;
  revision: number;
  state: string;
  taskIdStates: Array<{
    id: string;
    state: string;
  }>;
  workflowId: string;
}

/** 生成快照(纯读);由 registerCompactSnapshot 在钩子内调用并落盘。 */
export async function buildSnapshot(
  cwd: string,
  workflowId: string,
  reason: string,
): Promise<CompactSnapshot> {
  const dir = resolveWorkflowDir(cwd, workflowId);
  const manifest = await readManifest(dir);
  const states = await readTaskStates(dir);
  const current = await nextPendingTask(dir);
  return {
    currentTaskId: current?.id,
    pendingCount: states.filter((s) => s.state === "pending").length,
    reason,
    revision: manifest.revision,
    state: manifest.state,
    taskIdStates: states,
    workflowId,
  };
}

/**
 * 注册压缩前快照钩子。当前工作流 id 由调用方闭包提供(命令层维护)。
 * 快照双写:session entry(appendEntry)+ timeline 追加,保证重启可读。
 */
export function registerCompactSnapshot(
  pi: ExtensionAPI,
  getWorkflowId: () => string | undefined,
  getCwd: () => string,
): void {
  pi.on("session_before_compact", async (event) => {
    const id = getWorkflowId();
    if (!id) return;
    const snapshot = await buildSnapshot(getCwd(), id, event.reason);
    pi.appendEntry(SESSION_ANCHOR_TYPE, snapshot);
    try {
      appendFileSync(
        path.join(resolveWorkflowDir(getCwd(), id), "timeline.md"),
        `- ${new Date().toISOString()} | compact-snapshot | 压缩前快照: ${JSON.stringify(snapshot)}\n`,
      );
    } catch {
      // timeline 写失败不阻塞压缩;session entry 已是主落盘
    }
  });
}
