# Changelog

All notable changes to this project will be documented in this file.

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
