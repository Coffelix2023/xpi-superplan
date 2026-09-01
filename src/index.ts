import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { isValidWorkflowId, resolveWorkflowDir } from "./archive/paths.ts";
import {
  appendTimeline,
  archiveWorkflow,
  createChildWorkflow,
  createWorkflow,
  listWorkflowIds,
  readManifest,
  restoreFromDisk,
  updateManifest,
} from "./archive/store.ts";
import {
  buildWorkflowDispatch,
  parseSuperplanArgs,
  resolveWorkflowId,
  splitFixArgs,
} from "./command.ts";
import { appendDeckSelections, isCompletedDeckResult } from "./decision/capture.ts";
import { DECK_TOOL_NAME } from "./decision/deck.ts";
import {
  SESSION_ANCHOR_TYPE,
  type SessionAnchor,
  type WorkflowManifest,
} from "./domain/types.ts";
import { registerCompactSnapshot } from "./execution/compact-snapshot.ts";

/** 当前活动工作流 id;create/resume/start/fix 等设置,供压缩快照钩子读取。 */
let activeWorkflowId: string | undefined;

const VERSION = "0.1.0";

/** 设置活动工作流并追加 session 恢复锚点。 */
function activate(pi: ExtensionAPI, manifest: WorkflowManifest): void {
  activeWorkflowId = manifest.id;
  const anchor: SessionAnchor = {
    revision: manifest.revision,
    state: manifest.state,
    workflowId: manifest.id,
  };
  pi.appendEntry(SESSION_ANCHOR_TYPE, anchor);
}

/** 读取 manifest,失败时通知并返回 undefined(fail-closed 到用户可见)。 */
async function loadManifest(
  ctx: ExtensionCommandContext,
  id: string,
): Promise<WorkflowManifest | undefined> {
  try {
    return await readManifest(resolveWorkflowDir(ctx.cwd, id));
  } catch (err) {
    ctx.ui.notify(
      `工作流 ${id} 不可读: ${err instanceof Error ? err.message : String(err)}`,
      "error",
    );
    return undefined;
  }
}

export interface FinalizeResult {
  error?: string;
  manifest?: WorkflowManifest;
}

/**
 * finalize:修改完成后才生成新 revision 快照(快门在改完后按)。
 * fix/fix-fast/save 流程的收尾入口;archived 拒绝(不可变归档)。
 */
