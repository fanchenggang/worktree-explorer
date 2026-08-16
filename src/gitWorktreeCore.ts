import * as fs from "fs";
import * as path from "path";

export interface GitWorktree {
  path: string;
  head: string;
  branch?: string;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  lockReason?: string;
  prunable: boolean;
  main: boolean;
  status?: WorktreeStatus;
}

export interface WorktreeStatus {
  changedFiles: number;
  ahead?: number;
  behind?: number;
  hasUpstream: boolean;
  upstreamBranch?: string;
  upstreamGone?: boolean;
  lastCommitIso?: string;
  /** True when the status read failed; all other fields are defaults. */
  unavailable?: boolean;
}

export function parsePorcelain(output: string): GitWorktree[] {
  const worktrees: GitWorktree[] = [];
  let current: Partial<GitWorktree> | undefined;

  const flush = () => {
    if (current?.path) {
      worktrees.push({
        path: current.path,
        head: current.head ?? "",
        branch: current.branch,
        detached: current.detached ?? false,
        bare: current.bare ?? false,
        locked: current.locked ?? false,
        lockReason: current.lockReason,
        prunable: current.prunable ?? false,
        // The main worktree is always listed first by `git worktree list`.
        main: worktrees.length === 0,
      });
    }
    current = undefined;
  };

  for (const line of output.split(/\r?\n/)) {
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length) };
    } else if (line.startsWith("HEAD ")) {
      if (current) {
        current.head = line.slice("HEAD ".length);
      }
    } else if (line.startsWith("branch ")) {
      if (current) {
        current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
      }
    } else if (line === "detached") {
      if (current) {
        current.detached = true;
      }
    } else if (line === "bare") {
      if (current) {
        current.bare = true;
      }
    } else if (line.startsWith("locked")) {
      if (current) {
        current.locked = true;
        const reason = line.slice("locked".length).trim();
        if (reason) {
          current.lockReason = reason;
        }
      }
    } else if (line.startsWith("prunable")) {
      if (current) {
        current.prunable = true;
      }
    }
  }
  flush();
  return worktrees;
}

export function shortSha(head: string): string {
  return head.slice(0, 7);
}

export function branchFolderName(branch: string): string {
  // Also strip trailing dots and spaces, which are invalid on Windows.
  return branch.trim().replace(/[\\/:*?"<>|]/g, "-").replace(/[. ]+$/, "");
}

/**
 * Compares a worktree path with a workspace path, resolving symlinks on both
 * sides first. Git canonicalizes paths in its output (e.g. macOS `/tmp` is
 * reported as `/private/tmp`), while VS Code keeps the path the user opened,
 * so a plain string comparison would miss the match.
 */
export function isCurrentWorktree(worktreePath: string, workspacePath: string): boolean {
  return canonicalPath(worktreePath) === canonicalPath(workspacePath);
}

export function isCurrentWorktreeIn(worktreePath: string, workspacePaths: string[]): boolean {
  return workspacePaths.some((workspacePath) => isCurrentWorktree(worktreePath, workspacePath));
}

function canonicalPath(value: string): string {
  try {
    return fs.realpathSync.native(value);
  } catch {
    return path.resolve(value);
  }
}

export function parseWorktreeStatus(
  statusOutput: string
): Omit<WorktreeStatus, "lastCommitIso"> {
  const lines = statusOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const branchLine = lines.find((line) => line.startsWith("##"));
  const changedFiles = lines.filter((line) => line.startsWith("##") === false).length;

  const ahead = branchLine?.match(/ahead\s+(\d+)/)?.[1];
  const behind = branchLine?.match(/behind\s+(\d+)/)?.[1];
  const branchInfo = parseBranchLine(branchLine);
  const upstreamGone = branchLine?.includes("[gone]") ?? false;

  return {
    changedFiles,
    ahead: ahead ? Number(ahead) : undefined,
    behind: behind ? Number(behind) : undefined,
    hasUpstream: branchInfo.hasUpstream,
    ...(branchInfo.upstreamBranch ? { upstreamBranch: branchInfo.upstreamBranch } : {}),
    ...(upstreamGone ? { upstreamGone: true } : {}),
  };
}

function parseBranchLine(
  branchLine: string | undefined
): { hasUpstream: boolean; upstreamBranch?: string } {
  if (branchLine === undefined) {
    return { hasUpstream: false };
  }

  const normalized = branchLine.replace(/^##\s*/, "");
  const separator = normalized.indexOf("...");
  if (separator < 0) {
    return { hasUpstream: false };
  }

  const upstreamBranch = normalized.slice(separator + 3).split(/\s+/, 1)[0];
  if (upstreamBranch === undefined) {
    return { hasUpstream: false };
  }

  return { hasUpstream: true, upstreamBranch };
}

export function upstreamBranchShortName(upstream: string): string {
  const withoutRefs = upstream.replace(/^refs\/remotes\//, "");
  const separator = withoutRefs.indexOf("/");
  return separator >= 0 ? withoutRefs.slice(separator + 1) : withoutRefs;
}

export function hasUpstreamNameMismatch(
  localBranch: string,
  upstreamBranch: string
): boolean {
  return localBranch !== upstreamBranchShortName(upstreamBranch);
}

/**
 * Branches still checked out somewhere according to git's worktree registry.
 *
 * Prunable worktrees count: their directory is gone but the registry still
 * marks the branch as in use, and `git worktree add <path> <branch>` fails
 * with "already used by worktree at ..." until the metadata is pruned.
 */
export function checkedOutBranches(worktrees: GitWorktree[]): Set<string> {
  return new Set(
    worktrees
      .filter((worktree) => worktree.branch && worktree.bare === false)
      .map((worktree) => worktree.branch as string)
  );
}

/**
 * Builds `git worktree add` arguments for creating a new branch.
 *
 * Tracking is opt-in: the default is `--no-track`. `--track` is only
 * honored for remote-tracking starting points; a local branch base always
 * stays `--no-track` even if a caller passes `track: true`.
 */
export function buildAddWorktreeArgs(options: {
  branch: string;
  worktreePath: string;
  baseBranch: string;
  track: boolean;
  baseIsRemote: boolean;
}): string[] {
  const trackingArg = options.track && options.baseIsRemote ? "--track" : "--no-track";
  return [
    "worktree",
    "add",
    trackingArg,
    "-b",
    options.branch,
    options.worktreePath,
    options.baseBranch,
  ];
}

export function formatAge(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const elapsedMs = Math.max(0, now.getTime() - date.getTime());
  const seconds = Math.floor(elapsedMs / 1000);

  if (seconds < 60) {
    return "just now";
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
