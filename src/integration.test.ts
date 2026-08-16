import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { buildAddWorktreeArgs, parsePorcelain } from "./gitWorktreeCore";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return stdout.trim();
}

test("integration: worktree creation honors opt-in tracking", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "worktree-explorer-"));
  const repo = path.join(tmp, "repo");
  const remote = path.join(tmp, "remote.git");
  fs.mkdirSync(repo);
  fs.mkdirSync(remote);
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  await git(repo, ["init", "-q"]);
  await git(repo, ["config", "user.email", "test@example.com"]);
  await git(repo, ["config", "user.name", "Test"]);
  await git(repo, ["commit", "--allow-empty", "-q", "-m", "init"]);
  await git(repo, ["branch", "base"]);
  await git(repo, ["branch", "remote-feature"]);
  await git(remote, ["init", "-q", "--bare"]);
  await git(repo, ["remote", "add", "origin", remote]);
  await git(repo, ["push", "-q", "origin", "remote-feature"]);

  const noTrackArgs = buildAddWorktreeArgs({
    branch: "feature",
    worktreePath: path.join(tmp, "feature"),
    baseBranch: "origin/remote-feature",
    track: false,
    baseIsRemote: true,
  });
  await git(repo, noTrackArgs);

  const upstream = await execFileAsync(
    "git",
    ["-C", path.join(tmp, "feature"), "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    { encoding: "utf8" }
  ).then(
    ({ stdout }) => stdout.trim(),
    () => ""
  );
  assert.equal(upstream, "");

  const trackArgs = buildAddWorktreeArgs({
    branch: "feature-tracked",
    worktreePath: path.join(tmp, "feature-tracked"),
    baseBranch: "origin/remote-feature",
    track: true,
    baseIsRemote: true,
  });
  await git(repo, trackArgs);
  const trackedUpstream = await execFileAsync(
    "git",
    ["-C", path.join(tmp, "feature-tracked"), "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    { encoding: "utf8" }
  ).then(({ stdout }) => stdout.trim());
  assert.equal(trackedUpstream, "origin/remote-feature");

  await git(repo, ["worktree", "lock", "--reason", "integration", path.join(tmp, "feature")]);
  const parsed = parsePorcelain(await git(repo, ["worktree", "list", "--porcelain"]));
  const locked = parsed.find((worktree) => worktree.branch === "feature");
  assert.ok(locked);
  assert.equal(locked.locked, true);
  assert.equal(locked.lockReason, "integration");
  assert.equal(locked.main, false);
});
