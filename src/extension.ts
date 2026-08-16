import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { NotesStore } from "./notesStore";
import { openInCursor, openInIdea } from "./openers";
import { WorktreeItem, WorktreeProvider } from "./worktreeProvider";
import {
  addWorktree,
  branchFolderName,
  currentBranch,
  deleteBranch,
  removeWorktree,
  validateBranchName,
  workspaceRoot,
} from "./gitWorktree";

const NEW_BRANCH_PREFIX = "feature/";

export function activate(context: vscode.ExtensionContext): void {
  const notes = new NotesStore(context.globalState);
  const provider = new WorktreeProvider(notes);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("worktreeExplorer.list", provider),
    vscode.commands.registerCommand("worktreeExplorer.refresh", () => provider.refresh()),
    vscode.commands.registerCommand(
      "worktreeExplorer.openCursor",
      async (item?: WorktreeItem) => {
        if (!item) {
          return;
        }
        try {
          await openInCursor(item.worktree.path);
        } catch (error) {
          vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        }
      }
    ),
    vscode.commands.registerCommand("worktreeExplorer.openIdea", async (item?: WorktreeItem) => {
      if (!item) {
        return;
      }
      try {
        await openInIdea(item.worktree.path);
      } catch (error) {
        vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }),
    vscode.commands.registerCommand("worktreeExplorer.editNote", async (item?: WorktreeItem) => {
      if (!item) {
        return;
      }
      const value = await vscode.window.showInputBox({
        title: "Worktree note",
        prompt: `Note for ${String(item.label)}`,
        value: item.note,
        placeHolder: "What is this branch for?",
      });
      if (value === undefined) {
        return;
      }
      await notes.set(item.worktree.path, value);
      provider.refresh();
    }),
    vscode.commands.registerCommand("worktreeExplorer.createWorktree", async () => {
      const root = workspaceRoot();
      if (!root) {
        vscode.window.showErrorMessage("No workspace folder is open.");
        return;
      }

      try {
        const baseBranch = await currentBranch(root);
        const branch = await vscode.window.showInputBox({
          title: "Create worktree branch",
          prompt: `Create a new branch from ${baseBranch || "HEAD"}`,
          value: NEW_BRANCH_PREFIX,
          placeHolder: "feature/my-branch",
          ignoreFocusOut: true,
          validateInput: (value) => validateBranchName(root, value.trim()),
        });
        if (branch === undefined) {
          return;
        }

        const normalizedBranch = branch.trim();
        const directory = await vscode.window.showInputBox({
          title: "Create worktree branch",
          prompt:
            "Working directory for the new worktree. Keep the current directory to create a branch-named subdirectory.",
          value: root,
          valueSelection: [0, root.length],
          ignoreFocusOut: true,
          validateInput: (value) => validateWorktreeDirectory(value),
        });
        if (directory === undefined) {
          return;
        }

        let worktreeDirectory = path.resolve(directory.trim());
        if (worktreeDirectory === path.resolve(root)) {
          worktreeDirectory = path.join(root, branchFolderName(normalizedBranch));
        }
        await addWorktree(root, normalizedBranch, worktreeDirectory, baseBranch || "HEAD");
        await copyCursorDirectory(root, worktreeDirectory);
        provider.refresh();
        vscode.window.showInformationMessage(
          `Created worktree branch ${normalizedBranch} at ${worktreeDirectory}`
        );
      } catch (error) {
        vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }),
    vscode.commands.registerCommand("worktreeExplorer.deleteWorktree", async (item?: WorktreeItem) => {
      if (!item) {
        return;
      }

      const root = workspaceRoot();
      if (!root) {
        vscode.window.showErrorMessage("No workspace folder is open.");
        return;
      }

      const branch = item.worktree.branch;
      const currentNotice = item.current
        ? "\n\nThis worktree is currently open in this window."
        : "";
      const firstChoice = await vscode.window.showWarningMessage(
        `Delete worktree "${String(item.label)}"?${currentNotice}`,
        { modal: true },
        branch ? "Delete Worktree and Branch" : "Remove Worktree"
      );
      if (firstChoice === undefined) {
        return;
      }

      const deleteBranchToo = firstChoice === "Delete Worktree and Branch";
      const secondChoice = await vscode.window.showWarningMessage(
        deleteBranchToo
          ? `This will permanently delete branch "${branch}" and remove the worktree directory "${item.worktree.path}". This cannot be undone.`
          : `This will remove the worktree directory "${item.worktree.path}". The branch will be kept. This cannot be undone.`,
        { modal: true },
        deleteBranchToo ? "Delete Branch and Worktree" : "Remove Worktree"
      );
      if (secondChoice === undefined) {
        return;
      }

      try {
        await removeWorktree(root, item.worktree.path);
        if (deleteBranchToo && branch) {
          await deleteBranch(root, branch);
        }
        provider.refresh();
        vscode.window.showInformationMessage(`Deleted worktree ${String(item.label)}.`);
      } catch (error) {
        vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    })
  );
}

function validateWorktreeDirectory(value: string): string | undefined {
  const directory = value.trim();
  if (!directory) {
    return "Working directory is required.";
  }
  if (!path.isAbsolute(directory)) {
    return "Working directory must be an absolute path.";
  }
  return undefined;
}

async function copyCursorDirectory(sourceRoot: string, targetRoot: string): Promise<void> {
  const source = path.join(sourceRoot, ".cursor");
  const target = path.join(targetRoot, ".cursor");

  try {
    await fs.promises.access(source);
  } catch {
    return;
  }

  await fs.promises.cp(source, target, { recursive: true, force: true });
}

export function deactivate(): void {}
