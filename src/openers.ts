import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";
import * as vscode from "vscode";

const execFileAsync = promisify(execFile);

const OPEN_A_SENTINEL = "__open_a__";

function runExternal(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const needsShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
  return execFileAsync(command, args, { shell: needsShell });
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
      `Failed to open Cursor (${command}). Install the Cursor shell command, or set worktreeExplorer.cursorCommand.`
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
      `Failed to open VS Code (${command}). Install the VS Code shell command, or set worktreeExplorer.vscodeCommand.`
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
    "Failed to open IntelliJ IDEA. In IDEA, run Tools → Create Command-line Launcher, or set worktreeExplorer.ideaCommand to the absolute path."
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
