import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkflow } from "../archive/store.ts";
import type { DecisionPoint } from "../domain/types.ts";
import { appendDecision } from "./record.ts";
import { decideViaTui, type PromptUI, promptSelection } from "./tui.ts";

const POINT: DecisionPoint = {
  context: "本地持久化",
  id: "dp-1",
  question: "选哪个存储?",
  recommendedId: "a",
  candidates: [
    {
      id: "a",
      summary: "最简单",
      title: "JSON 文件",
      cons: [
        "无并发",
      ],
      pros: [
        "零依赖",
      ],
      risks: [
        "并发写丢失",
      ],
    },
    {
      id: "b",
      summary: "更强查询",
      title: "SQLite",
      cons: [
        "重",
      ],
      pros: [
        "事务",
      ],
      risks: [
        "原生模块编译",
      ],
    },
  ],
  constraints: [
    "零外部依赖",
  ],
};

function makeUI(
  selections: Array<string | undefined>,
  notes: Array<string | undefined>,
): {
  ui: PromptUI;
  notifications: string[];
} {
  let selectIdx = 0;
  let inputIdx = 0;
  const notifications: string[] = [];
  return {
    notifications,
    ui: {
      input: async () => notes[inputIdx++],
      notify: (m) => notifications.push(m),
      select: async () => selections[selectIdx++],
    },
  };
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "superplan-decision-"));
  await createWorkflow({
    cwd: dir,
    id: "2026-01-01-test",
    title: "测试",
  });
});

afterEach(async () => {
  await rm(dir, {
    force: true,
    recursive: true,
  });
});

const workflowDir = () =>
  path.join(dir, ".pi", "superplan", "workflows", "2026-01-01-test");

describe("appendDecision", () => {
  it("写入全部候选/选中项/备注/未采纳理由/revision", async () => {
    await appendDecision(workflowDir(), POINT, {
      candidateId: "a",
      note: "先简后繁",
      revision: 1,
    });
    const text = await readFile(path.join(workflowDir(), "decisions.md"), "utf8");
    expect(text).toContain("## dp-1 — 选哪个存储?");
    expect(text).toContain("- 选中项: **a** JSON 文件");
    expect(text).toContain("- 备注: 先简后繁");
    expect(text).toContain("- revision: 1");
    expect(text).toContain("a JSON 文件");
    expect(text).toContain("b SQLite");
    expect(text).toContain("原生模块编译");
    // 选中项 a 的风险不落盘(spec 仅要求未采纳项理由),但事务是未采纳 b 的 pros
  });

  it("非法候选 id fail-closed 拒绝写入", async () => {
    await expect(
      appendDecision(workflowDir(), POINT, {
        candidateId: "nope",
        revision: 1,
      }),
    ).rejects.toThrow("无候选 nope");
  });

  it("两次 appendDecision 追加而非覆盖历史", async () => {
    await appendDecision(workflowDir(), POINT, {
      candidateId: "a",
      revision: 1,
    });
    await appendDecision(
      workflowDir(),
      {
        ...POINT,
        id: "dp-2",
        question: "第二个问题?",
      },
      {
        candidateId: "b",
        revision: 2,
      },
    );
    const text = await readFile(path.join(workflowDir(), "decisions.md"), "utf8");
    expect(text).toContain("## dp-1 — 选哪个存储?");
    expect(text).toContain("## dp-2 — 第二个问题?");
  });
  it("无备注落盘为 (无)", async () => {
    await appendDecision(workflowDir(), POINT, {
      candidateId: "b",
      revision: 2,
    });
    const text = await readFile(path.join(workflowDir(), "decisions.md"), "utf8");
    expect(text).toContain("- 备注: (无)");
  });
});

describe("promptSelection", () => {
  it("选择 + 备注返回候选 id 与 note", async () => {
    const { ui } = makeUI(
      [
        "a JSON 文件",
      ],
      [
        "备注 x",
      ],
    );
    const sel = await promptSelection(ui, POINT);
    expect(sel).toEqual({
      candidateId: "a",
      note: "备注 x",
    });
  });

  it("select 取消返回 undefined", async () => {
    const { ui } = makeUI(
      [
        undefined,
      ],
      [],
    );
    expect(await promptSelection(ui, POINT)).toBeUndefined();
  });

  it("非法 id 返回 undefined 不进入备注", async () => {
    const { ui } = makeUI(
      [
        "zzz 未知",
      ],
      [],
    );
    expect(await promptSelection(ui, POINT)).toBeUndefined();
  });

  it("备注留空映射为 undefined", async () => {
    const { ui } = makeUI(
      [
        "b SQLite",
      ],
      [
        "",
      ],
    );
    const sel = await promptSelection(ui, POINT);
    expect(sel).toEqual({
      candidateId: "b",
      note: undefined,
    });
  });
});

describe("decideViaTui(无 deck 环境)", () => {
  it("选择后决策完整写入 decisions.md 并返回 true", async () => {
    const { ui } = makeUI(
      [
        "a JSON 文件",
      ],
      [
        "走 TUI",
      ],
    );
    const ok = await decideViaTui(workflowDir(), ui, POINT, 1);
    expect(ok).toBe(true);
    const text = await readFile(path.join(workflowDir(), "decisions.md"), "utf8");
    expect(text).toContain("**a**");
    expect(text).toContain("走 TUI");
  });

  it("用户取消时不写决策,timeline 记录 skipped", async () => {
    const { ui, notifications } = makeUI(
      [
        undefined,
      ],
      [],
    );
    const ok = await decideViaTui(workflowDir(), ui, POINT, 1);
    expect(ok).toBe(false);
    const text = await readFile(path.join(workflowDir(), "decisions.md"), "utf8");
    expect(text).not.toContain("dp-1");
    const timeline = await readFile(path.join(workflowDir(), "timeline.md"), "utf8");
    expect(timeline).toContain("decision-skipped");
    expect(notifications.some((n) => n.includes("已跳过"))).toBe(true);
  });
});
