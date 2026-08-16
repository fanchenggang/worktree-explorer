const KEY = "worktreeExplorer.notes";

export interface MementoLike {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Thenable<void>;
}

export class NotesStore {
  constructor(private readonly memento: MementoLike) {}

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
    if ((worktreePath in all) === false) {
      return;
    }
    delete all[worktreePath];
    await this.memento.update(KEY, all);
  }

  async prune(validPaths: Set<string>): Promise<void> {
    const all = { ...this.getAll() };
    let changed = false;
    for (const worktreePath of Object.keys(all)) {
      if (validPaths.has(worktreePath) === false) {
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
