import * as assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { listWorktrees } from "../gitWorktree";
import { parsePorcelain } from "../gitWorktreeCore";

const EXTENSION_ID = "fanchenggang.git-worktree-explorer";
const execFileAsync = promisify(execFile);

/**
 * Smoke test for the extension host: the extension must activate, and the
 * full git pipeline must see the fixture repository's worktrees.
 */
export async function run(): Promise<void> {
  const root = process.env.WORKTREE_EXPLORER_E2E_ROOT;
  assert.ok(root, "WORKTREE_EXPLORER_E2E_ROOT must point at the fixture repository");

  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `extension ${EXTENSION_ID} should be resolvable in the extension host`);
  await extension.activate();
  assert.ok(extension.isActive, `extension ${EXTENSION_ID} should activate`);

  // Exercising the tree refresh command covers the provider pipeline
  // (listWorktrees + status reads) against a real VS Code window.
  await vscode.commands.executeCommand("worktreeExplorer.refresh");

  const worktrees = await listWorktrees(root);
  assert.ok(worktrees.some((worktree) => worktree.main), "fixture should list the main worktree");
  assert.ok(
    worktrees.some((worktree) => worktree.branch === "feature/e2e"),
    "fixture should list the linked feature worktree"
  );
  const { stdout } = await execFileAsync("git", ["-C", root, "worktree", "list", "--porcelain"], {
    encoding: "utf8",
  });
  assert.equal(
    parsePorcelain(stdout).length,
    worktrees.length,
    "porcelain parsing should agree with listWorktrees"
  );

  console.log("[worktree-explorer e2e] suite passed");
}
