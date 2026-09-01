import path from "node:path";

/** workflow id 格式: <date>-<slug>,见 design.md D4。 */
const ID_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])-[a-z0-9][a-z0-9-]{0,62}$/;

export function isValidWorkflowId(id: string): boolean {
  return ID_RE.test(id);
}

export function workflowsRoot(cwd: string): string {
  return path.join(cwd, ".pi", "superplan", "workflows");
}

/** 解析并校验 workflow 目录;非法 id 或越界一律抛错(fail-closed)。 */
export function resolveWorkflowDir(cwd: string, id: string): string {
  if (!isValidWorkflowId(id)) {
    throw new Error(`非法 workflow id: ${JSON.stringify(id)}`);
  }
  const root = workflowsRoot(cwd);
  const dir = path.resolve(root, id);
  if (dir !== path.join(root, id) || !dir.startsWith(root + path.sep)) {
    throw new Error(`workflow 路径越界: ${id}`);
  }
  return dir;
}

/** 解析工作流目录内的相对路径;拒绝绝对路径与 `..` 逃逸。 */
export function resolveInside(workflowDir: string, rel: string): string {
  if (path.isAbsolute(rel)) {
    throw new Error(`拒绝绝对路径: ${rel}`);
  }
  const resolved = path.resolve(workflowDir, rel);
  if (resolved !== workflowDir && !resolved.startsWith(workflowDir + path.sep)) {
    throw new Error(`路径越出工作流目录: ${rel}`);
  }
  return resolved;
}

/** 标题 → slug;无法得到有效字符时回退 "workflow"。 */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || "workflow";
}
