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
  await assertWritableDir(workflowDir);
  const target = resolveInside(workflowDir, rel);
  await mkdir(path.dirname(target), {
    recursive: true,
  });
  const tmp = `${target}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, target);
}
/**
 * 写入前的只读检查:读 workflowDir 的 README 状态,archived 即拒绝。
 * README 缺失/不可读视为可写(创建前场景),由调用方校验兜底。
 */
async function assertWritableDir(workflowDir: string): Promise<void> {
  try {
    const manifest = await readManifest(workflowDir);
    assertWritable(manifest);
  } catch (err) {
    if (err instanceof Error && err.message.includes("已归档")) {
      throw err;
    }
    // README 不存在(首次创建)或其他读错误:放行,由调用方 fail-closed 校验
  }
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

/**
 * 通用 manifest 修订:mutate -> README 原子重写 ->(可选)timeline -> 新 revision 快照。
 * timeline 在快照前追加,保证快照自包含;D4 写入纪律。
 */
export async function updateManifest(
  workflowDir: string,
  mutate: (m: WorkflowManifest) => void,
  timeline?: (m: WorkflowManifest) => {
    detail: string;
    event: string;
  },
): Promise<WorkflowManifest> {
  const manifest = await readManifest(workflowDir);
  mutate(manifest);
  manifest.revision += 1;
  manifest.updatedAt = nowIso();
  const { body } = parseFrontmatter(
    await readFile(resolveInside(workflowDir, "README.md"), "utf8"),
  );
  // timeline 先于 README 写入:内部写发生在旧状态下,不触发只读守卫;
  // 状态落盘后外部写入才被拦截(归档转换自身不被挡)。
  const entry = timeline?.(manifest);
  if (entry) {
    await appendTimeline(workflowDir, entry.event, entry.detail);
  }
  await atomicWrite(workflowDir, "README.md", manifestFrontmatter(manifest) + body);
  await snapshotRevision(workflowDir, manifest.revision);
  return manifest;
}

/** 修订:更新 README 并生成新 revision 快照。 */
export async function bumpRevision(
  workflowDir: string,
  state?: WorkflowState,
): Promise<WorkflowManifest> {
  return updateManifest(
    workflowDir,
    (m) => {
      if (state) {
        assertTransition(m.state, state);
        m.state = state;
      }
    },
    (m) => ({
      detail: `revision ${m.revision}${state ? `, 状态 -> ${state}` : ""}`,
      event: "revise",
    }),
  );
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

/** 归档索引文件(cwd 级,横跨所有工作流);记录 id/标题/归档时间。 */
export const ARCHIVE_INDEX = ".pi/superplan/archive-index.md";

/**
 * 只读守卫:archived 状态的工作流拒绝一切写入(spec「不可变归档」)。
 * 所有写入路径在解析 workflow 后、写盘前调用。
 */
export function assertWritable(manifest: WorkflowManifest): void {
  if (manifest.state === "archived") {
    throw new Error(
      `工作流 ${manifest.id} 已归档,只读;如需继续演进请创建 child workflow`,
    );
  }
}

export interface ArchiveEntry {
  archivedAt: string;
  id: string;
  title: string;
}

/** 读归档索引(文件缺失视为空)。 */
export async function readArchiveIndex(cwd: string): Promise<ArchiveEntry[]> {
  let content = "";
  try {
    content = await readFile(path.join(cwd, ARCHIVE_INDEX), "utf8");
  } catch {
    return [];
  }
  return content
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.includes("archivedAt"))
    .map((line) => {
      const [, id, title, archivedAt] = line.split("|").map((s) => s.trim());
      return {
        archivedAt: archivedAt ?? "",
        id: id ?? "",
        title: title ?? "",
      };
    })
    .filter((e) => isValidWorkflowId(e.id));
}

async function appendArchiveIndex(cwd: string, entry: ArchiveEntry): Promise<void> {
  const file = path.join(cwd, ARCHIVE_INDEX);
  const existing = await readArchiveIndex(cwd);
  if (existing.some((e) => e.id === entry.id)) {
    return; // 幂等:已在索引中不重复追加
  }
  const header =
    existing.length === 0
      ? "# 归档索引\n\n| id | title | archivedAt |\n| --- | --- | --- |\n"
      : "";
  const line = `| ${entry.id} | ${entry.title} | ${entry.archivedAt} |\n`;
  await mkdir(path.dirname(file), {
    recursive: true,
  });
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const current = existing.length ? await readFile(file, "utf8") : "";
  await writeFile(tmp, current + header + line, "utf8");
  await rename(tmp, file);
}

export interface ArchiveResult {
  /** true = 本次执行了归档;false = 已是归档状态(幂等,无变更)。 */
  archived: boolean;
  manifest: WorkflowManifest;
}

/**
 * 归档:completed -> archived,生成新 revision 快照 + timeline + 归档索引。
 * 非 completed 状态拒绝;重复归档幂等返回(spec「重复归档」场景)。
 */
export async function archiveWorkflow(cwd: string, id: string): Promise<ArchiveResult> {
  const dir = resolveWorkflowDir(cwd, id);
  const manifest = await readManifest(dir);
  if (manifest.state === "archived") {
    return {
      archived: false,
      manifest,
    }; // 幂等
  }
  if (manifest.state !== "completed") {
    throw new Error(`工作流 ${id} 状态为 ${manifest.state},仅 completed 可归档`);
  }
  const updated = await bumpRevision(dir, "archived");
  await appendArchiveIndex(cwd, {
    archivedAt: updated.updatedAt,
    id: updated.id,
    title: updated.title,
  });
  return {
    archived: true,
    manifest: updated,
  };
}

export interface CreateChildOptions {
  childId?: string;
  /** 从父档案复制的核心文件(已确认上下文);缺省复制 README 之外全部核心文件。 */
  copyFiles?: readonly string[];
  cwd: string;
  parent: string;
  title: string;
}

/** child 默认复制的已确认上下文:决策/调研/设计/任务,不含 README(parent 由程序写)。 */
const CHILD_DEFAULT_COPY = [
  "decisions.md",
  "design.md",
  "proposal.md",
  "research.md",
] as const;

/**
 * 从既有工作流创建 child:README 记录 parent,复制已确认上下文,revision 1。
 * parent 必须存在;是否归档不限制(允许从活跃工作流派生,spec 未禁止)。
 * 创建后父档案字节不变。
 */
export async function createChildWorkflow(
  opts: CreateChildOptions,
): Promise<WorkflowManifest> {
  const parentDir = resolveWorkflowDir(opts.cwd, opts.parent);
  const parentManifest = await readManifest(parentDir); // 父不存在即抛错(fail-closed)

  const manifest = await createWorkflow({
    cwd: opts.cwd,
    id: opts.childId,
    parent: parentManifest.id,
    title: opts.title,
  });

  const files = opts.copyFiles ?? CHILD_DEFAULT_COPY;
  const childDir = resolveWorkflowDir(opts.cwd, manifest.id);
  await Promise.all(
    files.map(async (file) => {
      try {
        const content = await readFile(path.join(parentDir, file), "utf8");
        await atomicWrite(childDir, file, content);
      } catch {
        // 父档案该文件缺失:跳过,child 从模板默认内容起步
      }
    }),
  );
  // 父档案(含 timeline)零触碰:归档父档案必须保持不可变(spec「不可变归档」),
  // 血缘追溯由 child 的 README parent 字段 + workflowChain 承担。
  await appendTimeline(
    childDir,
    "child-created",
    `从 parent ${parentManifest.id} 创建,复制上下文: ${files.join(", ")}`,
  );
  return manifest;
}

/** 父子链视图节点:manifest + 归档时间(未归档为 undefined)。 */
export interface ChainNode {
  archivedAt?: string;
  manifest: WorkflowManifest;
}

/**
 * 父子链/状态/归档时间列表视图(spec「父子链可追溯」)。
 * 返回 root -> ... -> target 链(含 target 自身);无 parent 的 id 返回单节点。
 * archivedAt 从归档索引读取,索引缺失视为未归档。
 */
export async function workflowChain(cwd: string, id: string): Promise<ChainNode[]> {
  const index = new Map(
    (await readArchiveIndex(cwd)).map((e) => [
      e.id,
      e.archivedAt,
    ]),
  );
  const chain: ChainNode[] = [];
  const seen = new Set<string>(); // 防御循环 parent 数据
  let current: string | undefined = id;
  while (current && !seen.has(current)) {
    seen.add(current);
    const dir = resolveWorkflowDir(cwd, current);
    // ponytail: 链式逐跳读取(下一跳依赖上一跳的 parent 字段),天然顺序,不可并行
    const manifest = await readManifest(dir);
    const archivedAt = index.get(manifest.id);
    chain.unshift({
      ...(archivedAt
        ? {
            archivedAt,
          }
        : {}),
      manifest,
    });
    current = manifest.parent;
  }
  return chain;
}
