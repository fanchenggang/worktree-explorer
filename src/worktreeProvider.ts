import * as path from "path";
import * as vscode from "vscode";
import { formatAge, hasUpstreamNameMismatch } from "./gitWorktreeCore";
import {
  GitWorktree,
  getWorktreeStatuses,
  isCurrentWorktreeIn,
  listWorktrees,
  repositoryRoots,
  shortSha,
  workspaceRoot,
  workspaceRoots,
} from "./gitWorktree";
import { NotesStore } from "./notesStore";

class MessageItem extends vscode.TreeItem {
  constructor(message: string, retry = false) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(retry ? "error" : "info");
    if (retry) {
      this.command = {
        command: "worktreeExplorer.refresh",
        title: "Retry",
      };
    }
  }
}

export class WorktreeItem extends vscode.TreeItem {
  constructor(
    public readonly worktree: GitWorktree,
    public readonly note: string,
    public readonly current: boolean,
    private readonly showPath: boolean
  ) {
    const label = worktree.bare
      ? "(bare)"
      : (worktree.branch ?? (worktree.head ? shortSha(worktree.head) : worktree.path));
    super(label, vscode.TreeItemCollapsibleState.None);

    this.description = this.buildDescription();
    this.tooltip = this.buildTooltip();
    this.contextValue = [
      "worktree",
      current ? "current" : "other",
      worktree.locked ? "locked" : "unlocked",
      worktree.prunable ? "prunable" : "attached",
      worktree.bare ? "bare" : "checkout",
      worktree.detached ? "detached" : "branch",
    ].join(" ");
    this.iconPath = new vscode.ThemeIcon(this.iconName());
  }

  private iconName(): string {
    if (this.current) {
      return "check";
    }
    if (this.worktree.locked) {
      return "lock";
    }
    if (this.worktree.prunable) {
      return "warning";
    }
    if (this.hasChanges()) {
      return "circle-filled";
    }
    return "git-branch";
  }

  private hasChanges(): boolean {
    return (this.worktree.status?.changedFiles ?? 0) > 0;
  }

  private hasUpstreamNameMismatch(): boolean {
    const branch = this.worktree.branch;
    const upstreamBranch = this.worktree.status?.upstreamBranch;
    if (!branch || !upstreamBranch) {
      return false;
    }
    return hasUpstreamNameMismatch(branch, upstreamBranch);
  }

  private buildDescription(): string | undefined {
    const badges: string[] = [];
    if (this.current) {
      badges.push("current");
    }
    if (this.showPath) {
      badges.push(
        this.worktree.main
          ? this.worktree.path
          : path.basename(path.dirname(this.worktree.path))
      );
    }
    if (this.worktree.locked) {
      badges.push(this.worktree.lockReason ? `locked: ${this.worktree.lockReason}` : "locked");
    }
    if (this.worktree.prunable) {
      badges.push("prunable");
    }

    const status = this.worktree.status;
    if (status) {
      if (status.changedFiles > 0) {
        badges.push(`${status.changedFiles} change${status.changedFiles === 1 ? "" : "s"}`);
      }
      if (status.hasUpstream && ((status.ahead ?? 0) > 0 || (status.behind ?? 0) > 0)) {
        badges.push(`↑${status.ahead ?? 0} ↓${status.behind ?? 0}`);
      }
      if (status.upstreamBranch && this.hasUpstreamNameMismatch()) {
        badges.push(`⚠ upstream ${status.upstreamBranch}`);
      }
      if (status.upstreamGone) {
        badges.push("⚠ upstream gone");
      }
      if (status.lastCommitIso) {
        badges.push(formatAge(status.lastCommitIso));
      }
    }

    if (this.note) {
      const maxLength = vscode.workspace
        .getConfiguration("worktreeExplorer")
        .get<number>("noteMaxLength", 60);
      badges.push(this.note.length > maxLength ? `${this.note.slice(0, maxLength)}…` : this.note);
    }

    return badges.join(" · ") || undefined;
  }

  private buildTooltip(): string {
    const lines = [this.worktree.path];
    if (this.worktree.main) {
      lines.push("main worktree");
    }
    if (this.worktree.bare) {
      lines.push("bare repository");
    } else if (this.worktree.branch) {
      lines.push(`branch: ${this.worktree.branch}`);
    } else {
      lines.push(`detached HEAD: ${this.worktree.head}`);
    }

    if (this.worktree.locked) {
      lines.push(`locked${this.worktree.lockReason ? `: ${this.worktree.lockReason}` : ""}`);
    }
    if (this.worktree.prunable) {
      lines.push("prunable: metadata points to a missing directory");
    }

    const status = this.worktree.status;
    if (status) {
      lines.push(`changes: ${status.changedFiles}`);
      if (status.hasUpstream) {
        lines.push(`ahead ${status.ahead ?? 0} · behind ${status.behind ?? 0}`);
        if (status.upstreamBranch) {
          lines.push(`upstream: ${status.upstreamBranch}`);
        }
      } else {
        lines.push("no upstream");
      }

      if (status.upstreamBranch && this.hasUpstreamNameMismatch()) {
        lines.push(`warning: tracked remote branch name differs: ${status.upstreamBranch}`);
      }
      if (status.upstreamGone) {
        lines.push("warning: tracked remote branch was deleted");
      }
      if (status.lastCommitIso) {
        lines.push(`last commit: ${new Date(status.lastCommitIso).toLocaleString()}`);
      }
    }

    if (this.note) {
      lines.push(`note: ${this.note}`);
    }
    if (this.current) {
      lines.push("current");
    }
    return lines.join("\n");
  }
}

