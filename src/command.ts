/**
 * /xpi-superplan 子命令解析与调度消息构建(从 index.ts 抽出以便单测)。
 * 分层:确定性状态操作留在 index.ts;start/grillme/save/fix/fix-fast 的长流程
 * 由 skills/xpi-superplan 承载,这里只生成调度消息(sendUserMessage)。
 */

import { isValidWorkflowId } from "./archive/paths.ts";
import { listWorkflowIds } from "./archive/store.ts";

/** 需要派发 agent 行为流的模式。 */
export const AGENT_FLOW_MODES = [
  "start",
  "grillme",
  "save",
  "fix",
  "fix-fast",
] as const;
export type AgentFlowMode = (typeof AGENT_FLOW_MODES)[number];

const ARGS_RE = /\s+/;

export interface ParsedArgs {
  rest: string[];
  sub?: string;
}

/** 空参数由调用方归一为 start(反馈第 2 条)。 */
export function parseSuperplanArgs(args: string): ParsedArgs {
  const [sub, ...rest] = args.trim().split(ARGS_RE).filter(Boolean);
  return {
    rest,
    sub,
  };
}

/** 解析优先级:显式合法 id > 当前活动 > 最新。非法 id 视为非 id(如反馈文本)。 */
export async function resolveWorkflowId(
  cwd: string,
  explicitId: string | undefined,
  activeId: string | undefined,
): Promise<string | undefined> {
  if (explicitId && isValidWorkflowId(explicitId)) {
    return explicitId;
  }
  if (activeId) {
    return activeId;
  }
  return (await listWorkflowIds(cwd))[0];
}

/** fix/fix-fast 参数拆分:首词为合法 id 则取之,否则全部视为反馈。 */
export function splitFixArgs(rest: string[]): {
  explicitId?: string;
  feedback: string;
} {
  const [first, ...tail] = rest;
  if (first && isValidWorkflowId(first)) {
    return {
      explicitId: first,
      feedback: tail.join(" ").trim(),
    };
  }
  return {
    feedback: rest.join(" ").trim(),
  };
}

export interface DispatchInput {
  feedback?: string;
  mode: AgentFlowMode;
  /** 真实工作流目录(由调用方 resolve,含 cwd)。 */
  workflowDir: string;
  workflowId: string;
}

/** 调度消息:告诉 agent 模式、目标工作流与反馈,并要求加载 skill 执行。 */
export function buildWorkflowDispatch(input: DispatchInput): string {
  const lines = [
    `[xpi-superplan] mode: ${input.mode}`,
    `workflow: ${input.workflowId}`,
    `dir: ${input.workflowDir}`,
  ];
  if (input.feedback) {
    lines.push(`用户反馈: ${input.feedback}`);
  }
  lines.push(
    `加载 xpi-superplan skill,严格按其「${input.mode}」流程执行;用户取消不得产生虚假的完成状态。`,
  );
  return lines.join("\n");
}
