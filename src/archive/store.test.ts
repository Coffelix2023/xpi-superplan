import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveWorkflowDir } from "./paths.ts";
import {
  atomicWrite,
  bumpRevision,
  CORE_FILES,
  createWorkflow,
  listWorkflowIds,
  readManifest,
  restoreFromDisk,
  SUB_DIRS,
  snapshotRevision,
} from "./store.ts";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), "superplan-"));
});

afterEach(async () => {
  await rm(cwd, {
    force: true,
    recursive: true,
  });
});

const OPTS = {
  id: "2026-08-31-dashboard",
  title: "Dashboard 看板",
};

describe("档案创建 (1.3)", () => {
  it("创建完整目录与最小合法 Markdown", async () => {
    const manifest = await createWorkflow({
      cwd,
      ...OPTS,
    });
    expect(manifest.state).toBe("draft");
    expect(manifest.revision).toBe(1);

    const dir = resolveWorkflowDir(cwd, OPTS.id);
    const contents = await Promise.all(
      CORE_FILES.map((file) => readFile(path.join(dir, file), "utf8")),
    );
    for (const [i, file] of CORE_FILES.entries()) {
      expect(contents[i].length, file).toBeGreaterThan(0);
    }
    await Promise.all(
      SUB_DIRS.map(async (sub) => {
        expect(await readdir(path.join(dir, sub)), sub).toBeDefined();
      }),
    );
    // README 含 frontmatter 元信息
    const readme = await readFile(path.join(dir, "README.md"), "utf8");
    expect(readme).toContain(`id: ${OPTS.id}`);
    expect(readme).toContain("state: draft");
    // timeline 记录创建
    const timeline = await readFile(path.join(dir, "timeline.md"), "utf8");
    expect(timeline).toContain("| create |");
    // 初始 revision 1 快照存在
    expect(await readdir(path.join(dir, "revisions", "1"))).toEqual(
      expect.arrayContaining([
        ...CORE_FILES,
      ]),
    );
  });

  it("重复 id 拒绝创建", async () => {
    await createWorkflow({
      cwd,
      ...OPTS,
    });
    await expect(
      createWorkflow({
        cwd,
        ...OPTS,
      }),
    ).rejects.toThrow("已存在");
  });

  it("非法 id 拒绝创建", async () => {
    await expect(
      createWorkflow({
        cwd,
        id: "../evil",
        title: "x",
      }),
    ).rejects.toThrow("非法 workflow id");
  });
});

describe("原子写与 revision (1.4)", () => {
  it("bumpRevision 生成新快照且历史 revision 字节不变", async () => {
    await createWorkflow({
      cwd,
      ...OPTS,
    });
    const dir = resolveWorkflowDir(cwd, OPTS.id);
    const before = await readFile(
      path.join(dir, "revisions", "1", "README.md"),
      "utf8",
    );

    const updated = await bumpRevision(dir, "researching");
    expect(updated.revision).toBe(2);
    expect(updated.state).toBe("researching");

    const after = await readFile(path.join(dir, "revisions", "1", "README.md"), "utf8");
    expect(after).toBe(before);
    const rev2 = await readFile(path.join(dir, "revisions", "2", "README.md"), "utf8");
    expect(rev2).toContain("state: researching");
  });

  it("snapshotRevision 拒绝覆盖已存在快照", async () => {
    await createWorkflow({
      cwd,
      ...OPTS,
    });
    const dir = resolveWorkflowDir(cwd, OPTS.id);
    await expect(snapshotRevision(dir, 1)).rejects.toThrow("禁止覆盖");
  });

  it("非法状态转换在修订时被拒", async () => {
    await createWorkflow({
      cwd,
      ...OPTS,
    });
    const dir = resolveWorkflowDir(cwd, OPTS.id);
    await expect(bumpRevision(dir, "archived")).rejects.toThrow("非法状态转换");
  });

  it("atomicWrite 拒绝目录外目标", async () => {
    await createWorkflow({
      cwd,
      ...OPTS,
    });
    const dir = resolveWorkflowDir(cwd, OPTS.id);
    await expect(atomicWrite(dir, "../evil.md", "x")).rejects.toThrow("路径越出");
  });
});

describe("恢复 (1.5)", () => {
  it("仅从 README.md + tasks.md 恢复", async () => {
    await createWorkflow({
      cwd,
      ...OPTS,
    });
    const dir = resolveWorkflowDir(cwd, OPTS.id);
    await atomicWrite(dir, "tasks.md", "# 任务\n\n- [ ] 1.1 示例任务\n");

    const { manifest, tasks } = await restoreFromDisk(cwd, OPTS.id);
    expect(manifest.id).toBe(OPTS.id);
    expect(manifest.state).toBe("draft");
    expect(tasks).toContain("1.1 示例任务");
  });

  it("listWorkflowIds 倒序返回最新工作流", async () => {
    await createWorkflow({
      cwd,
      id: "2026-08-30-alpha",
      title: "a",
    });
    await createWorkflow({
      cwd,
      ...OPTS,
    });
    expect(await listWorkflowIds(cwd)).toEqual([
      OPTS.id,
      "2026-08-30-alpha",
    ]);
  });

  it("README 被篡改成非法状态时 fail-closed", async () => {
    await createWorkflow({
      cwd,
      ...OPTS,
    });
    const dir = resolveWorkflowDir(cwd, OPTS.id);
    const readme = await readFile(path.join(dir, "README.md"), "utf8");
    await writeFile(
      path.join(dir, "README.md"),
      readme.replace("state: draft", "state: hacked"),
      "utf8",
    );
    await expect(readManifest(dir)).rejects.toThrow("非法状态");
  });
});
