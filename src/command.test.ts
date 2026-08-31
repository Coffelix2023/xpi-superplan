import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkflow } from "./archive/store.ts";
import { SESSION_ANCHOR_TYPE, type SessionAnchor } from "./domain/types.ts";
import xpiSuperplan from "./index.ts";

type CommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;

type FakeContext = Pick<ExtensionCommandContext, "cwd" | "isProjectTrusted" | "ui">;

function makeContext(cwd: string, notifications: string[]): ExtensionCommandContext {
  const context: FakeContext = {
    cwd,
    ui: {
      notify: (message: string) => notifications.push(message),
    } as unknown as ExtensionCommandContext["ui"],
    isProjectTrusted: () => true,
  };
  return context as ExtensionCommandContext;
}

function registerForTest(
  entries: Array<{
    type: string;
    data: unknown;
  }>,
): CommandHandler {
  let handler: CommandHandler | undefined;
  const extension = {
    appendEntry: (type: string, data: unknown) =>
      entries.push({
        data,
        type,
      }),
    registerCommand: (
      _name: string,
      options: {
        handler: CommandHandler;
      },
    ) => {
      handler = options.handler;
    },
  } as unknown as ExtensionAPI;
  xpiSuperplan(extension);
  if (!handler) throw new Error("测试扩展未注册命令处理器");
  return handler;
}

let cwd: string;

afterEach(async () => {
  await rm(cwd, {
    force: true,
    recursive: true,
  });
});

beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), "superplan-command-"));
});

describe("xpi-superplan 命令恢复锚点", () => {
  it("create 写入 workflow 并追加完整 session anchor", async () => {
    const entries: Array<{
      type: string;
      data: unknown;
    }> = [];
    const notifications: string[] = [];
    const handler = registerForTest(entries);

    await handler("create command-test", makeContext(cwd, notifications));

    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe(SESSION_ANCHOR_TYPE);
    expect(entries[0].data).toEqual({
      revision: 1,
      state: "draft",
      workflowId: expect.stringMatching(/^\d{4}-\d{2}-\d{2}-command-test$/),
    });
    expect(notifications[0]).toContain("state: draft");
  });

  it("resume 从 README.md/tasks.md 读取并追加 anchor", async () => {
    const manifest = await createWorkflow({
      cwd,
      id: "2026-08-31-resume-test",
      title: "Resume Test",
    });
    const entries: Array<{
      type: string;
      data: unknown;
    }> = [];
    const notifications: string[] = [];
    const handler = registerForTest(entries);

    const context = makeContext(cwd, notifications);
    await handler("resume 2026-08-31-resume-test", context);

    expect(entries).toEqual([
      {
        data: {
          revision: manifest.revision,
          state: manifest.state,
          workflowId: manifest.id,
        } satisfies SessionAnchor,
        type: SESSION_ANCHOR_TYPE,
      },
    ]);
    expect(notifications[0]).toContain("2026-08-31-resume-test");
    expect(notifications[0]).toContain("revision=1");
    expect(notifications[0]).toContain("待办任务=0");
    expect(
      await readFile(
        path.join(cwd, ".pi/superplan/workflows/2026-08-31-resume-test/tasks.md"),
        "utf8",
      ),
    ).toContain("Resume Test");
  });
});
