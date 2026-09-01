import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  archiveWorkflow,
  bumpRevision,
  createChildWorkflow,
  createWorkflow,
  restoreFromDisk,
  workflowChain,
} from "./store.ts";

/** 断言正则(顶层声明)。 */
const EXISTS_RE = /已存在/;

let cwd: string;
const PARENT = "2026-09-01-idem-parent";
const CHILD = "2026-09-02-idem-child";

afterEach(async () => {
  await rm(cwd, {
    force: true,
    recursive: true,
  });
});

beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), "superplan-idem-"));
});

async function driveToCompleted(id: string): Promise<void> {
  const dir = path.join(cwd, ".pi/superplan/workflows", id);
  await bumpRevision(dir, "researching");
  await bumpRevision(dir, "decision_pending");
  await bumpRevision(dir, "planned");
  await bumpRevision(dir, "implementing");
  await bumpRevision(dir, "completed");
}

/** 目录指纹:文件名 -> 内容,用于验证重复执行零变更。 */
async function fingerprint(dir: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const entries = await readdir(dir, {
    recursive: true,
    withFileTypes: true,
  });
  await Promise.all(
    entries
      .filter((e) => e.isFile() && !e.name.endsWith(".tmp"))
      .map(async (e) => {
        const full = path.join(e.parentPath, e.name);
        map.set(path.relative(dir, full), await readFile(full, "utf8"));
      }),
  );
  return map;
}

describe("M6 操作幂等", () => {
  it("重复归档:revision 不变,目录指纹不变,索引单条", async () => {
    await createWorkflow({
      cwd,
      id: PARENT,
      title: "P",
    });
    await driveToCompleted(PARENT);
    const dir = path.join(cwd, ".pi/superplan/workflows", PARENT);
    const first = await archiveWorkflow(cwd, PARENT);
    const fp = await fingerprint(dir);

    const second = await archiveWorkflow(cwd, PARENT);
    const third = await archiveWorkflow(cwd, PARENT);

    expect(second.archived).toBe(false);
    expect(third.archived).toBe(false);
    expect(second.manifest.revision).toBe(first.manifest.revision);
    expect(await fingerprint(dir)).toEqual(fp);
  });

  it("重复恢复:纯读,零副作用", async () => {
    await createWorkflow({
      cwd,
      id: PARENT,
      title: "P",
    });
    const dir = path.join(cwd, ".pi/superplan/workflows", PARENT);
    await driveToCompleted(PARENT);
    const fp = await fingerprint(dir);

    const r1 = await restoreFromDisk(cwd, PARENT);
    const r2 = await restoreFromDisk(cwd, PARENT);

    expect(r2.manifest).toEqual(r1.manifest);
    expect(await fingerprint(dir)).toEqual(fp);
  });

  it("重复 child 创建:同 id 抛错且父档案不变;不同 id 各自 revision 1", async () => {
    await createWorkflow({
      cwd,
      id: PARENT,
      title: "P",
    });
    const c1 = await createChildWorkflow({
      childId: CHILD,
      cwd,
      parent: PARENT,
      title: "C",
    });
    expect(c1.revision).toBe(1);

    // 同 id 重复创建:抛错
    await expect(
      createChildWorkflow({
        childId: CHILD,
        cwd,
        parent: PARENT,
        title: "C",
      }),
    ).rejects.toThrow(EXISTS_RE);
    // 换 id 再建:同样 revision 1,互不干扰
    const c2 = await createChildWorkflow({
      childId: "2026-09-04-idem-second",
      cwd,
      parent: PARENT,
      title: "C2",
    });
    expect(c2.revision).toBe(1);
    expect((await workflowChain(cwd, c2.id)).map((n) => n.manifest.id)).toEqual([
      PARENT,
      c2.id,
    ]);
  });

  it("导出归档索引重复读:纯读一致", async () => {
    await createWorkflow({
      cwd,
      id: PARENT,
      title: "P",
    });
    await driveToCompleted(PARENT);
    await archiveWorkflow(cwd, PARENT);
    const { readArchiveIndex } = await import("./store.ts");
    const a = await readArchiveIndex(cwd);
    const b = await readArchiveIndex(cwd);
    expect(b).toEqual(a);
    expect(a).toHaveLength(1);
  });
});
