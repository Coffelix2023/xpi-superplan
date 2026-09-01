/** deck(pi-design-deck)检测与退化决策,对应 spec「卡片工具缺失退化」。 */

export const DECK_TOOL_NAME = "design_deck";

/** deck 包的 pi 安装源;拒绝安装时退化 TUI。 */
export const DECK_PACKAGE = "npm:@earendil-works/pi-design-deck";

export interface DeckPromptUI {
  confirm(title: string, message: string): Promise<boolean>;
  notify(message: string, type?: "info" | "warning" | "error"): void;
}

/** deck 工具已注册返回 true;getAllTools 不可用视为缺失(fail-closed)。 */
export function detectDeckTool(getAllTools: (() => unknown[]) | undefined): boolean {
  if (typeof getAllTools !== "function") {
    return false;
  }
  try {
    return getAllTools().some(
      (t) =>
        typeof t === "object" &&
        t !== null &&
        (
          t as {
            name?: string;
          }
        ).name === DECK_TOOL_NAME,
    );
  } catch {
    return false;
  }
}

export type DeckInstallDecision =
  | {
      action: "deck";
    }
  | {
      action: "tui-fallback";
      reason: string;
    };

/**
 * deck 缺失时的分支:用户确认则安装(fail-closed:安装失败即退化),拒绝则直接退化。
 * 返回退化分支时 reason 必非空,供 timeline 记录。
 */
export async function resolveDeckMissing(
  ui: DeckPromptUI,
  install: (pkg: string) => Promise<void>,
): Promise<DeckInstallDecision> {
  const agreed = await ui.confirm(
    "决策卡片工具未安装",
    `是否安装 ${DECK_PACKAGE}?拒绝则退化到终端选择,决策记录不受影响。`,
  );
  if (!agreed) {
    return {
      action: "tui-fallback",
      reason: "用户拒绝安装 deck",
    };
  }
  try {
    await install(DECK_PACKAGE);
    return {
      action: "deck",
    };
  } catch (err) {
    return {
      action: "tui-fallback",
      reason: `deck 安装失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 决策入口编排:deck 可用走 deck(返回 install 动作由调用方执行),
 * 缺失时走 resolveDeckMissing;无论哪个分支,选择收集都可用 TUI 兜底。
 */
export async function ensureDeckAvailable(
  ui: DeckPromptUI,
  getAllTools: (() => unknown[]) | undefined,
  install: (pkg: string) => Promise<void>,
): Promise<DeckInstallDecision> {
  if (detectDeckTool(getAllTools)) {
    return {
      action: "deck",
    };
  }
  return resolveDeckMissing(ui, install);
}
