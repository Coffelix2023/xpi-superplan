import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkflow } from "../archive/store.ts";
import {
  DECK_PACKAGE,
  DECK_TOOL_NAME,
  detectDeckTool,
  ensureDeckAvailable,
  resolveDeckMissing,
} from "./deck.ts";

function toolsOf(...names: string[]): () => Array<{
  name: string;
}> {
  return () =>
    names.map((name) => ({
      name,
    }));
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "superplan-deck-"));
  await createWorkflow({
    cwd: dir,
    id: "2026-01-01-test",
    title: "测试",
  });
});

afterEach(async () => {
  await rm(dir, {
    force: true,
    recursive: true,
  });
});

const timeline = async () =>
  readFile(
    path.join(dir, ".pi", "superplan", "workflows", "2026-01-01-test", "timeline.md"),
    "utf8",
  );

describe("detectDeckTool", () => {
  it("已注册 design_deck 返回 true", () => {
    expect(detectDeckTool(toolsOf("read", DECK_TOOL_NAME, "bash"))).toBe(true);
  });

  it("未注册返回 false", () => {
    expect(detectDeckTool(toolsOf("read", "bash"))).toBe(false);
    expect(detectDeckTool(() => [])).toBe(false);
  });

  it("getAllTools 缺失或抛错 fail-closed 视为缺失", () => {
    expect(detectDeckTool(undefined)).toBe(false);
    expect(
      detectDeckTool(() => {
        throw new Error("boom");
      }),
    ).toBe(false);
  });
});

describe("resolveDeckMissing", () => {
  it("用户拒绝安装 -> 退化 TUI,reason 可用于 timeline", async () => {
    let installCalled = false;
    const decision = await resolveDeckMissing(
      {
        confirm: async () => false,
        notify: () => {},
      },
      async () => {
        installCalled = true;
      },
    );
    expect(decision).toEqual({
      action: "tui-fallback",
      reason: "用户拒绝安装 deck",
    });
    expect(installCalled).toBe(false);
    await appendReason(decision.action === "tui-fallback" ? decision.reason : "");
    expect(await timeline()).toContain("deck-fallback | 用户拒绝安装 deck");
  });

  it("用户同意且安装成功 -> deck 路径", async () => {
    const installed: string[] = [];
    const decision = await resolveDeckMissing(
      {
        confirm: async () => true,
        notify: () => {},
      },
      async (pkg) => {
        installed.push(pkg);
      },
    );
    expect(decision).toEqual({
      action: "deck",
    });
    expect(installed).toEqual([
      DECK_PACKAGE,
    ]);
  });

  it("安装失败 -> 退化 TUI,原因含错误信息", async () => {
    const decision = await resolveDeckMissing(
      {
        confirm: async () => true,
        notify: () => {},
      },
      async () => {
        throw new Error("网络不通");
      },
    );
    expect(decision.action).toBe("tui-fallback");
    if (decision.action === "tui-fallback") {
      expect(decision.reason).toContain("网络不通");
    }
  });
});

/** 测试辅助:把退化原因写入 timeline(生产路径由调用方完成)。 */
async function appendReason(reason: string): Promise<void> {
  const { appendTimeline } = await import("../archive/store.ts");
  await appendTimeline(
    path.join(dir, ".pi", "superplan", "workflows", "2026-01-01-test"),
    "deck-fallback",
    reason,
  );
}

describe("ensureDeckAvailable", () => {
  it("deck 已注册不触发安装询问", async () => {
    let confirmed = false;
    const decision = await ensureDeckAvailable(
      {
        confirm: async () => {
          confirmed = true;
          return true;
        },
        notify: () => {},
      },
      toolsOf(DECK_TOOL_NAME),
      async () => {
        throw new Error("不应调用");
      },
    );
    expect(decision).toEqual({
      action: "deck",
    });
    expect(confirmed).toBe(false);
  });

  it("deck 缺失走确认分支,拒绝后 reason 供 timeline 记录", async () => {
    const decision = await ensureDeckAvailable(
      {
        confirm: async () => false,
        notify: () => {},
      },
      toolsOf("read"),
      async () => {},
    );
    expect(decision.action).toBe("tui-fallback");
  });
});
