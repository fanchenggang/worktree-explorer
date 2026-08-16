# Changelog

All notable changes to this project will be documented in this file.

## [0.5.0] - 2026-08-16

### Added

- Full UI localization: all user-facing messages now go through VS Code l10n with an English bundle and a Simplified Chinese bundle.
- An end-to-end smoke test (`npm run test:e2e`) that boots a real VS Code extension host against a disposable git fixture with a linked worktree.
- Type-aware ESLint checks (recommendedTypeChecked) in the lint pipeline.

### Removed

- Delete the palette-only commands (`Open in VS Code`, `Open in Current Window`, `Lock Worktree`, `Unlock Worktree`, `Clear Note`, `Fetch Remote`), which received no worktree argument from the command palette and did nothing. `Open in Current Window` remains available as a post-create action and in Go to Worktree.

### Fixed

- Do not offer branches still checked out in prunable worktrees; git rejects `worktree add` for them until the stale metadata is pruned.
- Hide Pull/Push/Merge on prunable worktrees and make Create Worktree fall back to the selected repository when launched from one.
- Respect the built-in `git.path` setting and discover bare repositories opened as workspace roots.
- Refresh the repository list when workspace folders are added or removed.
- Resolve symlinks when detecting the current worktree so the current badge, sorting, and the delete-current-worktree guard work when the workspace path differs from git's canonical path (e.g. macOS `/tmp` → `/private/tmp`).
- Show an `upstream gone` warning for deleted remote branches instead of a misleading `↑0 ↓0`.
- Strip Windows-invalid trailing dots and spaces from suggested worktree directory names.

### Changed

- The `--track` choice is now a plain two-option picker instead of a check-item quick pick.
- Pull Selected Worktrees shows one progress notification for the whole batch.
- Worktrees whose status read failed now show "status unavailable" instead of silently looking clean.
- External launcher commands get a timeout, and Windows shell commands are quoted properly.
- Slim and reorder the worktree context menu: Create Worktree Branch → Merge/Pull/Push → Reveal/Open in Terminal/Copy Path → Delete Worktree.
- Automatic focus/interval refreshes now reuse the status cache instead of clearing it; default `statusCacheSeconds` is 30.
- Clean up manifest metadata (icon, keywords, bugs, SCM Providers category) and redundant activation events.
- Quote arguments when launching `.cmd`/`.bat` commands on Windows.

### Hardening

- Set `GIT_TERMINAL_PROMPT=0` for all git subprocesses so git fails fast instead of hanging on an interactive credential prompt.
- Pull/Push/Fetch/Merge progress notifications are now cancellable; cancelling aborts the underlying git process.
- Cache `repositoryRoots()` lookups, honor `statusConcurrency` in Pull Selected Worktrees, and dispose the output channel on deactivate.
- Publish GitHub Releases only for `v*` tags instead of every push to `main`.

## [0.4.0] - 2026-08-16

### Added

- Reworked Create Worktree into a guided flow: base can be the clicked worktree branch, any local branch, a remote branch, an existing branch, or a detached commit/tag.
- Tracking is opt-in: creation defaults to `--no-track`; `--track` is only offered for remote starting points.
- Fetch-before-create and configurable settings-directory copy (`.cursor` by default).
- Directory preflight validation: absolute path, existing parent, empty target, and no overlap with existing worktrees.
- Worktree lock/unlock with optional reason, and lock/prunable badges in the tree.
- Pull upstream preflight with optional upstream setup and OutputChannel result logging.
- Fetch All Remotes and multi-select Pull Selected Worktrees.
- Go to Worktree quick pick with branch/path/note search.
- Open in VS Code, Open in Current Window, and Reveal in File Explorer actions.
- Auto refresh on window focus or interval, sorting, status cache, and status concurrency settings.
- Multi-repository workspace selection.
- Expanded IDEA/Toolbox detection on macOS, Linux, and Windows.
- Unit tests for `--track`/`--no-track` argument construction and notes store, plus a real git integration test.

### Changed

- Delete Worktree now blocks the current worktree and the main worktree, warns about uncommitted changes, and checks whether the branch is checked out elsewhere.
- Status reads are limited to a configurable concurrency and have an optional TTL cache.
- Manifest command and configuration titles are localized in English and Simplified Chinese.
- CI now runs ESLint, type-check, and tests before packaging or publishing.

## [0.3.0] - 2026-08-16

### Added

- Show dirty file count, ahead/behind tracking, and last commit age for each worktree.
- Add `Open in Terminal`, `Copy Path`, and `Prune Worktrees` actions.
- Prune stale worktree metadata with confirmation and clean up associated local notes.
- Unit tests for Git worktree parsing and status formatting.

### Changed

- Improve Git command error messages by including stderr where available.
- Keep manual refresh only; status information is read when the list is refreshed.

## [0.2.0] - 2026-08-16

### Added

- Create a new worktree branch from the current branch with a context-menu action.
- Copy the current worktree's `.cursor` directory into the newly created worktree.
- Delete a worktree from the context menu with double confirmation.
- Optionally force-delete the associated branch when deleting a worktree.
- Explicitly use `--no-track` when creating worktree branches.

## [0.1.0] - 2026-08-14

### Added

- Initial release with worktree listing, local notes, and open-in-Cursor/IDEA actions.
