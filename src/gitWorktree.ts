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
  checkedOutBranches,
  isCurrentWorktree,
  isCurrentWorktreeIn,
  parsePorcelain,
  parseWorktreeStatus,
  shortSha,
} from "./gitWorktreeCore";

const execFileAsync = promisify(execFile);

/**
 * Resolves the git binary. Honors VS Code's built-in `git.path` setting so
 * installations where git is not on PATH (common on Windows) still work.
 */
function gitCommand(): string {
  const configured = vscode.workspace.getConfiguration("git").get<string | null>("path", null);
  return configured && configured.trim().length > 0 ? configured.trim() : "git";
}

export interface GitRunOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function runGit(
  cwd: string,
  args: string[],
  options: GitRunOptions = {}
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(gitCommand(), args, {
      cwd,
      encoding: "utf8",
      timeout: options.timeoutMs,
      signal: options.signal,
      // Never let git block on an interactive credential prompt: with no TTY
      // the prompt can hang forever instead of failing.
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return stdout.trim();
  } catch (error) {
    if ((error as { code?: string }).code === "ABORT_ERR") {
      throw error;
    }
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

let cachedRepositoryRoots: { roots: string[]; expires: number } | undefined;
const REPOSITORY_ROOTS_CACHE_MS = 30_000;

export function invalidateRepositoryRootsCache(): void {
  cachedRepositoryRoots = undefined;
}

export async function repositoryRoots(): Promise<string[]> {
  const now = Date.now();
  const cached = cachedRepositoryRoots;
  if (cached && cached.expires > now) {
    return cached.roots;
  }
  const roots = await computeRepositoryRoots();
  cachedRepositoryRoots = { roots, expires: Date.now() + REPOSITORY_ROOTS_CACHE_MS };
  return roots;
}

async function computeRepositoryRoots(): Promise<string[]> {
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
        return;
      }

      // Bare repositories have no top-level checkout; detect them explicitly.
      const bare = await tryRunGit(root, ["rev-parse", "--is-bare-repository"]);
      if (bare === "true") {
        unique.set(path.resolve(root), root);
      }
    })
  );
  return [...unique.values()];
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
    return vscode.l10n.t("Branch name is required.");
  }

  try {
    await runGit(cwd, ["check-ref-format", "--branch", branch]);
  } catch {
    return vscode.l10n.t('"{0}" is not a valid git branch name.', branch);
  }

  try {
    await runGit(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
    return vscode.l10n.t('Branch "{0}" already exists.', branch);
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

export async function unlockWorktree(cwd: string, worktreePath: string): Promise<void> {
  await runGit(cwd, ["worktree", "unlock", worktreePath]);
}

export async function pullWorktree(
  cwd: string,
  worktreePath: string,
  signal?: AbortSignal
): Promise<string> {
  return runGit(cwd, ["-C", worktreePath, "pull", "--no-edit"], { signal });
}

export async function pushWorktree(
  cwd: string,
  worktreePath: string,
  signal?: AbortSignal
): Promise<string> {
  return runGit(cwd, ["-C", worktreePath, "push"], { signal });
}

export async function pushNewBranch(
  cwd: string,
  worktreePath: string,
  remote: string,
  branch: string,
  signal?: AbortSignal
): Promise<string> {
  return runGit(cwd, ["-C", worktreePath, "push", "-u", remote, branch], { signal });
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

export async function fetchAllRemotes(cwd: string, signal?: AbortSignal): Promise<string> {
  return runGit(cwd, ["fetch", "--all", "--prune"], { signal });
}

export async function fetchWorktree(
  cwd: string,
  worktreePath: string,
  signal?: AbortSignal
): Promise<string> {
  return runGit(cwd, ["-C", worktreePath, "fetch", "--all", "--prune"], { signal });
}

export async function mergeBranch(
  cwd: string,
  worktreePath: string,
  branch: string,
  signal?: AbortSignal
): Promise<string> {
  return runGit(cwd, ["-C", worktreePath, "merge", "--no-edit", branch], { signal });
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
        // Record an explicit marker so the UI can show "status unavailable"
        // instead of silently presenting the worktree as clean.
        statuses.set(worktree.path, { changedFiles: 0, hasUpstream: false, unavailable: true });
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
