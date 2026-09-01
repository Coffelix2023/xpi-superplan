/**
 * M3 完整性校验:缺文档/重复任务/无验收标准/依赖成环,对应 spec「完整性校验」。
 * 校验失败给出可读诊断,不进入执行状态。
 */

import { existsSync, readFileSync } from "node:fs";
import { resolveInside } from "../archive/paths.ts";

const HEADING_RE = /^## (\S+)(?:\s+(.*))?$/;
const DEP_RE = /^- 依赖: (.+)$/;
const ACC_RE = /^- 验收标准: (.+)$/;
const VERIFY_RE = /^- 验证命令: `(.+)`$/;
const SHALL_RE = /^SHALL\b/;

/** 单条诊断:文件/位置 + 可读描述。 */
export interface ArtifactIssue {
  file: string;
  message: string;
}

/** 必需文档集合,见 design.md D3(spec 生成路径只需要三工件)。 */
export const REQUIRED_ARTIFACTS = [
  "proposal.md",
  "design.md",
  "tasks.md",
] as const;

/** 解析 tasks.md 中的任务块(## <id> <title> 及其依赖/验收/验证行)。 */
export interface ParsedTask {
  acceptance: string;
  dependsOn: string[];
  id: string;
  title: string;
  verify: string;
}

/** 从 tasks.md 文本解析任务;无 id 的块被忽略(标题行是唯一判定依据)。 */
export function parseTasks(text: string): ParsedTask[] {
  const tasks: ParsedTask[] = [];
  let current:
    | {
        dependsOn: string[];
        id: string;
        title: string;
      }
    | undefined;
  let acceptance = "";
  let verify = "";
  const flush = () => {
    if (current) {
      tasks.push({
        acceptance,
        dependsOn: current.dependsOn,
        id: current.id,
        title: current.title,
        verify,
      });
    }
    acceptance = "";
    verify = "";
  };
  for (const line of text.split("\n")) {
    const heading = line.match(HEADING_RE);
    if (heading) {
      flush();
      current = {
        dependsOn: [],
        id: heading[1],
        title: heading[2] ?? "",
      };
      continue;
    }
    if (!current) continue;
    const dep = line.match(DEP_RE);
    if (dep) {
      current.dependsOn =
        dep[1].trim() === "(无)" ? [] : dep[1].split(",").map((s) => s.trim());
    }
    const acc = line.match(ACC_RE);
    if (acc) acceptance = acc[1].trim();
    const ver = line.match(VERIFY_RE);
    if (ver) verify = ver[1].trim();
  }
  flush();
  return tasks;
}

/** 检查1: 缺必需文档。有缺失时返回 true(后续检查无输入)。 */
function checkMissingDocs(workflowDir: string, issues: ArtifactIssue[]): boolean {
  let missing = false;
  for (const file of REQUIRED_ARTIFACTS) {
    if (!existsSync(resolveInside(workflowDir, file))) {
      issues.push({
        file,
        message: `缺少必需文档 ${file}`,
      });
      missing = true;
    }
  }
  return missing;
}

/** 检查2: 任务 id 重复。 */
function checkDuplicates(tasks: ParsedTask[], issues: ArtifactIssue[]): void {
  const seen = new Set<string>();
  for (const t of tasks) {
    if (seen.has(t.id)) {
      issues.push({
        file: "tasks.md",
        message: `任务 id 重复: ${t.id}(${t.title})`,
      });
    }
    seen.add(t.id);
  }
}

/** 检查3: 任务缺 SHALL 验收标准或验证命令。 */
function checkTaskCompleteness(tasks: ParsedTask[], issues: ArtifactIssue[]): void {
  for (const t of tasks) {
    if (!t.acceptance || !SHALL_RE.test(t.acceptance)) {
      issues.push({
        file: "tasks.md",
        message: `任务 ${t.id} 缺少 SHALL 验收标准`,
      });
    }
    if (!t.verify) {
      issues.push({
        file: "tasks.md",
        message: `任务 ${t.id} 缺少验证命令`,
      });
    }
  }
}

/** 检查4: 依赖成环(DFS 染色)+ 引用不存在的依赖。 */
function checkDependencyCycles(tasks: ParsedTask[], issues: ArtifactIssue[]): void {
  const byId = new Map(
    tasks.map((t) => [
      t.id,
      t,
    ]),
  );
  const color = new Map<string, number>();
  for (const t of tasks) color.set(t.id, 0);

  const visit = (id: string, stack: string[]): void => {
    color.set(id, 1);
    stack.push(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (!byId.has(dep)) {
        issues.push({
          file: "tasks.md",
          message: `任务 ${id} 依赖不存在的任务 ${dep}`,
        });
        continue;
      }
      const c = color.get(dep);
      if (c === 1) {
        const cycle = [
          ...stack.slice(stack.indexOf(dep)),
          dep,
        ].join(" -> ");
        issues.push({
          file: "tasks.md",
          message: `依赖成环: ${cycle}`,
        });
      } else if (c === 0) {
        visit(dep, stack);
      }
    }
    stack.pop();
    color.set(id, 2);
  };
  for (const t of tasks) {
    if (color.get(t.id) === 0) visit(t.id, []);
  }
}

/** 四类缺陷 + 未知缺陷全部检出;返回空数组表示通过。 */
export function validateArtifacts(workflowDir: string): ArtifactIssue[] {
  const issues: ArtifactIssue[] = [];
  if (checkMissingDocs(workflowDir, issues)) {
    return issues; // 文档缺失时后续检查无输入,提前返回
  }
  const tasks = parseTasks(
    readFileSync(resolveInside(workflowDir, "tasks.md"), "utf8"),
  );
  checkDuplicates(tasks, issues);
  checkTaskCompleteness(tasks, issues);
  checkDependencyCycles(tasks, issues);
  return issues;
}
