/**
 * tasks.md 任务块的低层读写:块解析/状态行更新/任务文件路径。
 * 被 task-state.ts(状态机)与恢复命令共用。
 */

import path from "node:path";
import type { TaskState } from "../domain/types.ts";

/** tasks.md 中一个任务块(`## <id> <title>` 至下一块/文件尾)。 */
export interface TaskBlock {
  /** 块的原始文本(不含标题行)。 */
  body: string;
  id: string;
  /** 状态行 `- 状态: <state>` 的值;无状态行视为 pending。 */
  state?: TaskState;
  title: string;
}

export function workflowFile(workflowDir: string): string {
  return path.join(workflowDir, "tasks.md");
}

const HEADING_RE = /^## (\S+)(?:\s+(.*))?$/;
const STATE_RE = /^- 状态: (\S+)\s*$/;
const STATE_LINE_RE = /^- 状态: \S+\s*$/;

/** 解析 tasks.md 全部任务块(按文件顺序)。 */
export function allBlocks(text: string): TaskBlock[] {
  const blocks: TaskBlock[] = [];
  let current:
    | {
        bodyLines: string[];
        id: string;
        state?: TaskState;
        title: string;
      }
    | undefined;
  const flush = () => {
    if (current) {
      blocks.push({
        body: current.bodyLines.join("\n"),
        id: current.id,
        state: current.state,
        title: current.title,
      });
    }
  };
  for (const line of text.split("\n")) {
    const heading = line.match(HEADING_RE);
    if (heading) {
      flush();
      current = {
        bodyLines: [],
        id: heading[1],
        title: heading[2] ?? "",
      };
      continue;
    }
    if (!current) continue;
    const state = line.match(STATE_RE);
    if (state) {
      current.state = state[1] as TaskState;
    } else {
      current.bodyLines.push(line);
    }
  }
  flush();
  return blocks;
}

/** 按 id 查找任务块;不存在抛错(fail-closed)。 */
export function findBlock(text: string, taskId: string): TaskBlock {
  const block = allBlocks(text).find((b) => b.id === taskId);
  if (!block) {
    throw new Error(`tasks.md 中不存在任务: ${taskId}`);
  }
  return block;
}

/**
 * 更新任务块的状态行:已有 `- 状态:` 行则替换,否则在块首(标题行后)插入。
 * 返回更新后的完整文本;不落盘。
 */
export function updateBlockState(
  text: string,
  taskId: string,
  state: TaskState,
): string {
  const lines = text.split("\n");
  let start = -1;
  let stateLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].match(HEADING_RE);
    if (heading && heading[1] === taskId) {
      start = i;
      continue;
    }
    if (start === -1) continue;
    // 到达下一个任务块则停止
    if (heading) break;
    if (STATE_LINE_RE.test(lines[i])) {
      stateLine = i;
      break;
    }
  }
  if (start === -1) {
    throw new Error(`tasks.md 中不存在任务: ${taskId}`);
  }
  const line = `- 状态: ${state}`;
  if (stateLine !== -1) {
    lines[stateLine] = line;
  } else {
    lines.splice(start + 1, 0, "", line);
  }
  return lines.join("\n");
}
