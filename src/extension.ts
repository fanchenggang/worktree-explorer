import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { NotesStore } from "./notesStore";
import {
  openInCode,
  openInCursor,
  openInCurrentWindow,
  openInIdea,
  revealInOS,
} from "./openers";
import { WorktreeItem, WorktreeProvider } from "./worktreeProvider";
import {
  addDetachedWorktree,
  addExistingWorktree,
  addWorktree,
  branchFolderName,
  currentBranch,
  deleteBranch,
  dryRunPrune,
  fetchAllRemotes,
  fetchWorktree,
  findBranchWorktree,
  getUpstream,
  getWorktreeStatuses,
  isCommitish,
  isRemoteBranch,
  listLocalBranches,
  listRemoteBranches,
  listRemotes,
  listWorktrees,
  lockWorktree,
  mergeBranch,
  pruneWorktrees,
  pullWorktree,
  pushNewBranch,
  pushWorktree,
  remoteBranchShortName,
  removeWorktree,
  repositoryRoots,
  setUpstream,
  unlockWorktree,
  validateBranchName,
  workspaceRoot,
} from "./gitWorktree";

const SELECTED_REPOSITORY_KEY = "worktreeExplorer.selectedRepository";

function configuration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("worktreeExplorer");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function showError(error: unknown): void {
  void vscode.window.showErrorMessage(errorMessage(error));
}

class RepositoryManager {
  constructor(private readonly memento: vscode.Memento) {}

  async current(): Promise<string | undefined> {
    const roots = await repositoryRoots();
    if (roots.length === 0) {
      return workspaceRoot();
    }

    const selected = this.memento.get<string>(SELECTED_REPOSITORY_KEY, "");
    if (selected) {
      const match = roots.find((root) => path.resolve(root) === path.resolve(selected));
      if (match) {
        return match;
      }
    }
    return roots[0];
  }

  async select(): Promise<string | undefined> {
    const roots = await repositoryRoots();
    if (roots.length === 0) {
      void vscode.window.showErrorMessage("No Git repository is open in this window.");
      return undefined;
    }

    const items = roots.map((root) => ({
      label: path.basename(root) || root,
      description: root,
      root,
    }));
    const selected = await vscode.window.showQuickPick(items, {
      title: "Select Repository",
      placeHolder: "Choose the Git repository to show in the Worktrees view",
      ignoreFocusOut: true,
    });
    if (!selected) {
      return undefined;
    }

    await this.memento.update(SELECTED_REPOSITORY_KEY, selected.root);
    return selected.root;
  }
}

let outputChannel: vscode.OutputChannel | undefined;

function output(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("Worktree Explorer");
  }
  return outputChannel;
}

function appendOutput(title: string, body: string): void {
  const channel = output();
  channel.appendLine(`== ${title} ==`);
  if (body) {
    channel.appendLine(body);
  }
  channel.appendLine("");
}

async function showOutputResult(title: string, body: string): Promise<void> {
  appendOutput(title, body);
  const choice = await vscode.window.showInformationMessage(
    `${title}. Details are in the Worktree Explorer output.`,
    "Open Output",
    "Copy Output"
  );
  if (choice === "Open Output") {
    output().show(true);
  } else if (choice === "Copy Output") {
    await vscode.env.clipboard.writeText(body);
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error as { code?: unknown }).code === "ABORT_ERR" ||
    (error as { name?: unknown }).name === "AbortError"
  );
}

/**
 * Runs a task under a cancellable progress notification and aborts the task's
 * AbortSignal when the user cancels, so long-running git processes get killed.
 */
function withCancellableProgress<T>(
  title: string,
  task: (signal: AbortSignal) => Promise<T>
): Thenable<T> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: true,
    },
    (_progress, token) => {
      const controller = new AbortController();
      const disposable = token.onCancellationRequested(() => controller.abort());
      return task(controller.signal).finally(() => disposable.dispose());
    }
  );
}

type CreateMode = "new-current" | "new-local" | "new-remote" | "existing" | "detached";

interface ModeItem extends vscode.QuickPickItem {
  mode: CreateMode;
}

interface BranchItem extends vscode.QuickPickItem {
  branch: string;
  remote: boolean;
}

