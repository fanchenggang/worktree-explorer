import * as vscode from "vscode";
import { NotesStore } from "./notesStore";
import { openInCursor, openInIdea } from "./openers";
import { WorktreeItem, WorktreeProvider } from "./worktreeProvider";

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
    })
  );
}

export function deactivate(): void {}
