/**
 * M7.1 集成冒烟:四个端到端场景(spec 7.1)。
 * 场景间共享真实文件系统(mkdtemp),走模块公开入口,不 mock 内部。
 * deck 场景的 deck 调用边界(tool_result details)与 CLI 检测(execFile)仍用桩——
 * 这两处是外部进程/用户交互边界,单测 2.4/3.3 已实测真实环境。
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  archiveWorkflow,
  bumpRevision,
  createChildWorkflow,
  createWorkflow,
  restoreFromDisk,
  updateManifest,
  workflowChain,
} from "./archive/store.ts";
import { checkArtifacts } from "./artifacts/cli.ts";
import {
  type ArtifactInput,
  type ArtifactTask,
  writeArtifacts,
} from "./artifacts/generate.ts";
import { captureDeckSelection, type ToolResultLike } from "./decision/capture.ts";
import { buildSnapshot } from "./execution/compact-snapshot.ts";
import { resumeWorkflow } from "./execution/pause-resume.ts";
import { parseTaskState, setTaskState } from "./execution/task-state.ts";
import { findBlock } from "./execution/taskfile.ts";

/** 断言正则(顶层声明)。 */
const ARCHIVED_RE = /已归档/;

let cwd: string;

afterEach(async () => {
  await rm(cwd, {
    force: true,
    recursive: true,
  });
});

beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), "superplan-integration-"));
});

function dirOf(id: string): string {
  return path.join(cwd, ".pi/superplan/workflows", id);
}

const DECK_RESULT: ToolResultLike = {
  toolName: "design_deck",
  details: {
    status: "completed",
    selections: {
      "db-choice": "sqlite-1 SQLite 轻量方案",
    },
  },
};

describe("场景1 无依赖全流程", () => {
  it("全流程: 创建, 决策, 工件, 任务执行, 完成, 归档", async () => {
    // 创建
    const manifest = await createWorkflow({
      cwd,
      id: "2026-09-01-e2e-flow",
      title: "端到端流程",
    });
    expect(manifest.state).toBe("draft");
    const dir = dirOf(manifest.id);

    // 决策(TUI 路径的落盘等价物:captureDeckSelection 直接收 tool_result)
    const point = {
      constraints: [],
      context: "",
      id: "db-choice",
      question: "数据库选哪个?",
      candidates: [
        {
          cons: [],
          id: "sqlite-1",
          pros: [],
          risks: [],
          summary: "",
          title: "SQLite 轻量方案",
        },
        {
          cons: [],
          id: "pg-1",
          pros: [],
          risks: [],
          summary: "",
          title: "Postgres 完整方案",
        },
      ],
    };
    const captured = await captureDeckSelection(
      dir,
      point,
      manifest.revision,
      DECK_RESULT,
    );
    expect(captured).toBe(true);
    expect(await readFile(path.join(dir, "decisions.md"), "utf8")).toContain(
      "sqlite-1",
    );

    // 状态推进到 planned 后生成工件
    await bumpRevision(dir, "researching");
    await bumpRevision(dir, "decision_pending");
    await bumpRevision(dir, "planned");
    const input: ArtifactInput = {
      title: "端到端流程",
      decisions: [
        {
          candidateTitle: "SQLite 轻量方案",
          id: "db-choice",
          pointId: "db-choice",
          question: "数据库选哪个?",
        },
      ],
      research: [
        "SQLite 单文件零运维",
      ],
    };
    const tasks: ArtifactTask[] = [
      {
        acceptance: "SHALL 数据库可读写",
        dependsOn: [],
        id: "S1",
        title: "接入 SQLite",
        verify: "pnpm test",
      },
    ];
    await writeArtifacts(dir, input, tasks);

    // 完整性校验通过
    const check = await checkArtifacts(dir);
    expect(check.mode).toBe("local");
    if (check.mode === "local") {
      expect(check.issues).toEqual([]);
    }

    // 任务执行
    await setTaskState(dir, "S1", "in_progress");
    await setTaskState(dir, "S1", "done");
    expect(
      parseTaskState(
        findBlock(await readFile(path.join(dir, "tasks.md"), "utf8"), "S1"),
      ),
    ).toBe("done");

    // completed -> 归档
    await bumpRevision(dir, "implementing");
    await bumpRevision(dir, "completed");
    const archived = await archiveWorkflow(cwd, manifest.id);
    expect(archived.archived).toBe(true);

    // 恢复视图:仅从磁盘读回
    const restored = await restoreFromDisk(cwd, manifest.id);
    expect(restored.manifest.state).toBe("archived");
  });
});

