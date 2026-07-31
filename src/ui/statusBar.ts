import * as vscode from 'vscode';
import type { NvmrcStatus } from '../types';

const link = (label: string, command: string): string => `[${label}](command:${command})`;
const DIVIDER = '\n\n---\n\n';

function versionTable(rows: [string, string][]): string {
    const body = rows.map(([label, value]) => `| ${label} | ${value} |`).join('\n');
    return `| | |\n|---|---|\n${body}`;
}

function buildTooltip(status: NvmrcStatus): vscode.MarkdownString {
    const tooltip = new vscode.MarkdownString();
    tooltip.isTrusted = true;
    tooltip.supportThemeIcons = true;

    switch (status.kind) {
        case 'not-node-project':
            tooltip.appendMarkdown('$(circle-slash) No Node project detected in this workspace.');
            break;

        case 'node-not-found':
            tooltip.appendMarkdown('$(circle-slash) **Node.js not found**\n\nNode.js was not found on PATH.');
            break;

        case 'no-nvmrc':
            tooltip.appendMarkdown(link(`Create .nvmrc with v${status.current}`, 'wlyNvmrc.createNvmrc'));
            tooltip.appendMarkdown(
                `${DIVIDER}${versionTable([
                    ['Active Node', `$(check) v${status.current}`],
                    ['.nvmrc', '$(warning) Not found']
                ])}`
            );
            break;

        case 'match':
            tooltip.appendMarkdown(
                versionTable([
                    ['Active Node', `$(check) v${status.current}`],
                    ['.nvmrc requires', `v${status.required}`]
                ])
            );
            tooltip.appendMarkdown(`${DIVIDER}${link('Open .nvmrc', 'wlyNvmrc.openNvmrcFile')}`);
            break;

        case 'mismatch':
            tooltip.appendMarkdown(link(`Switch to v${status.required} now (nvm use)`, 'wlyNvmrc.useRequiredVersion'));
            tooltip.appendMarkdown(
                `${DIVIDER}${versionTable([
                    ['Active Node', `$(error) v${status.current}`],
                    ['.nvmrc requires', `v${status.required}`]
                ])}`
            );
            tooltip.appendMarkdown(
                `${DIVIDER}${link(`Install v${status.required} via nvm`, 'wlyNvmrc.installRequiredVersion')}\n${link('Open .nvmrc', 'wlyNvmrc.openNvmrcFile')}`
            );
            break;
    }

    return tooltip;
}

export class NvmrcStatusBar {
    private readonly item: vscode.StatusBarItem;

    constructor() {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.item.command = 'wlyNvmrc.openMenu';
    }

    update(status: NvmrcStatus): void {
        switch (status.kind) {
            case 'not-node-project':
                this.item.hide();
                return;

            case 'node-not-found':
                this.item.text = '$(circle-slash) Node not found';
                this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                break;

            case 'no-nvmrc':
                this.item.text = '$(warning) .nvmrc missing';
                this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                break;

            case 'match':
                this.item.text = `$(check) Node v${status.current}`;
                this.item.backgroundColor = undefined;
                break;

            case 'mismatch':
                this.item.text = `$(alert) Node v${status.current} ≠ v${status.required}`;
                this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                break;
        }

        this.item.tooltip = buildTooltip(status);
        this.item.show();
    }

    dispose(): void {
        this.item.dispose();
    }
}
