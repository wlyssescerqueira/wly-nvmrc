import * as vscode from "vscode";
import { findScriptProjects, type ScriptProject } from "./scriptsService";
import type { ScriptRunner } from "./scriptRunner";
import type { NvmrcController } from "../controller";

export type ScriptNode = {
  kind: "script";
  project: ScriptProject;
  script: string;
  command: string;
  file?: string;
  args?: string[];
};

/** Cached list of package.json scripts in the workspace; fires when scripts or their run state change. */
export class ScriptCatalog implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private projects: Promise<ScriptProject[]> | undefined;
  private readonly disposables: vscode.Disposable[] = [this.changed];

  constructor(controller: NvmrcController, runner: ScriptRunner) {
    this.disposables.push(
      controller.onDidChange(() => this.changed.fire()),
      runner.onDidChange(() => this.changed.fire()),
    );
    const watcher = vscode.workspace.createFileSystemWatcher("**/package.json");
    this.disposables.push(
      watcher,
      watcher.onDidChange(() => this.reload()),
      watcher.onDidCreate(() => this.reload()),
      watcher.onDidDelete(() => this.reload()),
    );
    const files = vscode.workspace.createFileSystemWatcher("**/scripts/**");
    this.disposables.push(
      files,
      files.onDidCreate(() => this.reload()),
      files.onDidChange(() => this.reload()),
      files.onDidDelete(() => this.reload()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.reload()),
    );
  }

  /** Re-scans package.json files (use when files changed, not for status-only updates). */
  reload(): void {
    this.projects = undefined;
    this.changed.fire();
  }

  getProjects(): Promise<ScriptProject[]> {
    this.projects ??= findScriptProjects();
    return this.projects;
  }

  dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
  }
}
