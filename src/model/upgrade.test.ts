import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkflow } from "../archive/store.ts";
import type { ModelCatalog } from "./config.ts";
import {
  handoffHintFor,
  type SessionModelControl,
  upgradeStageModel,
} from "./upgrade.ts";

/** 错误信息断言用正则(顶层声明,避免每次调用重建)。 */
const NOT_FOUND_RE = /not_found/;
const NO_ARCHIVE_CHANGE_RE = /未做任何档案变更/;

let cwd: string;
const WORKFLOW_ID = "2026-09-01-upgrade-test";

afterEach(async () => {
  await rm(cwd, {
    force: true,
    recursive: true,
  });
});

beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), "superplan-upgrade-"));
});

function fakeCatalog(): ModelCatalog {
  const models = new Set([
    "anthropic/claude-opus-4-5",
    "openai/gpt-5",
  ]);
  return {
    find: (provider, modelId) =>
      models.has(`${provider}/${modelId}`)
        ? {
            id: modelId,
            provider,
          }
        : undefined,
    hasConfiguredAuth: () => true,
  };
}

function fakeSession(currentProvider?: string): SessionModelControl & {
  models: unknown[];
  levels: string[];
} {
  const models: unknown[] = [];
  const levels: string[] = [];
  return {
    currentProvider,
    models,
    levels,
    setModel: async (model: unknown) => {
      models.push(model);
      return true;
    },
    setThinkingLevel: (level: string) => {
      levels.push(level);
    },
  };
}

describe("handoffHintFor", () => {
  it("跨供应商返回交接提示", () => {
    const hint = handoffHintFor("anthropic", "openai/gpt-5");
    expect(hint).toContain("openai/gpt-5");
    expect(hint).toContain("anthropic");
    expect(hint).toContain("resume");
  });

  it("同供应商与未知当前供应商均返回 undefined", () => {
    expect(handoffHintFor("openai", "openai/gpt-5")).toBeUndefined();
    expect(handoffHintFor(undefined, "openai/gpt-5")).toBeUndefined();
  });
});

describe("upgradeStageModel", () => {
  it("校验通过:切换会话模型 + thinking level + 档案落盘 + timeline", async () => {
    await createWorkflow({
      cwd,
      id: WORKFLOW_ID,
      title: "Upgrade Test",
    });
    const session = fakeSession("openai");

    const result = await upgradeStageModel({
      catalog: fakeCatalog(),
      cwd,
      ref: "anthropic/claude-opus-4-5",
      model: {
        id: "claude-opus-4-5",
        provider: "anthropic",
      },
      session,
      stage: "execution",
      thinkingLevel: "xhigh",
      workflowId: WORKFLOW_ID,
    });

    expect(result.applied).toBe(true);
    // 跨供应商:openai -> anthropic
    expect(result.handoffHint).toBeDefined();
    expect(session.models).toHaveLength(1);
    expect(session.levels).toEqual([
      "xhigh",
    ]);

    const timeline = await readFile(
      path.join(cwd, `.pi/superplan/workflows/${WORKFLOW_ID}/timeline.md`),
      "utf8",
    );
    expect(timeline).toContain("model-set");
    expect(timeline).toContain("model-handoff-hint");
    expect(timeline).toContain("手动升降档");

    const readme = await readFile(
      path.join(cwd, `.pi/superplan/workflows/${WORKFLOW_ID}/README.md`),
      "utf8",
    );
    expect(readme).toContain("executionModel: anthropic/claude-opus-4-5");
  });

  it("同供应商无交接提示", async () => {
    await createWorkflow({
      cwd,
      id: WORKFLOW_ID,
      title: "Upgrade Test",
    });
    const session = fakeSession("openai");

    const result = await upgradeStageModel({
      catalog: fakeCatalog(),
      cwd,
      ref: "openai/gpt-5",
      model: {
        id: "gpt-5",
        provider: "openai",
      },
      session,
      stage: "review",
      thinkingLevel: "low",
      workflowId: WORKFLOW_ID,
    });

    expect(result.handoffHint).toBeUndefined();
    const timeline = await readFile(
      path.join(cwd, `.pi/superplan/workflows/${WORKFLOW_ID}/timeline.md`),
      "utf8",
    );
    expect(timeline).not.toContain("model-handoff-hint");
  });

  it("目录校验失败:抛错,不切会话,不写档案", async () => {
    await createWorkflow({
      cwd,
      id: WORKFLOW_ID,
      title: "Upgrade Test",
    });
    const session = fakeSession("openai");

    await expect(
      upgradeStageModel({
        catalog: fakeCatalog(),
        cwd,
        model: undefined,
        ref: "nope/missing",
        session,
        stage: "planning",
        thinkingLevel: "high",
        workflowId: WORKFLOW_ID,
      }),
    ).rejects.toThrow(NOT_FOUND_RE);

    expect(session.models).toHaveLength(0);
    expect(session.levels).toHaveLength(0);
  });

  it("setModel 返回 false(无 key):抛错,不写档案", async () => {
    await createWorkflow({
      cwd,
      id: WORKFLOW_ID,
      title: "Upgrade Test",
    });
    const session: SessionModelControl & {
      levels: string[];
    } = {
      currentProvider: "openai",
      levels: [],
      setModel: async () => false,
      setThinkingLevel: (level: string) => {
        session.levels.push(level);
      },
    };

    await expect(
      upgradeStageModel({
        catalog: fakeCatalog(),
        cwd,
        ref: "anthropic/claude-opus-4-5",
        model: {
          id: "claude-opus-4-5",
          provider: "anthropic",
        },
        session,
        stage: "planning",
        thinkingLevel: "high",
        workflowId: WORKFLOW_ID,
      }),
    ).rejects.toThrow(NO_ARCHIVE_CHANGE_RE);

    expect(session.levels).toHaveLength(0);
    const readme = await readFile(
      path.join(cwd, `.pi/superplan/workflows/${WORKFLOW_ID}/README.md`),
      "utf8",
    );
    expect(readme).not.toContain("planningModel: anthropic");
  });
});
