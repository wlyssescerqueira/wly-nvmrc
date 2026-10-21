import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { run } from "../utils/exec";
import { quotePosix } from "../utils/shell";

export function androidSdk(): string | undefined {
  const candidates = [
    vscode.workspace
      .getConfiguration("wlyNvmrc.android")
      .get<string>("sdkPath"),
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.platform === "win32"
      ? path.join(
          process.env.LOCALAPPDATA ||
            path.join(os.homedir(), "AppData", "Local"),
          "Android",
          "Sdk",
        )
      : path.join(
          os.homedir(),
          process.platform === "darwin" ? "Library/Android/sdk" : "Android/Sdk",
        ),
  ];
  return candidates.find((candidate): candidate is string =>
    Boolean(candidate && fs.existsSync(path.join(candidate, "platform-tools"))),
  );
}

function emulatorPath(sdk: string): string {
  return path.join(
    sdk,
    "emulator",
    process.platform === "win32" ? "emulator.exe" : "emulator",
  );
}

export function androidReady(): boolean {
  const sdk = androidSdk();
  return Boolean(sdk && fs.existsSync(emulatorPath(sdk)));
}

export async function configureAndroid(): Promise<void> {
  const suggestion =
    androidSdk() ||
    (process.platform === "win32"
      ? path.join(
          process.env.LOCALAPPDATA ||
            path.join(os.homedir(), "AppData", "Local"),
          "Android",
          "Sdk",
        )
      : path.join(
          os.homedir(),
          process.platform === "darwin" ? "Library/Android/sdk" : "Android/Sdk",
        ));
  const choice = await vscode.window.showQuickPick(
    [
      {
        label: "Select Android SDK folder",
        action: "select",
        description: suggestion,
      },
      {
        label: "Show setup instructions",
        action: "help",
        description: "SDK Manager, ANDROID_HOME and emulator setup",
      },
    ],
    { placeHolder: "Android SDK / emulator setup" },
  );
  if (choice?.action === "select") {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Use Android SDK",
      defaultUri: fs.existsSync(suggestion)
        ? vscode.Uri.file(suggestion)
        : undefined,
    });
    const sdk = selected?.[0]?.fsPath;
    if (!sdk) {
      return;
    }
    if (!fs.existsSync(path.join(sdk, "platform-tools"))) {
      await vscode.window.showWarningMessage(
        "This folder has no platform-tools. Install Android SDK Platform-Tools using Android Studio > SDK Manager.",
      );
      return;
    }
    await vscode.workspace
      .getConfiguration("wlyNvmrc.android")
      .update("sdkPath", sdk, vscode.ConfigurationTarget.Global);
    await vscode.window.showInformationMessage(
      "Android SDK saved. Scripts launched by this extension will receive ANDROID_HOME automatically.",
    );
  } else if (choice?.action === "help") {
    const env =
      process.platform === "win32"
        ? `[Environment]::SetEnvironmentVariable('ANDROID_HOME', '${suggestion.replace(/'/g, "''")}', 'User')`
        : `export ANDROID_HOME=${quotePosix(suggestion)}`;
    const doc = await vscode.workspace.openTextDocument({
      language: "markdown",
      content: [
        "# Android setup",
        "",
        "1. In Android Studio > SDK Manager, install Android SDK Platform-Tools and Android Emulator.",
        "2. In Device Manager, create a virtual device and download its system image.",
        '3. Choose "Select Android SDK folder" in this extension. No machine environment changes are required.',
        "",
        `Suggested SDK folder: ${suggestion}`,
        "",
        "For terminals outside this extension, you can set ANDROID_HOME yourself after checking the path:",
        "",
        "```" + (process.platform === "win32" ? "powershell" : "sh"),
        env,
        "```",
        "",
        "Restart VS Code and terminals after changing system environment variables.",
        "Documentation: https://developer.android.com/tools/variables",
      ].join("\n"),
    });
    await vscode.window.showTextDocument(doc);
  }
}

export async function startAndroidEmulator(): Promise<void> {
  const sdk = androidSdk();
  if (!sdk || !androidReady()) {
    await configureAndroid();
    return;
  }
  try {
    const result = await run(emulatorPath(sdk), ["-list-avds"]);
    const avds = result.stdout
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean);
    if (!avds.length) {
      await vscode.window.showInformationMessage(
        "No Android virtual devices found. Create one in Android Studio > Device Manager.",
      );
      return;
    }
    const avd =
      avds.length === 1
        ? avds[0]
        : await vscode.window.showQuickPick(avds, {
            placeHolder: "Choose an Android emulator",
          });
    if (!avd) {
      return;
    }
    if (!vscode.workspace.isTrusted) {
      return;
    }
    const task = new vscode.Task(
      { type: "wlyNvmrc-emulator" },
      vscode.TaskScope.Workspace,
      `Android: ${avd}`,
      "wly",
      new vscode.ProcessExecution(emulatorPath(sdk), ["-avd", avd], {
        env: { ANDROID_HOME: sdk },
      }),
    );
    await vscode.tasks.executeTask(task);
  } catch (error) {
    await vscode.window.showErrorMessage(
      `Could not start Android emulator: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
