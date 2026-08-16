import * as vscode from "vscode";
import { formatAge, hasUpstreamNameMismatch } from "./gitWorktreeCore";
import {
  GitWorktree,
  getWorktreeStatuses,
  isCurrentWorktree,
  listWorktrees,
  shortSha,
  workspaceRoot,
} from "./gitWorktree";
import { NotesStore } from "./notesStore";

class MessageItem extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon("info");
  }
}

export class WorktreeItem extends vscode.TreeItem {
  constructor(
    public readonly worktree: GitWorktree,
    public readonly note: string,
    public readonly current: boolean
  ) {
    const label = worktree.bare
      ? "(bare)"
      : (worktree.branch ?? (worktree.head ? shortSha(worktree.head) : worktree.path));
    super(label, vscode.TreeItemCollapsibleState.None);

    this.description = this.buildDescription();
    this.tooltip = this.buildTooltip();
    this.contextValue = "worktree";
    this.iconPath = new vscode.ThemeIcon(
      current ? "check" : this.hasChanges() ? "circle-filled" : "git-branch"
    );
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

    const status = this.worktree.status;
    if (status) {
      if (status.changedFiles > 0) {
        badges.push(
          `${status.changedFiles} change${status.changedFiles === 1 ? "" : "s"}`
        );
      }
      if (status.hasUpstream && ((status.ahead ?? 0) > 0 || (status.behind ?? 0) > 0)) {
        badges.push(`↑${status.ahead ?? 0} ↓${status.behind ?? 0}`);
      }
      if (status.upstreamBranch && this.hasUpstreamNameMismatch()) {
        badges.push(`⚠ upstream ${status.upstreamBranch}`);
      }
      if (status.lastCommitIso) {
        badges.push(formatAge(status.lastCommitIso));
      }
    }

    if (this.note) {
      badges.push(this.note);
    }

    return badges.join(" · ") || undefined;
  }

  private buildTooltip(): string {
    const lines = [this.worktree.path];
    if (this.worktree.bare) {
      lines.push("bare repository");
    } else if (this.worktree.branch) {
      lines.push(`branch: ${this.worktree.branch}`);
    } else {
      lines.push(`detached HEAD: ${this.worktree.head}`);
    }

    const status = this.worktree.status;
    if (status) {
      lines.push(`changes: ${status.changedFiles}`);
      if (status.hasUpstream) {
        lines.push(`ahead ${status.ahead ?? 0} · behind ${status.behind ?? 0}`);
      } else {
        lines.push("no upstream");
      }
      if (status.upstreamBranch && this.hasUpstreamNameMismatch()) {
        lines.push(`warning: tracked remote branch name differs: ${status.upstreamBranch}`);
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

export class WorktreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    vscode.TreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly notes: NotesStore) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    const root = workspaceRoot();
    if (!root) {
      return [new MessageItem("Open a Git repository workspace to see worktrees.")];
    }

    try {
      const worktrees = await listWorktrees(root);
      const statuses = await getWorktreeStatuses(root, worktrees);
      return worktrees.map((worktree) => {
        const enriched: GitWorktree = {
          ...worktree,
          status: statuses.get(worktree.path),
        };
        return new WorktreeItem(
          enriched,
          this.notes.get(worktree.path),
          isCurrentWorktree(worktree.path, root)
        );
      });
    } catch (error) {
      return [
        new MessageItem(error instanceof Error ? error.message : String(error)),
      ];
    }
  }
}
