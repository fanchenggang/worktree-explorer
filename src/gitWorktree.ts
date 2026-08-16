import { execFile } from "child_process";
import * as path from "path";
import { promisify } from "util";
import * as vscode from "vscode";
import {
  GitWorktree,
  WorktreeStatus,
  parsePorcelain,
  parseWorktreeStatus,
} from "./gitWorktreeCore";

export {
  GitWorktree,
  WorktreeStatus,
  branchFolderName,
  parsePorcelain,
  parseWorktreeStatus,
  shortSha,
} from "./gitWorktreeCore";

const execFileAsync = promisify(execFile);

export async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
    });
    return stdout.trim();
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(stderr || `git ${args.join(" ")} failed`);
  }
}

export async function listWorktrees(cwd: string): Promise<GitWorktree[]> {
  const output = await runGit(cwd, ["worktree", "list", "--porcelain"]);
  return parsePorcelain(output);
}

export function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function isCurrentWorktree(worktreePath: string, workspacePath: string): boolean {
  return path.resolve(worktreePath) === path.resolve(workspacePath);
}

export async function currentBranch(cwd: string): Promise<string> {
  return runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
}

export async function validateBranchName(
  cwd: string,
  branch: string
): Promise<string | undefined> {
  if (!branch) {
    return "Branch name is required.";
  }

  try {
    await runGit(cwd, ["check-ref-format", "--branch", branch]);
  } catch {
    return `"${branch}" is not a valid git branch name.`;
  }

  try {
    await runGit(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
    return `Branch "${branch}" already exists.`;
  } catch {
    return undefined;
  }
}

export async function addWorktree(
  cwd: string,
  branch: string,
  worktreePath: string,
  baseBranch: string
): Promise<void> {
  await runGit(cwd, [
    "worktree",
    "add",
    "--no-track",
    "-b",
    branch,
    worktreePath,
    baseBranch,
  ]);
}

export async function removeWorktree(cwd: string, worktreePath: string): Promise<void> {
  await runGit(cwd, ["worktree", "remove", "--force", worktreePath]);
}

export async function pullWorktree(cwd: string, worktreePath: string): Promise<string> {
  return runGit(cwd, ["-C", worktreePath, "pull", "--no-edit"]);
}

export async function pushWorktree(cwd: string, worktreePath: string): Promise<string> {
  return runGit(cwd, ["-C", worktreePath, "push"]);
}

export async function pushNewBranch(
  cwd: string,
  worktreePath: string,
  remote: string,
  branch: string
): Promise<string> {
  return runGit(cwd, ["-C", worktreePath, "push", "-u", remote, branch]);
}

export async function listRemotes(cwd: string): Promise<string[]> {
  const output = await runGit(cwd, ["remote"]);
  return output
    .split(/\r?\n/)
    .map((remote) => remote.trim())
    .filter(Boolean);
}

export async function listBranches(cwd: string): Promise<string[]> {
  const output = await runGit(cwd, ["branch", "--format=%(refname:short)"]);
  return output
    .split(/\r?\n/)
    .map((branch) => branch.trim())
    .filter(Boolean);
}

export async function mergeBranch(
  cwd: string,
  worktreePath: string,
  branch: string
): Promise<string> {
  return runGit(cwd, ["-C", worktreePath, "merge", "--no-edit", branch]);
}

export async function deleteBranch(cwd: string, branch: string): Promise<void> {
  await runGit(cwd, ["branch", "-D", branch]);
}

export async function getWorktreeStatus(
  cwd: string,
  worktreePath: string
): Promise<WorktreeStatus> {
  const [statusOutput, lastCommit] = await Promise.all([
    runGit(cwd, [
      "-C",
      worktreePath,
      "status",
      "--porcelain=v1",
      "--branch",
      "--untracked-files=normal",
    ]),
    runGit(cwd, ["-C", worktreePath, "log", "-1", "--format=%cI"]),
  ]);

  return {
    ...parseWorktreeStatus(statusOutput),
    lastCommitIso: lastCommit || undefined,
  };
}

export async function getWorktreeStatuses(
  cwd: string,
  worktrees: GitWorktree[]
): Promise<Map<string, WorktreeStatus>> {
  const candidates = worktrees.filter((worktree) => !worktree.bare);
  const results = await Promise.allSettled(
    candidates.map((worktree) => getWorktreeStatus(cwd, worktree.path))
  );

  const statuses = new Map<string, WorktreeStatus>();
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      statuses.set(candidates[index].path, result.value);
      return;
    }
    console.warn(
      `Failed to read status for ${candidates[index].path}: ${String(result.reason)}`
    );
  });
  return statuses;
}

export async function dryRunPrune(cwd: string): Promise<string> {
  return runGit(cwd, ["worktree", "prune", "--dry-run"]);
}

export async function pruneWorktrees(cwd: string): Promise<void> {
  await runGit(cwd, ["worktree", "prune"]);
}
