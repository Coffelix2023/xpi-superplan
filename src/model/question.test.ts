import { describe, expect, it } from "vitest";
import {
  askViaTui,
  bridgeInstruction,
  detectPlanQuestionTool,
  PLAN_QUESTION_TOOL,
  type PlanQuestion,
  type QuestionUI,
  routePlanQuestion,
} from "./question.ts";

const QUESTION: PlanQuestion = {
  id: "db-choice",
  question: "数据库选哪个?",
  recommended: "SQLite 轻量",
  options: [
    "SQLite 轻量",
    "Postgres 完整",
  ],
};

function fakeTools(names: string[]): () => Array<{
  name: string;
}> {
  return () =>
    names.map((name) => ({
      name,
    }));
}

function fakeUI(
  selectResult: string | undefined,
  inputResult?: string,
): QuestionUI & {
  notes: string[];
} {
  const notes: string[] = [];
  return {
    input: async () => inputResult,
    notes,
    notify: (message: string) => {
      notes.push(message);
    },
    select: async () => selectResult,
  };
}

describe("detectPlanQuestionTool", () => {
  it("已注册 -> true", () => {
    expect(
      detectPlanQuestionTool(
        fakeTools([
          "read",
          PLAN_QUESTION_TOOL,
        ]),
      ),
    ).toBe(true);
  });

  it.each([
    [
      "未注册",
      fakeTools([
        "read",
        "bash",
      ]),
    ],
    [
      "getAllTools 缺失",
      undefined,
    ],
  ])("%s -> false", (_label, getAllTools) => {
    expect(detectPlanQuestionTool(getAllTools)).toBe(false);
  });

  it("getAllTools 抛错 -> false(fail-closed)", () => {
    expect(
      detectPlanQuestionTool(() => {
        throw new Error("boom");
      }),
    ).toBe(false);
  });
});

describe("routePlanQuestion", () => {
  it("工具可用 -> bridge,指令含问题与选项", () => {
    const route = routePlanQuestion(
      fakeTools([
        PLAN_QUESTION_TOOL,
      ]),
      QUESTION,
    );
    expect(route.action).toBe("bridge");
    if (route.action === "bridge") {
      expect(route.instruction).toContain(PLAN_QUESTION_TOOL);
      expect(route.instruction).toContain("db-choice");
      expect(route.instruction).toContain("- SQLite 轻量(推荐)");
    }
  });

  it("工具不可用 -> tui 主路径", () => {
    expect(routePlanQuestion(undefined, QUESTION).action).toBe("tui");
  });
});

describe("askViaTui", () => {
  it("选择与备注产出完整 PlanAnswer,与桥接同一内部模型", async () => {
    const ui = fakeUI("SQLite 轻量", "数据量小");
    const answer = await askViaTui(ui, QUESTION);
    expect(answer).toEqual({
      cancelled: false,
      choice: "SQLite 轻量",
      id: "db-choice",
      note: "数据量小",
    });
  });

  it("备注留空 -> note undefined", async () => {
    const answer = await askViaTui(fakeUI("Postgres 完整", ""), QUESTION);
    expect(answer).toEqual({
      cancelled: false,
      choice: "Postgres 完整",
      id: "db-choice",
    });
  });

  it("用户取消 -> cancelled", async () => {
    expect(await askViaTui(fakeUI(undefined), QUESTION)).toEqual({
      cancelled: true,
      id: "db-choice",
    });
  });

  it("非法选项 -> 提示并 cancelled(不静默收编)", async () => {
    const ui = fakeUI("MongoDB");
    const answer = await askViaTui(ui, QUESTION);
    expect(answer).toEqual({
      cancelled: true,
      id: "db-choice",
    });
    expect(ui.notes[0]).toContain("非法选项");
  });

  it("推荐项仅为提示,不改变选择语义", () => {
    expect(bridgeInstruction(QUESTION)).toContain("(推荐)");
    expect(QUESTION.options).toContain(QUESTION.recommended);
  });
});
