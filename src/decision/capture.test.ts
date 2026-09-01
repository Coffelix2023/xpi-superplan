import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkflow } from "../archive/store.ts";
import type { DecisionPoint } from "../domain/types.ts";
import {
  captureDeckSelection,
  isCompletedDeckResult,
  selectionFromDetails,
} from "./capture.ts";

const POINT: DecisionPoint = {
  constraints: [],
  context: "本地",
  id: "dp-1",
  question: "选哪个存储?",
  recommendedId: "a",
  candidates: [
    {
      cons: [],
      id: "a",
      pros: [],
      risks: [],
      summary: "简单",
      title: "JSON 文件",
    },
    {
      cons: [],
      id: "b",
      pros: [],
      risks: [],
      summary: "强",
      title: "SQLite",
    },
  ],
};

const COMPLETED = {
  toolName: "design_deck",
  details: {
    status: "completed",
    url: "http://localhost:8377/",
    selections: {
      "dp-1": "a JSON 文件",
    },
  },
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "superplan-capture-"));
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
const decisions = async () =>
  readFile(path.join(workflowDir(), "decisions.md"), "utf8");

describe("isCompletedDeckResult", () => {
  it("completed + selections 才有效", () => {
    expect(isCompletedDeckResult(COMPLETED)).toBe(true);
  });

  it("非 design_deck / 取消 / 无 selections 均无效", () => {
    expect(
      isCompletedDeckResult({
        details: COMPLETED.details,
        toolName: "bash",
      }),
    ).toBe(false);
    expect(
      isCompletedDeckResult({
        toolName: "design_deck",
        details: {
          status: "cancelled",
          url: "",
        },
      }),
    ).toBe(false);
    expect(
      isCompletedDeckResult({
        toolName: "design_deck",
        details: {
          status: "completed",
          url: "",
        },
      }),
    ).toBe(false);
    expect(
      isCompletedDeckResult({
        details: undefined,
        toolName: "design_deck",
      }),
    ).toBe(false);
  });
});

describe("selectionFromDetails", () => {
  it("label 拆出 candidateId,notes 映射为 note", () => {
    const sel = selectionFromDetails(
      POINT,
      {
        status: "completed",
        notes: {
          "dp-1": "要事务",
        },
        selections: {
          "dp-1": "b SQLite",
        },
      },
      3,
    );
    expect(sel).toMatchObject({
      candidateId: "b",
      note: "要事务",
      pointId: "dp-1",
      revision: 3,
    });
  });

  it("selections 不含本决策点返回 undefined", () => {
    expect(
      selectionFromDetails(
        POINT,
        {
          status: "completed",
          selections: {
            other: "x",
          },
        },
        1,
      ),
    ).toBeUndefined();
  });

  it("label 映射不到候选 fail-closed 抛错", () => {
    expect(() =>
      selectionFromDetails(
        POINT,
        {
          status: "completed",
          selections: {
            "dp-1": "zzz 未知",
          },
        },
        1,
      ),
    ).toThrow("无法映射回候选");
  });
});

describe("captureDeckSelection(强制回写)", () => {
  it("completed 结果回写 decisions.md + timeline", async () => {
    const ok = await captureDeckSelection(workflowDir(), POINT, 1, COMPLETED);
    expect(ok).toBe(true);
    const text = await decisions();
    expect(text).toContain("## dp-1");
    expect(text).toContain("**a**");
    expect(text).toContain("- revision: 1");
    const timeline = await readFile(path.join(workflowDir(), "timeline.md"), "utf8");
    expect(timeline).toContain("decision-captured");
  });

  it("aborted 结果不回写, 返回 false, completed 才是补写条件", async () => {
    const ok = await captureDeckSelection(workflowDir(), POINT, 1, {
      toolName: "design_deck",
      details: {
        status: "aborted",
        url: "",
      },
    });
    expect(ok).toBe(false);
    expect(await decisions()).not.toContain("dp-1");
  });

  it("completed 但缺本决策点选择时不写", async () => {
    const ok = await captureDeckSelection(workflowDir(), POINT, 1, {
      toolName: "design_deck",
      details: {
        status: "completed",
        url: "",
        selections: {
          other: "x",
        },
      },
    });
    expect(ok).toBe(false);
  });

  it("非法 label 抛错,decisions.md 保持干净", async () => {
    await expect(
      captureDeckSelection(workflowDir(), POINT, 1, {
        toolName: "design_deck",
        details: {
          status: "completed",
          url: "",
          selections: {
            "dp-1": "bad label",
          },
        },
      }),
    ).rejects.toThrow("无法映射回候选");
    expect(await decisions()).not.toContain("dp-1");
  });
});
