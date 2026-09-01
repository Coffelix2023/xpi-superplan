/** DecisionPoint → deck JSON 转换与 sendMessage 指令,见 design.md D1。 */

import type { DecisionPoint } from "../domain/types.ts";

/** pi-design-deck deck-schema 的最小面(仅本扩展用到的字段)。 */
export interface DeckOption {
  aside?: string;
  description?: string;
  label: string;
  previewBlocks: Array<
    | {
        code: string;
        lang: string;
        type: "code";
      }
    | {
        content: string;
        type: "html" | "mermaid";
      }
  >;
  recommended?: boolean;
}

export interface DeckSlide {
  context?: string;
  id: string;
  options: DeckOption[];
  title: string;
}

export interface DeckConfig {
  slides: DeckSlide[];
  title?: string;
}

/** 候选摘要 + 优劣风险拼为 aside,无富预览需求,统一用 text 块。 */
function optionAside(point: DecisionPoint, index: number): string {
  const c = point.candidates[index];
  const parts: string[] = [];
  if (c.pros.length > 0) parts.push(`优势: ${c.pros.join("; ")}`);
  if (c.cons.length > 0) parts.push(`代价: ${c.cons.join("; ")}`);
  if (c.risks.length > 0) parts.push(`风险: ${c.risks.join("; ")}`);
  return (
    [
      c.summary,
      ...parts,
    ].join("\n") || "(无说明)"
  );
}

/** DecisionPoint 转为单 slide deck JSON。 */
export function toDeckConfig(point: DecisionPoint): DeckConfig {
  return {
    title: point.question,
    slides: [
      {
        context: [
          point.context,
          ...point.constraints.map((c) => `约束: ${c}`),
        ]
          .filter(Boolean)
          .join("\n"),
        id: point.id,
        options: point.candidates.map((c, i) => ({
          aside: optionAside(point, i),
          description: c.summary,
          label: `${c.id} ${c.title}`,
          recommended: point.recommendedId === c.id,
          previewBlocks: [
            {
              content: `<p>${c.summary}</p>`,
              type: "html" as const,
            },
          ],
        })),
        title: point.question,
      },
    ],
  };
}

/** 生成给模型的 sendMessage 指令文本(由扩展注入,模型负责调用 design_deck)。 */
export function deckInstruction(config: DeckConfig): string {
  return [
    "请调用 design_deck 工具展示以下决策卡片,等用户提交后原样返回结果:",
    JSON.stringify(config),
  ].join("\n");
}
