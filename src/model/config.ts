/**
 * M5 阶段模型配置,对应 design.md D5:
 * README.md 记录 planningModel/executionModel/reviewModel + thinkingLevel。
 * 所有写入经 updateManifest(revision 快照 + timeline);校验 fail-closed。
 */

import { updateManifest } from "../archive/store.ts";
import type { WorkflowManifest } from "../domain/types.ts";

/** Pi 会话内可用的思考级别(与 pi-agent-core ThinkingLevel 一致)。 */
export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ConfigThinkingLevel = (typeof THINKING_LEVELS)[number];

export function isThinkingLevel(value: string): value is ConfigThinkingLevel {
  return (THINKING_LEVELS as readonly string[]).includes(value);
}

/** 拒绝空白字符(model 引用不允许空格)。 */
const WS_RE = /\s/;

export type StageKey = "planning" | "execution" | "review";

/** README frontmatter 中的字段名,与 WorkflowManifest 可选字段一一对应。 */
export const STAGE_FIELDS: Record<
  StageKey,
  "executionModel" | "planningModel" | "reviewModel"
> = {
  execution: "executionModel",
  planning: "planningModel",
  review: "reviewModel",
};

/** 模型目录条目的最小面(真实 Model 的结构子集)。 */
export interface CatalogModel {
  id: string;
  provider: string;
  /** Pi ThinkingLevelMap:显式 null 标记该级别不支持,未声明走 provider 默认。 */
  thinkingLevelMap?: Partial<Record<string, string | null>>;
}

/** 模型目录最小面(真实实现包 ctx.modelRegistry,单测传桩)。 */
export interface ModelCatalog {
  find(provider: string, modelId: string): CatalogModel | undefined;
  hasConfiguredAuth(model: CatalogModel): boolean;
}

/** 校验失败原因;调用方呈现给用户或记 timeline,不静默替换。 */
export interface ModelValidationError {
  detail: string;
  reason: "not_found" | "no_auth" | "thinking_unsupported";
}

/**
 * 校验阶段模型与思考级别(fail-closed)。
 * - 模型不存在 / 无认证 / thinkingLevelMap 显式 null 拒绝该级别 -> 校验失败
 * - model 未声明 thinkingLevelMap 时视为全部支持(Pi 对未声明级别走 provider 默认)
 */
export function validateStageModel(
  catalog: ModelCatalog,
  ref: string,
  thinkingLevel: ConfigThinkingLevel,
): ModelValidationError | undefined {
  const parsed = parseModelRef(ref);
  if (!parsed) {
    return {
      detail: `模型引用必须为 "<provider>/<modelId>",得到: ${JSON.stringify(ref)}`,
      reason: "not_found",
    };
  }
  const model = catalog.find(parsed.provider, parsed.modelId);
  if (!model) {
    return {
      detail: `模型不存在: ${ref}(在模型目录中未找到 ${parsed.provider}/${parsed.modelId})`,
      reason: "not_found",
    };
  }
  if (!catalog.hasConfiguredAuth(model)) {
    return {
      detail: `模型 ${ref} 未认证(无 API key 或 OAuth)`,
      reason: "no_auth",
    };
  }
  if (thinkingLevel !== "off" && model.thinkingLevelMap?.[thinkingLevel] === null) {
    return {
      detail: `模型 ${ref} 不支持思考级别 ${thinkingLevel}(thinkingLevelMap 显式 null)`,
      reason: "thinking_unsupported",
    };
  }
  return undefined;
}

/** "<provider>/<modelId>";modelId 可含斜杠以外任意非空白,provider 不含斜杠。 */
export function parseModelRef(ref: string):
  | {
      modelId: string;
      provider: string;
    }
  | undefined {
  const idx = ref.indexOf("/");
  if (idx <= 0 || idx === ref.length - 1) {
    return undefined;
  }
  const provider = ref.slice(0, idx);
  const modelId = ref.slice(idx + 1);
  if (WS_RE.test(provider) || WS_RE.test(modelId)) {
    return undefined;
  }
  return {
    modelId,
    provider,
  };
}

export interface SetStageModelOptions {
  catalog: ModelCatalog;
  cwd: string;
  /** 变更说明,记入 timeline detail。 */
  detail?: string;
  ref: string;
  stage: StageKey;
  thinkingLevel: ConfigThinkingLevel;

  workflowId: string;
}

/** 阶段模型配置写入;校验失败抛错,不写 README(fail-closed)。 */
export async function setStageModel(
  opts: SetStageModelOptions,
): Promise<WorkflowManifest> {
  const error = validateStageModel(opts.catalog, opts.ref, opts.thinkingLevel);
  if (error) {
    throw new Error(`模型校验失败(${error.reason}): ${error.detail}`);
  }
  const { resolveWorkflowDir } = await import("../archive/paths.ts");
  const dir = resolveWorkflowDir(opts.cwd, opts.workflowId);
  return updateManifest(
    dir,
    (m) => {
      m[STAGE_FIELDS[opts.stage]] = opts.ref;
      m.thinkingLevel = opts.thinkingLevel;
    },
    (_m) => ({
      detail: `阶段 ${opts.stage} 模型 -> ${opts.ref}${opts.detail ? ` (${opts.detail})` : ""}`,
      event: "model-set",
    }),
  );
}
