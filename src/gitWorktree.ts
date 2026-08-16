import { execFile } from "child_process";
import * as path from "path";
import { promisify } from "util";
import * as vscode from "vscode";
import {
  GitWorktree,
  WorktreeStatus,
  buildAddWorktreeArgs,
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

export interface GitRunOptions {
  timeoutMs?: number;
}

export async function runGit(
  cwd: string,
  args: string[],
  options: GitRunOptions = {}
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: options.timeoutMs,
    });
    return stdout.trim();
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(stderr || `git ${args.join(" ")} failed`, { cause: error });
  }
}

export async function tryRunGit(
  cwd: string,
  args: string[],
  options: GitRunOptions = {}
): Promise<string | undefined> {
  try {
    return await runGit(cwd, args, options);
  } catch {
    return undefined;
  }
}

export async function listWorktrees(cwd: string): Promise<GitWorktree[]> {
  const output = await runGit(cwd, ["worktree", "list", "--porcelain"]);
  return parsePorcelain(output);
}

export function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function workspaceRoots(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
}

export async function repositoryRoots(): Promise<string[]> {
  const roots = workspaceRoots();
  const unique = new Map<string, string>();
  await Promise.all(
    roots.map(async (root) => {
      // For linked worktrees the common dir points at the main repository
      // `.git`; derive the main checkout from it so that a repo opened through
      // several of its worktrees is only listed once.
      const commonDir = await tryRunGit(root, [
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ]);
      if (commonDir !== undefined && path.basename(commonDir) === ".git") {
        unique.set(path.dirname(commonDir), path.dirname(commonDir));
        return;
      }

      const topLevel = await tryRunGit(root, ["rev-parse", "--show-toplevel"]);
      if (topLevel !== undefined) {
        unique.set(path.resolve(topLevel), topLevel);
      }
    })
  );
  return [...unique.values()];
}

export function isCurrentWorktree(worktreePath: string, workspacePath: string): boolean {
  return path.resolve(worktreePath) === path.resolve(workspacePath);
}

export function isCurrentWorktreeIn(worktreePath: string, workspacePaths: string[]): boolean {
  return workspacePaths.some((workspacePath) => isCurrentWorktree(worktreePath, workspacePath));
}

export async function currentBranch(cwd: string): Promise<string> {
  return runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
}

export async function listLocalBranches(cwd: string): Promise<string[]> {
  const output = await runGit(cwd, ["branch", "--format=%(refname:short)"]);
  return splitLines(output);
}

export async function listRemoteBranches(cwd: string): Promise<string[]> {
  const output = await tryRunGit(cwd, [
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/remotes",
  ]);
  return output
    ? splitLines(output).filter((branch) => branch.endsWith("/HEAD") === false)
    : [];
}

export function remoteBranchShortName(remoteBranch: string): string {
  const separator = remoteBranch.indexOf("/");
  return separator >= 0 ? remoteBranch.slice(separator + 1) : remoteBranch;
}

export async function isRemoteBranch(cwd: string, branch: string): Promise<boolean> {
  const verified = await tryRunGit(cwd, [
    "show-ref",
    "--verify",
    "--quiet",
    `refs/remotes/${branch}`,
  ]);
  return verified !== undefined;
}

export async function isCommitish(cwd: string, commitish: string): Promise<boolean> {
  const verified = await tryRunGit(cwd, [
    "rev-parse",
    "--verify",
    "--quiet",
    `${commitish}^{commit}`,
  ]);
  return verified !== undefined;
}

