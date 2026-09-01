import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ARCHIVE_INDEX,
  archiveWorkflow,
  assertWritable,
  atomicWrite,
  bumpRevision,
  createWorkflow,
  readArchiveIndex,
} from "./store.ts";

/** 错误断言正则(顶层声明,避免重复构建)。 */
const ARCHIVED_RE = /已归档/;
const CHILD_HINT_RE = /已归档.*child workflow/;
const ONLY_COMPLETED_RE = /仅 completed 可归档/;

let cwd: string;
const ID = "2026-09-01-archive-test";

afterEach(async () => {
  await rm(cwd, {
    force: true,
    recursive: true,
  });
});

beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), "superplan-archive-"));
});

/** draft -> researching -> decision_pending -> planned -> implementing -> completed */
async function driveToCompleted(id: string): Promise<void> {
  const dir = path.join(cwd, ".pi/superplan/workflows", id);
  // 状态转换必须顺序执行(状态机约束),逐个显式调用
  await bumpRevision(dir, "researching");
  await bumpRevision(dir, "decision_pending");
  await bumpRevision(dir, "planned");
  await bumpRevision(dir, "implementing");
  await bumpRevision(dir, "completed");
}

describe("assertWritable", () => {
  it("archived 状态拒绝并提示创建 child", () => {
    expect(() =>
      assertWritable({
        createdAt: "",
        id: ID,
        revision: 1,
        state: "archived",
        title: "t",
        updatedAt: "",
      }),
    ).toThrow(CHILD_HINT_RE);
  });

  it("completed 状态放行", () => {
    expect(() =>
      assertWritable({
        createdAt: "",
        id: ID,
        revision: 1,
        state: "completed",
        title: "t",
        updatedAt: "",
      }),
    ).not.toThrow();
  });
});

describe("archiveWorkflow", () => {
  it("completed 归档:状态 archived + 新 revision + timeline + 归档索引", async () => {
    await createWorkflow({
      cwd,
      id: ID,
      title: "Archive Test",
    });
    await driveToCompleted(ID);

    const result = await archiveWorkflow(cwd, ID);

    expect(result.archived).toBe(true);
    expect(result.manifest.state).toBe("archived");
    const readme = await readFile(
      path.join(cwd, `.pi/superplan/workflows/${ID}/README.md`),
      "utf8",
    );
    expect(readme).toContain("state: archived");
    const timeline = await readFile(
      path.join(cwd, `.pi/superplan/workflows/${ID}/timeline.md`),
      "utf8",
    );
    expect(timeline).toContain("状态 -> archived");
    const index = await readArchiveIndex(cwd);
    expect(index).toEqual([
      {
        archivedAt: expect.any(String),
        id: ID,
        title: "Archive Test",
      },
    ]);
  });

  it("非 completed 状态拒绝归档", async () => {
    await createWorkflow({
      cwd,
      id: ID,
      title: "Archive Test",
    });
    await expect(archiveWorkflow(cwd, ID)).rejects.toThrow(ONLY_COMPLETED_RE);
  });

  it("重复归档幂等:无变更,索引不重复", async () => {
    await createWorkflow({
      cwd,
      id: ID,
      title: "Archive Test",
    });
    await driveToCompleted(ID);
    const first = await archiveWorkflow(cwd, ID);
    const revisionAfterFirst = first.manifest.revision;

    const second = await archiveWorkflow(cwd, ID);

    expect(second.archived).toBe(false);
    expect(second.manifest.revision).toBe(revisionAfterFirst);
    expect(await readArchiveIndex(cwd)).toHaveLength(1);
  });

  it("归档后任何写入都被守卫拒绝", async () => {
    await createWorkflow({
      cwd,
      id: ID,
      title: "Archive Test",
    });
    await driveToCompleted(ID);
    await archiveWorkflow(cwd, ID);
    const dir = path.join(cwd, `.pi/superplan/workflows/${ID}`);

    await expect(atomicWrite(dir, "decisions.md", "篡改内容")).rejects.toThrow(
      ARCHIVED_RE,
    );
    // 未归档的工作流不受影响
    const other = await createWorkflow({
      cwd,
      id: "2026-09-01-archive-other",
      title: "Other",
    });
    expect(other.state).toBe("draft");
  });

  it("归档索引缺文件时读取为空,首次写入生成表头", async () => {
    expect(await readArchiveIndex(cwd)).toEqual([]);
    await createWorkflow({
      cwd,
      id: ID,
      title: "Archive Test",
    });
    await driveToCompleted(ID);
    await archiveWorkflow(cwd, ID);
    const raw = await readFile(path.join(cwd, ARCHIVE_INDEX), "utf8");
    expect(raw).toContain("# 归档索引");
    expect(raw).toContain(`| ${ID} | Archive Test |`);
  });
});

// 防止 writeFile 未使用告警(读校验场景保留引用)
void writeFile;
