import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron";

/**
 * Boots a disposable git repository (with one linked worktree) and launches
 * the VS Code extension host against it, running src/e2e/suite.ts.
 */
async function main(): Promise<void> {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "worktree-explorer-e2e-"));
  try {
    const repo = path.join(fixture, "repo");
    fs.mkdirSync(repo);
    const git = (...args: string[]): string =>
      execFileSync("git", args, { cwd: repo, encoding: "utf8" });
    git("init", "-q");
    git("config", "user.email", "e2e@example.com");
    git("config", "user.name", "Worktree Explorer E2E");
    git("commit", "--allow-empty", "-q", "-m", "init");
    execFileSync(
      "git",
      ["worktree", "add", "-q", "-b", "feature/e2e", path.join(fixture, "feature-e2e")],
      { cwd: repo }
    );

    let vscodeExecutablePath = await downloadAndUnzipVSCode();
    // VS Code ≥ 1.133 ships the macOS binary as "Code" while test-electron
    // still points at "Electron"; use the real binary when it exists.
    if (process.platform === "darwin") {
      const codeBinary = vscodeExecutablePath.replace(/Electron$/, "Code");
      if (codeBinary !== vscodeExecutablePath && fs.existsSync(codeBinary)) {
        vscodeExecutablePath = codeBinary;
      }
    }

    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath: path.resolve(__dirname, "../.."),
      extensionTestsPath: path.resolve(__dirname, "./suite"),
      launchArgs: [repo, "--disable-extensions"],
      extensionTestsEnv: {
        WORKTREE_EXPLORER_E2E_ROOT: repo,
      },
    });
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
