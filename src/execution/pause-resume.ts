/**
 * M4 暂停/恢复,对应 design.md D6 恢复协议:
 * 暂停 = 工作流状态转 paused + timeline;恢复 = 从磁盘重读定位下一个待办任务。
 */

import { resolveWorkflowDir } from "../archive/paths.ts";
import { bumpRevision, readManifest } from "../archive/store.ts";
import { canTransition, type WorkflowState } from "../domain/types.ts";
import { nextPendingTask, readTaskStates } from "./task-state.ts";
export interface ResumeInfo {
  currentTask?: {
    id: string;
    title: string;
  };
  id: string;
  manifest: {
    id: string;
    revision: number;
    state: WorkflowState;
    title: string;
  };
  pendingCount: number;
  states: Array<{
    id: string;
    state: string;
  }>;
}

/** 暂停工作流(状态转换 fail-closed);timeline 记录暂停原因。 */
export async function pauseWorkflow(
  cwd: string,
  id: string,
  reason?: string,
): Promise<void> {
  const dir = resolveWorkflowDir(cwd, id);
  const manifest = await readManifest(dir);
  if (!canTransition(manifest.state, "paused")) {
    throw new Error(`工作流 ${id} 状态 ${manifest.state} 不可暂停`);
  }
  await bumpRevision(dir, "paused");
  if (reason) {
    const { appendTimeline } = await import("../archive/store.ts");
    await appendTimeline(dir, "pause-reason", reason);
  }
}
/**
 * 恢复:读 manifest + 全部任务状态,定位下一个待办任务。
 * 新会话只需 workflow id,其余从磁盘重放(design.md D6)。
 */
export async function resumeWorkflow(cwd: string, id: string): Promise<ResumeInfo> {
  const dir = resolveWorkflowDir(cwd, id);
  const manifest = await readManifest(dir);
  const states = await readTaskStates(dir);
  const pendingCount = states.filter((s) => s.state === "pending").length;
  const currentTask = await nextPendingTask(dir);
  return {
    currentTask,
    id: manifest.id,
    manifest: {
      id: manifest.id,
      revision: manifest.revision,
      state: manifest.state,
      title: manifest.title,
    },
    pendingCount,
    states,
  };
}
