import * as vscode from "vscode";
import * as path from "path";
import type { ScriptCatalog, ScriptNode } from "../services/scriptCatalog";
import type { ScriptProject } from "../services/scriptsService";
import type { ScriptRunner } from "../services/scriptRunner";
import { discoverScriptFiles } from "../services/scriptFiles";
import {
  listScriptProcesses,
  matchScriptProcesses,
  runtimeKey,
  type RuntimeCandidate,
} from "../services/scriptProcesses";
import type { FooterProject, FooterScript } from "./statusBar";

type ProjectNode = { kind: "project"; project: ScriptProject };
type GroupNode = {
  kind: "group";
  project: ScriptProject;
  source: "npm" | "files";
};
type Node = ProjectNode | GroupNode | ScriptNode;

export class ScriptsTree
  implements vscode.TreeDataProvider<Node>, vscode.Disposable
{
  private readonly changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly subscription: vscode.Disposable;
  private processes = new Map<string, number[]>();
  private readonly portStates = new Map<string, FooterScript>();
  private unavailable = false;

  async refreshRuntime(): Promise<void> {
    const projects = await this.catalog.getProjects();
    const candidates: RuntimeCandidate[] = (
      await Promise.all(
        projects.map(async (project) => [
          ...Object.entries(project.scripts).map(([script, command]) => ({
            dir: project.dir,
            script,
            command,
          })),
          ...(await discoverScriptFiles(project.dir)).map((file) => ({
            dir: project.dir,
            script: `file:${file.relativePath}`,
            command: `node ${file.args.join(" ")}`,
            file: file.relativePath,
          })),
        ]),
      )
    ).flat();
    try {
      this.processes = matchScriptProcesses(
        await listScriptProcesses(),
        candidates,
      );
      this.unavailable = false;
    } catch {
      this.processes.clear();
      this.unavailable = true;
    }
    this.changed.fire(undefined);
  }

  setPortStates(projects: FooterProject[]): void {
    this.portStates.clear();
    for (const project of projects) {
      for (const script of project.scripts) {
        this.portStates.set(runtimeKey(script.dir, script.script), script);
      }
    }
    this.changed.fire(undefined);
  }

  constructor(
    private readonly catalog: ScriptCatalog,
    private readonly runner: ScriptRunner,
  ) {
    this.subscription = catalog.onDidChange(() => this.changed.fire(undefined));
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (!node) {
      return (await this.catalog.getProjects()).map((project) => ({
        kind: "project",
        project,
      }));
    }
    if (node.kind === "project") {
      return ["npm", "files"].map(
        (source) =>
          ({ kind: "group", project: node.project, source }) as GroupNode,
      );
    }
    if (node.kind === "script") {
      return [];
    }
    const project = node.project;
    if (node.source === "npm") {
      return Object.entries(project.scripts).map(([script, command]) => ({
        kind: "script",
        project,
        script,
        command,
      }));
    }
    return (await discoverScriptFiles(project.dir)).map((file) => ({
      kind: "script",
      project,
      script: `file:${file.relativePath}`,
      command: `node ${file.args.map((arg) => JSON.stringify(arg)).join(" ")}`,
      file: file.relativePath,
      args: file.args,
    }));
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === "project") {
      const item = new vscode.TreeItem(
        node.project.label
          .replace(/[\\/]package\.json$/, "")
          .replace(/^package\.json$/, path.basename(node.project.dir)),
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.id = node.project.dir;
      item.iconPath = new vscode.ThemeIcon("folder-library");
      item.tooltip = node.project.dir;
      return item;
    }
    if (node.kind === "group") {
      const item = new vscode.TreeItem(
        node.source === "npm" ? "Comandos npm" : "Arquivos de scripts",
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.id = `${node.project.dir}:${node.source}`;
      item.iconPath = new vscode.ThemeIcon(
        node.source === "npm" ? "package" : "folder",
      );
      item.description =
        node.source === "npm"
          ? `${Object.keys(node.project.scripts).length}`
          : "scripts/";
      return item;
    }
    const key = runtimeKey(node.project.dir, node.script);
    const mode = this.runner.runningMode(node.project.dir, node.script);
    const pids = this.processes.get(key) ?? [];
    const port = this.portStates.get(key);
    const state =
      mode ??
      (pids.length
        ? "external"
        : (port?.state ?? (this.unavailable ? "unknown" : "idle")));
    const running = state === "task" || state === "debug";
    const external = state === "external";
    const item = new vscode.TreeItem(
      node.file ? node.file.replace(/^scripts[\\/]/, "") : node.script,
    );
    item.id = `${node.project.dir}:${node.script}`;
    item.contextValue = external
      ? "wlyScriptExternal"
      : running
        ? "wlyScriptRunning"
        : node.file
          ? "wlyScriptFile"
          : "wlyScript";
    item.iconPath = new vscode.ThemeIcon(
      state === "debug"
        ? "debug-alt"
        : running
          ? "sync~spin"
          : external
            ? "pass-filled"
            : state === "conflict"
              ? "warning"
              : state === "occupied"
                ? "circle-slash"
                : state === "unknown"
                  ? "question"
                  : "circle-outline",
      running || external
        ? new vscode.ThemeColor("debugIcon.startForeground")
        : undefined,
    );
    item.description =
      state === "debug"
        ? "Depurando nesta janela"
        : running
          ? "Em execução nesta janela"
          : external
            ? `Em execução · PID ${pids.length ? pids.join(", ") : port?.listeners.map((listener) => listener.pid).join(", ")}`
            : state === "conflict"
              ? "Porta usada por outro projeto"
              : state === "occupied"
                ? `Porta usada por ${[...new Set(port?.listeners.map((listener) => listener.owner?.script))].filter(Boolean).join(", ")}`
                : state === "unknown"
                  ? "Estado não identificado"
                  : "Parado";
    item.tooltip = `${node.file ?? node.script}\n${item.description}\n${node.command}\n${node.project.dir}`;
    item.command = {
      command: "wlyNvmrc.scripts.open",
      title: "Abrir script",
      arguments: [node],
    };
    return item;
  }

  dispose(): void {
    this.subscription.dispose();
    this.changed.dispose();
  }
}
