/**
 * M5 结构化提问桥,对应 design.md D2 与 spec「结构化提问」:
 * 主路径 ctx.ui 自实现;plan_mode_question 工具可用时才桥接增强。
 * 两条路径产出同一内部答案模型(PlanQuestionAnswer),档案不依赖 plan-mode 存在。
 */

export const PLAN_QUESTION_TOOL = "plan_mode_question";

/** 工具注册表最小面(复用 deck 检测约定)。 */
export type ToolsLike = Array<{
  name?: string;
}>;

/** plan_mode_question 已注册返回 true;getAllTools 缺失/抛错视为不可用(fail-closed)。 */
export function detectPlanQuestionTool(
  getAllTools: (() => ToolsLike) | undefined,
): boolean {
  if (typeof getAllTools !== "function") {
    return false;
  }
  try {
    return getAllTools().some((t) => t?.name === PLAN_QUESTION_TOOL);
  } catch {
    return false;
  }
}

/** 一个结构化问题的最小面(与 ctx.ui.select 语义对齐)。 */
export interface PlanQuestion {
  /** 问题 id,写入答案模型,保证两条路径可对照。 */
  id: string;
  options: string[];
  question: string;
  /** 推荐 option label,仅提示不强制。 */
  recommended?: string;
}

/** 内部答案模型:两条提问路径的统一产物,plan-mode 不在场也成立。 */
export interface PlanQuestionAnswer {
  /** 用户取消;调用方决定重试或跳过。 */
  cancelled: true;
  id: string;
}
export interface PlanQuestionAnswerPicked {
  cancelled: false;
  /** option label 原文。 */
  choice: string;
  id: string;
  note?: string;
}

export type PlanAnswer = PlanQuestionAnswer | PlanQuestionAnswerPicked;

/** ctx.ui 最小面(与 decision/tui.ts PromptUI 同约定)。 */
export interface QuestionUI {
  input(title: string, placeholder?: string): Promise<string | undefined>;
  notify(message: string, type?: "info" | "warning" | "error"): void;
  select(title: string, options: string[]): Promise<string | undefined>;
}

/**
 * ctx.ui 主路径:选项选择 + 可选备注 -> PlanAnswer。
 * 取消 / 选项不在候选内均返回 cancelled(非法值不静默收编)。
 */
export async function askViaTui(
  ui: QuestionUI,
  question: PlanQuestion,
): Promise<PlanAnswer> {
  const picked = await ui.select(question.question, question.options);
  if (picked === undefined) {
    return {
      cancelled: true,
      id: question.id,
    };
  }
  if (!question.options.includes(picked)) {
    ui.notify(`非法选项: ${picked}`, "warning");
    return {
      cancelled: true,
      id: question.id,
    };
  }
  const note = await ui.input("备注(可留空)");
  return {
    cancelled: false,
    choice: picked,
    id: question.id,
    note: note || undefined,
  };
}

/** 桥接可用时的 sendMessage 指令正文(模型据此调用 plan_mode_question)。 */
export function bridgeInstruction(question: PlanQuestion): string {
  const options = question.options
    .map((o) => `- ${o}${o === question.recommended ? "(推荐)" : ""}`)
    .join("\n");
  return [
    `请调用工具 ${PLAN_QUESTION_TOOL} 向用户提问(id: ${question.id}):`,
    question.question,
    "选项:",
    options,
    "返回的选择结果须由扩展捕获回写,不得自行决定答案。",
  ].join("\n");
}

export type QuestionRoute =
  | {
      action: "bridge";
      instruction: string;
    }
  | {
      action: "tui";
    };

/**
 * 路由决策:plan_mode_question 可用 -> 桥接(D2 可选增强);
 * 不可用 -> ctx.ui 主路径。桥接失败由调用方退化 askViaTui。
 */
export function routePlanQuestion(
  getAllTools: (() => ToolsLike) | undefined,
  question: PlanQuestion,
): QuestionRoute {
  if (detectPlanQuestionTool(getAllTools)) {
    return {
      action: "bridge",
      instruction: bridgeInstruction(question),
    };
  }
  return {
    action: "tui",
  };
}
