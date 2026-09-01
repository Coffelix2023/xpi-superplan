import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { archiveWorkflow, bumpRevision, createWorkflow } from "./archive/store.ts";
import {
  buildWorkflowDispatch,
  parseSuperplanArgs,
  resolveWorkflowId,
  splitFixArgs,
} from "./command.ts";
import { SESSION_ANCHOR_TYPE, type SessionAnchor } from "./domain/types.ts";
import xpiSuperplan from "./index.ts";

const COMMAND_ID_RE = /^\d{4}-\d{2}-\d{2}-command-test$/;

type CommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;

type FakeContext = Pick<ExtensionCommandContext, "cwd" | "isProjectTrusted" | "ui">;

interface UiStubs {
  confirm?: boolean;
  input?: string;
}

function makeContext(
  cwd: string,
  notifications: string[],
  stubs: UiStubs = {},
  trusted = true,
): ExtensionCommandContext {
  const context: FakeContext = {
    cwd,
    ui: {
      confirm: async () => stubs.confirm ?? true,
      input: async () => stubs.input,
      notify: (message: string) => notifications.push(message),
    } as unknown as ExtensionCommandContext["ui"],
    isProjectTrusted: () => trusted,
  };
  return context as ExtensionCommandContext;
}

interface FakePi {
  entries: Array<{
    data: unknown;
    type: string;
  }>;
  handler: CommandHandler;
  handlers: Record<string, (event: unknown, ctx: unknown) => unknown>;
  sent: string[];
  tools: Record<
    string,
    {
      execute: unknown;
    }
  >;
}

