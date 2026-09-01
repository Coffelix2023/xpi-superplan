import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkflow } from "../archive/store.ts";
import { pauseWorkflow, resumeWorkflow } from "./pause-resume.ts";
import { setTaskState } from "./task-state.ts";

const TASKS = `# 测试 — 任务计划

## T1 第一步

- 依赖: (无)
- 验收标准: SHALL 完成
- 验证命令: \`pnpm test\`

## T2 第二步

- 依赖: T1
- 验收标准: SHALL 通过
- 验证命令: \`pnpm test\`
`;

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "superplan-pause-"));
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

const workflowDir = () =>
  path.join(dir, ".pi", "superplan", "workflows", "2026-01-01-test");
const timeline = async () => readFile(path.join(workflowDir(), "timeline.md"), "utf8");

describe("pauseWorkflow", () => {
  it("implementing 可暂停, manifest 转 paused 并记 timeline", async () => {
    const { bumpRevision, readManifest } = await import("../archive/store.ts");
    const wf = workflowDir();
    await bumpRevision(wf, "researching");
    await bumpRevision(wf, "decision_pending");
    await bumpRevision(wf, "planned");
    await bumpRevision(wf, "implementing");
    await pauseWorkflow(dir, "2026-01-01-test", "等依赖就绪");
    const manifest = await readManifest(wf);
    expect(manifest.state).toBe("paused");
    expect(await timeline()).toContain("pause-reason | 等依赖就绪");
  });

  it("completed 状态不可暂停(fail-closed)", async () => {
    const { bumpRevision } = await import("../archive/store.ts");
    const wf = workflowDir();
    await bumpRevision(wf, "researching");
    await bumpRevision(wf, "paused");
    await bumpRevision(wf, "planned");
    await bumpRevision(wf, "implementing");
    await bumpRevision(wf, "completed");
    await expect(pauseWorkflow(dir, "2026-01-01-test")).rejects.toThrow("不可暂停");
  });
});

describe("resumeWorkflow 恢复", () => {
  it("返回 manifest、任务状态与下一个待办任务", async () => {
    await setTaskState(workflowDir(), "T1", "in_progress");
    await setTaskState(workflowDir(), "T1", "done");
    const info = await resumeWorkflow(dir, "2026-01-01-test");
    expect(info.manifest.title).toBe("测试");
    expect(info.pendingCount).toBe(1);
    expect(info.currentTask).toEqual({
      id: "T2",
      title: "第二步",
    });
    expect(info.states).toContainEqual({
      id: "T1",
      state: "done",
    });
  });

  it("全部完成后 currentTask 为 undefined", async () => {
    await setTaskState(workflowDir(), "T1", "in_progress");
    await setTaskState(workflowDir(), "T1", "done");
    await setTaskState(workflowDir(), "T2", "in_progress");
    await setTaskState(workflowDir(), "T2", "done");
    const info = await resumeWorkflow(dir, "2026-01-01-test");
    expect(info.currentTask).toBeUndefined();
    expect(info.pendingCount).toBe(0);
  });
});