export async function validateBranchName(
  cwd: string,
  branch: string
): Promise<string | undefined> {
  if (branch.length === 0) {
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
  baseBranch: string,
  track = false
): Promise<void> {
  const baseIsRemote = await isRemoteBranch(cwd, baseBranch);
  await runGit(
    cwd,
    buildAddWorktreeArgs({
      branch,
      worktreePath,
      baseBranch,
      track: track && baseIsRemote,
      baseIsRemote,
    })
  );
}

export async function addExistingWorktree(
  cwd: string,
  worktreePath: string,
  branch: string
): Promise<void> {
  await runGit(cwd, ["worktree", "add", worktreePath, branch]);
}

export async function addDetachedWorktree(
  cwd: string,
  worktreePath: string,
  commitish: string
): Promise<void> {
  await runGit(cwd, ["worktree", "add", "--detach", worktreePath, commitish]);
}

export async function removeWorktree(
  cwd: string,
  worktreePath: string,
  force = false
): Promise<void> {
  const args = ["worktree", "remove"];
  if (force) {
    args.push("--force");
  }
  args.push(worktreePath);
  await runGit(cwd, args);
}

export async function lockWorktree(
  cwd: string,
  worktreePath: string,
  reason?: string
): Promise<void> {
  const args = ["worktree", "lock"];
  if (reason && reason.trim()) {
    args.push("--reason", reason.trim());
  }
  args.push(worktreePath);
  await runGit(cwd, args);
}

export async function unlockWorktree(cwd: string, worktreePath: string): Promise<void> {
  await runGit(cwd, ["worktree", "unlock", worktreePath]);
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
  return splitLines(output);
}

export async function getUpstream(
  cwd: string,
  worktreePath: string
): Promise<string | undefined> {
  return tryRunGit(cwd, [
    "-C",
    worktreePath,
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{u}",
  ]);
}

export async function setUpstream(
  cwd: string,
  worktreePath: string,
  remote: string,
  branch: string
): Promise<void> {
  await runGit(cwd, [
    "-C",
    worktreePath,
    "branch",
    "--set-upstream-to",
    `${remote}/${branch}`,
    branch,
  ]);
}

export async function fetchAllRemotes(cwd: string): Promise<string> {
  return runGit(cwd, ["fetch", "--all", "--prune"]);
}

export async function fetchWorktree(cwd: string, worktreePath: string): Promise<string> {
  return runGit(cwd, ["-C", worktreePath, "fetch", "--all", "--prune"]);
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

export function findBranchWorktree(
  worktrees: GitWorktree[],
  branch: string,
  excludePath?: string
): GitWorktree | undefined {
  const excluded = excludePath ? path.resolve(excludePath) : "";
  return worktrees.find(
    (worktree) =>
      worktree.branch === branch &&
      (excluded === "" || path.resolve(worktree.path) !== excluded)
  );
}

export async function getWorktreeStatus(
  cwd: string,
  worktreePath: string,
  timeoutMs = 15000
): Promise<WorktreeStatus> {
  const [statusOutput, lastCommit] = await Promise.all([
    runGit(
      cwd,
      [
        "-C",
        worktreePath,
        "status",
        "--porcelain=v1",
        "--branch",
        "--untracked-files=normal",
      ],
      { timeoutMs }
    ),
    tryRunGit(cwd, ["-C", worktreePath, "log", "-1", "--format=%cI"], { timeoutMs }),
  ]);

  return {
    ...parseWorktreeStatus(statusOutput),
    lastCommitIso: lastCommit || undefined,
  };
}

export async function getWorktreeStatuses(
  cwd: string,
  worktrees: GitWorktree[],
  concurrency = 4
): Promise<Map<string, WorktreeStatus>> {
  const candidates = worktrees.filter((worktree) => worktree.bare === false);
  const statuses = new Map<string, WorktreeStatus>();
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= candidates.length) {
        return;
      }
      const worktree = candidates[index];
      try {
        statuses.set(worktree.path, await getWorktreeStatus(cwd, worktree.path));
      } catch (error) {
        console.warn(`Failed to read status for ${worktree.path}: ${String(error)}`);
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, candidates.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return statuses;
}

export async function dryRunPrune(cwd: string): Promise<string> {
  return runGit(cwd, ["worktree", "prune", "--dry-run"]);
}

export async function pruneWorktrees(cwd: string): Promise<void> {
  await runGit(cwd, ["worktree", "prune"]);
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
