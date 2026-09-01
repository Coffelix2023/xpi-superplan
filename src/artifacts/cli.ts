/**
 * M3 OpenSpec CLI 可选适配,对应 spec「OpenSpec CLI 可选适配」:
 * CLI 可用时提供 verify/archive 适配入口,不可用时本地 Markdown 校验兜底,CLI 不是硬依赖。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type ArtifactIssue, validateArtifacts } from "./validate.ts";

const execFileAsync = promisify(execFile);

export type CliCheckResult =
  | {
      mode: "local";
      issues: ArtifactIssue[];
    }
  | {
      cli: string;
      mode: "openspec";
      output: string;
    };

/** 检测本机 OpenSpec CLI(`openspec --version` 可执行即认为可用)。 */
export async function detectOpenSpecCli(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "openspec",
      [
        "--version",
      ],
      {
        timeout: 5000,
      },
    );
    const version = stdout.trim();
    return version.length > 0 ? version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 校验入口:CLI 可用且传了 changeName 则走 openspec validate,
 * 否则退回本地 validateArtifacts。两种路径都返回结构化结果,工作流不中断。
 */
export async function checkArtifacts(
  workflowDir: string,
  changeName?: string,
  detect: () => Promise<string | undefined> = detectOpenSpecCli,
): Promise<CliCheckResult> {
  let cli: string | undefined;
  try {
    cli = await detect();
  } catch {
    cli = undefined; // 检测本身失败视为 CLI 不可用,本地校验兜底
  }
  if (cli && changeName) {
    try {
      const { stdout } = await execFileAsync(
        "openspec",
        [
          "validate",
          changeName,
        ],
        {
          timeout: 15000,
        },
      );
      return {
        cli,
        mode: "openspec",
        output: stdout.trim(),
      };
    } catch (err) {
      const output = err instanceof Error ? err.message : String(err);
      return {
        cli,
        mode: "openspec",
        output,
      };
    }
  }
  return {
    issues: validateArtifacts(workflowDir),
    mode: "local",
  };
}