function registerForTest(): FakePi {
  const fake: FakePi = {
    entries: [],
    handlers: {},
    sent: [],
    tools: {},
    handler: () => Promise.reject(new Error("未注册")),
  };
  const extension = {
    appendEntry: (type: string, data: unknown) =>
      fake.entries.push({
        data,
        type,
      }),
    on: (event: string, h: (e: unknown, c: unknown) => unknown) => {
      fake.handlers[event] = h;
      return () => {};
    },
    registerCommand: (
      _name: string,
      options: {
        handler: CommandHandler;
      },
    ) => {
      fake.handler = options.handler;
    },
    registerTool: (tool: { name: string; execute: unknown }) => {
      fake.tools[tool.name] = tool;
    },
    sendUserMessage: (content: string) => fake.sent.push(content),
  } as unknown as ExtensionAPI;
  xpiSuperplan(extension);
  return fake;
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

/** 沿合法转换链推进到 completed:draft→researching→decision_pending→planned→implementing→completed。 */
async function completeWorkflow(id: string): Promise<void> {
  const dir = path.join(cwd, ".pi/superplan/workflows", id);
  for (const s of [
    "researching",
    "decision_pending",
    "planned",
    "implementing",
    "completed",
  ] as const) {
    // biome-ignore lint/performance/noAwaitInLoops: 状态转换链必须顺序执行(每步依赖上一步状态)
    await bumpRevision(dir, s);
  }
}

describe("xpi-superplan 命令恢复锚点", () => {
  it("create 写入 workflow 并追加完整 session anchor", async () => {
    const fake = registerForTest();
    const notifications: string[] = [];

    await fake.handler("create command-test", makeContext(cwd, notifications));

    expect(fake.entries).toHaveLength(1);
    expect(fake.entries[0].type).toBe(SESSION_ANCHOR_TYPE);
    expect(fake.entries[0].data).toEqual({
      revision: 1,
      state: "draft",
      workflowId: expect.stringMatching(COMMAND_ID_RE),
    });
    expect(notifications[0]).toContain("state: draft");
  });

  it("resume 从 README.md/tasks.md 读取并追加 anchor", async () => {
    const manifest = await createWorkflow({
      cwd,
      id: "2026-08-31-resume-test",
      title: "Resume Test",
    });
    const fake = registerForTest();
    const notifications: string[] = [];

    await fake.handler(
      "resume 2026-08-31-resume-test",
      makeContext(cwd, notifications),
    );

    expect(fake.entries).toEqual([
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
    expect(notifications[0]).toContain("待办=0");
    expect(
      await readFile(
        path.join(cwd, ".pi/superplan/workflows/2026-08-31-resume-test/tasks.md"),
        "utf8",
      ),
    ).toContain("Resume Test");
  });
});

describe("参数解析(command.ts)", () => {
  it("空参数 sub 为 undefined(调用方归一为 start)", () => {
    expect(parseSuperplanArgs("")).toEqual({
      rest: [],
      sub: undefined,
    });
    expect(parseSuperplanArgs("  ")).toEqual({
      rest: [],
      sub: undefined,
    });
  });

  it("splitFixArgs: 首词为合法 id 则拆分,否则全部为反馈", () => {
    expect(
      splitFixArgs([
        "2026-08-31-a",
        "按钮",
        "太小",
      ]),
    ).toEqual({
      explicitId: "2026-08-31-a",
      feedback: "按钮 太小",
    });
    expect(
      splitFixArgs([
        "按钮",
        "太小",
      ]),
    ).toEqual({
      explicitId: undefined,
      feedback: "按钮 太小",
    });
  });

  it("resolveWorkflowId 优先级: 显式 > 活动 > 最新", async () => {
    await createWorkflow({
      cwd,
      id: "2026-08-30-old",
      title: "Old",
    });
    await createWorkflow({
      cwd,
      id: "2026-08-31-new",
      title: "New",
    });
    expect(await resolveWorkflowId(cwd, "2026-08-30-old", "2026-08-31-new")).toBe(
      "2026-08-30-old",
    );
    expect(await resolveWorkflowId(cwd, undefined, "2026-08-30-old")).toBe(
      "2026-08-30-old",
    );
    expect(await resolveWorkflowId(cwd, undefined, undefined)).toBe("2026-08-31-new");
    // 非法 id 不作显式 id,回落活动
    expect(await resolveWorkflowId(cwd, "反馈文本", "2026-08-30-old")).toBe(
      "2026-08-30-old",
    );
  });

  it("buildWorkflowDispatch 携带 mode/workflow/dir/反馈", () => {
    const msg = buildWorkflowDispatch({
      feedback: "按钮太小",
      mode: "fix",
      workflowDir: "/p/.pi/superplan/workflows/2026-08-31-a",
      workflowId: "2026-08-31-a",
    });
    expect(msg).toContain("mode: fix");
    expect(msg).toContain("workflow: 2026-08-31-a");
    expect(msg).toContain("dir: /p/.pi/superplan/workflows/2026-08-31-a");
    expect(msg).toContain("用户反馈: 按钮太小");
    expect(msg).toContain("xpi-superplan skill");
  });
});

describe("start / grillme / save 派发", () => {
  it("空参数等价于 start: 创建 + anchor + sendUserMessage", async () => {
    const fake = registerForTest();
    const notifications: string[] = [];

    await fake.handler(
      "",
      makeContext(cwd, notifications, {
        input: "我的计划",
      }),
    );

    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]).toContain("mode: start");
    expect(fake.sent[0]).toContain("workflow: ");
    expect(fake.entries[0].type).toBe(SESSION_ANCHOR_TYPE);
    expect(notifications.at(-1)).toContain("start 引导流程已派发");
  });

  it("start 无标题且用户取消输入: 不创建、不派发", async () => {
    const fake = registerForTest();
    const notifications: string[] = [];

    await fake.handler(
      "start",
      makeContext(cwd, notifications, {
        input: undefined,
      }),
    );

    expect(fake.sent).toHaveLength(0);
    expect(fake.entries).toHaveLength(0);
    expect(notifications[0]).toContain("已取消");
  });

  it("grillme 与 save 对显式 id 派发调度消息", async () => {
    await createWorkflow({
      cwd,
      id: "2026-08-31-grill",
      title: "Grill",
    });
    const fake = registerForTest();
    const notifications: string[] = [];

    await fake.handler("grillme 2026-08-31-grill", makeContext(cwd, notifications));
    await fake.handler("save 2026-08-31-grill", makeContext(cwd, notifications));

    expect(fake.sent).toHaveLength(2);
    expect(fake.sent[0]).toContain("mode: grillme");
    expect(fake.sent[0]).toContain("workflow: 2026-08-31-grill");
    expect(fake.sent[1]).toContain("mode: save");
  });

  it("grillme 对不存在的显式 id 报错且不派发", async () => {
    const fake = registerForTest();
    const notifications: string[] = [];

    await fake.handler("grillme 2026-08-31-ghost", makeContext(cwd, notifications));

    expect(fake.sent).toHaveLength(0);
    expect(notifications[0]).toContain("不可读");
  });
});

describe("archive", () => {
  it("completed + 用户确认 → 归档成功并清理活动 id", async () => {
    await createWorkflow({
      cwd,
      id: "2026-08-31-arch",
      title: "Arch",
    });
    await completeWorkflow("2026-08-31-arch");
    const fake = registerForTest();
    const notifications: string[] = [];

    await fake.handler(
      "archive 2026-08-31-arch",
      makeContext(cwd, notifications, {
        confirm: true,
      }),
    );

    expect(notifications.at(-1)).toContain("已归档 2026-08-31-arch");
    const readme = await readFile(
      path.join(cwd, ".pi/superplan/workflows/2026-08-31-arch/README.md"),
      "utf8",
    );
    expect(readme).toContain("state: archived");
  });

  it("用户取消 → 不归档", async () => {
    await createWorkflow({
      cwd,
      id: "2026-08-31-arch2",
      title: "Arch2",
    });
    await completeWorkflow("2026-08-31-arch2");
    const fake = registerForTest();
    const notifications: string[] = [];

    await fake.handler(
      "archive 2026-08-31-arch2",
      makeContext(cwd, notifications, {
        confirm: false,
      }),
    );

    expect(notifications.at(-1)).toBe("已取消归档");
    const readme = await readFile(
      path.join(cwd, ".pi/superplan/workflows/2026-08-31-arch2/README.md"),
      "utf8",
    );
    expect(readme).toContain("state: completed");
  });

  it("非 completed 状态拒绝归档", async () => {
    await createWorkflow({
      cwd,
      id: "2026-08-31-draft",
      title: "Draft",
    });
    const fake = registerForTest();
    const notifications: string[] = [];

    await fake.handler("archive 2026-08-31-draft", makeContext(cwd, notifications));

    expect(notifications[0]).toContain("仅 completed 可归档");
  });
});

describe("fix / fix-fast", () => {
  it("活动工作流: 只记 fix-request timeline,revision 不变(快照留给 finalize)", async () => {
    await createWorkflow({
      cwd,
      id: "2026-08-31-fix",
      title: "Fix",
    });
    const fake = registerForTest();
    const notifications: string[] = [];

    await fake.handler("fix 2026-08-31-fix 按钮太小", makeContext(cwd, notifications));

    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]).toContain("mode: fix");
    expect(fake.sent[0]).toContain("用户反馈: 按钮太小");
    const dir = path.join(cwd, ".pi/superplan/workflows/2026-08-31-fix");
    const readme = await readFile(path.join(dir, "README.md"), "utf8");
    expect(readme).toContain("revision: 1"); // 不再派发时快照
    const timeline = await readFile(path.join(dir, "timeline.md"), "utf8");
    expect(timeline).toContain("fix-request");
    expect(timeline).toContain("按钮太小");
    expect(notifications.at(-1)).toContain("finalize 固化");
  });

  it("已归档工作流: 创建 child 而非覆盖父档案", async () => {
    const parent = await createWorkflow({
      cwd,
      id: "2026-08-31-done",
      title: "Done",
    });
    await completeWorkflow("2026-08-31-done");
    await archiveWorkflow(cwd, "2026-08-31-done");
    const parentReadme = await readFile(
      path.join(cwd, ".pi/superplan/workflows/2026-08-31-done/README.md"),
      "utf8",
    );
    const fake = registerForTest();
    const notifications: string[] = [];

    await fake.handler(
      "fix-fast 2026-08-31-done 文案调整",
      makeContext(cwd, notifications),
    );

    // 派发到 child,父档案字节不变
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]).toContain("mode: fix-fast");
    expect(fake.sent[0]).not.toContain(`workflow: ${parent.id}`);
    expect(fake.sent[0]).toContain("用户反馈: 文案调整");
    expect(
      await readFile(
        path.join(cwd, ".pi/superplan/workflows/2026-08-31-done/README.md"),
        "utf8",
      ),
    ).toBe(parentReadme);
    const anchor = fake.entries.at(-1)?.data as SessionAnchor;
    expect(anchor.workflowId).not.toBe(parent.id);
    expect(notifications.at(-1)).toContain(`parent: ${parent.id}`);
  });

  it("缺反馈 → 用法提示,不产生任何变更", async () => {
    await createWorkflow({
      cwd,
      id: "2026-08-31-nofb",
      title: "NoFb",
    });
    const fake = registerForTest();
    const notifications: string[] = [];

    await fake.handler("fix 2026-08-31-nofb", makeContext(cwd, notifications));

    expect(fake.sent).toHaveLength(0);
    expect(notifications[0]).toContain("用法");
    const readme = await readFile(
      path.join(cwd, ".pi/superplan/workflows/2026-08-31-nofb/README.md"),
      "utf8",
    );
    expect(readme).toContain("revision: 1");
  });
});

