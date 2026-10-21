import * as vscode from "vscode";
import { run } from "../utils/exec";
import { activateNode, nvmCommand, nvmScript } from "./posixNvm";

export const nvmUnavailableMessage =
  process.platform === "win32"
    ? "nvm was not found on PATH. Install nvm-windows to switch versions automatically."
    : "nvm.sh was not found. Install nvm-sh or configure NVM_DIR, then restart VS Code.";

export async function isNvmAvailable(): Promise<boolean> {
  if (process.platform !== "win32") {
    return Boolean(nvmScript());
  }
  try {
    // nvm-windows refuses to run from a GUI process without a console and
    // displays a modal "Terminal Only" dialog. Check PATH without starting
    // nvm itself; actual nvm commands run in VS Code's integrated terminal.
    await run("where.exe", ["nvm"]);
    return true;
  } catch {
    return false;
  }
}

async function runNvmInTerminal(args: string[]): Promise<void> {
  if (!vscode.workspace.isTrusted) {
    throw new Error("Trust this workspace before running nvm.");
  }
  const task = new vscode.Task(
    { type: "wly-nvmrc", command: args[0] },
    vscode.TaskScope.Workspace,
    `nvm ${args.join(" ")}`,
    "Wly Nvmrc",
    process.platform === "win32"
      ? new vscode.ShellExecution("nvm", args)
      : new vscode.ProcessExecution("/bin/sh", ["-c", nvmCommand(args)]),
  );
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Shared,
    focus: false,
    clear: false,
  };

  const execution = await vscode.tasks.executeTask(task);
  await new Promise<void>((resolve, reject) => {
    const processSubscription = vscode.tasks.onDidEndTaskProcess((event) => {
      if (event.execution !== execution) {
        return;
      }
      processSubscription.dispose();
      taskSubscription.dispose();
      if (event.exitCode === 0) {
        resolve();
      } else {
        reject(
          new Error(`nvm exited with code ${event.exitCode ?? "unknown"}`),
        );
      }
    });
    const taskSubscription = vscode.tasks.onDidEndTask((event) => {
      if (event.execution !== execution) {
        return;
      }
      // Some task providers do not emit a process event. Let that event
      // win when available, otherwise avoid leaving the command pending.
      setTimeout(() => {
        processSubscription.dispose();
        taskSubscription.dispose();
        reject(new Error("nvm task ended without an exit code."));
      }, 0);
    });
  });
}

export async function useVersion(version: string): Promise<void> {
  await runNvmInTerminal(["use", version]);
  if (process.platform !== "win32") {
    const { stdout } = await run("/bin/sh", [
      "-c",
      nvmCommand(["which", version]),
    ]);
    activateNode(stdout);
  }
}

export async function installVersion(version: string): Promise<void> {
  await runNvmInTerminal(["install", version]);
}
