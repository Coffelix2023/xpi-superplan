import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertTransition,
  isWorkflowState,
  type WorkflowManifest,
  type WorkflowState,
} from "../domain/types.ts";
import { parseFrontmatter, serializeFrontmatter } from "./markdown.ts";
import {
  isValidWorkflowId,
  resolveInside,
  resolveWorkflowDir,
  slugify,
  workflowsRoot,
} from "./paths.ts";

/** 档案核心文件与子目录,见 design.md D3。 */
export const CORE_FILES = [
  "README.md",
  "decisions.md",
  "research.md",
  "proposal.md",
  "design.md",
  "tasks.md",
  "timeline.md",
] as const;

export const SUB_DIRS = [
  "revisions",
  "references",
  "scripts",
  "assets",
] as const;

const FILE_TITLES: Record<(typeof CORE_FILES)[number], string> = {
  "decisions.md": "决策记录",
  "design.md": "设计",
  "proposal.md": "提案",
  "README.md": "工作流元信息",
  "research.md": "调研",
  "tasks.md": "任务计划",
  "timeline.md": "时间线",
};

function nowIso(): string {
  return new Date().toISOString();
}

/** 原子写入:临时文件 + rename。目标必须在工作流目录内。 */
export async function atomicWrite(
  workflowDir: string,
  rel: string,
  content: string,
): Promise<void> {
  const target = resolveInside(workflowDir, rel);
  await mkdir(path.dirname(target), {
    recursive: true,
  });
  const tmp = `${target}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, target);
}
export async function appendTimeline(
  workflowDir: string,
  event: string,
  detail: string,
): Promise<void> {
  const file = resolveInside(workflowDir, "timeline.md");
  let existing = "";
  try {
    existing = await readFile(file, "utf8");
  } catch {
    // 首次写入
  }
  const line = `- ${nowIso()} | ${event} | ${detail}\n`;
  await atomicWrite(workflowDir, "timeline.md", existing + line);
}

function manifestFrontmatter(m: WorkflowManifest): string {
  return serializeFrontmatter({
    createdAt: m.createdAt,
    executionModel: m.executionModel ?? "",
    id: m.id,
    parent: m.parent ?? "",
    planningModel: m.planningModel ?? "",
    reviewModel: m.reviewModel ?? "",
    revision: m.revision,
    state: m.state,
    thinkingLevel: m.thinkingLevel ?? "",
    title: m.title,
    updatedAt: m.updatedAt,
  });
}

export interface CreateWorkflowOptions {
  cwd: string;
  id?: string;
  parent?: string;
  title: string;
}

/** 创建工作流档案;id 已存在时抛错(fail-closed)。 */
export async function createWorkflow(
  opts: CreateWorkflowOptions,
): Promise<WorkflowManifest> {
  const id = opts.id ?? `${nowIso().slice(0, 10)}-${slugify(opts.title)}`;
  const dir = resolveWorkflowDir(opts.cwd, id);
  try {
    await readdir(dir);
    throw new Error(`workflow 已存在: ${id}`);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("workflow 已存在")) {
      throw err;
    }
  }

  const now = nowIso();
  const manifest: WorkflowManifest = {
    createdAt: now,
    id,
    revision: 1,
    state: "draft",
    title: opts.title,
    updatedAt: now,
  };
  if (opts.parent) {
    manifest.parent = opts.parent;
  }

  await Promise.all(
    SUB_DIRS.map((sub) =>
      mkdir(path.join(dir, sub), {
        recursive: true,
      }),
    ),
  );
  await Promise.all(
    CORE_FILES.map((file) => {
      const header = file === "README.md" ? manifestFrontmatter(manifest) : "";
      return atomicWrite(
        dir,
        file,
        `${header}\n# ${opts.title} — ${FILE_TITLES[file]}\n`,
      );
    }),
  );
  await appendTimeline(
    dir,
    "create",
    `创建工作流 ${id}${opts.parent ? ` (parent: ${opts.parent})` : ""}`,
  );
  await snapshotRevision(dir, 1);
  return manifest;
}