describe("信任与兼容", () => {
  it("项目未受信任: fail-closed,一切子命令停用", async () => {
    const fake = registerForTest();
    const notifications: string[] = [];

    await fake.handler("start", makeContext(cwd, notifications, {}, false));

    expect(fake.sent).toHaveLength(0);
    expect(notifications[0]).toContain("未受信任");
  });

  it("list 子命令保留", async () => {
    await createWorkflow({
      cwd,
      id: "2026-08-31-list",
      title: "List",
    });
    const fake = registerForTest();
    const notifications: string[] = [];

    await fake.handler("list", makeContext(cwd, notifications));

    expect(notifications[0]).toContain("2026-08-31-list");
    expect(fake.sent).toHaveLength(0);
  });

  it("未知子命令提示", async () => {
    const fake = registerForTest();
    const notifications: string[] = [];

    await fake.handler("bogus", makeContext(cwd, notifications));

    expect(notifications[0]).toContain("未知子命令: bogus");
  });
});

describe("tool_result 决策自动回写", () => {
  const deckEvent = (status: string) => ({
    toolName: "design_deck",
    details: {
      status,
      notes: {
        "dp-1": "备注 x",
      },
      selections: {
        "dp-1": "a 方案 A",
      },
    },
  });

  it("completed deck 结果自动写入活动工作流 decisions.md", async () => {
    const fake = registerForTest();
    const notifications: string[] = [];
    await fake.handler(
      "start 回写测试",
      makeContext(cwd, notifications, {
        input: undefined,
      }),
    );
    const anchor = fake.entries.at(-1)?.data as SessionAnchor;
    const hook = fake.handlers.tool_result;
    expect(hook).toBeDefined();

    const prev = process.cwd();
    process.chdir(cwd);
    try {
      await hook(deckEvent("completed"), makeContext(cwd, notifications));
    } finally {
      process.chdir(prev);
    }

    const text = await readFile(
      path.join(cwd, ".pi/superplan/workflows", anchor.workflowId, "decisions.md"),
      "utf8",
    );
    expect(text).toContain("## deck — dp-1");
    expect(text).toContain("- 选中项: **a 方案 A**");
    expect(text).toContain("- 备注: 备注 x");
    expect(notifications.at(-1)).toContain("自动回写 1 项");
  });

  it("取消的 deck 结果不写", async () => {
    const fake = registerForTest();
    const notifications: string[] = [];
    await fake.handler(
      "start 取消测试",
      makeContext(cwd, notifications, {
        input: undefined,
      }),
    );
    const anchor = fake.entries.at(-1)?.data as SessionAnchor;
    const hook = fake.handlers.tool_result;

    const prev = process.cwd();
    process.chdir(cwd);
    try {
      await hook(deckEvent("cancelled"), makeContext(cwd, notifications));
    } finally {
      process.chdir(prev);
    }

    const text = await readFile(
      path.join(cwd, ".pi/superplan/workflows", anchor.workflowId, "decisions.md"),
      "utf8",
    );
    expect(text).not.toContain("## deck —");
  });
});