async function finalizeWorkflow(
  pi: ExtensionAPI,
  cwd: string,
  explicitId: string | undefined,
  summary: string | undefined,
): Promise<FinalizeResult> {
  const id = await resolveWorkflowId(cwd, explicitId, activeWorkflowId);
  if (!id) {
    return {
      error: "没有可固化的工作流(先 /xpi-superplan start)",
    };
  }
  const dir = resolveWorkflowDir(cwd, id);
  let manifest: WorkflowManifest;
  try {
    manifest = await readManifest(dir);
  } catch (err) {
    return {
      error: `工作流 ${id} 不可读: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (manifest.state === "archived") {
    return {
      error: `工作流 ${id} 已归档,只读;如需演进请 /xpi-superplan fix`,
    };
  }
  const updated = await updateManifest(
    dir,
    () => {},
    (m) => ({
      detail: `固化修改成果为 revision ${m.revision}${summary ? `:${summary}` : ""}`,
      event: "finalize",
    }),
  );
  activate(pi, updated);
  return {
    manifest: updated,
  };
}

export default function xpiSuperplan(pi: ExtensionAPI): void {
  registerCompactSnapshot(
    pi,
    () => activeWorkflowId,
    // 钩子触发时无 ctx,约定扩展工作目录为进程 cwd(Pi 主进程即项目根)
    () => process.cwd(),
  );

  // design_deck 完成时在 tool_result 边界自动回写决策到活动工作流(不依赖模型自觉)。
  pi.on("tool_result", async (event, hookCtx) => {
    if (!activeWorkflowId || event.toolName !== DECK_TOOL_NAME) {
      return;
    }
    if (!isCompletedDeckResult(event)) {
      return;
    }
    const dir = resolveWorkflowDir(process.cwd(), activeWorkflowId);
    let manifest: WorkflowManifest;
    try {
      manifest = await readManifest(dir);
    } catch {
      return; // 工作流已删除:跳过回写
    }
    if (manifest.state === "archived") {
      return; // 不可变归档,拒绝写入
    }
    const recorded = await appendDeckSelections(dir, manifest.revision, event);
    if (recorded.length > 0) {
      hookCtx.ui.notify(
        `deck 决策已自动回写 ${recorded.length} 项 → ${activeWorkflowId}/decisions.md`,
      );
    }
  });

  // fix/fix-fast/save 流程收尾:agent 改完 decisions.md/tasks.md 后调用,此刻才快照。
  pi.registerTool({
    description:
      "固化 superplan 工作流的修改成果:生成新 revision 快照。fix/fix-fast/save 流程修改完 decisions.md/tasks.md 后必须调用一次;已归档工作流拒绝。",
    label: "xpi-superplan finalize",
    name: "xpi_superplan_finalize",
    parameters: Type.Object({
      summary: Type.Optional(
        Type.String({
          description: "本次修改摘要,记入 timeline",
        }),
      ),
      workflowId: Type.Optional(
        Type.String({
          description: "工作流 id,缺省取当前活动工作流",
        }),
      ),
    }),
    promptSnippet: "xpi_superplan_finalize: 固化 superplan 修改成果为新 revision 快照",
    execute: async (_toolCallId, params, _signal, _onUpdate, toolCtx) => {
      const result = await finalizeWorkflow(
        pi,
        toolCtx.cwd,
        params.workflowId,
        params.summary,
      );
      if (result.error || !result.manifest) {
        return {
          content: [
            {
              text: `finalize 失败: ${result.error}`,
              type: "text" as const,
            },
          ],
          details: {
            error: result.error,
          },
        };
      }
      const m = result.manifest;
      return {
        content: [
          {
            text: `已固化 ${m.id} 为 revision ${m.revision}(快照含当前 decisions.md/tasks.md 等内容)`,
            type: "text" as const,
          },
        ],
        details: {
          revision: m.revision,
          workflowId: m.id,
        },
      };
    },
  });
  pi.registerCommand("xpi-superplan", {
    description:
      "xpi-superplan 工作流: start|grillme|save|archive|fix|fix-fast|finalize|create|resume|list(空参数=start)",
    handler: async (args, ctx) => {
      if (!ctx.isProjectTrusted()) {
        ctx.ui.notify("项目未受信任,xpi-superplan 已停用(fail-closed)", "warning");
        return;
      }
      const { sub, rest } = parseSuperplanArgs(args);
      // 反馈第 2 条:空参数视为 start
      const mode = sub ?? "start";

      // ---- 兼容命令(保留) ----
      if (mode === "create") {
        const title = rest.join(" ");
        if (!title) {
          ctx.ui.notify("用法: /xpi-superplan create <标题>", "warning");
          return;
        }
        const manifest = await createWorkflow({
          cwd: ctx.cwd,
          title,
        });
        activate(pi, manifest);
        ctx.ui.notify(`已创建工作流 ${manifest.id} (state: draft, revision: 1)`);
        return;
      }

      if (mode === "resume") {
        const id = rest[0] ?? (await listWorkflowIds(ctx.cwd))[0];
        if (!id) {
          ctx.ui.notify("没有可恢复的工作流", "warning");
          return;
        }
        const { manifest } = await restoreFromDisk(ctx.cwd, id);
        activate(pi, manifest);
        const { resumeWorkflow } = await import("./execution/pause-resume.ts");
        const info = await resumeWorkflow(ctx.cwd, id);
        ctx.ui.notify(
          `已恢复 ${manifest.id}: state=${manifest.state}, revision=${manifest.revision}, 待办=${info.pendingCount}${info.currentTask ? `, 下一任务: ${info.currentTask.id} ${info.currentTask.title}` : ""}`,
        );
        return;
      }

      if (mode === "list") {
        const ids = await listWorkflowIds(ctx.cwd);
        ctx.ui.notify(
          ids.length > 0
            ? `工作流(最新在前): ${ids.join(", ")}`
            : `xpi-superplan ${VERSION}: 暂无工作流`,
        );
        return;
      }

      // ---- start: 创建 + 派发引导流程 ----
      if (mode === "start") {
        let title = rest.join(" ").trim();
        if (!title) {
          title = (await ctx.ui.input("计划标题", "例如: 重构登录流程"))?.trim() ?? "";
        }
        if (!title) {
          ctx.ui.notify("已取消 start(未提供标题)", "warning");
          return;
        }
        const manifest = await createWorkflow({
          cwd: ctx.cwd,
          title,
        });
        activate(pi, manifest);
        pi.sendUserMessage(
          buildWorkflowDispatch({
            mode: "start",
            workflowDir: resolveWorkflowDir(ctx.cwd, manifest.id),
            workflowId: manifest.id,
          }),
        );
        ctx.ui.notify(`已创建 ${manifest.id},start 引导流程已派发`);
        return;
      }

      // ---- grillme / save: 解析目标 + 派发 ----
      if (mode === "grillme" || mode === "save") {
        if (rest[0] && !isValidWorkflowId(rest[0])) {
          ctx.ui.notify(`非法工作流 id: ${rest[0]}`, "warning");
          return;
        }
        const id = await resolveWorkflowId(ctx.cwd, rest[0], activeWorkflowId);
        if (!id) {
          ctx.ui.notify("没有可用工作流,先 /xpi-superplan start", "warning");
          return;
        }
        const manifest = await loadManifest(ctx, id);
        if (!manifest) {
          return;
        }
        activate(pi, manifest);
        pi.sendUserMessage(
          buildWorkflowDispatch({
            mode,
            workflowDir: resolveWorkflowDir(ctx.cwd, id),
            workflowId: id,
          }),
        );
        ctx.ui.notify(`${mode} 流程已派发: ${id}`);
        return;
      }

      // ---- archive: 确认 + 现有 archiveWorkflow ----
      if (mode === "archive") {
        if (rest[0] && !isValidWorkflowId(rest[0])) {
          ctx.ui.notify(`非法工作流 id: ${rest[0]}`, "warning");
          return;
        }
        const id = await resolveWorkflowId(ctx.cwd, rest[0], activeWorkflowId);
        if (!id) {
          ctx.ui.notify("没有可归档的工作流", "warning");
          return;
        }
        const manifest = await loadManifest(ctx, id);
        if (!manifest) {
          return;
        }
        if (manifest.state === "archived") {
          if (activeWorkflowId === id) {
            activeWorkflowId = undefined;
          }
          ctx.ui.notify(`${id} 已是归档状态(幂等,无变更)`);
          return;
        }
        if (manifest.state !== "completed") {
          ctx.ui.notify(
            `${id} 状态为 ${manifest.state},仅 completed 可归档(先完成或 resume 后继续)`,
            "warning",
          );
          return;
        }
        const ok = await ctx.ui.confirm(
          "归档工作流",
          `归档 ${id} 后档案只读,后续演进需创建 child workflow。确认归档?`,
        );
        if (!ok) {
          ctx.ui.notify("已取消归档");
          return;
        }
        const result = await archiveWorkflow(ctx.cwd, id);
        if (activeWorkflowId === id) {
          activeWorkflowId = undefined;
        }
        ctx.ui.notify(`已归档 ${id} (revision ${result.manifest.revision})`);
        return;
      }

      // ---- fix / fix-fast: 新版本 + 派发盘问 ----
      if (mode === "fix" || mode === "fix-fast") {
        const { explicitId, feedback } = splitFixArgs(rest);
        if (!feedback) {
          ctx.ui.notify(`用法: /xpi-superplan ${mode} [id] <反馈意见>`, "warning");
          return;
        }
        const id = await resolveWorkflowId(ctx.cwd, explicitId, activeWorkflowId);
        if (!id) {
          ctx.ui.notify("没有可用工作流,先 /xpi-superplan start", "warning");
          return;
        }
        const manifest = await loadManifest(ctx, id);
        if (!manifest) {
          return;
        }
        // 新建 version:archived 派生 child(父档案不可变);活动工作流只记 timeline。
        // 快照由 finalize 在修改完成后生成,保证 revision 内容是修改后的成果。
        let target = manifest;
        if (manifest.state === "archived") {
          target = await createChildWorkflow({
            cwd: ctx.cwd,
            parent: manifest.id,
            title: `${manifest.title} (fix)`,
          });
        }
        await appendTimeline(
          resolveWorkflowDir(ctx.cwd, target.id),
          "fix-request",
          `${mode}: ${feedback}`,
        );
        activate(pi, target);
        pi.sendUserMessage(
          buildWorkflowDispatch({
            feedback,
            mode,
            workflowDir: resolveWorkflowDir(ctx.cwd, target.id),
            workflowId: target.id,
          }),
        );
        ctx.ui.notify(
          `${mode} 已派发: ${target.id} (revision ${target.revision}${target.parent ? `, parent: ${target.parent}` : ""};修改完成后 finalize 固化)`,
        );
        return;
      }

      // ---- finalize: 修改完成后生成新 revision 快照 ----
      if (mode === "finalize") {
        if (rest[0] && !isValidWorkflowId(rest[0])) {
          ctx.ui.notify(`非法工作流 id: ${rest[0]}`, "warning");
          return;
        }
        const result = await finalizeWorkflow(
          pi,
          ctx.cwd,
          rest[0],
          rest.slice(1).join(" ") || undefined,
        );
        if (result.error || !result.manifest) {
          ctx.ui.notify(`finalize 失败: ${result.error}`, "warning");
          return;
        }
        ctx.ui.notify(
          `已固化 ${result.manifest.id} 为 revision ${result.manifest.revision}`,
        );
        return;
      }

      ctx.ui.notify(`未知子命令: ${mode}`, "warning");
    },
  });
}
