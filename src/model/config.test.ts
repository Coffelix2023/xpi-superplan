import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkflow } from "../archive/store.ts";
import {
  type CatalogModel,
  isThinkingLevel,
  type ModelCatalog,
  parseModelRef,
  STAGE_FIELDS,
  setStageModel,
  THINKING_LEVELS,
  validateStageModel,
} from "./config.ts";

/** 错误信息断言用正则(顶层声明,避免每次调用重建)。 */
const NOT_FOUND_RE = /not_found/;

let cwd: string;

afterEach(async () => {
  await rm(cwd, {
    force: true,
    recursive: true,
  });
});

beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), "superplan-model-"));
});

/** 假模型目录:注册表内模型有认证;openai/gpt-x 支持 xhigh。 */
function fakeCatalog(overrides?: Partial<ModelCatalog>): ModelCatalog {
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
    ...overrides,
  };
}

function gpt5WithLevel(map?: Record<string, string | null>): CatalogModel {
  return {
    id: "gpt-5",
    provider: "openai",
    thinkingLevelMap: map,
  };
}

describe("parseModelRef", () => {
  it("解析 provider/modelId", () => {
    expect(parseModelRef("anthropic/claude-opus-4-5")).toEqual({
      modelId: "claude-opus-4-5",
      provider: "anthropic",
    });
  });

  it.each([
    "",
    "no-slash",
    "/leading",
    "trailing/",
    "a b/c",
    "a/ b c",
  ])("拒绝非法引用 %j", (ref) => {
    expect(parseModelRef(ref)).toBeUndefined();
  });
});

describe("validateStageModel fail-closed", () => {
  it("合法模型返回 undefined", () => {
    expect(
      validateStageModel(fakeCatalog(), "anthropic/claude-opus-4-5", "high"),
    ).toBeUndefined();
  });

  it("模型不存在 -> not_found", () => {
    const err = validateStageModel(fakeCatalog(), "nope/missing", "high");
    expect(err?.reason).toBe("not_found");
  });

  it("未认证 -> no_auth", () => {
    const err = validateStageModel(
      fakeCatalog({
        hasConfiguredAuth: () => false,
      }),
      "openai/gpt-5",
      "low",
    );
    expect(err?.reason).toBe("no_auth");
  });

  it("thinkingLevelMap 显式 null -> thinking_unsupported", () => {
    const catalog: ModelCatalog = {
      find: () =>
        gpt5WithLevel({
          xhigh: null,
        }),
      hasConfiguredAuth: () => true,
    };
    const err = validateStageModel(catalog, "openai/gpt-5", "xhigh");
    expect(err?.reason).toBe("thinking_unsupported");
  });

  it("thinkingLevelMap 未声明的级别视为支持", () => {
    const catalog: ModelCatalog = {
      find: () =>
        gpt5WithLevel({
          max: "255",
        }),
      hasConfiguredAuth: () => true,
    };
    expect(validateStageModel(catalog, "openai/gpt-5", "xhigh")).toBeUndefined();
  });

  it("off 级别跳过能力检查", () => {
    const catalog: ModelCatalog = {
      find: () =>
        gpt5WithLevel({
          high: null,
        }),
      hasConfiguredAuth: () => true,
    };
    expect(validateStageModel(catalog, "openai/gpt-5", "off")).toBeUndefined();
  });
});

describe("isThinkingLevel", () => {
  it.each(THINKING_LEVELS)("接受 %s", (level) => {
    expect(isThinkingLevel(level)).toBe(true);
  });
  it.each([
    "nope",
    "",
    "HIGH",
  ])("拒绝 %j", (level) => {
    expect(isThinkingLevel(level)).toBe(false);
  });
});

describe("setStageModel", () => {
  it("写入 README 阶段字段 + thinkingLevel,新 revision + timeline", async () => {
    const manifest = await createWorkflow({
      cwd,
      id: "2026-09-01-model-test",
      title: "Model Test",
    });
    expect(manifest.revision).toBe(1);

    const updated = await setStageModel({
      catalog: fakeCatalog(),
      cwd,
      ref: "anthropic/claude-opus-4-5",
      stage: "execution",
      thinkingLevel: "high",
      workflowId: "2026-09-01-model-test",
    });

    expect(updated.revision).toBe(2);
    expect(updated[STAGE_FIELDS.execution]).toBe("anthropic/claude-opus-4-5");
    expect(updated.thinkingLevel).toBe("high");

    const readme = await readFile(
      path.join(cwd, ".pi/superplan/workflows/2026-09-01-model-test/README.md"),
      "utf8",
    );
    expect(readme).toContain("executionModel: anthropic/claude-opus-4-5");
    expect(readme).toContain("thinkingLevel: high");

    const timeline = await readFile(
      path.join(cwd, ".pi/superplan/workflows/2026-09-01-model-test/timeline.md"),
      "utf8",
    );
    expect(timeline).toContain("model-set");
    expect(timeline).toContain("阶段 execution 模型 -> anthropic/claude-opus-4-5");
  });

  it("校验失败抛错且不写 README(fail-closed)", async () => {
    await createWorkflow({
      cwd,
      id: "2026-09-01-model-test",
      title: "Model Test",
    });
    await expect(
      setStageModel({
        catalog: fakeCatalog(),
        cwd,
        ref: "nope/missing",
        stage: "planning",
        thinkingLevel: "low",
        workflowId: "2026-09-01-model-test",
      }),
    ).rejects.toThrow(NOT_FOUND_RE);

    const readme = await readFile(
      path.join(cwd, ".pi/superplan/workflows/2026-09-01-model-test/README.md"),
      "utf8",
    );
    expect(readme).not.toContain("planningModel: nope/missing");
  });

  it("非法思考级别被 isThinkingLevel 拒绝", async () => {
    await createWorkflow({
      cwd,
      id: "2026-09-01-model-test",
      title: "Model Test",
    });
    expect(isThinkingLevel("ultra")).toBe(false);
  });
});
