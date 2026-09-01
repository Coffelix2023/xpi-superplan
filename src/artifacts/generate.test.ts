import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkflow } from "../archive/store.ts";
import type { ArtifactInput, ArtifactTask } from "./generate.ts";
import { generateArtifacts, writeArtifacts } from "./generate.ts";

const INPUT: ArtifactInput = {
  title: "测试工作流",
  decisions: [
    {
      candidateTitle: "JSON 文件",
      id: "a",
      note: "先简后繁",
      pointId: "dp-1",
      question: "选哪个存储?",
    },
    {
      candidateTitle: "单写队列",
      id: "b",
      pointId: "dp-2",
      question: "并发策略?",
    },
  ],
  research: [
    "调研发现 X 库成熟",
    "性能基准 Y 达标",
  ],
};

const TASKS: ArtifactTask[] = [
  {
    acceptance: "读写往返一致",
    dependsOn: [],
    id: "T1",
    title: "实现存储层",
    verify: "pnpm test",
  },
  {
    acceptance: "并发写不丢失",
    id: "T2",
    title: "接入并发队列",
    verify: "pnpm test",
    dependsOn: [
      "T1",
    ],
  },
];

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "superplan-artifacts-"));
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
const read = (file: string) => readFile(path.join(workflowDir(), file), "utf8");

describe("generateArtifacts", () => {
  const docs = generateArtifacts(INPUT, TASKS);

  it("proposal 含背景(调研)/目标(SHALL)/范围/非目标/风险", () => {
    const p = docs["proposal.md"];
    expect(p).toContain("## 背景");
    expect(p).toContain("调研发现 X 库成熟");
    expect(p).toContain("SHALL");
    expect(p).toContain("## 范围");
    expect(p).toContain("## 非目标");
    expect(p).toContain("## 风险");
    expect(p).toContain("JSON 文件");
  });

  it("design 含架构/接口/数据流/失败处理(WHEN/THEN)", () => {
    const d = docs["design.md"];
    expect(d).toContain("## 架构");
    expect(d).toContain("## 接口");
    expect(d).toContain("SHALL 满足决策 dp-1");
    expect(d).toContain("## 数据流");
    expect(d).toContain("WHEN 决策约束无法满足 THEN 停止实现");
  });

  it("tasks 含依赖/验收标准(SHALL)/验证命令", () => {
    const t = docs["tasks.md"];
    expect(t).toContain("## T1 实现存储层");
    expect(t).toContain("依赖: (无)");
    expect(t).toContain("依赖: T1");
    expect(t).toContain("SHALL 读写往返一致");
    expect(t).toContain("`pnpm test`");
    expect(t).toContain("依据决策 dp-2:单写队列");
  });

  it("备注注入决策行,未采纳理由可经 decisions.md 追溯", () => {
    expect(docs["proposal.md"]).toContain("先简后繁");
    expect(docs["proposal.md"]).toContain("详见 decisions.md dp-1");
  });
});

describe("writeArtifacts", () => {
  it("三文档原子写入工作流目录", async () => {
    await writeArtifacts(workflowDir(), INPUT, TASKS);
    expect(await read("proposal.md")).toContain("测试工作流");
    expect(await read("design.md")).toContain("数据流");
    expect(await read("tasks.md")).toContain("T2 接入并发队列");
  });
});
