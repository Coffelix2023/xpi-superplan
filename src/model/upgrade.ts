/**
 * M5 手动升降档,对应 design.md D5:
 * 用户命令触发 -> 模型目录校验 -> pi.setModel/setThinkingLevel -> 档案写入 + timeline。
 * 校验失败不切换(fail-closed);跨供应商给出新会话交接提示,不静默硬切。
 */

import { resolveWorkflowDir } from "../archive/paths.ts";
import { appendTimeline } from "../archive/store.ts";
import type { StageKey } from "./config.ts";
import {
  type ConfigThinkingLevel,
  type ModelCatalog,
  setStageModel,
  validateStageModel,
} from "./config.ts";

/** pi.setModel 返回 false = 无 API key(Pi 类型合同:Promise<boolean>)。 */
export interface SessionModelControl {
  currentProvider?: string;
  /** 真实实现传 Model 对象(catalog.find 的返回值)。 */
  setModel(model: unknown): Promise<boolean>;
  setThinkingLevel(level: ConfigThinkingLevel): void;
}

export interface UpgradeResult {
  applied: boolean;
  /** 跨供应商时的新会话交接提示;同供应商为 undefined。 */
  handoffHint?: string;
}

/** 目标模型与当前模型不同供应商时返回交接提示(design.md D5 风险条目)。 */
export function handoffHintFor(
  currentProvider: string | undefined,
  targetRef: string,
): string | undefined {
  if (!currentProvider) {
    return undefined;
  }
  const targetProvider = targetRef.split("/")[0];
  if (targetProvider === currentProvider) {
    return undefined;
  }
  return `目标模型 ${targetRef} 与当前会话供应商(${currentProvider})不同,工具兼容不保证;建议新建会话并用 /xpi-superplan resume <workflowId> 交接(workflow id + revision)。`;
}

export interface UpgradeStageOptions {
  catalog: ModelCatalog;
  cwd: string;
  /** catalog.find 返回的模型对象;直传给 session.setModel。 */
  model: unknown;
  ref: string;
  session: SessionModelControl;
  stage: StageKey;
  thinkingLevel: ConfigThinkingLevel;
  workflowId: string;
}

/**
 * 阶段升降档:校验 -> 会话切换 -> 档案记录。
 * 校验失败或 setModel 返回 false 时抛错,不落盘(fail-closed)。
 */
export async function upgradeStageModel(
  opts: UpgradeStageOptions,
): Promise<UpgradeResult> {
  const validationError = validateStageModel(
    opts.catalog,
    opts.ref,
    opts.thinkingLevel,
  );
  if (validationError) {
    throw new Error(
      `模型校验失败(${validationError.reason}): ${validationError.detail};请选择可用模型或显式采用当前模型`,
    );
  }

  const applied = await opts.session.setModel(opts.model);
  if (!applied) {
    throw new Error("会话切换模型失败,通常未配置凭据;未做任何档案变更");
  }
  opts.session.setThinkingLevel(opts.thinkingLevel);

  await setStageModel({
    catalog: opts.catalog,
    cwd: opts.cwd,
    detail: "手动升降档",
    ref: opts.ref,
    stage: opts.stage,
    thinkingLevel: opts.thinkingLevel,
    workflowId: opts.workflowId,
  });

  const hint = handoffHintFor(opts.session.currentProvider, opts.ref);
  if (hint) {
    await appendTimeline(
      resolveWorkflowDir(opts.cwd, opts.workflowId),
      "model-handoff-hint",
      hint,
    );
  }
  return {
    applied: true,
    handoffHint: hint,
  };
}
