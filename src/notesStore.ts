import * as vscode from "vscode";

const KEY = "worktreeExplorer.notes";

export class NotesStore {
  constructor(private readonly memento: vscode.Memento) {}

  get(worktreePath: string): string {
    return this.getAll()[worktreePath] ?? "";
  }

  async set(worktreePath: string, note: string): Promise<void> {
    const all = { ...this.getAll() };
    const trimmed = note.trim();
    if (trimmed) {
      all[worktreePath] = trimmed;
    } else {
      delete all[worktreePath];
    }
    await this.memento.update(KEY, all);
  }

  private getAll(): Record<string, string> {
    return this.memento.get<Record<string, string>>(KEY, {});
  }
}
