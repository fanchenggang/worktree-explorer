import assert from "node:assert/strict";
import test from "node:test";
import {
  branchFolderName,
  formatAge,
  parsePorcelain,
  parseWorktreeStatus,
  shortSha,
} from "./gitWorktreeCore";

test("parsePorcelain parses branch, detached, and bare worktrees", () => {
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
    ].join("\n")
  );

  assert.equal(worktrees.length, 4);
  assert.deepEqual(worktrees[0], {
    path: "/repo",
    head: "abcdef1234567",
    branch: "main",
    detached: false,
    bare: false,
  });
  assert.deepEqual(worktrees[1], {
    path: "/repo/feature",
    head: "1234567890abc",
    branch: "feature/x",
    detached: false,
    bare: false,
  });
  assert.deepEqual(worktrees[2], {
    path: "/repo/detached",
    head: "deadbee",
    branch: undefined,
    detached: true,
    bare: false,
  });
  assert.deepEqual(worktrees[3], {
    path: "/repo/bare",
    head: "fedcba1",
    branch: undefined,
    detached: false,
    bare: true,
  });
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
    }
  );
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