/** 生成 revisions/<n>/ 快照;已存在则拒绝(历史不可覆盖)。 */
export async function snapshotRevision(
  workflowDir: string,
  revision: number,
): Promise<void> {
  const dest = resolveInside(workflowDir, path.join("revisions", String(revision)));
  try {
    await readdir(dest);
    throw new Error(`revision ${revision} 已存在,禁止覆盖`);
  } catch (err) {
    if (err instanceof Error && err.message.includes("禁止覆盖")) {
      throw err;
    }
  }
  await mkdir(dest, {
    recursive: true,
  });
  await Promise.all(CORE_FILES.map((file) => copyCoreFile(workflowDir, dest, file)));
}

async function copyCoreFile(
  workflowDir: string,
  dest: string,
  file: string,
): Promise<void> {
  let content = "";
  try {
    content = await readFile(path.join(workflowDir, file), "utf8");
  } catch {
    // 核心文件缺失则快照空内容, 校验由上层负责
  }
  await writeFile(path.join(dest, file), content, "utf8");
}

export async function readManifest(workflowDir: string): Promise<WorkflowManifest> {
  const content = await readFile(resolveInside(workflowDir, "README.md"), "utf8");
  const { data } = parseFrontmatter(content);
  const state = data.state ?? "";
  if (!isWorkflowState(state)) {
    throw new Error(`README.md 含非法状态: ${JSON.stringify(state)}`);
  }
  const revision = Number(data.revision);
  if (!Number.isInteger(revision) || revision < 1) {
    throw new Error(`README.md 含非法 revision: ${JSON.stringify(data.revision)}`);
  }
  const manifest: WorkflowManifest = {
    createdAt: data.createdAt ?? "",
    id: data.id ?? "",
    revision,
    state: state as WorkflowState,
    title: data.title ?? "",
    updatedAt: data.updatedAt ?? "",
  };
  if (data.parent) manifest.parent = data.parent;
  if (data.planningModel) manifest.planningModel = data.planningModel;
  if (data.executionModel) manifest.executionModel = data.executionModel;
  if (data.reviewModel) manifest.reviewModel = data.reviewModel;
  if (data.thinkingLevel) manifest.thinkingLevel = data.thinkingLevel;
  return manifest;
}

/** 修订:更新 README 并生成新 revision 快照。 */
export async function bumpRevision(
  workflowDir: string,
  state?: WorkflowState,
): Promise<WorkflowManifest> {
  const manifest = await readManifest(workflowDir);
  if (state) {
    assertTransition(manifest.state, state);
    manifest.state = state;
  }
  manifest.revision += 1;
  manifest.updatedAt = nowIso();
  const { body } = parseFrontmatter(
    await readFile(resolveInside(workflowDir, "README.md"), "utf8"),
  );
  await atomicWrite(workflowDir, "README.md", manifestFrontmatter(manifest) + body);
  await appendTimeline(
    workflowDir,
    "revise",
    `revision ${manifest.revision}${state ? `, 状态 -> ${state}` : ""}`,
  );
  await snapshotRevision(workflowDir, manifest.revision);
  return manifest;
}

/** 恢复:仅读 README.md + tasks.md,见 design.md D6。 */
export async function restoreFromDisk(
  cwd: string,
  id: string,
): Promise<{
  manifest: WorkflowManifest;
  tasks: string;
}> {
  const dir = resolveWorkflowDir(cwd, id);
  const manifest = await readManifest(dir);
  let tasks = "";
  try {
    tasks = await readFile(resolveInside(dir, "tasks.md"), "utf8");
  } catch {
    // tasks.md 可能尚未生成
  }
  return {
    manifest,
    tasks,
  };
}

/** 按日期前缀倒序列出合法工作流 id(最新在前)。 */
export async function listWorkflowIds(cwd: string): Promise<string[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(workflowsRoot(cwd));
  } catch {
    return [];
  }
  return entries.filter(isValidWorkflowId).sort((a, b) => b.localeCompare(a));
}
