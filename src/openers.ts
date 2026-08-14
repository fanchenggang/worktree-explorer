import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";
import * as vscode from "vscode";

const execFileAsync = promisify(execFile);

const OPEN_A_SENTINEL = "__open_a__";

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("worktreeExplorer");
}

export async function openInCursor(worktreePath: string): Promise<void> {
  if (vscode.env.appName.toLowerCase().includes("cursor")) {
    await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(worktreePath), {
      forceNewWindow: true,
    });
    return;
  }

  const command = config().get<string>("cursorCommand", "cursor");
  try {
    await execFileAsync(command, [worktreePath]);
  } catch {
    throw new Error(
      `Failed to open Cursor (${command}). Install the Cursor shell command, or set worktreeExplorer.cursorCommand.`
    );
  }
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
    if (configured !== toolbox) {
      candidates.push(toolbox);
    }
    candidates.push(OPEN_A_SENTINEL);
  }
  return candidates;
}

async function tryOpenIdea(candidate: string, worktreePath: string): Promise<void> {
  if (candidate === OPEN_A_SENTINEL) {
    await execFileAsync("open", ["-a", "IntelliJ IDEA", worktreePath]);
    return;
  }
  if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) {
    throw new Error(`not found: ${candidate}`);
  }
  await execFileAsync(candidate, [worktreePath]);
}
