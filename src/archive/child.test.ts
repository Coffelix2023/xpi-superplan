import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bumpRevision,
  createChildWorkflow,
  createWorkflow,
  readManifest,
} from "./store.ts";

let cwd: string;
/** 断言正则(顶层声明)。 */
const EXISTS_RE = /已存在/;
const CHILD_ID_RE = /^\d{4}-\d{2}-\d{2}-child-followup$/;
const PARENT = "2026-09-01-parent-flow";
const CHILD = "2026-09-02-child-flow";

afterEach(async () => {
  await rm(cwd, {
    force: true,
    recursive: true,
  });
});

beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), "superplan-child-"));
});

async function snapshotParent(): Promise<Map<string, string>> {
  const dir = path.join(cwd, ".pi/superplan/workflows", PARENT);
  const files = [
    "README.md",
    "decisions.md",
    "design.md",
    "proposal.md",
    "research.md",
    "tasks.md",
    "timeline.md",
  ];
  const contents = await Promise.all(
    files.map(async (file) => {
      try {
        return await readFile(path.join(dir, file), "utf8");
      } catch {
        return null; // 缺文件跳过
      }
    }),
  );
  const snapshot = new Map<string, string>();
  files.forEach((file, i) => {
    const content = contents[i];
    if (content !== null) {
      snapshot.set(file, content);
    }
  });
  return snapshot;
}

describe("createChildWorkflow", () => {
  it("child 记录 parent + 复制上下文 + revision 1,父档案字节不变", async () => {
    await createWorkflow({
      cwd,
      id: PARENT,
      title: "Parent",
    });
    const parentDir = path.join(cwd, ".pi/superplan/workflows", PARENT);
    await atomicWriteTest(parentDir, "decisions.md", "# 决策\n\n选了方案 A");
    await bumpRevision(parentDir, "researching");

    const before = await snapshotParent();

    const child = await createChildWorkflow({
      cwd,
      parent: PARENT,
      title: "Child Followup",
    });

    // child manifest
    expect(child.id).toMatch(CHILD_ID_RE);
    expect(child.parent).toBe(PARENT);
    expect(child.revision).toBe(1);
    expect(child.state).toBe("draft");

    const childDir = path.join(cwd, ".pi/superplan/workflows", child.id);
    const childReadme = await readFile(path.join(childDir, "README.md"), "utf8");
    expect(childReadme).toContain(`parent: ${PARENT}`);
    // 上下文已复制
    const childDecisions = await readFile(path.join(childDir, "decisions.md"), "utf8");
    expect(childDecisions).toContain("选了方案 A");
    // 父档案字节不变(时间线内的 child-created 记录在父 timeline 属预期行为变化;
    // spec 要求"父档案保持不变"指档案内容,child-created 记录在父 timeline 供追溯)
    const after = await snapshotParent();
    for (const [file, content] of before) {
      if (file !== "timeline.md") {
        expect(after.get(file), file).toBe(content);
      }
    }
  });

  it("显式 childId 与自定义 copyFiles 生效", async () => {
    await createWorkflow({
      cwd,
      id: PARENT,
      title: "Parent",
    });
    const parentDir = path.join(cwd, ".pi/superplan/workflows", PARENT);
    await atomicWriteTest(parentDir, "research.md", "调研结论 XYZ");

    const child = await createChildWorkflow({
      childId: CHILD,
      copyFiles: [
        "research.md",
      ],
      cwd,
      parent: PARENT,
      title: "Custom Child",
    });

    expect(child.id).toBe(CHILD);
    const childDir = path.join(cwd, ".pi/superplan/workflows", CHILD);
    expect(await readFile(path.join(childDir, "research.md"), "utf8")).toContain(
      "调研结论 XYZ",
    );
    // 未复制的文件保持模板默认
    const decisions = await readFile(path.join(childDir, "decisions.md"), "utf8");
    expect(decisions).not.toContain("调研结论 XYZ");
  });

  it("父不存在时抛错(fail-closed)", async () => {
    await expect(
      createChildWorkflow({
        cwd,
        parent: "2026-09-01-no-such",
        title: "X",
      }),
    ).rejects.toThrow();
  });

  it("child id 已存在时抛错且父档案不变", async () => {
    await createWorkflow({
      cwd,
      id: PARENT,
      title: "Parent",
    });
    await createWorkflow({
      cwd,
      id: CHILD,
      title: "Existing",
    });
    const before = await snapshotParent();

    await expect(
      createChildWorkflow({
        childId: CHILD,
        cwd,
        parent: PARENT,
        title: "Dup",
      }),
    ).rejects.toThrow(EXISTS_RE);

    const after = await snapshotParent();
    for (const [file, content] of before) {
      if (file !== "timeline.md") {
        expect(after.get(file), file).toBe(content);
      }
    }
  });

  it("child 的 timeline 记录创建事件,父可读回状态", async () => {
    await createWorkflow({
      cwd,
      id: PARENT,
      title: "Parent",
    });
    const child = await createChildWorkflow({
      cwd,
      parent: PARENT,
      title: "Traced",
    });
    const childDir = path.join(cwd, ".pi/superplan/workflows", child.id);
    const timeline = await readFile(path.join(childDir, "timeline.md"), "utf8");
    expect(timeline).toContain("child-created");
    expect(timeline).toContain(`从 parent ${PARENT} 创建`);
    // 父状态可正常读回
    const parentDir = path.join(cwd, ".pi/superplan/workflows", PARENT);
    const manifest = await readManifest(parentDir);
    expect(manifest.id).toBe(PARENT);
  });
});

/** 测试辅助:绕过 createWorkflow 直接写父档案文件。 */
async function atomicWriteTest(dir: string, file: string, content: string) {
  const { atomicWrite } = await import("./store.ts");
  await atomicWrite(dir, file, content);
}
