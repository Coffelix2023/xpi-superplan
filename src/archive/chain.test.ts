import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  archiveWorkflow,
  bumpRevision,
  createChildWorkflow,
  createWorkflow,
  workflowChain,
} from "./store.ts";

let cwd: string;
const ROOT = "2026-09-01-root-flow";
const CHILD = "2026-09-02-child-flow";
const GRAND = "2026-09-03-grand-flow";

afterEach(async () => {
  await rm(cwd, {
    force: true,
    recursive: true,
  });
});

beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), "superplan-chain-"));
});

/** 驱动到 completed(顺序状态机)。 */
async function driveToCompleted(id: string): Promise<void> {
  const dir = path.join(cwd, ".pi/superplan/workflows", id);
  await bumpRevision(dir, "researching");
  await bumpRevision(dir, "decision_pending");
  await bumpRevision(dir, "planned");
  await bumpRevision(dir, "implementing");
  await bumpRevision(dir, "completed");
}

describe("workflowChain 父子链视图", () => {
  it("三层链:root -> child -> grand,顺序与 parent 字段正确", async () => {
    await createWorkflow({
      cwd,
      id: ROOT,
      title: "Root",
    });
    await createChildWorkflow({
      childId: CHILD,
      cwd,
      parent: ROOT,
      title: "C",
    });
    await createChildWorkflow({
      childId: GRAND,
      cwd,
      parent: CHILD,
      title: "G",
    });

    const chain = await workflowChain(cwd, GRAND);

    expect(chain.map((n) => n.manifest.id)).toEqual([
      ROOT,
      CHILD,
      GRAND,
    ]);
    expect(chain[2].manifest.parent).toBe(CHILD);
    expect(chain[1].manifest.parent).toBe(ROOT);
    // 未归档节点无 archivedAt
    expect("archivedAt" in chain[0]).toBe(false);
  });

  it("无 parent 的独立工作流返回单节点", async () => {
    await createWorkflow({
      cwd,
      id: ROOT,
      title: "Solo",
    });
    const chain = await workflowChain(cwd, ROOT);
    expect(chain).toHaveLength(1);
    expect(chain[0].manifest.id).toBe(ROOT);
  });

  it("已归档节点的元信息", async () => {
    await createWorkflow({
      cwd,
      id: ROOT,
      title: "Root",
    });
    await driveToCompleted(ROOT);
    await archiveWorkflow(cwd, ROOT);

    const chain = await workflowChain(cwd, ROOT);

    expect(chain[0].archivedAt).toEqual(expect.any(String));
  });

  it("不存在的 id 抛错(fail-closed)", async () => {
    await expect(workflowChain(cwd, "2026-09-01-void")).rejects.toThrow();
  });

  it("父子链每个节点都能读回 manifest", async () => {
    await createWorkflow({
      cwd,
      id: ROOT,
      title: "Root",
    });
    await createChildWorkflow({
      childId: CHILD,
      cwd,
      parent: ROOT,
      title: "C",
    });

    const chains = await Promise.all(
      [
        ROOT,
        CHILD,
      ].map(async (id) => {
        const chain = await workflowChain(cwd, id);
        return {
          chain,
          id,
        };
      }),
    );
    for (const { chain, id } of chains) {
      expect(chain[chain.length - 1].manifest.id).toBe(id);
    }
  });
});
