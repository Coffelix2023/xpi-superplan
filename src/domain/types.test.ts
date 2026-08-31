import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  isWorkflowState,
  WORKFLOW_STATES,
} from "./types.ts";

describe("状态机", () => {
  it("覆盖 8 个生命周期状态", () => {
    expect(WORKFLOW_STATES).toHaveLength(8);
    expect(isWorkflowState("draft")).toBe(true);
    expect(isWorkflowState("nonsense")).toBe(false);
  });

  it("允许合法转换", () => {
    expect(canTransition("draft", "researching")).toBe(true);
    expect(canTransition("implementing", "paused")).toBe(true);
    expect(canTransition("paused", "implementing")).toBe(true);
    expect(canTransition("completed", "archived")).toBe(true);
  });

  it("拒绝非法转换", () => {
    expect(canTransition("draft", "implementing")).toBe(false);
    expect(canTransition("archived", "draft")).toBe(false);
    expect(canTransition("completed", "implementing")).toBe(false);
    expect(canTransition("archived", "archived")).toBe(false);
  });

  it("assertTransition 对非法转换抛错", () => {
    expect(() => assertTransition("draft", "archived")).toThrow("非法状态转换");
    expect(() => assertTransition("planned", "implementing")).not.toThrow();
  });
});