export interface WorktreeProviderOptions {
  getRepositoryRoot: () => Promise<string | undefined>;
}

export class WorktreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private readonly statusCache = new Map<
    string,
    { status: import("./gitWorktreeCore").WorktreeStatus; expires: number }
  >();

  constructor(
    private readonly notes: NotesStore,
    private readonly options: WorktreeProviderOptions
  ) {}

  refresh(clearStatusCache = true): void {
    if (clearStatusCache) {
      this.statusCache.clear();
    }
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    const root = await this.options.getRepositoryRoot();
    if (root === undefined) {
      return [new MessageItem("Open a Git repository workspace to see worktrees.")];
    }

    try {
      const [worktrees, repoRoots] = await Promise.all([listWorktrees(root), repositoryRoots()]);
      const openedPaths = workspaceRoots();
      const sorted = sortWorktrees(worktrees, openedPaths);
      const statuses = await this.getStatuses(root, sorted);
      const items: vscode.TreeItem[] = [];

      if (repoRoots.length > 1) {
        items.push(new RepositoryItem(root));
      }

      const branchCounts = new Map<string, number>();
      for (const worktree of sorted) {
        if (worktree.branch) {
          branchCounts.set(worktree.branch, (branchCounts.get(worktree.branch) ?? 0) + 1);
        }
      }

      items.push(
        ...sorted.map((worktree) => {
          const enriched: GitWorktree = {
            ...worktree,
            status: statuses.get(worktree.path),
          };
          return new WorktreeItem(
            enriched,
            this.notes.get(worktree.path),
            isCurrentWorktreeIn(worktree.path, openedPaths),
            worktree.branch ? (branchCounts.get(worktree.branch) ?? 0) > 1 : false
          );
        })
      );
      return items;
    } catch (error) {
      return [new MessageItem(error instanceof Error ? error.message : String(error), true)];
    }
  }

  private async getStatuses(
    root: string,
    worktrees: GitWorktree[]
  ): Promise<Map<string, import("./gitWorktreeCore").WorktreeStatus>> {
    const cacheSeconds = vscode.workspace
      .getConfiguration("worktreeExplorer")
      .get<number>("statusCacheSeconds", 0);
    const now = Date.now();
    const result = new Map<string, import("./gitWorktreeCore").WorktreeStatus>();
    const stale: GitWorktree[] = [];

    for (const worktree of worktrees) {
      const cached = this.statusCache.get(worktree.path);
      if (cached && cached.expires > now) {
        result.set(worktree.path, cached.status);
      } else {
        stale.push(worktree);
      }
    }

    if (stale.length === 0) {
      return result;
    }

    const concurrency = vscode.workspace
      .getConfiguration("worktreeExplorer")
      .get<number>("statusConcurrency", 4);
    const fresh = await getWorktreeStatuses(root, stale, concurrency);
    const ttlMs = cacheSeconds * 1000;
    for (const [worktreePath, status] of fresh) {
      result.set(worktreePath, status);
      if (ttlMs > 0) {
        this.statusCache.set(worktreePath, { status, expires: Date.now() + ttlMs });
      }
    }
    return result;
  }
}

class RepositoryItem extends vscode.TreeItem {
  constructor(repositoryRoot: string) {
    super(`Repository: ${repositoryRoot}`, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon("folder-opened");
    this.tooltip = "The selected repository. Click to choose another workspace repository.";
    this.description = "select repository";
    this.command = {
      command: "worktreeExplorer.selectRepository",
      title: "Select Repository",
    };
  }
}

export function sortWorktrees(worktrees: GitWorktree[], currentPaths: string[]): GitWorktree[] {
  return [...worktrees].sort((left, right) => {
    const leftCurrent = isCurrentWorktreeIn(left.path, currentPaths) ? 1 : 0;
    const rightCurrent = isCurrentWorktreeIn(right.path, currentPaths) ? 1 : 0;
    if (leftCurrent !== rightCurrent) {
      return rightCurrent - leftCurrent;
    }

    const leftMain = left.main ? 1 : 0;
    const rightMain = right.main ? 1 : 0;
    if (leftMain !== rightMain) {
      return rightMain - leftMain;
    }

    const preferred = new Set(["main", "master"]);
    const leftPreferred = left.branch && preferred.has(left.branch) ? 1 : 0;
    const rightPreferred = right.branch && preferred.has(right.branch) ? 1 : 0;
    if (leftPreferred !== rightPreferred) {
      return rightPreferred - leftPreferred;
    }

    const leftName = left.branch ?? left.path;
    const rightName = right.branch ?? right.path;
    return leftName.localeCompare(rightName);
  });
}

export function fallbackRepositoryRoot(): string | undefined {
  return workspaceRoot();
}