describe("显式 id 严格解析", () => {
  it("grillme 收到非法 id 报错,不回落到其他工作流", async () => {
    await createWorkflow({
      cwd,
      id: "2026-08-31-real",
      title: "Real",
    });
    const fake = registerForTest();
    const notifications: string[] = [];

    await fake.handler("grillme 随便输入", makeContext(cwd, notifications));

    expect(notifications[0]).toContain("非法工作流 id");
    expect(fake.sent).toHaveLength(0);
  });

  it("archive 收到非法 id 报错", async () => {
    const fake = registerForTest();
    const notifications: string[] = [];

    await fake.handler("archive 随便输入", makeContext(cwd, notifications));

    expect(notifications[0]).toContain("非法工作流 id");
  });
});

describe("finalize", () => {
  it("子命令: fix 后 finalize 生成含修改成果的 revision 快照", async () => {
    await createWorkflow({
      cwd,
      id: "2026-08-31-fin",
      title: "Fin",
    });
    const fake = registerForTest();
    const notifications: string[] = [];

    await fake.handler("fix 2026-08-31-fin 改文案", makeContext(cwd, notifications));
    // 模拟 agent 修改 decisions.md 后固化
    const dir = path.join(cwd, ".pi/superplan/workflows/2026-08-31-fin");
    const { appendFile } = await import("node:fs/promises");
    await appendFile(path.join(dir, "decisions.md"), "## deck — d1\n- 选中项: **a**\n");
    await fake.handler(
      "finalize 2026-08-31-fin 改完文案",
      makeContext(cwd, notifications),
    );

    expect(notifications.at(-1)).toContain("已固化 2026-08-31-fin 为 revision 2");
    const readme = await readFile(path.join(dir, "README.md"), "utf8");
    expect(readme).toContain("revision: 2");
    // 快照包含修改后的 decisions.md(快门在改完后按)
    const snap = await readFile(path.join(dir, "revisions/2/decisions.md"), "utf8");
    expect(snap).toContain("## deck — d1");
    const timeline = await readFile(path.join(dir, "timeline.md"), "utf8");
    expect(timeline).toContain("finalize");
    expect(timeline).toContain("改完文案");
  });

  it("已归档工作流拒绝 finalize", async () => {
    await createWorkflow({
      cwd,
      id: "2026-08-31-fd",
      title: "Fd",
    });
    await completeWorkflow("2026-08-31-fd");
    await archiveWorkflow(cwd, "2026-08-31-fd");
    const fake = registerForTest();
    const notifications: string[] = [];

    await fake.handler("finalize 2026-08-31-fd", makeContext(cwd, notifications));

    expect(notifications.at(-1)).toContain("已归档");
  });

  it("工具 xpi_superplan_finalize: 返回新 revision", async () => {
    await createWorkflow({
      cwd,
      id: "2026-08-31-ft",
      title: "Ft",
    });
    const fake = registerForTest();
    const tool = fake.tools.xpi_superplan_finalize as unknown as {
      execute: (
        id: string,
        params: {
          summary?: string;
          workflowId?: string;
        },
        signal: undefined,
        onUpdate: undefined,
        ctx: {
          cwd: string;
        },
      ) => Promise<{
        content: Array<{
          text: string;
        }>;
        details: unknown;
      }>;
    };
    expect(tool).toBeDefined();

    const result = await tool.execute(
      "call-1",
      {
        summary: "工具固化",
        workflowId: "2026-08-31-ft",
      },
      undefined,
      undefined,
      {
        cwd,
      },
    );

    expect(result.content[0].text).toContain("revision 2");
    expect(result.details).toEqual({
      revision: 2,
      workflowId: "2026-08-31-ft",
    });
  });

  it("工具对已归档工作流返回错误", async () => {
    await createWorkflow({
      cwd,
      id: "2026-08-31-fe",
      title: "Fe",
    });
    await completeWorkflow("2026-08-31-fe");
    await archiveWorkflow(cwd, "2026-08-31-fe");
    const fake = registerForTest();
    const tool = fake.tools.xpi_superplan_finalize as unknown as {
      execute: (
        id: string,
        params: {
          workflowId?: string;
        },
        signal: undefined,
        onUpdate: undefined,
        ctx: {
          cwd: string;
        },
      ) => Promise<{
        content: Array<{
          text: string;
        }>;
        details: unknown;
      }>;
    };

    const result = await tool.execute(
      "call-2",
      {
        workflowId: "2026-08-31-fe",
      },
      undefined,
      undefined,
      {
        cwd,
      },
    );

    expect(result.content[0].text).toContain("finalize 失败");
    expect(result.content[0].text).toContain("已归档");
  });
});