export function activate(context: vscode.ExtensionContext): void {
  const notes = new NotesStore(context.globalState);
  const repositories = new RepositoryManager(context.workspaceState);
  const provider = new WorktreeProvider(notes, {
    getRepositoryRoot: () => repositories.current(),
  });

  async function rootForCommand(item?: WorktreeItem): Promise<string | undefined> {
    if (item) {
      return item.worktree.path;
    }
    return repositories.current();
  }

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("worktreeExplorer.list", provider),
    vscode.commands.registerCommand("worktreeExplorer.refresh", () => provider.refresh()),
    installAutoRefresh(provider),
    vscode.commands.registerCommand("worktreeExplorer.selectRepository", async () => {
      try {
        await repositories.select();
        provider.refresh();
      } catch (error) {
        showError(error);
      }
    }),
    vscode.commands.registerCommand("worktreeExplorer.openCursor", async (item?: WorktreeItem) => {
      if (!item) {
        return;
      }
      try {
        await openInCursor(item.worktree.path);
      } catch (error) {
        showError(error);
      }
    }),
    vscode.commands.registerCommand("worktreeExplorer.openCode", async (item?: WorktreeItem) => {
      if (!item) {
        return;
      }
      try {
        await openInCode(item.worktree.path);
      } catch (error) {
        showError(error);
      }
    }),
    vscode.commands.registerCommand("worktreeExplorer.openIdea", async (item?: WorktreeItem) => {
      if (!item) {
        return;
      }
      try {
        await openInIdea(item.worktree.path);
      } catch (error) {
        showError(error);
      }
    }),
    vscode.commands.registerCommand(
      "worktreeExplorer.openCurrentWindow",
      async (item?: WorktreeItem) => {
        if (!item) {
          return;
        }
        try {
          await openInCurrentWindow(item.worktree.path);
        } catch (error) {
          showError(error);
        }
      }
    ),
    vscode.commands.registerCommand("worktreeExplorer.revealInOS", async (item?: WorktreeItem) => {
      if (!item) {
        return;
      }
      try {
        await revealInOS(item.worktree.path);
      } catch (error) {
        showError(error);
      }
    }),
    vscode.commands.registerCommand("worktreeExplorer.editNote", async (item?: WorktreeItem) => {
      if (!item) {
        return;
      }
      const value = await vscode.window.showInputBox({
        title: "Worktree note",
        prompt: `Note for ${String(item.label)}`,
        value: item.note,
        placeHolder: "What is this branch for? Leave empty to clear the note.",
      });
      if (value === undefined) {
        return;
      }
      await notes.set(item.worktree.path, value);
      provider.refresh(false);
    }),
    vscode.commands.registerCommand("worktreeExplorer.clearNote", async (item?: WorktreeItem) => {
      if (!item) {
        return;
      }
      await notes.delete(item.worktree.path);
      provider.refresh(false);
    }),
    vscode.commands.registerCommand(
      "worktreeExplorer.openTerminal",
      async (item?: WorktreeItem) => {
        if (!item) {
          return;
        }
        const terminal = vscode.window.createTerminal({
          cwd: item.worktree.path,
          name: String(item.label),
        });
        terminal.show();
      }
    ),
    vscode.commands.registerCommand("worktreeExplorer.copyPath", async (item?: WorktreeItem) => {
      if (!item) {
        return;
      }
      await vscode.env.clipboard.writeText(item.worktree.path);
      void vscode.window.showInformationMessage(`Copied ${item.worktree.path}`);
    }),
    vscode.commands.registerCommand("worktreeExplorer.prune", async () => {
      const root = await repositories.current();
      if (!root) {
        void vscode.window.showErrorMessage("No workspace folder is open.");
        return;
      }

      try {
        const dryRun = await dryRunPrune(root);
        if (!dryRun) {
          void vscode.window.showInformationMessage("Nothing to prune.");
          return;
        }

        const choice = await vscode.window.showWarningMessage(
          "Remove stale worktree metadata?",
          { modal: true },
          "Prune Worktrees"
        );
        if (choice !== "Prune Worktrees") {
          return;
        }

        await pruneWorktrees(root);
        const remaining = await listWorktrees(root);
        await notes.prune(new Set(remaining.map((worktree) => worktree.path)));
        provider.refresh();
        void vscode.window.showInformationMessage("Pruned stale worktree metadata.");
      } catch (error) {
        showError(error);
      }
    }),
    vscode.commands.registerCommand(
      "worktreeExplorer.createWorktree",
      async (item?: WorktreeItem) => createWorktree(item, provider, repositories)
    ),
    vscode.commands.registerCommand("worktreeExplorer.pull", async (item?: WorktreeItem) => {
      if (!item) {
        return;
      }
      await pullWorktreeCommand(item, provider);
    }),
    vscode.commands.registerCommand("worktreeExplorer.push", async (item?: WorktreeItem) => {
      if (!item) {
        return;
      }
      await pushWorktreeCommand(item, provider);
    }),
    vscode.commands.registerCommand("worktreeExplorer.fetch", async (item?: WorktreeItem) => {
      if (!item) {
        return;
      }
      const root = await rootForCommand(item);
      if (!root) {
        void vscode.window.showErrorMessage("No workspace folder is open.");
        return;
      }
      try {
        const result = await withCancellableProgress(`Fetching ${String(item.label)}...`, (signal) =>
          fetchWorktree(root, item.worktree.path, signal)
        );
        provider.refresh();
        await showOutputResult(`Fetched ${String(item.label)}`, result);
      } catch (error) {
        if (!isAbortError(error)) {
          showError(error);
        }
      }
    }),
    vscode.commands.registerCommand("worktreeExplorer.fetchAll", async () => {
      const root = await repositories.current();
      if (!root) {
        void vscode.window.showErrorMessage("No workspace folder is open.");
        return;
      }
      try {
        const result = await withCancellableProgress("Fetching all remotes...", (signal) =>
          fetchAllRemotes(root, signal)
        );
        provider.refresh();
        await showOutputResult("Fetched all remotes", result);
      } catch (error) {
        if (!isAbortError(error)) {
          showError(error);
        }
      }
    }),
    vscode.commands.registerCommand("worktreeExplorer.pullAll", async () => {
      await pullAllCommand(provider, repositories);
    }),
    vscode.commands.registerCommand(
      "worktreeExplorer.mergeBranch",
      async (item?: WorktreeItem) => {
        if (!item) {
          return;
        }
        await mergeBranchCommand(item, provider);
      }
    ),
    vscode.commands.registerCommand("worktreeExplorer.lockWorktree", async (item?: WorktreeItem) => {
      if (!item) {
        return;
      }
      const root = await rootForCommand(item);
      if (!root) {
        void vscode.window.showErrorMessage("No workspace folder is open.");
        return;
      }
      if (item.worktree.locked) {
        void vscode.window.showInformationMessage(`Worktree ${String(item.label)} is already locked.`);
        return;
      }
      const reason = await vscode.window.showInputBox({
        title: "Lock Worktree",
        prompt: `Reason for locking ${String(item.label)} (optional)`,
        ignoreFocusOut: true,
      });
      if (reason === undefined) {
        return;
      }
      try {
        await lockWorktree(root, item.worktree.path, reason);
        provider.refresh();
        void vscode.window.showInformationMessage(`Locked worktree ${String(item.label)}.`);
      } catch (error) {
        showError(error);
      }
    }),
    vscode.commands.registerCommand(
      "worktreeExplorer.unlockWorktree",
      async (item?: WorktreeItem) => {
        if (!item) {
          return;
        }
        const root = await rootForCommand(item);
        if (!root) {
          void vscode.window.showErrorMessage("No workspace folder is open.");
          return;
        }
        if (!item.worktree.locked) {
          void vscode.window.showInformationMessage(`Worktree ${String(item.label)} is not locked.`);
          return;
        }
        try {
          await unlockWorktree(root, item.worktree.path);
          provider.refresh();
          void vscode.window.showInformationMessage(`Unlocked worktree ${String(item.label)}.`);
        } catch (error) {
          showError(error);
        }
      }
    ),
    vscode.commands.registerCommand("worktreeExplorer.quickOpen", async () => {
      try {
        await quickOpenWorktree(repositories, notes);
      } catch (error) {
        showError(error);
      }
    }),
    vscode.commands.registerCommand(
      "worktreeExplorer.deleteWorktree",
      async (item?: WorktreeItem) => {
        if (!item) {
          return;
        }
        await deleteWorktreeCommand(item, notes, provider, repositories);
      }
    ),
    {
      dispose: () => {
        outputChannel?.dispose();
        outputChannel = undefined;
      },
    }
  );
}

