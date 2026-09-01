import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkflow } from "../archive/store.ts";
import {
  canTaskTransition,
  nextPendingTask,
  parseTaskState,
  readTaskStates,
  setTaskState,
} from "./task-state.ts";
import { allBlocks, findBlock, updateBlockState } from "./taskfile.ts";

const TASKS = `# 测试 — 任务计划

## T1 实现存储层

- 依赖: (无)
- 验收标准: SHALL 读写一致
- 验证命令: \`pnpm test\`

## T2 接入队列

- 依赖: T1
- 验收标准: SHALL 并发安全
- 验证命令: \`pnpm test\`
`;

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "superplan-taskstate-"));
  await createWorkflow({
    cwd: dir,
    id: "2026-01-01-test",
    title: "测试",
  });
  await writeFile(path.join(workflowDir(), "tasks.md"), TASKS, "utf8");
});

afterEach(async () => {
  await rm(dir, {
    force: true,
    recursive: true,
  });
});

const { writeFile } = await import("node:fs/promises");
const workflowDir = () =>
  path.join(dir, ".pi", "superplan", "workflows", "2026-01-01-test");
const tasksFile = () => path.join(workflowDir(), "tasks.md");
const timeline = async () => readFile(path.join(workflowDir(), "timeline.md"), "utf8");

describe("canTaskTransition", () => {
  it("pending -> in_progress -> done 合法;failed 不能直接 done;done 终态", () => {
    expect(canTaskTransition("pending", "in_progress")).toBe(true);
    expect(canTaskTransition("in_progress", "done")).toBe(true);
    expect(canTaskTransition("in_progress", "failed")).toBe(true);
    expect(canTaskTransition("failed", "pending")).toBe(true);
    expect(canTaskTransition("failed", "done")).toBe(false);
    expect(canTaskTransition("done", "in_progress")).toBe(false);
    expect(canTaskTransition("pending", "done")).toBe(false);
  });
});

describe("taskfile 低层读写", () => {
  it("allBlocks 按文件顺序解析,无状态行时缺省 pending", () => {
    const blocks = allBlocks(TASKS);
    expect(blocks.map((b) => b.id)).toEqual([
      "T1",
      "T2",
    ]);
    expect(parseTaskState(blocks[0])).toBe("pending");
  });

  it("updateBlockState 插入状态行,已有状态行则替换", () => {
    const once = updateBlockState(TASKS, "T2", "in_progress");
    expect(once).toContain("## T2 接入队列\n\n- 状态: in_progress\n");
    const twice = updateBlockState(once, "T2", "done");
    expect(twice).toContain("- 状态: done");
    expect(twice).not.toContain("in_progress");
  });

  it("findBlock 任务不存在抛错", () => {
    expect(() => findBlock(TASKS, "ghost")).toThrow("不存在任务: ghost");
  });
});

describe("setTaskState(落盘 + timeline)", () => {
  it("状态变更写入 tasks.md 且 timeline 记录", async () => {
    await setTaskState(workflowDir(), "T1", "in_progress");
    const text = await readFile(tasksFile(), "utf8");
    expect(text).toContain("- 状态: in_progress");
    expect(await timeline()).toContain("任务 T1: pending -> in_progress");
  });

  it("非法转换抛错且 tasks.md 不被改写", async () => {
    await expect(setTaskState(workflowDir(), "T1", "done")).rejects.toThrow(
      "非法状态转换",
    );
    expect(await readFile(tasksFile(), "utf8")).not.toContain("- 状态:");
  });

  it("任务不存在抛错", async () => {
    await expect(setTaskState(workflowDir(), "ghost", "in_progress")).rejects.toThrow(
      "不存在任务",
    );
  });
});

describe("重启后读回(readTaskStates/nextPendingTask)", () => {
  it("状态变更后从磁盘读回与写入一致", async () => {
    await setTaskState(workflowDir(), "T1", "in_progress");
    await setTaskState(workflowDir(), "T1", "done");
    await setTaskState(workflowDir(), "T2", "in_progress");
    const states = await readTaskStates(workflowDir());
    expect(states).toEqual([
      {
        id: "T1",
        state: "done",
      },
      {
        id: "T2",
        state: "in_progress",
      },
    ]);
  });

  it("nextPendingTask 返回第一个 pending;全部完成返回 undefined", async () => {
    await setTaskState(workflowDir(), "T1", "in_progress");
    await setTaskState(workflowDir(), "T1", "done");
    expect(await nextPendingTask(workflowDir())).toEqual({
      id: "T2",
      title: "接入队列",
    });
    await setTaskState(workflowDir(), "T2", "in_progress");
    await setTaskState(workflowDir(), "T2", "done");
    expect(await nextPendingTask(workflowDir())).toBeUndefined();
  });

  it("tasks.md 缺失时 readTaskStates 返回空", async () => {
    await rm(tasksFile());
    expect(await readTaskStates(workflowDir())).toEqual([]);
  });
});
