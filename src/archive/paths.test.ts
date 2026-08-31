import { describe, expect, it } from "vitest";
import {
  isValidWorkflowId,
  resolveInside,
  resolveWorkflowDir,
  slugify,
  workflowsRoot,
} from "./paths.ts";

const CWD = "/proj";
const VALID_ID = "2026-08-31-dashboard";

describe("workflow id 校验", () => {
  it("接受合法 id", () => {
    expect(isValidWorkflowId(VALID_ID)).toBe(true);
    expect(isValidWorkflowId("2026-01-01-a")).toBe(true);
  });

  it("拒绝非法 id", () => {
    for (const bad of [
      "",
      "dashboard",
      "2026-08-31",
      "2026-08-31-",
      "2026-08-31-UPPER",
      "2026-08-31-a/b",
      "2026-08-31-..",
      "../etc",
      "2026-13-40-x", // 月份日期超界仍过正则, 但这里只校验格式
      " 2026-08-31-x",
    ]) {
      expect(isValidWorkflowId(bad), bad).toBe(false);
    }
  });
});

describe("路径解析", () => {
  it("合法 id 解析到 workflows 根目录内", () => {
    const dir = resolveWorkflowDir(CWD, VALID_ID);
    expect(dir).toBe(`${workflowsRoot(CWD)}/${VALID_ID}`);
  });

  it("非法 id 抛错", () => {
    expect(() => resolveWorkflowDir(CWD, "../evil")).toThrow("非法 workflow id");
    expect(() => resolveWorkflowDir(CWD, "2026-08-31-a/../b")).toThrow(
      "非法 workflow id",
    );
  });

  it("resolveInside 拒绝逃逸", () => {
    const dir = resolveWorkflowDir(CWD, VALID_ID);
    expect(resolveInside(dir, "tasks.md")).toBe(`${dir}/tasks.md`);
    expect(resolveInside(dir, "revisions/1/tasks.md")).toContain("revisions");
    expect(() => resolveInside(dir, "../other/tasks.md")).toThrow("路径越出");
    expect(() => resolveInside(dir, "/etc/passwd")).toThrow("拒绝绝对路径");
  });
});

describe("slugify", () => {
  it("转换常见标题", () => {
    expect(slugify("Add Dark Mode!")).toBe("add-dark-mode");
    expect(slugify("  多次--分隔  ")).toBe("workflow");
    expect(slugify("中文标题")).toBe("workflow");
  });
});
