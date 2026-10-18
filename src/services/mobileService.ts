import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { toast } from "../utils/output";

export function isAndroidProject(dir: string): boolean {
  if (fs.existsSync(path.join(dir, "android"))) {
    return true;
  }
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(dir, "package.json"), "utf8"),
    );
    const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
    return Boolean(dependencies.expo || dependencies["react-native"]);
  } catch {
    return false;
  }
}

/** Mobile launch scripts need to be visible even when they have no server port. */
export function isMobileLaunchScript(script: string, command: string): boolean {
  return (
    /(?:^|[:_-])(?:emulator|avd|android|ios)(?:$|[:_-])/i.test(script) ||
    /\bemulator(?:\.exe)?\s+(?:-avd|@)/i.test(command)
  );
}

export async function openApkFolder(dir: string): Promise<void> {
  const apks = await vscode.workspace.findFiles(
    new vscode.RelativePattern(dir, "**/*.apk"),
    "**/{node_modules,.git,.gradle}/**",
  );
  const folders = [
    ...new Set(apks.map((apk) => path.dirname(apk.fsPath))),
  ].sort();
  const output = path.join(dir, "android", "app", "build", "outputs", "apk");
  if (folders.length === 0 && fs.existsSync(output)) {
    folders.push(output);
  }
  if (folders.length === 0) {
    toast(
      "No APK output folder found. Build or download an APK into this project first.",
      "warn",
    );
    return;
  }
  const folder =
    folders.length === 1
      ? folders[0]
      : (
          await vscode.window.showQuickPick(
            folders.map((folder) => ({
              label: path.relative(dir, folder) || ".",
              description: folder,
              folder,
            })),
            { placeHolder: "Choose an APK folder to open" },
          )
        )?.folder;
  if (folder && !(await vscode.env.openExternal(vscode.Uri.file(folder)))) {
    toast("Could not open the APK folder in the file manager.", "error");
  }
}
