import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { NotesStore } from "./notesStore";
import {
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
  checkedOutBranches,
  currentBranch,
  deleteBranch,
  dryRunPrune,
  fetchAllRemotes,
  findBranchWorktree,
  getUpstream,
  getWorktreeStatuses,
  invalidateRepositoryRootsCache,
  isCommitish,
  isRemoteBranch,
  listLocalBranches,
  listRemoteBranches,
  listRemotes,
  listWorktrees,
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
} from "./gitWorktree";

const SELECTED_REPOSITORY_KEY = "worktreeExplorer.selectedRepository";

const t = vscode.l10n.t;

function configuration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("worktreeExplorer");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Text label of a worktree item; the base type allows a rich TreeItemLabel. */
function labelOf(item: WorktreeItem): string {
  return item.label as string;
}

function showError(error: unknown): void {
  void vscode.window.showErrorMessage(errorMessage(error));
}

class RepositoryManager {
  constructor(private readonly memento: vscode.Memento) {}

  async current(): Promise<string | undefined> {
    const roots = await repositoryRoots();
    if (roots.length === 0) {
      // Let the tree show its welcome message instead of running git in a
      // non-repository folder and surfacing a raw git error.
      return undefined;
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
      void vscode.window.showErrorMessage(t("No Git repository is open in this window."));
      return undefined;
    }

    const items = roots.map((root) => ({
      label: path.basename(root) || root,
      description: root,
      root,
    }));
    const selected = await vscode.window.showQuickPick(items, {
      title: t("Select Repository"),
      placeHolder: t("Choose the Git repository to show in the Worktrees view"),
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
    outputChannel = vscode.window.createOutputChannel(t("Worktree Explorer"));
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
    t("{0}. Details are in the Worktree Explorer output.", title),
    t("Open Output"),
    t("Copy Output")
  );
  if (choice === t("Open Output")) {
    output().show(true);
  } else if (choice === t("Copy Output")) {
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
      return task(controller.signal).finally(() => {
        disposable.dispose();
      });
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

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("worktreeExplorer.list", provider),
    vscode.commands.registerCommand("worktreeExplorer.refresh", () => provider.refresh()),
    installAutoRefresh(provider),
    // The repository list depends on the open workspace folders; a fresh
    // lookup would otherwise be delayed by the 30s cache.
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      invalidateRepositoryRootsCache();
      provider.refresh(false);
    }),
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
        title: t("Worktree note"),
        prompt: t("Note for {0}", labelOf(item)),
        value: item.note,
        placeHolder: t("What is this branch for? Leave empty to clear the note."),
      });
      if (value === undefined) {
        return;
      }
      await notes.set(item.worktree.path, value);
      provider.refresh(false);
    }),
    vscode.commands.registerCommand(
      "worktreeExplorer.openTerminal",
      (item?: WorktreeItem) => {
        if (!item) {
          return;
        }
        const terminal = vscode.window.createTerminal({
          cwd: item.worktree.path,
          name: labelOf(item),
        });
        terminal.show();
      }
    ),
    vscode.commands.registerCommand("worktreeExplorer.copyPath", async (item?: WorktreeItem) => {
      if (!item) {
        return;
      }
      await vscode.env.clipboard.writeText(item.worktree.path);
      void vscode.window.showInformationMessage(t("Copied {0}", item.worktree.path));
    }),
    vscode.commands.registerCommand("worktreeExplorer.prune", async () => {
      const root = await repositories.current();
      if (!root) {
        void vscode.window.showErrorMessage(t("No workspace folder is open."));
        return;
      }

      try {
        const dryRun = await dryRunPrune(root);
        if (!dryRun) {
          void vscode.window.showInformationMessage(t("Nothing to prune."));
          return;
        }

        const choice = await vscode.window.showWarningMessage(
          t("Remove stale worktree metadata?"),
          { modal: true },
          t("Prune Worktrees")
        );
        if (choice !== t("Prune Worktrees")) {
          return;
        }

        await pruneWorktrees(root);
        const remaining = await listWorktrees(root);
        await notes.prune(new Set(remaining.map((worktree) => worktree.path)));
        provider.refresh();
        void vscode.window.showInformationMessage(t("Pruned stale worktree metadata."));
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
    vscode.commands.registerCommand("worktreeExplorer.fetchAll", async () => {
      const root = await repositories.current();
      if (!root) {
        void vscode.window.showErrorMessage(t("No workspace folder is open."));
        return;
      }
      try {
        const result = await withCancellableProgress(t("Fetching all remotes..."), (signal) =>
          fetchAllRemotes(root, signal)
        );
        provider.refresh();
        await showOutputResult(t("Fetched all remotes"), result);
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
  // A prunable worktree's directory is gone, so it cannot serve as the
  // repository root or as the source for settings-directory copies.
  const sourcePath =
    item && item.worktree.bare === false && item.worktree.prunable === false
      ? item.worktree.path
      : await repositories.current();
  const root = sourcePath;
  if (!root) {
    void vscode.window.showErrorMessage(t("No workspace folder is open."));
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
            label: t("$(circle-outline) --no-track (recommended)"),
            description: remoteBranch,
            detail: t("The new branch gets no upstream; you can set one later with Pull."),
            value: false,
          },
          {
            label: t("$(check) --track"),
            description: remoteBranch,
            detail: t("Set the remote branch as the new branch's upstream."),
            value: true,
          },
        ],
        {
          title: t("Upstream Tracking"),
          placeHolder: t("Choose whether the new branch tracks the remote branch"),
          ignoreFocusOut: true,
        }
      );
      if (!trackingChoice) {
        return;
      }
      track = trackingChoice.value;
    } else if (mode.mode === "existing") {
      const existing = await pickExistingBranch(root, worktrees);
      if (!existing) {
        return;
      }
      await createExistingWorktree(root, existing, item, provider);
      return;
    } else {
      const commitish = await vscode.window.showInputBox({
        title: t("Create Detached Worktree"),
        prompt: t("Commit SHA, tag, or any commit-ish"),
        ignoreFocusOut: true,
        validateInput: async (value) => {
          const trimmed = value.trim();
          if (!trimmed) {
            return t("A commit or tag is required.");
          }
          return (await isCommitish(root, trimmed))
            ? undefined
            : t('"{0}" is not a valid commit or tag.', trimmed);
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

    const copyDirs = await chooseCopyDirs(sourcePath);
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: t("Creating worktree {0}...", branch),
        cancellable: false,
      },
      async () => {
        await addWorktree(root, branch, directory, baseBranch, track);
        if (copyDirs.length > 0) {
          await copyConfiguredDirs(sourcePath, directory, copyDirs);
        }
      }
    );

    provider.refresh();
    await showCreatedActions(branch, directory);
  } catch (error) {
    showError(error);
  }
}

/**
 * Settings-directory copy source for a context-menu launch. Prunable or bare
 * items cannot be a source, so fall back to the repository root.
 */
function copySourcePath(sourceItem: WorktreeItem | undefined, root: string): string {
  if (sourceItem && sourceItem.worktree.bare === false && sourceItem.worktree.prunable === false) {
    return sourceItem.worktree.path;
  }
  return root;
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
  const source = copySourcePath(sourceItem, root);
  const copyDirs = await chooseCopyDirs(source);
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: t("Checking out worktree {0}...", branch),
      cancellable: false,
    },
    async () => {
      await addExistingWorktree(root, directory, branch);
      if (copyDirs.length > 0) {
        await copyConfiguredDirs(source, directory, copyDirs);
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
  const source = copySourcePath(sourceItem, root);
  const copyDirs = await chooseCopyDirs(source);
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: t("Creating detached worktree {0}...", folderName),
      cancellable: false,
    },
    async () => {
      await addDetachedWorktree(root, directory, commitish);
      if (copyDirs.length > 0) {
        await copyConfiguredDirs(source, directory, copyDirs);
      }
    }
  );
  provider.refresh();
  await showCreatedActions(commitish, directory);
}

async function pickCreateMode(defaultBase: string): Promise<ModeItem | undefined> {
  const modes: ModeItem[] = [
    {
      label: t("$(git-branch) New branch from {0}", defaultBase || "HEAD"),
      description: t("Use the current worktree branch as the base"),
      mode: "new-current",
    },
    {
      label: t("$(repo) New branch from another local branch"),
      mode: "new-local",
    },
    {
      label: t("$(cloud) New branch from a remote branch"),
      mode: "new-remote",
    },
    {
      label: t("$(check) Check out an existing local branch"),
      mode: "existing",
    },
    {
      label: t("$(git-commit) Detached worktree from commit/tag"),
      mode: "detached",
    },
  ];

  return vscode.window.showQuickPick(modes, {
    title: t("Create Worktree"),
    placeHolder: t("Choose what the new worktree should be based on"),
    ignoreFocusOut: true,
  });
}

async function pickLocalBranch(root: string, current: string | undefined): Promise<string | undefined> {
  const branches = await listLocalBranches(root);
  const items: BranchItem[] = branches.map((branch) => ({
    label: branch,
    description: branch === current ? t("current") : undefined,
    branch,
    remote: false,
  }));
  const selected = await vscode.window.showQuickPick(items, {
    title: t("Base Branch"),
    placeHolder: t("Choose a local branch to create the new branch from"),
    ignoreFocusOut: true,
  });
  return selected?.branch;
}

async function pickRemoteBranch(root: string): Promise<string | undefined> {
  while (true) {
    const remoteBranches = await listRemoteBranches(root);
    if (remoteBranches.length === 0) {
      const fetchNow = t("Fetch Remotes");
      const choice = await vscode.window.showWarningMessage(
        t("No remote branches are available."),
        { modal: true },
        fetchNow
      );
      if (choice !== fetchNow) {
        return undefined;
      }
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: t("Fetching remotes..."),
          cancellable: false,
        },
        () => fetchAllRemotes(root)
      );
      continue;
    }

    const items: BranchItem[] = [
      {
        label: t("$(sync) Fetch remotes and refresh list"),
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
      title: t("Remote Branch"),
      placeHolder: t("Choose a remote branch to create the new branch from"),
      ignoreFocusOut: true,
    });
    if (!selected) {
      return undefined;
    }
    if (selected.branch === "") {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: t("Fetching remotes..."),
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
  // Include prunable worktrees: git's registry still considers their branch
  // checked out and rejects `git worktree add` with "already used by
  // worktree at ..." until the stale metadata is pruned.
  const checkedOut = checkedOutBranches(worktrees);
  const available = branches.filter((branch) => !checkedOut.has(branch));
  if (available.length === 0) {
    void vscode.window.showInformationMessage(
      t("Every local branch is already checked out in a worktree.")
    );
    return undefined;
  }
  const selected = await vscode.window.showQuickPick(available, {
    title: t("Check Out Existing Branch"),
    placeHolder: t("Choose a local branch that is not checked out anywhere"),
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
    title: t("New Branch Name"),
    prompt: t("Create a new branch from {0}", baseBranch),
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
    title: t("Worktree Directory"),
    prompt: t("Absolute directory for the new worktree"),
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
    return t("Working directory is required.");
  }
  if (!path.isAbsolute(directory)) {
    return t("Working directory must be an absolute path.");
  }

  const resolved = path.resolve(directory);
  const rootPath = path.resolve(root);
  if (resolved === rootPath) {
    return t("Choose a subdirectory; the repository root itself cannot be a new worktree.");
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
    return t("The directory cannot overlap an existing worktree.");
  }

  const parent = path.dirname(resolved);
  try {
    const parentStat = await fs.promises.stat(parent);
    if (!parentStat.isDirectory()) {
      return t('Parent "{0}" is not a directory.', parent);
    }
  } catch {
    return t('Parent directory "{0}" does not exist.', parent);
  }

  try {
    const targetStat = await fs.promises.stat(resolved);
    if (!targetStat.isDirectory()) {
      return t('"{0}" already exists and is not a directory.', resolved);
    }
    const entries = await fs.promises.readdir(resolved);
    if (entries.length > 0) {
      return t('"{0}" already exists and is not empty.', resolved);
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
        label: t("$(copy) Copy settings directories"),
        description: available.join(", "),
        detail: t("Copy them from the source worktree into the new worktree."),
        value: true,
      },
      {
        label: t("$(x) Skip copying"),
        value: false,
      },
    ],
    {
      title: t("Copy Settings"),
      placeHolder: t("Choose whether to copy settings directories"),
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
    t("Created worktree {0} at {1}", branch, directory),
    t("Open in Cursor"),
    t("Open in Current Window"),
    t("Open in Terminal"),
    t("Copy Path")
  );
  if (choice === t("Open in Cursor")) {
    try {
      await openInCursor(directory);
    } catch (error) {
      showError(error);
    }
  } else if (choice === t("Open in Current Window")) {
    try {
      await openInCurrentWindow(directory);
    } catch (error) {
      showError(error);
    }
  } else if (choice === t("Open in Terminal")) {
    const terminal = vscode.window.createTerminal({ cwd: directory, name: branch });
    terminal.show();
  } else if (choice === t("Copy Path")) {
    await vscode.env.clipboard.writeText(directory);
  }
}

// ---------------------------------------------------------------------------
// Pull / Push / Merge
// ---------------------------------------------------------------------------

async function pullWorktreeCommand(item: WorktreeItem, provider: WorktreeProvider): Promise<void> {
  if (item.worktree.bare) {
    void vscode.window.showWarningMessage(t("Bare worktrees cannot be updated from a remote."));
    return;
  }
  if (!item.worktree.branch) {
    void vscode.window.showWarningMessage(t("A detached HEAD worktree cannot be pulled."));
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

    const result = await withCancellableProgress(t("Pulling {0}...", labelOf(item)), (signal) =>
      pullWorktree(root, item.worktree.path, signal)
    );
    provider.refresh();
    await showOutputResult(t("Pulled {0}", labelOf(item)), result);
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
    void vscode.window.showWarningMessage(t("No remotes are configured for this repository."));
    return undefined;
  }

  const remote =
    remotes.length === 1
      ? remotes[0]
      : await vscode.window.showQuickPick(remotes, {
          title: t("Choose Remote"),
          placeHolder: t("Choose a remote for the upstream branch"),
          ignoreFocusOut: true,
        });
  if (!remote) {
    return undefined;
  }

  const remoteBranch = `${remote}/${branch}`;
  if (!(await isRemoteBranch(root, remoteBranch))) {
    const choice = await vscode.window.showWarningMessage(
      t('Remote branch "{0}" does not exist. Fetch remotes and try again?', remoteBranch),
      { modal: true },
      t("Fetch")
    );
    if (choice !== t("Fetch")) {
      return undefined;
    }
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: t("Fetching remotes..."),
        cancellable: false,
      },
      () => fetchAllRemotes(root)
    );
    if (!(await isRemoteBranch(root, remoteBranch))) {
      void vscode.window.showErrorMessage(
        t('Remote branch "{0}" still does not exist after fetching.', remoteBranch)
      );
      return undefined;
    }
  }

  const confirm = await vscode.window.showWarningMessage(
    t('Set "{0}" as upstream of "{1}" and pull?', remoteBranch, branch),
    { modal: true },
    t("Set Upstream and Pull")
  );
  if (confirm !== t("Set Upstream and Pull")) {
    return undefined;
  }

  await setUpstream(root, worktreePath, remote, branch);
  return remoteBranch;
}

async function pushWorktreeCommand(item: WorktreeItem, provider: WorktreeProvider): Promise<void> {
  if (item.worktree.bare) {
    void vscode.window.showWarningMessage(t("Bare worktrees cannot be pushed to a remote."));
    return;
  }
  if (!item.worktree.branch) {
    void vscode.window.showWarningMessage(t("A detached HEAD worktree cannot be pushed."));
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
        void vscode.window.showWarningMessage(t("No remotes are configured for this repository."));
        return;
      }

      const remote =
        remotes.length === 1
          ? remotes[0]
          : await vscode.window.showQuickPick(remotes, {
              title: t("Push to Remote"),
              placeHolder: t("Choose a remote to push to"),
              ignoreFocusOut: true,
            });
      if (!remote) {
        return;
      }

      const choice = await vscode.window.showWarningMessage(
        t('Push branch "{0}" to "{1}" and set it as upstream?', branch, remote),
        { modal: true },
        t("Push")
      );
      if (choice !== t("Push")) {
        return;
      }

      pushTask = (signal) => pushNewBranch(root, item.worktree.path, remote, branch, signal);
      successFallback = t("Pushed {0} to {1}.", branch, remote);
    } else {
      pushTask = (signal) => pushWorktree(root, item.worktree.path, signal);
      successFallback = t("Pushed {0} to remote.", labelOf(item));
    }

    const result = await withCancellableProgress(t("Pushing {0}...", labelOf(item)), (signal) =>
      pushTask(signal)
    );
    provider.refresh();
    await showOutputResult(t("Pushed {0}", labelOf(item)), result || successFallback);
  } catch (error) {
    if (!isAbortError(error)) {
      showError(error);
    }
  }
}

