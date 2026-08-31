import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createWorkflow, listWorkflowIds, restoreFromDisk } from "./archive/store.ts";
import { SESSION_ANCHOR_TYPE, type SessionAnchor } from "./domain/types.ts";

const VERSION = "0.1.0";

export default function xpiSuperplan(pi: ExtensionAPI): void {
  pi.registerCommand("xpi-superplan", {
    description: "xpi-superplan 工作流: create <title> | resume [id] | list",
    handler: async (args, ctx) => {
      if (!ctx.isProjectTrusted()) {
        ctx.ui.notify("项目未受信任,xpi-superplan 已停用(fail-closed)", "warning");
        return;
      }
      const [sub, ...rest] = args.trim().split(/\s+/).filter(Boolean);

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
        const { manifest, tasks } = await restoreFromDisk(ctx.cwd, id);
        const anchor: SessionAnchor = {
          revision: manifest.revision,
          state: manifest.state,
          workflowId: manifest.id,
        };
        pi.appendEntry(SESSION_ANCHOR_TYPE, anchor);
        const taskLines = tasks.split("\n").filter((l) => l.startsWith("- ["));
        const pending = taskLines.filter((l) => l.startsWith("- [ ]")).length;
        ctx.ui.notify(
          `已恢复 ${manifest.id}: state=${manifest.state}, revision=${manifest.revision}, 待办任务=${pending}`,
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
