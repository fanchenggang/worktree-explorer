import assert from "node:assert/strict";
import test from "node:test";
import {
  branchFolderName,
  buildAddWorktreeArgs,
  formatAge,
  hasUpstreamNameMismatch,
  parsePorcelain,
  parseWorktreeStatus,
  shortSha,
  upstreamBranchShortName,
} from "./gitWorktreeCore";

test("parsePorcelain parses branch, detached, bare, locked, and prunable worktrees", () => {
  const worktrees = parsePorcelain(
    [
      "worktree /repo",
      "HEAD abcdef1234567",
      "branch refs/heads/main",
      "",
      "worktree /repo/feature",
      "HEAD 1234567890abc",
      "branch refs/heads/feature/x",
      "",
      "worktree /repo/detached",
      "HEAD deadbee",
      "detached",
      "",
      "worktree /repo/bare",
      "HEAD fedcba1",
      "bare",
      "",
      "worktree /repo/locked",
      "HEAD 1111111",
      "branch refs/heads/locked-branch",
      "locked keep this one",
      "",
      "worktree /repo/prunable",
      "HEAD 2222222",
      "branch refs/heads/gone",
      "prunable gitdir file points to non-existent location",
      "",
    ].join("\n")
  );

  assert.equal(worktrees.length, 6);
  assert.deepEqual(worktrees[0], {
    path: "/repo",
    head: "abcdef1234567",
    branch: "main",
    detached: false,
    bare: false,
    locked: false,
    lockReason: undefined,
    prunable: false,
    main: true,
  });
  assert.deepEqual(worktrees[1], {
    path: "/repo/feature",
    head: "1234567890abc",
    branch: "feature/x",
    detached: false,
    bare: false,
    locked: false,
    lockReason: undefined,
    prunable: false,
    main: false,
  });
  assert.deepEqual(worktrees[2], {
    path: "/repo/detached",
    head: "deadbee",
    branch: undefined,
    detached: true,
    bare: false,
    locked: false,
    lockReason: undefined,
    prunable: false,
    main: false,
  });
  assert.deepEqual(worktrees[3], {
    path: "/repo/bare",
    head: "fedcba1",
    branch: undefined,
    detached: false,
    bare: true,
    locked: false,
    lockReason: undefined,
    prunable: false,
    main: false,
  });
  assert.equal(worktrees[4].locked, true);
  assert.equal(worktrees[4].lockReason, "keep this one");
  assert.equal(worktrees[5].prunable, true);
});

test("buildAddWorktreeArgs defaults to --no-track and never tracks a local base", () => {
  assert.deepEqual(
    buildAddWorktreeArgs({
      branch: "feature/x",
      worktreePath: "/repo/feature-x",
      baseBranch: "main",
      track: false,
      baseIsRemote: false,
    }),
    ["worktree", "add", "--no-track", "-b", "feature/x", "/repo/feature-x", "main"]
  );

  assert.deepEqual(
    buildAddWorktreeArgs({
      branch: "feature/x",
      worktreePath: "/repo/feature-x",
      baseBranch: "main",
      track: true,
      baseIsRemote: false,
    }),
    ["worktree", "add", "--no-track", "-b", "feature/x", "/repo/feature-x", "main"]
  );
});

test("buildAddWorktreeArgs opts into --track only for remote bases", () => {
  assert.deepEqual(
    buildAddWorktreeArgs({
      branch: "feature/x",
      worktreePath: "/repo/feature-x",
      baseBranch: "origin/feature/x",
      track: false,
      baseIsRemote: true,
    }),
    ["worktree", "add", "--no-track", "-b", "feature/x", "/repo/feature-x", "origin/feature/x"]
  );

  assert.deepEqual(
    buildAddWorktreeArgs({
      branch: "feature/x",
      worktreePath: "/repo/feature-x",
      baseBranch: "origin/feature/x",
      track: true,
      baseIsRemote: true,
    }),
    ["worktree", "add", "--track", "-b", "feature/x", "/repo/feature-x", "origin/feature/x"]
  );
});

test("parseWorktreeStatus parses changes and ahead/behind", () => {
  assert.deepEqual(
    parseWorktreeStatus(
      "## main...origin/main [ahead 1, behind 2]\n M file.txt\n?? new.txt"
    ),
    {
      changedFiles: 2,
      ahead: 1,
      behind: 2,
      hasUpstream: true,
      upstreamBranch: "origin/main",
    }
  );
});

test("parseWorktreeStatus handles no upstream and behind-only branches", () => {
  assert.deepEqual(parseWorktreeStatus("## main\n M file.txt"), {
    changedFiles: 1,
    ahead: undefined,
    behind: undefined,
    hasUpstream: false,
  });

  assert.deepEqual(
    parseWorktreeStatus("## main...origin/main [behind 3]"),
    {
      changedFiles: 0,
      ahead: undefined,
      behind: 3,
      hasUpstream: true,
      upstreamBranch: "origin/main",
    }
  );
});

test("upstreamBranchShortName strips remote-tracking prefixes", () => {
  assert.equal(upstreamBranchShortName("origin/main"), "main");
  assert.equal(upstreamBranchShortName("origin/feature/x"), "feature/x");
  assert.equal(upstreamBranchShortName("refs/remotes/origin/main"), "main");
});

test("hasUpstreamNameMismatch detects different local and remote branch names", () => {
  assert.equal(hasUpstreamNameMismatch("main", "origin/main"), false);
  assert.equal(hasUpstreamNameMismatch("feature/x", "origin/feature/x"), false);
  assert.equal(hasUpstreamNameMismatch("feature/x", "origin/main"), true);
  assert.equal(hasUpstreamNameMismatch("main", "refs/remotes/origin/main"), false);
});

test("formatAge formats recent and older commits", () => {
  const now = new Date("2026-08-16T12:00:00.000Z");

  assert.equal(formatAge("2026-08-16T11:59:40.000Z", now), "just now");
  assert.equal(formatAge("2026-08-16T11:58:00.000Z", now), "2m ago");
  assert.equal(formatAge("2026-08-16T09:00:00.000Z", now), "3h ago");
  assert.equal(formatAge("2026-08-13T12:00:00.000Z", now), "3d ago");
  assert.equal(formatAge("2026-06-01T12:00:00.000Z", now), "2026-06-01");
});

test("branchFolderName and shortSha normalize values", () => {
  assert.equal(branchFolderName("feature/my:branch"), "feature-my-branch");
  assert.equal(shortSha("abcdef1234567"), "abcdef1");
});
