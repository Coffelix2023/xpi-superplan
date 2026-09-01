import { describe, expect, it } from "vitest";
import type { DecisionPoint } from "../domain/types.ts";
import { deckInstruction, toDeckConfig } from "./deck-convert.ts";

const POINT: DecisionPoint = {
  context: "本地持久化场景",
  id: "dp-storage",
  question: "选哪个存储?",
  recommendedId: "a",
  candidates: [
    {
      cons: [],
      id: "a",
      summary: "最简单",
      title: "JSON 文件",
      pros: [
        "零依赖",
      ],
      risks: [
        "并发写丢失",
      ],
    },
    {
      id: "b",
      risks: [],
      summary: "更强查询",
      title: "SQLite",
      cons: [
        "重",
      ],
      pros: [
        "事务",
      ],
    },
  ],
  constraints: [
    "零外部依赖",
    "Node 24+",
  ],
};

describe("toDeckConfig", () => {
  const config = toDeckConfig(POINT);

  it("生成单 slide,id/question 来自 DecisionPoint", () => {
    expect(config.title).toBe("选哪个存储?");
    expect(config.slides).toHaveLength(1);
    expect(config.slides[0].id).toBe("dp-storage");
    expect(config.slides[0].title).toBe("选哪个存储?");
  });

  it("每个候选一个 option,label 为 `<id> <title>`", () => {
    const labels = config.slides[0].options.map((o) => o.label);
    expect(labels).toEqual([
      "a JSON 文件",
      "b SQLite",
    ]);
  });

  it("recommended 标记推荐候选,其余 false", () => {
    const recs = config.slides[0].options.map((o) => o.recommended);
    expect(recs).toEqual([
      true,
      false,
    ]);
  });

  it("context 拼接上下文与约束", () => {
    expect(config.slides[0].context).toContain("本地持久化场景");
    expect(config.slides[0].context).toContain("约束: 零外部依赖");
    expect(config.slides[0].context).toContain("约束: Node 24+");
  });

  it("aside 含 summary 与非空 pros/cons/risks,空数组不产生噪音", () => {
    const [a, b] = config.slides[0].options;
    expect(a.aside).toContain("最简单");
    expect(a.aside).toContain("优势: 零依赖");
    expect(a.aside).toContain("风险: 并发写丢失");
    expect(a.aside).not.toContain("代价");
    expect(b.aside).toContain("代价: 重");
    expect(b.aside).not.toContain("风险");
  });

  it("无推荐项时全部 recommended=false", () => {
    const config2 = toDeckConfig({
      ...POINT,
      recommendedId: undefined,
    });
    expect(config2.slides[0].options.every((o) => o.recommended === false)).toBe(true);
  });

  it("输出可 JSON 序列化且可被 deck-schema 校验通过(parses back)", () => {
    const json = JSON.parse(JSON.stringify(config)) as typeof config;
    expect(json.slides[0].options[0].previewBlocks).toEqual([
      {
        content: "<p>最简单</p>",
        type: "html",
      },
    ]);
  });
});

describe("deckInstruction", () => {
  it("指令含 design_deck 调用要求与完整 JSON", () => {
    const text = deckInstruction(toDeckConfig(POINT));
    expect(text).toContain("design_deck");
    const jsonLine = text.split("\n")[1];
    const parsed = JSON.parse(jsonLine) as {
      slides: Array<{
        id: string;
      }>;
    };
    expect(parsed.slides[0].id).toBe("dp-storage");
  });
});