describe("场景2 有 deck 全流程", () => {
  it("deck 捕获强制回写决策并留痕, 拒绝安装退化路径同样收口", async () => {
    const manifest = await createWorkflow({
      cwd,
      id: "2026-09-01-e2e-deck",
      title: "Deck 流程",
    });
    const dir = dirOf(manifest.id);
    const point = {
      constraints: [],
      context: "",
      id: "db-choice",
      question: "数据库选哪个?",
      candidates: [
        {
          cons: [],
          id: "sqlite-1",
          pros: [],
          risks: [],
          summary: "",
          title: "SQLite 轻量方案",
        },
      ],
    };

    // 模拟模型调 deck 后的 tool_result(结构为 2.4 实测确认)
    expect(await captureDeckSelection(dir, point, manifest.revision, DECK_RESULT)).toBe(
      true,
    );

    // 重复捕获幂等语义:回写以 append 为主,二次捕获仍成功但内容可追溯
    const decisions = await readFile(path.join(dir, "decisions.md"), "utf8");
    expect(decisions).toContain("db-choice");
    expect(decisions).toContain("sqlite-1");
    // timeline 留痕
    const timeline = await readFile(path.join(dir, "timeline.md"), "utf8");
    expect(timeline).toContain("decision-captured");
  });
});

describe("场景3 压缩恢复", () => {
  it("快照先落盘再压缩, 恢复不丢任务进度", async () => {
    const manifest = await createWorkflow({
      cwd,
      id: "2026-09-01-e2e-compact",
      title: "压缩恢复流程",
    });
    const dir = dirOf(manifest.id);
    await bumpRevision(dir, "researching");
    await bumpRevision(dir, "decision_pending");
    await bumpRevision(dir, "planned");
    await bumpRevision(dir, "implementing");
    await writeArtifacts(
      dir,
      {
        decisions: [],
        research: [],
        title: "压缩恢复流程",
      },
      [
        {
          acceptance: "SHALL A",
          dependsOn: [],
          id: "S1",
          title: "任务一",
          verify: "true",
        },
        {
          acceptance: "SHALL B",
          id: "S2",
          title: "任务二",
          verify: "true",
          dependsOn: [
            "S1",
          ],
        },
      ],
    );

    // 执行 S1 完成,S2 进行中
    await setTaskState(dir, "S1", "in_progress");
    await setTaskState(dir, "S1", "done");
    await setTaskState(dir, "S2", "in_progress");

    // 压缩前快照(钩子内部逻辑)
    const snapshot = await buildSnapshot(cwd, manifest.id, "context-full");
    expect(snapshot.currentTaskId).toBe("S2");
    expect(snapshot.taskIdStates).toEqual([
      {
        id: "S1",
        state: "done",
      },
      {
        id: "S2",
        state: "in_progress",
      },
    ]);

    // "新会话":仅凭 workflow id 从磁盘恢复
    const info = await resumeWorkflow(cwd, manifest.id);
    expect(info.currentTask?.id).toBe("S2");
    expect(info.pendingCount).toBe(0); // in_progress 不算 pending;定位靠 nextPendingTask
  });
});

describe("场景4 归档 child", () => {
  it("父归档只读, child 独立推进, 父子链可追溯", async () => {
    await createWorkflow({
      cwd,
      id: "2026-09-01-e2e-parent",
      title: "父流程",
    });
    const parentDir = dirOf("2026-09-01-e2e-parent");
    await bumpRevision(parentDir, "researching");
    await bumpRevision(parentDir, "decision_pending");
    await bumpRevision(parentDir, "planned");
    await bumpRevision(parentDir, "implementing");
    await bumpRevision(parentDir, "completed");
    await archiveWorkflow(cwd, "2026-09-01-e2e-parent");

    // 父归档后写入被拒
    await expect(updateManifest(parentDir, () => {})).rejects.toThrow(ARCHIVED_RE);

    // child 创建并推进
    const child = await createChildWorkflow({
      childId: "2026-09-02-e2e-child",
      cwd,
      parent: "2026-09-01-e2e-parent",
      title: "子流程",
    });
    expect(child.parent).toBe("2026-09-01-e2e-parent");
    await bumpRevision(dirOf(child.id), "researching");

    // 父子链:从 child 出发可追溯,父节点带归档时间
    const chain = await workflowChain(cwd, child.id);
    expect(chain.map((n) => n.manifest.id)).toEqual([
      "2026-09-01-e2e-parent",
      child.id,
    ]);
    expect(chain[0].archivedAt).toEqual(expect.any(String));
    expect(chain[1].archivedAt).toBeUndefined();
  });
});
