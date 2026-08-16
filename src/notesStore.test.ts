import assert from "node:assert/strict";
import test from "node:test";
import { MementoLike, NotesStore } from "./notesStore";

class FakeMemento implements MementoLike {
  private value: Record<string, unknown> = {};
  updates = 0;

  get<T>(key: string, defaultValue: T): T {
    const value = this.value[key];
    return value === undefined ? defaultValue : (value as unknown as T);
  }

  async update(key: string, value: unknown): Promise<void> {
    this.updates += 1;
    this.value[key] = value as Record<string, string>;
  }
}

test("NotesStore sets, trims, clears, and prunes notes", async () => {
  const memento = new FakeMemento();
  const notes = new NotesStore(memento);

  assert.equal(notes.get("/repo/feature"), "");

  await notes.set("/repo/feature", "  fix login bug  ");
  assert.equal(notes.get("/repo/feature"), "fix login bug");
  assert.equal(memento.updates, 1);

  await notes.set("/repo/feature", "   ");
  assert.equal(notes.get("/repo/feature"), "");
  assert.equal(memento.updates, 2);

  await notes.set("/repo/feature", "keep me");
  await notes.set("/repo/stale", "remove me");
  await notes.prune(new Set(["/repo/feature"]));
  assert.equal(notes.get("/repo/feature"), "keep me");
  assert.equal(notes.get("/repo/stale"), "");
});

test("NotesStore delete is a no-op for missing paths", async () => {
  const memento = new FakeMemento();
  const notes = new NotesStore(memento);
  await notes.delete("/does/not/exist");
  assert.equal(memento.updates, 0);
});