async function mergeBranchCommand(item: WorktreeItem, provider: WorktreeProvider): Promise<void> {
  if (item.worktree.bare) {
    void vscode.window.showWarningMessage(t("Bare worktrees cannot merge branches."));
    return;
  }
  if (!item.worktree.branch) {
    void vscode.window.showWarningMessage(t("A detached HEAD worktree cannot merge branches."));
    return;
  }

  const root = item.worktree.path;
  try {
    const branches = await listLocalBranches(root);
    const otherBranches = branches.filter((branch) => branch !== item.worktree.branch);
    if (otherBranches.length === 0) {
      void vscode.window.showInformationMessage(t("No other branches to merge."));
      return;
    }

    const sourceBranch = await vscode.window.showQuickPick(otherBranches, {
      title: t("Merge Branch"),
      placeHolder: t("Choose a branch to merge into {0}", item.worktree.branch),
      ignoreFocusOut: true,
    });
    if (!sourceBranch) {
      return;
    }

    const choice = await vscode.window.showWarningMessage(
      t('Merge branch "{0}" into "{1}"?', sourceBranch, item.worktree.branch),
      { modal: true },
      t("Merge")
    );
    if (choice !== t("Merge")) {
      return;
    }

    const result = await withCancellableProgress(
      t("Merging {0} into {1}...", sourceBranch, item.worktree.branch),
      (signal) => mergeBranch(root, item.worktree.path, sourceBranch, signal)
    );
    provider.refresh();
    await showOutputResult(t("Merged {0} into {1}", sourceBranch, item.worktree.branch), result);
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
      t(
        "This worktree is currently open in this window. Open another worktree window first, then delete this one from there."
      )
    );
    return;
  }
  if (item.worktree.main) {
    void vscode.window.showErrorMessage(t("The main worktree cannot be removed."));
    return;
  }
  if (item.worktree.prunable) {
    void vscode.window.showWarningMessage(
      t("This worktree is already prunable. Run Prune Worktrees to remove its metadata.")
    );
    return;
  }

  const root = (await repositories.current()) ?? item.worktree.path;
  const branch = item.worktree.branch;
  const changedFiles = item.worktree.status?.changedFiles ?? 0;
  const worktrees = await listWorktrees(root);

  if (branch) {
    // Prunable worktrees still hold their branch in git's registry, so
    // `git branch -D` would refuse to delete it until the metadata is pruned.
    const activeWorktrees = worktrees.filter((worktree) => worktree.bare === false);
    const other = findBranchWorktree(activeWorktrees, branch, item.worktree.path);
    if (other) {
      void vscode.window.showErrorMessage(
        other.prunable
          ? t(
              'Branch "{0}" is still checked out in prunable worktree "{1}". Run Prune Worktrees first.',
              branch,
              other.path
            )
          : t('Branch "{0}" is also checked out at "{1}". Delete or switch that worktree first.', branch, other.path)
      );
      return;
    }
  }

  if (item.worktree.locked) {
    const unlockChoice = await vscode.window.showWarningMessage(
      t(
        'Worktree "{0}" is locked{1}. Unlock it and continue?',
        labelOf(item),
        item.worktree.lockReason ? `: ${item.worktree.lockReason}` : ""
      ),
      { modal: true },
      t("Unlock and Delete")
    );
    if (unlockChoice !== t("Unlock and Delete")) {
      return;
    }
    await unlockWorktree(root, item.worktree.path);
  }

  const dirtyNotice =
    changedFiles > 0
      ? `\n\n${t(
          "It has {0} changed file{1} that will be removed with the worktree.",
          String(changedFiles),
          changedFiles === 1 ? "" : "s"
        )}`
      : "";
  const firstChoice = await vscode.window.showWarningMessage(
    t('Delete worktree "{0}"?{1}', labelOf(item), dirtyNotice),
    { modal: true },
    branch ? t("Delete Worktree and Branch") : t("Remove Worktree")
  );
  if (firstChoice === undefined) {
    return;
  }

  const deleteBranchToo = firstChoice === t("Delete Worktree and Branch");
  const secondChoice = await vscode.window.showWarningMessage(
    deleteBranchToo
      ? t(
          'This will permanently delete branch "{0}" and remove the worktree directory "{1}". This cannot be undone.',
          String(branch),
          item.worktree.path
        )
      : t(
          'This will remove the worktree directory "{0}". The branch will be kept. This cannot be undone.',
          item.worktree.path
        ),
    { modal: true },
    deleteBranchToo ? t("Delete Branch and Worktree") : t("Remove Worktree")
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
    void vscode.window.showInformationMessage(t("Deleted worktree {0}.", labelOf(item)));
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
    void vscode.window.showErrorMessage(t("No workspace folder is open."));
    return;
  }

  try {
    const worktrees = await listWorktrees(root);
    const candidates = worktrees.filter(
      (worktree) => !worktree.bare && worktree.branch && !worktree.prunable
    );
    if (candidates.length === 0) {
      void vscode.window.showInformationMessage(t("No pullable worktrees."));
      return;
    }

    const concurrency = configuration().get<number>("statusConcurrency", 4);
    const statuses = await getWorktreeStatuses(root, candidates, concurrency);
    const pullable = candidates.filter((worktree) => statuses.get(worktree.path)?.hasUpstream);
    if (pullable.length === 0) {
      void vscode.window.showInformationMessage(
        t("No worktree branch has an upstream configured.")
      );
      return;
    }

    const items = pullable.map((worktree) => ({
      label: worktree.branch as string,
      description: worktree.path,
      worktree,
    }));
    const selected = await vscode.window.showQuickPick(items, {
      title: t("Pull Worktrees"),
      placeHolder: t("Choose worktrees to pull"),
      canPickMany: true,
      ignoreFocusOut: true,
    });
    if (!selected || selected.length === 0) {
      return;
    }

    const successes: string[] = [];
    const failures: string[] = [];
    // One progress notification for the whole batch; the message tracks the
    // current worktree instead of flashing a new notification per pull.
    const cancelled = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: t("Pulling selected worktrees..."),
        cancellable: true,
      },
      async (progress, token) => {
        const controller = new AbortController();
        const disposable = token.onCancellationRequested(() => controller.abort());
        try {
          for (let index = 0; index < selected.length; index += 1) {
            const entry = selected[index];
            progress.report({ message: `${entry.label} (${index + 1}/${selected.length})` });
            try {
              const result = await pullWorktree(root, entry.worktree.path, controller.signal);
              successes.push(`${entry.label}: ${result || t("up to date")}`);
            } catch (error) {
              if (isAbortError(error)) {
                return true;
              }
              failures.push(`${entry.label}: ${errorMessage(error)}`);
            }
          }
          return false;
        } finally {
          disposable.dispose();
        }
      }
    );
    if (cancelled) {
      provider.refresh();
      return;
    }

    provider.refresh();
    const summary = [
      successes.length > 0 ? t("Pulled {0} worktree(s):", String(successes.length)) : "",
      ...successes,
      failures.length > 0 ? t("Failed {0} worktree(s):", String(failures.length)) : "",
      ...failures,
    ]
      .filter((line) => line.length > 0)
      .join("\n");
    await showOutputResult(t("Pull All"), summary);
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
    void vscode.window.showErrorMessage(t("No workspace folder is open."));
    return;
  }

  const worktrees = await listWorktrees(root);
  const openable = worktrees.filter(
    (worktree) => worktree.bare === false && worktree.prunable === false
  );
  const items = openable.map((worktree) => ({
    label: worktree.branch ?? t("(detached)"),
    description: worktree.path,
    detail: notes.get(worktree.path),
    worktree,
  }));
  const selected = await vscode.window.showQuickPick(items, {
    title: t("Go to Worktree"),
    placeHolder: t("Search by branch, path, or note"),
    matchOnDescription: true,
    matchOnDetail: true,
    ignoreFocusOut: true,
  });
  if (!selected) {
    return;
  }

  const action = await vscode.window.showQuickPick(
    [
      { label: `$(window) ${t("Open in Cursor")}`, action: "cursor" },
      { label: `$(globe) ${t("Open in Current Window")}`, action: "current" },
      { label: `$(terminal) ${t("Open in Terminal")}`, action: "terminal" },
      { label: `$(copy) ${t("Copy Path")}`, action: "copy" },
      { label: `$(folder-opened) ${t("Reveal in File Explorer")}`, action: "reveal" },
    ],
    {
      title: t("Actions for {0}", selected.label),
      placeHolder: t("Choose an action"),
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
