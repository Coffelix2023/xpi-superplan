/**
 * M4 任务状态机:待办/进行/完成/失败 + 状态落盘 + timeline,对应 design.md D6。
 * 状态写入 tasks.md 的任务块状态行;重启后从磁盘读回。
 */

import { readFile } from "node:fs/promises";
import { appendTimeline, atomicWrite } from "../archive/store.ts";
import type { TaskState } from "../domain/types.ts";
import {
  allBlocks,
  findBlock,
  type TaskBlock,
  updateBlockState,
  workflowFile,
} from "./taskfile.ts";

/** 合法任务状态转换;failed 不可直接转 done(须先回 pending),done 终态。 */
const TASK_TRANSITIONS: Readonly<Record<TaskState, readonly TaskState[]>> = {
  done: [],
  failed: [
    "pending",
  ],
  in_progress: [
    "done",
    "failed",
    "pending",
  ],
  pending: [
    "in_progress",
  ],
};

export function canTaskTransition(from: TaskState, to: TaskState): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

/** 任务块状态:状态行缺省视为 pending。 */
export function parseTaskState(block: TaskBlock): TaskState {
  return block.state ?? "pending";
}

/**
 * 变更任务状态并落盘:重写 tasks.md 对应块的状态行 + timeline。
 * 非法转换或任务不存在抛错(fail-closed),不产生半写状态。
 */
export async function setTaskState(
  workflowDir: string,
  taskId: string,
  to: TaskState,
): Promise<{
  from: TaskState;
  to: TaskState;
}> {
  const text = await readFile(workflowFile(workflowDir), "utf8");
  const from = parseTaskState(findBlock(text, taskId));
  if (!canTaskTransition(from, to)) {
    throw new Error(`任务 ${taskId} 非法状态转换: ${from} -> ${to}`);
  }
  await atomicWrite(workflowDir, "tasks.md", updateBlockState(text, taskId, to));
  await appendTimeline(workflowDir, "task-state", `任务 ${taskId}: ${from} -> ${to}`);
  return {
    from,
    to,
  };
}

/** 重启后读回:解析 tasks.md 返回全部任务块状态(tasks.md 缺失视为空)。 */
export async function readTaskStates(workflowDir: string): Promise<
  Array<{
    id: string;
    state: TaskState;
  }>
> {
  let text = "";
  try {
    text = await readFile(workflowFile(workflowDir), "utf8");
  } catch {
    return [];
  }
  return allBlocks(text).map((b) => ({
    id: b.id,
    state: parseTaskState(b),
  }));
}

/** 定位下一个待办任务(按文件顺序第一个 pending);供恢复命令使用。 */
export async function nextPendingTask(workflowDir: string): Promise<
  | {
      id: string;
      title: string;
    }
  | undefined
> {
  const states = await readTaskStates(workflowDir);
  const pending = states.find((s) => s.state === "pending");
  if (!pending) return undefined;
  const text = await readFile(workflowFile(workflowDir), "utf8");
  return {
    id: pending.id,
    title: findBlock(text, pending.id).title,
  };
}
