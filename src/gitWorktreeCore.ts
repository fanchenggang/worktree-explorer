export interface GitWorktree {
  path: string;
  head: string;
  branch?: string;
  detached: boolean;
  bare: boolean;
  status?: WorktreeStatus;
}

export interface WorktreeStatus {
  changedFiles: number;
  ahead?: number;
  behind?: number;
  hasUpstream: boolean;
  upstreamBranch?: string;
  lastCommitIso?: string;
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
    }
  }
  flush();
  return worktrees;
}

export function shortSha(head: string): string {
  return head.slice(0, 7);
}

export function branchFolderName(branch: string): string {
  return branch.trim().replace(/[\\/:*?"<>|]/g, "-");
}

export function parseWorktreeStatus(
  statusOutput: string
): Omit<WorktreeStatus, "lastCommitIso"> {
  const lines = statusOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const branchLine = lines.find((line) => line.startsWith("##"));
  const changedFiles = lines.filter((line) => !line.startsWith("##")).length;

  const ahead = branchLine?.match(/ahead\s+(\d+)/)?.[1];
  const behind = branchLine?.match(/behind\s+(\d+)/)?.[1];
  const branchInfo = parseBranchLine(branchLine);

  return {
    changedFiles,
    ahead: ahead ? Number(ahead) : undefined,
    behind: behind ? Number(behind) : undefined,
    hasUpstream: branchInfo.hasUpstream,
    ...(branchInfo.upstreamBranch ? { upstreamBranch: branchInfo.upstreamBranch } : {}),
  };
}

function parseBranchLine(
  branchLine: string | undefined
): { hasUpstream: boolean; upstreamBranch?: string } {
  if (!branchLine) {
    return { hasUpstream: false };
  }

  const normalized = branchLine.replace(/^##\s*/, "");
  const separator = normalized.indexOf("...");
  if (separator < 0) {
    return { hasUpstream: false };
  }

  const upstreamBranch = normalized.slice(separator + 3).split(/\s+/, 1)[0];
  if (!upstreamBranch) {
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

export function formatAge(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
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
