import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkflow } from "../archive/store.ts";
import { checkArtifacts } from "./cli.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "superplan-cli-"));
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

const workflowDir = () =>
  path.join(dir, ".pi", "superplan", "workflows", "2026-01-01-test");
const write = async (file: string, content: string) => {
  await writeFile(path.join(workflowDir(), file), content, "utf8");
};

const VALID_TASKS = `# 任务

## T1

- 依赖: (无)
- 验收标准: SHALL 完成
- 验证命令: \`pnpm test\`
`;

/** 建齐合法三文档。 */
async function seedValid(): Promise<void> {
  await write("proposal.md", "# 提案\n");
  await write("design.md", "# 设计\n");
  await write("tasks.md", VALID_TASKS);
}

describe("checkArtifacts(无 CLI 环境)", () => {
  it("CLI 不存在时本地校验兜底,合法文档集通过", async () => {
    await seedValid();
    const result = await checkArtifacts(
      workflowDir(),
      "some-change",
      async () => undefined,
    );
    expect(result).toEqual({
      issues: [],
      mode: "local",
    });
  });

  it("fallback mode finds issues", async () => {
    await rm(path.join(workflowDir(), "design.md"));
    // 只留 proposal.md, 其余必需文档已删/未补
    const result = await checkArtifacts(
      workflowDir(),
      "some-change",
      async () => undefined,
    );
    expect(result).toEqual({
      mode: "local",
      issues: [
        {
          file: "design.md",
          message: "缺少必需文档 design.md",
        },
      ],
    });
  });

  it("CLI 可用但未提供 changeName 时也走本地校验", async () => {
    await seedValid();
    const result = await checkArtifacts(workflowDir(), undefined, async () => "0.5.0");
    expect(result).toEqual({
      issues: [],
      mode: "local",
    });
  });
});

describe("checkArtifacts(CLI 可用)", () => {
  it("CLI 可用且有 changeName 时走 openspec validate", async () => {
    const result = await checkArtifacts(
      workflowDir(),
      "my-change",
      async () => "0.5.0",
    );
    // 本机实际执行 openspec validate my-change;无论输出成败都是结构化结果
    expect(result.mode).toBe("openspec");
    if (result.mode === "openspec") {
      expect(result.cli).toBe("0.5.0");
      expect(typeof result.output).toBe("string");
    }
  });

  it("CLI 检测失败时 fail-open 到本地校验", async () => {
    await seedValid();
    const result = await checkArtifacts(workflowDir(), "x", async () => {
      throw new Error("command not found");
    });
    expect(result.mode).toBe("local");
  });
});