// ---------------------------------------------------------------------------
// Create Worktree
// ---------------------------------------------------------------------------

async function createWorktree(
  item: WorktreeItem | undefined,
  provider: WorktreeProvider,
  repositories: RepositoryManager
): Promise<void> {
  const root =
    item && item.worktree.bare === false ? item.worktree.path : await repositories.current();
  if (!root) {
    void vscode.window.showErrorMessage("No workspace folder is open.");
    return;
  }

  try {
    const defaultBase = item?.worktree.branch ?? (await currentBranch(root));
    const worktrees = await listWorktrees(root);
    const mode = await pickCreateMode(defaultBase);
    if (!mode) {
      return;
    }

    let baseBranch = defaultBase || "HEAD";
    let track = false;

    if (mode.mode === "new-current") {
      baseBranch = defaultBase || "HEAD";
    } else if (mode.mode === "new-local") {
      const selected = await pickLocalBranch(root, defaultBase || undefined);
      if (!selected) {
        return;
      }
      baseBranch = selected;
    } else if (mode.mode === "new-remote") {
      const remoteBranch = await pickRemoteBranch(root);
      if (!remoteBranch) {
        return;
      }
      baseBranch = remoteBranch;
      const trackingChoice = await vscode.window.showQuickPick(
        [
          {
            label: "$(check) Track remote branch (--track)",
            description: remoteBranch,
            detail: "Unchecked (default): --no-track, the new branch has no upstream. Check this to set the upstream.",
            picked: false,
          },
        ],
        {
          title: "Upstream Tracking",
          placeHolder: "Default --no-track; check the item to use --track",
          canPickMany: true,
          ignoreFocusOut: true,
        }
      );
      if (trackingChoice === undefined) {
        return;
      }
      track = trackingChoice.length > 0;
    } else if (mode.mode === "existing") {
      const existing = await pickExistingBranch(root, worktrees);
      if (!existing) {
        return;
      }
      await createExistingWorktree(root, existing, item, provider);
      return;
    } else {
      const commitish = await vscode.window.showInputBox({
        title: "Create Detached Worktree",
        prompt: "Commit SHA, tag, or any commit-ish",
        ignoreFocusOut: true,
        validateInput: async (value) => {
          const trimmed = value.trim();
          if (!trimmed) {
            return "A commit or tag is required.";
          }
          return (await isCommitish(root, trimmed)) ? undefined : `"${trimmed}" is not a valid commit or tag.`;
        },
      });
      if (!commitish) {
        return;
      }
      await createDetachedWorktree(root, commitish.trim(), item, provider);
      return;
    }

    const branch = await promptNewBranchName(root, baseBranch, mode.mode === "new-remote");
    if (!branch) {
      return;
    }

    const directory = await promptWorktreeDirectory(root, branch, worktrees);
    if (!directory) {
      return;
    }

    const copyDirs = await chooseCopyDirs(
      item && item.worktree.bare === false ? item.worktree.path : root
    );
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Creating worktree ${branch}...`,
        cancellable: false,
      },
      async () => {
        await addWorktree(root, branch, directory, baseBranch, track);
        if (copyDirs.length > 0) {
          await copyConfiguredDirs(
            item && item.worktree.bare === false ? item.worktree.path : root,
            directory,
            copyDirs
          );
        }
      }
    );

    provider.refresh();
    await showCreatedActions(branch, directory);
  } catch (error) {
    showError(error);
  }
}

async function createExistingWorktree(
  root: string,
  branch: string,
  sourceItem: WorktreeItem | undefined,
  provider: WorktreeProvider
): Promise<void> {
  const directory = await promptWorktreeDirectory(root, branch, await listWorktrees(root));
  if (!directory) {
    return;
  }
  const copyDirs = await chooseCopyDirs(sourceItem ? sourceItem.worktree.path : root);
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Checking out worktree ${branch}...`,
      cancellable: false,
    },
    async () => {
      await addExistingWorktree(root, directory, branch);
      if (copyDirs.length > 0) {
        await copyConfiguredDirs(sourceItem ? sourceItem.worktree.path : root, directory, copyDirs);
      }
    }
  );
  provider.refresh();
  await showCreatedActions(branch, directory);
}

