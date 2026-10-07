import * as vscode from 'vscode';
import { findScriptProjects, type ScriptProject } from '../services/scriptsService';
import { detectScriptPorts } from '../services/portService';
import type { ScriptRunner } from '../services/scriptRunner';
import type { NvmrcController } from '../controller';
import type { ProjectStatus } from '../types';

export type ProjectNode = { kind: 'project'; project: ScriptProject };
export type ScriptNode = { kind: 'script'; project: ScriptProject; script: string; command: string };
export type ScriptsTreeNode = ProjectNode | ScriptNode;

function samePath(a: string, b: string): boolean {
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export class ScriptsTreeProvider implements vscode.TreeDataProvider<ScriptsTreeNode>, vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<ScriptsTreeNode | undefined>();
    readonly onDidChangeTreeData = this.changed.event;
    private projects: Promise<ScriptProject[]> | undefined;
    private readonly disposables: vscode.Disposable[] = [this.changed];

    constructor(private readonly controller: NvmrcController, private readonly runner: ScriptRunner) {
        this.disposables.push(
            controller.onDidChange(() => this.changed.fire(undefined)),
            runner.onDidChange(() => this.changed.fire(undefined))
        );
    }

    /** Re-scans package.json files (use when files changed, not for status-only updates). */
    reload(): void {
        this.projects = undefined;
        this.changed.fire(undefined);
    }

    getProjects(): Promise<ScriptProject[]> {
        this.projects ??= findScriptProjects().then((projects) => {
            void vscode.commands.executeCommand('setContext', 'wlyNvmrc.hasScripts', projects.length > 0);
            return projects;
        });
        return this.projects;
    }

    private nodeStatus(project: ScriptProject): ProjectStatus | undefined {
        return this.controller.getStatus().projects.find((status) => samePath(status.path, project.dir));
    }

    async getChildren(node?: ScriptsTreeNode): Promise<ScriptsTreeNode[]> {
        if (!node) {return (await this.getProjects()).map((project) => ({ kind: 'project', project }));}
        if (node.kind === 'script') {return [];}
        return Object.entries(node.project.scripts).map(([script, command]) => ({ kind: 'script', project: node.project, script, command }));
    }

    getTreeItem(node: ScriptsTreeNode): vscode.TreeItem {
        return node.kind === 'project' ? this.projectItem(node) : this.scriptItem(node);
    }

    private projectItem({ project }: ProjectNode): vscode.TreeItem {
        const item = new vscode.TreeItem(project.label, vscode.TreeItemCollapsibleState.Expanded);
        item.id = `project:${project.packageJson.fsPath}`;
        item.resourceUri = project.packageJson;
        item.iconPath = vscode.ThemeIcon.File;
        item.contextValue = 'wlyScriptsProject';

        const status = this.nodeStatus(project);
        const current = this.controller.getStatus();
        const active = current.kind === 'ready' ? current.current : undefined;
        if (status?.required) {
            item.description = status.matches === false ? `✗ Node v${status.required} (active v${active})` : `Node v${status.required}`;
        } else if (status) {
            item.description = 'no .nvmrc';
        }
        const tooltip = new vscode.MarkdownString(`**${project.label}**\n\nPackage manager: \`${project.packageManager}\``);
        if (status?.required) {tooltip.appendMarkdown(`\n\nRequires Node v${status.required}${active ? ` · active v${active}` : ''}`);}
        item.tooltip = tooltip;
        return item;
    }

    private scriptItem({ project, script, command }: ScriptNode): vscode.TreeItem {
        const running = this.runner.isRunning(project.dir, script);
        const ports = detectScriptPorts(project.dir, script);
        const item = new vscode.TreeItem(script, vscode.TreeItemCollapsibleState.None);
        item.id = `script:${project.packageJson.fsPath}:${script}`;
        item.description = ports.length ? `${ports.map((port) => `:${port}`).join(' ')} · ${command}` : command;
        item.iconPath = new vscode.ThemeIcon(running ? 'sync~spin' : 'tools', running ? new vscode.ThemeColor('charts.green') : undefined);
        item.contextValue = running ? 'wlyScriptRunning' : 'wlyScript';
        const tooltip = new vscode.MarkdownString();
        tooltip.appendCodeblock(command, 'shell');
        if (ports.length) {tooltip.appendMarkdown(`Listens on port${ports.length > 1 ? 's' : ''} ${ports.join(', ')}`);}
        item.tooltip = tooltip;
        item.command = { title: 'Open script', command: 'wlyNvmrc.scripts.open', arguments: [{ kind: 'script', project, script, command }] };
        return item;
    }

    dispose(): void {this.disposables.forEach((disposable) => disposable.dispose());}
}
