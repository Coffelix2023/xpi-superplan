import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createWorkflow, listWorkflowIds, restoreFromDisk } from "./archive/store.ts";
import { SESSION_ANCHOR_TYPE, type SessionAnchor } from "./domain/types.ts";
import { registerCompactSnapshot } from "./execution/compact-snapshot.ts";

/** 当前活动工作流 id;create/resume 设置,供压缩快照钩子读取。 */
let activeWorkflowId: string | undefined;

const VERSION = "0.1.0";

const ARGS_RE = /\s+/;
export default function xpiSuperplan(pi: ExtensionAPI): void {
  registerCompactSnapshot(
    pi,
    () => activeWorkflowId,
    // 钩子触发时无 ctx,约定扩展工作目录为进程 cwd(Pi 主进程即项目根)
    () => process.cwd(),
  );
  pi.registerCommand("xpi-superplan", {
    description: "xpi-superplan 工作流: create <title> | resume [id] | list",
    handler: async (args, ctx) => {
      if (!ctx.isProjectTrusted()) {
        ctx.ui.notify("项目未受信任,xpi-superplan 已停用(fail-closed)", "warning");
        return;
      }
      const [sub, ...rest] = args.trim().split(ARGS_RE).filter(Boolean);

      if (sub === "create") {
        const title = rest.join(" ");
        if (!title) {
          ctx.ui.notify("用法: /xpi-superplan create <标题>", "warning");
          return;
        }
        const manifest = await createWorkflow({
          cwd: ctx.cwd,
          title,
        });
        activeWorkflowId = manifest.id;
        const anchor: SessionAnchor = {
          revision: manifest.revision,
          state: manifest.state,
          workflowId: manifest.id,
        };
        pi.appendEntry(SESSION_ANCHOR_TYPE, anchor);
        ctx.ui.notify(`已创建工作流 ${manifest.id} (state: draft, revision: 1)`);
        return;
      }

      if (sub === "resume") {
        const id = rest[0] ?? (await listWorkflowIds(ctx.cwd))[0];
        if (!id) {
          ctx.ui.notify("没有可恢复的工作流", "warning");
          return;
        }
        activeWorkflowId = id;
        const { manifest } = await restoreFromDisk(ctx.cwd, id);
        const anchor: SessionAnchor = {
          revision: manifest.revision,
          state: manifest.state,
          workflowId: manifest.id,
        };
        pi.appendEntry(SESSION_ANCHOR_TYPE, anchor);
        const { resumeWorkflow } = await import("./execution/pause-resume.ts");
        const info = await resumeWorkflow(ctx.cwd, id);
        ctx.ui.notify(
          `已恢复 ${manifest.id}: state=${manifest.state}, revision=${manifest.revision}, 待办=${info.pendingCount}${info.currentTask ? `, 下一任务: ${info.currentTask.id} ${info.currentTask.title}` : ""}`,
        );
        return;
      }

      if (sub === "list" || !sub) {
        const ids = await listWorkflowIds(ctx.cwd);
        ctx.ui.notify(
          ids.length > 0
            ? `工作流(最新在前): ${ids.join(", ")}`
            : `xpi-superplan ${VERSION}: 暂无工作流`,
        );
        return;
      }

      ctx.ui.notify(`未知子命令: ${sub}`, "warning");
    },
  });
}