async function createDetachedWorktree(
  root: string,
  commitish: string,
  sourceItem: WorktreeItem | undefined,
  provider: WorktreeProvider
): Promise<void> {
  const folderName = branchFolderName(commitish);
  const directory = await promptWorktreeDirectory(root, folderName, await listWorktrees(root));
  if (!directory) {
    return;
  }
  const copyDirs = await chooseCopyDirs(sourceItem ? sourceItem.worktree.path : root);
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Creating detached worktree ${folderName}...`,
      cancellable: false,
    },
    async () => {
      await addDetachedWorktree(root, directory, commitish);
      if (copyDirs.length > 0) {
        await copyConfiguredDirs(sourceItem ? sourceItem.worktree.path : root, directory, copyDirs);
      }
    }
  );
  provider.refresh();
  await showCreatedActions(commitish, directory);
}

async function pickCreateMode(defaultBase: string): Promise<ModeItem | undefined> {
  const modes: ModeItem[] = [
    {
      label: `$(git-branch) New branch from ${defaultBase || "HEAD"}`,
      description: "Use the current worktree branch as the base",
      mode: "new-current",
    },
    {
      label: "$(repo) New branch from another local branch",
      mode: "new-local",
    },
    {
      label: "$(cloud) New branch from a remote branch",
      mode: "new-remote",
    },
    {
      label: "$(check) Check out an existing local branch",
      mode: "existing",
    },
    {
      label: "$(git-commit) Detached worktree from commit/tag",
      mode: "detached",
    },
  ];

  return vscode.window.showQuickPick(modes, {
    title: "Create Worktree",
    placeHolder: "Choose what the new worktree should be based on",
    ignoreFocusOut: true,
  });
}

async function pickLocalBranch(root: string, current: string | undefined): Promise<string | undefined> {
  const branches = await listLocalBranches(root);
  const items: BranchItem[] = branches.map((branch) => ({
    label: branch,
    description: branch === current ? "current" : undefined,
    branch,
    remote: false,
  }));
  const selected = await vscode.window.showQuickPick(items, {
    title: "Base Branch",
    placeHolder: "Choose a local branch to create the new branch from",
    ignoreFocusOut: true,
  });
  return selected?.branch;
}

async function pickRemoteBranch(root: string): Promise<string | undefined> {
  while (true) {
    const remoteBranches = await listRemoteBranches(root);
    if (remoteBranches.length === 0) {
      const fetchNow = "Fetch Remotes";
      const choice = await vscode.window.showWarningMessage(
        "No remote branches are available.",
        { modal: true },
        fetchNow
      );
      if (choice !== fetchNow) {
        return undefined;
      }
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Fetching remotes...",
          cancellable: false,
        },
        () => fetchAllRemotes(root)
      );
      continue;
    }

    const items: BranchItem[] = [
      {
        label: "$(sync) Fetch remotes and refresh list",
        branch: "",
        remote: true,
      },
      ...remoteBranches.map((branch) => ({
        label: branch,
        branch,
        remote: true,
      })),
    ];
    const selected = await vscode.window.showQuickPick(items, {
      title: "Remote Branch",
      placeHolder: "Choose a remote branch to create the new branch from",
      ignoreFocusOut: true,
    });
    if (!selected) {
      return undefined;
    }
    if (selected.branch === "") {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Fetching remotes...",
          cancellable: false,
        },
        () => fetchAllRemotes(root)
      );
      continue;
    }
    return selected.branch;
  }
}

async function pickExistingBranch(
  root: string,
  worktrees: import("./gitWorktreeCore").GitWorktree[]
): Promise<string | undefined> {
  const branches = await listLocalBranches(root);
  const checkedOut = new Set(
    worktrees
      .filter((worktree) => worktree.branch && worktree.prunable === false && worktree.bare === false)
      .map((worktree) => worktree.branch as string)
  );
  const available = branches.filter((branch) => !checkedOut.has(branch));
  if (available.length === 0) {
    void vscode.window.showInformationMessage(
      "Every local branch is already checked out in a worktree."
    );
    return undefined;
  }
  const selected = await vscode.window.showQuickPick(available, {
    title: "Check Out Existing Branch",
    placeHolder: "Choose a local branch that is not checked out anywhere",
    ignoreFocusOut: true,
  });
  return selected;
}

async function promptNewBranchName(
  root: string,
  baseBranch: string,
  remoteBase: boolean
): Promise<string | undefined> {
  const prefix = configuration().get<string>("defaultBranchPrefix", "feature/");
  const suggested = remoteBase
    ? remoteBranchShortName(baseBranch)
    : `${prefix}${path.posix.basename(baseBranch)}-worktree`;
  const branch = await vscode.window.showInputBox({
    title: "New Branch Name",
    prompt: `Create a new branch from ${baseBranch}`,
    value: suggested,
    placeHolder: "feature/my-branch",
    ignoreFocusOut: true,
    validateInput: createBranchValidator(root),
  });
  return branch?.trim();
}

function debouncedValidate(
  validate: (value: string) => Promise<string | undefined>,
  delayMs: number
): (value: string) => Promise<string | undefined> {
  let timer: NodeJS.Timeout | undefined;
  return (value) =>
    new Promise((resolve) => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        void validate(value).then(resolve, (error: unknown) => resolve(errorMessage(error)));
      }, delayMs);
    });
}

function createBranchValidator(root: string): (value: string) => Promise<string | undefined> {
  return debouncedValidate((value) => validateBranchName(root, value.trim()), 250);
}

async function promptWorktreeDirectory(
  root: string,
  folderName: string,
  worktrees: import("./gitWorktreeCore").GitWorktree[]
): Promise<string | undefined> {
  const suggested = path.join(root, branchFolderName(folderName));
  const validateDirectory = debouncedValidate(
    (value) => validateWorktreeDirectory(root, value, worktrees),
    200
  );
  const directory = await vscode.window.showInputBox({
    title: "Worktree Directory",
    prompt: "Absolute directory for the new worktree",
    value: suggested,
    valueSelection: [0, suggested.length],
    ignoreFocusOut: true,
    validateInput: validateDirectory,
  });
  return directory ? path.resolve(directory.trim()) : undefined;
}

async function validateWorktreeDirectory(
  root: string,
  value: string,
  worktrees: import("./gitWorktreeCore").GitWorktree[]
): Promise<string | undefined> {
  const directory = value.trim();
  if (!directory) {
    return "Working directory is required.";
  }
  if (!path.isAbsolute(directory)) {
    return "Working directory must be an absolute path.";
  }

  const resolved = path.resolve(directory);
  const rootPath = path.resolve(root);
  if (resolved === rootPath) {
    return "Choose a subdirectory; the repository root itself cannot be a new worktree.";
  }

  const separator = path.sep;
  const mainPath = path.resolve(worktrees.find((worktree) => worktree.main)?.path ?? rootPath);
  const allowedParents = new Set(
    [mainPath, rootPath].map((candidate) => path.resolve(candidate))
  );
  const overlapsWorktree = worktrees.some((worktree) => {
    const resolvedWorktree = path.resolve(worktree.path);
    if (resolved === resolvedWorktree) {
      return true;
    }
    // Do not allow the new directory to contain an existing worktree.
    if (resolvedWorktree.startsWith(resolved + separator)) {
      return true;
    }
    // Nested directories are only allowed inside the main worktree or the
    // source worktree the user launched the command from.
    return (
      resolved.startsWith(resolvedWorktree + separator) &&
      allowedParents.has(resolvedWorktree) === false
    );
  });
  if (overlapsWorktree) {
    return "The directory cannot overlap an existing worktree.";
  }

  const parent = path.dirname(resolved);
  try {
    const parentStat = await fs.promises.stat(parent);
    if (!parentStat.isDirectory()) {
      return `Parent "${parent}" is not a directory.`;
    }
  } catch {
    return `Parent directory "${parent}" does not exist.`;
  }

  try {
    const targetStat = await fs.promises.stat(resolved);
    if (!targetStat.isDirectory()) {
      return `"${resolved}" already exists and is not a directory.`;
    }
    const entries = await fs.promises.readdir(resolved);
    if (entries.length > 0) {
      return `"${resolved}" already exists and is not empty.`;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return errorMessage(error);
    }
  }

  return undefined;
}

async function chooseCopyDirs(sourceRoot: string): Promise<string[]> {
  const configured = configuration().get<string[]>("copyDirs", [".cursor"]);
  const available: string[] = [];
  for (const dir of configured) {
    if (!dir || path.isAbsolute(dir) || dir.split(/[\\/]/).includes("..")) {
      continue;
    }
    try {
      const stat = await fs.promises.stat(path.join(sourceRoot, dir));
      if (stat.isDirectory()) {
        available.push(dir);
      }
    } catch {
      // directory does not exist in the source worktree
    }
  }

  if (available.length === 0) {
    return [];
  }

  if (!configuration().get<boolean>("confirmCopyDirs", false)) {
    return available;
  }

  const choice = await vscode.window.showQuickPick(
    [
      {
        label: `$(copy) Copy settings directories`,
        description: available.join(", "),
        detail: "Copy them from the source worktree into the new worktree.",
        value: true,
      },
      {
        label: "$(x) Skip copying",
        value: false,
      },
    ],
    {
      title: "Copy Settings",
      placeHolder: "Choose whether to copy settings directories",
      ignoreFocusOut: true,
    }
  );
  return choice?.value ? available : [];
}

async function copyConfiguredDirs(
  sourceRoot: string,
  targetRoot: string,
  dirs: string[]
): Promise<void> {
  for (const dir of dirs) {
    const source = path.join(sourceRoot, dir);
    const target = path.join(targetRoot, dir);
    try {
      await fs.promises.access(source);
    } catch {
      continue;
    }
    await fs.promises.cp(source, target, { recursive: true, force: true });
  }
}

async function showCreatedActions(branch: string, directory: string): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    `Created worktree ${branch} at ${directory}`,
    "Open in Cursor",
    "Open in Current Window",
    "Open in Terminal",
    "Copy Path"
  );
  if (choice === "Open in Cursor") {
    try {
      await openInCursor(directory);
    } catch (error) {
      showError(error);
    }
  } else if (choice === "Open in Current Window") {
    try {
      await openInCurrentWindow(directory);
    } catch (error) {
      showError(error);
    }
  } else if (choice === "Open in Terminal") {
    const terminal = vscode.window.createTerminal({ cwd: directory, name: branch });
    terminal.show();
  } else if (choice === "Copy Path") {
    await vscode.env.clipboard.writeText(directory);
  }
}

// ---------------------------------------------------------------------------
// Pull / Push / Merge
// ---------------------------------------------------------------------------

async function pullWorktreeCommand(item: WorktreeItem, provider: WorktreeProvider): Promise<void> {
  if (item.worktree.bare) {
    void vscode.window.showWarningMessage("Bare worktrees cannot be updated from a remote.");
    return;
  }
  if (!item.worktree.branch) {
    void vscode.window.showWarningMessage("A detached HEAD worktree cannot be pulled.");
    return;
  }

  const root = item.worktree.path;
  try {
    let upstream = await getUpstream(root, item.worktree.path);
    if (!upstream) {
      upstream = await offerSetUpstream(root, item.worktree.path, item.worktree.branch);
      if (!upstream) {
        return;
      }
    }

    const result = await withCancellableProgress(`Pulling ${String(item.label)}...`, (signal) =>
      pullWorktree(root, item.worktree.path, signal)
    );
    provider.refresh();
    await showOutputResult(`Pulled ${String(item.label)}`, result);
  } catch (error) {
    if (!isAbortError(error)) {
      showError(error);
    }
  }
}

async function offerSetUpstream(
  root: string,
  worktreePath: string,
  branch: string
): Promise<string | undefined> {
  const remotes = await listRemotes(root);
  if (remotes.length === 0) {
    void vscode.window.showWarningMessage("No remotes are configured for this repository.");
    return undefined;
  }

  const remote =
    remotes.length === 1
      ? remotes[0]
      : await vscode.window.showQuickPick(remotes, {
          title: "Choose Remote",
          placeHolder: "Choose a remote for the upstream branch",
          ignoreFocusOut: true,
        });
  if (!remote) {
    return undefined;
  }

  const remoteBranch = `${remote}/${branch}`;
  if (!(await isRemoteBranch(root, remoteBranch))) {
    const choice = await vscode.window.showWarningMessage(
      `Remote branch "${remoteBranch}" does not exist. Fetch remotes and try again?`,
      { modal: true },
      "Fetch"
    );
    if (choice !== "Fetch") {
      return undefined;
    }
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Fetching remotes...",
        cancellable: false,
      },
      () => fetchAllRemotes(root)
    );
    if (!(await isRemoteBranch(root, remoteBranch))) {
      void vscode.window.showErrorMessage(
        `Remote branch "${remoteBranch}" still does not exist after fetching.`
      );
      return undefined;
    }
  }

  const confirm = await vscode.window.showWarningMessage(
    `Set "${remoteBranch}" as upstream of "${branch}" and pull?`,
    { modal: true },
    "Set Upstream and Pull"
  );
  if (confirm !== "Set Upstream and Pull") {
    return undefined;
  }

  await setUpstream(root, worktreePath, remote, branch);
  return remoteBranch;
}

async function pushWorktreeCommand(item: WorktreeItem, provider: WorktreeProvider): Promise<void> {
  if (item.worktree.bare) {
    void vscode.window.showWarningMessage("Bare worktrees cannot be pushed to a remote.");
    return;
  }
  if (!item.worktree.branch) {
    void vscode.window.showWarningMessage("A detached HEAD worktree cannot be pushed.");
    return;
  }

  const root = item.worktree.path;
  try {
    const branch = item.worktree.branch;
    const hasUpstream = (await getUpstream(root, item.worktree.path)) !== undefined;
    let pushTask: (signal: AbortSignal) => Promise<string>;
    let successFallback: string;

    if (hasUpstream === false) {
      const remotes = await listRemotes(root);
      if (remotes.length === 0) {
        void vscode.window.showWarningMessage("No remotes are configured for this repository.");
        return;
      }

      const remote =
        remotes.length === 1
          ? remotes[0]
          : await vscode.window.showQuickPick(remotes, {
              title: "Push to Remote",
              placeHolder: "Choose a remote to push to",
              ignoreFocusOut: true,
            });
      if (!remote) {
        return;
      }

      const choice = await vscode.window.showWarningMessage(
        `Push branch "${branch}" to "${remote}" and set it as upstream?`,
        { modal: true },
        "Push"
      );
      if (choice !== "Push") {
        return;
      }

      pushTask = (signal) => pushNewBranch(root, item.worktree.path, remote, branch, signal);
      successFallback = `Pushed ${branch} to ${remote}.`;
    } else {
      pushTask = (signal) => pushWorktree(root, item.worktree.path, signal);
      successFallback = `Pushed ${String(item.label)} to remote.`;
    }

    const result = await withCancellableProgress(`Pushing ${String(item.label)}...`, (signal) =>
      pushTask(signal)
    );
    provider.refresh();
    await showOutputResult(`Pushed ${String(item.label)}`, result || successFallback);
  } catch (error) {
    if (!isAbortError(error)) {
      showError(error);
    }
  }
}

async function mergeBranchCommand(item: WorktreeItem, provider: WorktreeProvider): Promise<void> {
  if (item.worktree.bare) {
    void vscode.window.showWarningMessage("Bare worktrees cannot merge branches.");
    return;
  }
  if (!item.worktree.branch) {
    void vscode.window.showWarningMessage("A detached HEAD worktree cannot merge branches.");
    return;
  }

  const root = item.worktree.path;
  try {
    const branches = await listLocalBranches(root);
    const otherBranches = branches.filter((branch) => branch !== item.worktree.branch);
    if (otherBranches.length === 0) {
      void vscode.window.showInformationMessage("No other branches to merge.");
      return;
    }

    const sourceBranch = await vscode.window.showQuickPick(otherBranches, {
      title: "Merge Branch",
      placeHolder: `Choose a branch to merge into ${item.worktree.branch}`,
      ignoreFocusOut: true,
    });
    if (!sourceBranch) {
      return;
    }

    const choice = await vscode.window.showWarningMessage(
      `Merge branch "${sourceBranch}" into "${item.worktree.branch}"?`,
      { modal: true },
      "Merge"
    );
    if (choice !== "Merge") {
      return;
    }

    const result = await withCancellableProgress(
      `Merging ${sourceBranch} into ${item.worktree.branch}...`,
      (signal) => mergeBranch(root, item.worktree.path, sourceBranch, signal)
    );
    provider.refresh();
    await showOutputResult(`Merged ${sourceBranch} into ${item.worktree.branch}`, result);
  } catch (error) {
    if (!isAbortError(error)) {
      showError(error);
    }
  }
}

// ---------------------------------------------------------------------------
// Delete / Lock / Batch operations
// ---------------------------------------------------------------------------

async function deleteWorktreeCommand(
  item: WorktreeItem,
  notes: NotesStore,
  provider: WorktreeProvider,
  repositories: RepositoryManager
): Promise<void> {
  if (item.current) {
    void vscode.window.showErrorMessage(
      "This worktree is currently open in this window. Open another worktree window first, then delete this one from there."
    );
    return;
  }
  if (item.worktree.main) {
    void vscode.window.showErrorMessage("The main worktree cannot be removed.");
    return;
  }
  if (item.worktree.prunable) {
    void vscode.window.showWarningMessage(
      "This worktree is already prunable. Run Prune Worktrees to remove its metadata."
    );
    return;
  }

  const root = (await repositories.current()) ?? item.worktree.path;
  const branch = item.worktree.branch;
  const changedFiles = item.worktree.status?.changedFiles ?? 0;
  const worktrees = await listWorktrees(root);

  if (branch) {
    const activeWorktrees = worktrees.filter((worktree) => worktree.prunable === false);
    const other = findBranchWorktree(activeWorktrees, branch, item.worktree.path);
    if (other) {
      void vscode.window.showErrorMessage(
        `Branch "${branch}" is also checked out at "${other.path}". Delete or switch that worktree first.`
      );
      return;
    }
  }

  if (item.worktree.locked) {
    const unlockChoice = await vscode.window.showWarningMessage(
      `Worktree "${String(item.label)}" is locked${
        item.worktree.lockReason ? `: ${item.worktree.lockReason}` : ""
      }. Unlock it and continue?`,
      { modal: true },
      "Unlock and Delete"
    );
    if (unlockChoice !== "Unlock and Delete") {
      return;
    }
    await unlockWorktree(root, item.worktree.path);
  }

  const dirtyNotice =
    changedFiles > 0
      ? `\n\nIt has ${changedFiles} changed file${changedFiles === 1 ? "" : "s"} that will be removed with the worktree.`
      : "";
  const firstChoice = await vscode.window.showWarningMessage(
    `Delete worktree "${String(item.label)}"?${dirtyNotice}`,
    { modal: true },
    branch ? "Delete Worktree and Branch" : "Remove Worktree"
  );
  if (firstChoice === undefined) {
    return;
  }

  const deleteBranchToo = firstChoice === "Delete Worktree and Branch";
  const secondChoice = await vscode.window.showWarningMessage(
    deleteBranchToo
      ? `This will permanently delete branch "${branch}" and remove the worktree directory "${item.worktree.path}". This cannot be undone.`
      : `This will remove the worktree directory "${item.worktree.path}". The branch will be kept. This cannot be undone.`,
    { modal: true },
    deleteBranchToo ? "Delete Branch and Worktree" : "Remove Worktree"
  );
  if (secondChoice === undefined) {
    return;
  }

  try {
    await removeWorktree(root, item.worktree.path, changedFiles > 0);
    if (deleteBranchToo && branch) {
      await deleteBranch(root, branch);
    }
    await notes.delete(item.worktree.path);
    provider.refresh();
    void vscode.window.showInformationMessage(`Deleted worktree ${String(item.label)}.`);
  } catch (error) {
    showError(error);
  }
}

async function pullAllCommand(
  provider: WorktreeProvider,
  repositories: RepositoryManager
): Promise<void> {
  const root = await repositories.current();
  if (!root) {
    void vscode.window.showErrorMessage("No workspace folder is open.");
    return;
  }

  try {
    const worktrees = await listWorktrees(root);
    const candidates = worktrees.filter(
      (worktree) => !worktree.bare && worktree.branch && !worktree.prunable
    );
    if (candidates.length === 0) {
      void vscode.window.showInformationMessage("No pullable worktrees.");
      return;
    }

    const concurrency = configuration().get<number>("statusConcurrency", 4);
    const statuses = await getWorktreeStatuses(root, candidates, concurrency);
    const pullable = candidates.filter((worktree) => statuses.get(worktree.path)?.hasUpstream);
    if (pullable.length === 0) {
      void vscode.window.showInformationMessage(
        "No worktree branch has an upstream configured."
      );
      return;
    }

    const items = pullable.map((worktree) => ({
      label: worktree.branch as string,
      description: worktree.path,
      worktree,
    }));
    const selected = await vscode.window.showQuickPick(items, {
      title: "Pull Worktrees",
      placeHolder: "Choose worktrees to pull",
      canPickMany: true,
      ignoreFocusOut: true,
    });
    if (!selected || selected.length === 0) {
      return;
    }

    const successes: string[] = [];
    const failures: string[] = [];
    for (let index = 0; index < selected.length; index += 1) {
      const entry = selected[index];
      try {
        const result = await withCancellableProgress(
          `Pulling ${entry.label} (${index + 1}/${selected.length})...`,
          (signal) => pullWorktree(root, entry.worktree.path, signal)
        );
        successes.push(`${entry.label}: ${result || "up to date"}`);
      } catch (error) {
        if (isAbortError(error)) {
          provider.refresh();
          return;
        }
        failures.push(`${entry.label}: ${errorMessage(error)}`);
      }
    }

    provider.refresh();
    const summary = [
      successes.length > 0 ? `Pulled ${successes.length} worktree(s):` : "",
      ...successes,
      failures.length > 0 ? `Failed ${failures.length} worktree(s):` : "",
      ...failures,
    ]
      .filter((line) => line.length > 0)
      .join("\n");
    await showOutputResult("Pull All", summary);
  } catch (error) {
    showError(error);
  }
}

async function quickOpenWorktree(
  repositories: RepositoryManager,
  notes: NotesStore
): Promise<void> {
  const root = await repositories.current();
  if (!root) {
    void vscode.window.showErrorMessage("No workspace folder is open.");
    return;
  }

  const worktrees = await listWorktrees(root);
  const openable = worktrees.filter(
    (worktree) => worktree.bare === false && worktree.prunable === false
  );
  const items = openable.map((worktree) => ({
    label: worktree.branch ?? "(detached)",
    description: worktree.path,
    detail: notes.get(worktree.path),
    worktree,
  }));
  const selected = await vscode.window.showQuickPick(items, {
    title: "Go to Worktree",
    placeHolder: "Search by branch, path, or note",
    matchOnDescription: true,
    matchOnDetail: true,
    ignoreFocusOut: true,
  });
  if (!selected) {
    return;
  }

  const action = await vscode.window.showQuickPick(
    [
      { label: "$(window) Open in Cursor", action: "cursor" },
      { label: "$(globe) Open in Current Window", action: "current" },
      { label: "$(terminal) Open in Terminal", action: "terminal" },
      { label: "$(copy) Copy Path", action: "copy" },
      { label: "$(folder-opened) Reveal in File Explorer", action: "reveal" },
    ],
    {
      title: `Actions for ${selected.label}`,
      placeHolder: "Choose an action",
      ignoreFocusOut: true,
    }
  );
  if (!action) {
    return;
  }

  try {
    if (action.action === "cursor") {
      await openInCursor(selected.worktree.path);
    } else if (action.action === "current") {
      await openInCurrentWindow(selected.worktree.path);
    } else if (action.action === "terminal") {
      vscode.window.createTerminal({ cwd: selected.worktree.path, name: selected.label }).show();
    } else if (action.action === "copy") {
      await vscode.env.clipboard.writeText(selected.worktree.path);
    } else {
      await revealInOS(selected.worktree.path);
    }
  } catch (error) {
    showError(error);
  }
}

// ---------------------------------------------------------------------------
// Auto refresh
// ---------------------------------------------------------------------------

function installAutoRefresh(provider: WorktreeProvider): vscode.Disposable {
  let interval: NodeJS.Timeout | undefined;
  let focusTimer: NodeJS.Timeout | undefined;

  function clearTimers(): void {
    if (interval) {
      clearInterval(interval);
      interval = undefined;
    }
    if (focusTimer) {
      clearTimeout(focusTimer);
      focusTimer = undefined;
    }
  }

  function apply(): void {
    clearTimers();
    const mode = configuration().get<string>("autoRefresh", "onFocus");
    if (mode === "interval") {
      const seconds = Math.max(5, configuration().get<number>("refreshIntervalSeconds", 60));
      // Do not clear the status cache: TTL-based caching keeps these
      // automatic refreshes cheap. Mutating commands call refresh() and
      // explicitly clear the cache.
      interval = setInterval(() => provider.refresh(false), seconds * 1000);
    }
  }

  const stateDisposable = vscode.window.onDidChangeWindowState((state) => {
    if (!state.focused || configuration().get<string>("autoRefresh", "onFocus") !== "onFocus") {
      return;
    }
    if (focusTimer) {
      clearTimeout(focusTimer);
    }
    focusTimer = setTimeout(() => provider.refresh(false), 800);
  });

  const configDisposable = vscode.workspace.onDidChangeConfiguration((event) => {
    if (
      event.affectsConfiguration("worktreeExplorer.autoRefresh") ||
      event.affectsConfiguration("worktreeExplorer.refreshIntervalSeconds")
    ) {
      apply();
    }
  });

  apply();

  return vscode.Disposable.from(stateDisposable, configDisposable, {
    dispose: clearTimers,
  });
}

export function deactivate(): void {}
