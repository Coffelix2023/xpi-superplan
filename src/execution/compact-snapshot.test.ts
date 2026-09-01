import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkflow } from "../archive/store.ts";
import { buildSnapshot, registerCompactSnapshot } from "./compact-snapshot.ts";
import { setTaskState } from "./task-state.ts";

const TASKS = `# 任务

## T1 首任务

- 依赖: (无)
- 验收标准: SHALL 完成
- 验证命令: \`pnpm test\`

## T2 次任务

- 依赖: T1
- 验收标准: SHALL 通过
- 验证命令: \`pnpm test\`
`;

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "superplan-compact-"));
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

describe("buildSnapshot", () => {
  it("快照含锚点字段 + 全部任务状态 + 下一个待办", async () => {
    await setTaskState(workflowDir(), "T1", "in_progress");
    await setTaskState(workflowDir(), "T1", "done");
    const snapshot = await buildSnapshot(dir, "2026-01-01-test", "threshold");
    expect(snapshot).toMatchObject({
      currentTaskId: "T2",
      pendingCount: 1,
      reason: "threshold",
      revision: 1,
      state: "draft",
      workflowId: "2026-01-01-test",
    });
    expect(snapshot.taskIdStates).toEqual([
      {
        id: "T1",
        state: "done",
      },
      {
        id: "T2",
        state: "pending",
      },
    ]);
  });
});

describe("registerCompactSnapshot", () => {
  interface Entry {
    data: unknown;
    type: string;
  }
  type Handler = (event: { reason: string }) => Promise<void>;

  function register(): {
    entries: Entry[];
    fire: Handler;
  } {
    const entries: Entry[] = [];
    let handler: Handler | undefined;
    const pi = {
      appendEntry: (type: string, data: unknown) =>
        entries.push({
          type,
          data,
        }),
      on: (_event: string, h: Handler) => {
        handler = h;
      },
    } as unknown as Parameters<typeof registerCompactSnapshot>[0];
    registerCompactSnapshot(
      pi,
      () => "2026-01-01-test",
      () => dir,
    );
    return {
      entries,
      fire: handler as Handler,
    };
  }

  it("compact hook writes snapshot to disk first", async () => {
    await setTaskState(workflowDir(), "T1", "in_progress");
    await setTaskState(workflowDir(), "T1", "done");
    const { entries, fire } = register();
    await fire({
      reason: "manual",
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("xpi-superplan");
    const snapshot = entries[0].data as {
      currentTaskId?: string;
      workflowId: string;
    };
    expect(snapshot.workflowId).toBe("2026-01-01-test");
    expect(snapshot.currentTaskId).toBe("T2");
    // timeline 也落了盘
    expect(await timeline()).toContain("compact-snapshot");
  });

  it("无活动工作流时不写快照", async () => {
    const entries: Entry[] = [];
    let handler: Handler | undefined;
    const pi = {
      appendEntry: (type: string, data: unknown) =>
        entries.push({
          type,
          data,
        }),
      on: (_e: string, h: Handler) => {
        handler = h;
      },
    } as unknown as Parameters<typeof registerCompactSnapshot>[0];
    registerCompactSnapshot(
      pi,
      () => undefined,
      () => dir,
    );
    await (handler as Handler)({
      reason: "manual",
    });
    expect(entries).toHaveLength(0);
  });
});
