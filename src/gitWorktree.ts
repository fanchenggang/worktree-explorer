import { execFile } from "child_process";
import * as path from "path";
import { promisify } from "util";
import * as vscode from "vscode";

const execFileAsync = promisify(execFile);

export interface GitWorktree {
  path: string;
  head: string;
  branch?: string;
  detached: boolean;
  bare: boolean;
}

export async function listWorktrees(cwd: string): Promise<GitWorktree[]> {
  const { stdout } = await execFileAsync("git", ["worktree", "list", "--porcelain"], {
    cwd,
    encoding: "utf8",
  });
  return parsePorcelain(stdout);
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

export function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function isCurrentWorktree(worktreePath: string, workspacePath: string): boolean {
  return path.resolve(worktreePath) === path.resolve(workspacePath);
}
