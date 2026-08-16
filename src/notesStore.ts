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

  async delete(worktreePath: string): Promise<void> {
    const all = { ...this.getAll() };
    if (!(worktreePath in all)) {
      return;
    }
    delete all[worktreePath];
    await this.memento.update(KEY, all);
  }

  async prune(validPaths: Set<string>): Promise<void> {
    const all = { ...this.getAll() };
    let changed = false;
    for (const worktreePath of Object.keys(all)) {
      if (!validPaths.has(worktreePath)) {
        delete all[worktreePath];
        changed = true;
      }
    }
    if (changed) {
      await this.memento.update(KEY, all);
    }
  }

  private getAll(): Record<string, string> {
    return this.memento.get<Record<string, string>>(KEY, {});
  }
}
