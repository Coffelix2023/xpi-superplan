import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkflow } from "../archive/store.ts";
import { parseTasks, validateArtifacts } from "./validate.ts";

const VALID_TASKS = `# 测试 — 任务计划

## T1 实现存储层

- 依赖: (无)
- 验收标准: SHALL 读写往返一致
- 验证命令: \`pnpm test\`

## T2 接入队列

- 依赖: T1
- 验收标准: SHALL 并发写不丢失
- 验证命令: \`pnpm test\`
`;

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "superplan-validate-"));
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

/** 建齐三文档;tasks 内容可替换。 */
async function seedValid(tasks = VALID_TASKS): Promise<void> {
  await write("proposal.md", "# 提案\n");
  await write("design.md", "# 设计\n");
  await write("tasks.md", tasks);
}

describe("parseTasks", () => {
  it("解析 id/标题/依赖/验收/验证", () => {
    const tasks = parseTasks(VALID_TASKS);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toEqual({
      acceptance: "SHALL 读写往返一致",
      dependsOn: [],
      id: "T1",
      title: "实现存储层",
      verify: "pnpm test",
    });
    expect(tasks[1].dependsOn).toEqual([
      "T1",
    ]);
  });
});

describe("validateArtifacts 四类缺陷", () => {
  it("完整文档集通过, 无诊断", async () => {
    await seedValid();
    expect(validateArtifacts(workflowDir())).toEqual([]);
  });

  it("缺陷1: 缺文档", async () => {
    await seedValid();
    await rm(path.join(workflowDir(), "design.md"));
    const issues = validateArtifacts(workflowDir());
    expect(issues).toEqual([
      {
        file: "design.md",
        message: "缺少必需文档 design.md",
      },
    ]);
  });

  it("缺陷2: 任务 id 重复", async () => {
    await seedValid(`${VALID_TASKS}
## T1 冒名顶替

- 依赖: (无)
- 验收标准: SHALL 无关紧要
- 验证命令: \`true\`
`);
    const issues = validateArtifacts(workflowDir());
    expect(issues).toContainEqual({
      file: "tasks.md",
      message: "任务 id 重复: T1(冒名顶替)",
    });
  });

  it("缺陷3: 任务缺 SHALL 验收标准或验证命令,诊断指到具体任务", async () => {
    await seedValid(`# 任务

## T1 无验收

- 依赖: (无)
- 验证命令: \`pnpm test\`

## T2 无验证

- 依赖: (无)
- 验收标准: SHALL 存在
`);
    const issues = validateArtifacts(workflowDir());
    expect(issues).toContainEqual({
      file: "tasks.md",
      message: "任务 T1 缺少 SHALL 验收标准",
    });
    expect(issues).toContainEqual({
      file: "tasks.md",
      message: "任务 T2 缺少验证命令",
    });
  });

  it("缺陷4: 依赖成环, 报告成环链", async () => {
    await seedValid(`# 任务

## A

- 依赖: B
- 验收标准: SHALL x
- 验证命令: \`true\`

## B

- 依赖: A
- 验收标准: SHALL y
- 验证命令: \`true\`
`);
    const issues = validateArtifacts(workflowDir());
    const cycle = issues.find((i) => i.message.indexOf("依赖成环") === 0);
    expect(cycle?.message).toContain("A -> B");
  });

  it("依赖不存在的任务也报可读诊断", async () => {
    await seedValid(`# 任务

## T1

- 依赖: 幽灵
- 验收标准: SHALL x
- 验证命令: \`true\`
`);
    const issues = validateArtifacts(workflowDir());
    expect(issues).toContainEqual({
      file: "tasks.md",
      message: "任务 T1 依赖不存在的任务 幽灵",
    });
  });
});
