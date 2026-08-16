import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";
import * as vscode from "vscode";

const execFileAsync = promisify(execFile);

const OPEN_A_SENTINEL = "__open_a__";
const EXTERNAL_COMMAND_TIMEOUT_MS = 15_000;

function runExternal(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const needsShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
  if (needsShell) {
    // With `shell: true` Node passes the joined string to cmd.exe verbatim, so
    // a path containing spaces or `&` would break or be interpreted. Quote the
    // command and each argument ourselves: Windows paths cannot contain double
    // quotes, so this is safe for the values this module passes.
    const quotedCommand = command.startsWith('"') && command.endsWith('"') ? command : `"${command}"`;
    const quotedArgs = args.map((arg) => `"${arg}"`);
    return execFileAsync(quotedCommand, quotedArgs, {
      shell: true,
      timeout: EXTERNAL_COMMAND_TIMEOUT_MS,
    });
  }
  // A timeout keeps a hanging launcher (e.g. an IDEA CLI waiting on a lock)
  // from blocking the command forever.
  return execFileAsync(command, args, { timeout: EXTERNAL_COMMAND_TIMEOUT_MS });
}

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("worktreeExplorer");
}

function isRunningInApp(appName: string): boolean {
  return vscode.env.appName.toLowerCase().includes(appName);
}

export async function openInCursor(worktreePath: string): Promise<void> {
  if (isRunningInApp("cursor")) {
    await openFolder(worktreePath, { forceNewWindow: true });
    return;
  }

  const command = config().get<string>("cursorCommand", "cursor");
  try {
    await runExternal(command, [worktreePath]);
  } catch {
    throw new Error(
      vscode.l10n.t(
        "Failed to open Cursor ({0}). Install the Cursor shell command, or set worktreeExplorer.cursorCommand.",
        command
      )
    );
  }
}

export async function openInCode(worktreePath: string): Promise<void> {
  if (isRunningInApp("visual studio code")) {
    await openFolder(worktreePath, { forceNewWindow: true });
    return;
  }

  const command = config().get<string>("vscodeCommand", "code");
  try {
    await runExternal(command, [worktreePath]);
  } catch {
    throw new Error(
      vscode.l10n.t(
        "Failed to open VS Code ({0}). Install the VS Code shell command, or set worktreeExplorer.vscodeCommand.",
        command
      )
    );
  }
}

export async function openInCurrentWindow(worktreePath: string): Promise<void> {
  await openFolder(worktreePath, { forceNewWindow: false });
}

export async function revealInOS(worktreePath: string): Promise<void> {
  await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(worktreePath));
}

export async function openInIdea(worktreePath: string): Promise<void> {
  const configured = config().get<string>("ideaCommand", "idea");
  for (const candidate of ideaCandidates(configured)) {
    try {
      await tryOpenIdea(candidate, worktreePath);
      return;
    } catch {
      // try the next candidate
    }
  }

  throw new Error(
    vscode.l10n.t(
      "Failed to open IntelliJ IDEA. In IDEA, run Tools → Create Command-line Launcher, or set worktreeExplorer.ideaCommand to the absolute path."
    )
  );
}

function ideaCandidates(configured: string): string[] {
  const candidates = [configured];

  if (process.platform === "darwin") {
    const toolbox = path.join(
      os.homedir(),
      "Library/Application Support/JetBrains/Toolbox/scripts/idea"
    );
    addCandidate(candidates, toolbox);
    candidates.push(OPEN_A_SENTINEL);
  } else if (process.platform === "linux") {
    addCandidate(candidates, path.join(os.homedir(), ".local/share/JetBrains/Toolbox/scripts/idea"));
    addCandidate(candidates, "/usr/local/bin/idea");
  } else if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
    addCandidate(candidates, path.join(localAppData, "JetBrains", "Toolbox", "scripts", "idea.cmd"));
  }

  return candidates;
}

function addCandidate(candidates: string[], candidate: string): void {
  if (candidates.includes(candidate) === false) {
    candidates.push(candidate);
  }
}

async function tryOpenIdea(candidate: string, worktreePath: string): Promise<void> {
  if (candidate === OPEN_A_SENTINEL) {
    await runExternal("open", ["-a", "IntelliJ IDEA", worktreePath]);
    return;
  }
  if (path.isAbsolute(candidate) && fs.existsSync(candidate) === false) {
    throw new Error(`not found: ${candidate}`);
  }
  await runExternal(candidate, [worktreePath]);
}

async function openFolder(
  worktreePath: string,
  options: { forceNewWindow: boolean }
): Promise<void> {
  await vscode.commands.executeCommand(
    "vscode.openFolder",
    vscode.Uri.file(worktreePath),
    options
  );
}
