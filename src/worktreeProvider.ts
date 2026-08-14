import * as vscode from "vscode";
import {
  GitWorktree,
  isCurrentWorktree,
  listWorktrees,
  shortSha,
  workspaceRoot,
} from "./gitWorktree";
import { NotesStore } from "./notesStore";

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

    const parts: string[] = [];
    if (current) {
      parts.push("current");
    }
    if (note) {
      parts.push(note);
    }
    this.description = parts.join(" · ") || undefined;
    this.tooltip = [worktree.path, note].filter(Boolean).join("\n");
    this.contextValue = "worktree";
    this.iconPath = new vscode.ThemeIcon(current ? "check" : "git-branch");
  }
}

export class WorktreeProvider implements vscode.TreeDataProvider<WorktreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    WorktreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly notes: NotesStore) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: WorktreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<WorktreeItem[]> {
    const root = workspaceRoot();
    if (!root) {
      return [];
    }
    try {
      const worktrees = await listWorktrees(root);
      return worktrees.map(
        (wt) => new WorktreeItem(wt, this.notes.get(wt.path), isCurrentWorktree(wt.path, root))
      );
    } catch {
      return [];
    }
  }
}
