import * as vscode from 'vscode';
import type { NvmrcStatus } from '../types';

function buildTooltip(status: NvmrcStatus): vscode.MarkdownString {
    const tooltip = new vscode.MarkdownString();
    tooltip.supportThemeIcons = true;
    if (status.kind === 'node-not-found') {
        tooltip.appendMarkdown('$(circle-slash) **Node.js not found**\n\n');
    } else if (status.kind === 'ready') {
        tooltip.appendMarkdown(`**Active Node:** v${status.current}\n\n`);
    }
    tooltip.appendMarkdown('| Project | Required | Status |\n|---|---|---|\n');
    for (const project of status.projects) {
        const required = !project.required ? 'missing' : project.source === 'engines' ? `v${project.required} (engines)` : `v${project.required}`;
        const state = project.matches === true ? '$(check) match' : project.matches === false ? '$(error) mismatch' : '$(warning) —';
        tooltip.appendMarkdown(`| ${project.name} | ${required} | ${state} |\n`);
    }
    tooltip.appendMarkdown('\nClick to manage each project.');
    return tooltip;
}

export class NvmrcStatusBar {
    private readonly item: vscode.StatusBarItem;
    constructor() {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.item.command = 'wlyNvmrc.openMenu';
    }

    update(status: NvmrcStatus): void {
        if (status.kind === 'not-node-project') {this.item.hide(); return;}
        if (status.kind === 'node-not-found') {
            this.item.text = '$(circle-slash) Node not found';
            this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        } else {
            const mismatches = status.projects.filter((project) => project.matches === false).length;
            const missing = status.projects.filter((project) => !project.required).length;
            if (mismatches > 0) {
                this.item.text = `$(alert) Node v${status.current} · ${mismatches} mismatch${mismatches > 1 ? 'es' : ''}`;
                this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
            } else if (missing > 0) {
                this.item.text = `$(warning) ${missing} .nvmrc missing`;
                this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            } else {
                this.item.text = `$(check) Node v${status.current} · ${status.projects.length} project${status.projects.length > 1 ? 's' : ''}`;
                this.item.backgroundColor = undefined;
            }
        }
        this.item.tooltip = buildTooltip(status);
        this.item.show();
    }

    dispose(): void {this.item.dispose();}
}
