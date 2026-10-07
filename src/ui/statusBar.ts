import * as vscode from 'vscode';
import type { NvmrcStatus } from '../types';

export type FooterScript = { dir: string; script: string; ports: number[]; running: boolean };
export type FooterProject = { label: string; scripts: FooterScript[] };

function link(label: string, command: string, args?: unknown): string {
    const query = args === undefined ? '' : `?${encodeURIComponent(JSON.stringify(args))}`;
    return `[${label}](command:${command}${query})`;
}

/** Each menu entry is its own paragraph so the hover lays them out as a vertical list. */
function section(title: string, entries: string[]): string {
    return [title, ...entries].join('\n\n');
}

function statusSection(status: NvmrcStatus): string {
    const lines: string[] = [];
    if (status.kind === 'node-not-found') {
        lines.push('$(circle-slash) **Node.js not found**');
    } else if (status.kind === 'ready') {
        lines.push(`$(versions) **Node v${status.current}**`);
    }
    const rows = status.projects.map((project) => {
        const required = !project.required ? 'missing' : project.source === 'engines' ? `v${project.required} (engines)` : `v${project.required}`;
        const state = project.matches === true ? '$(check) match' : project.matches === false ? '$(error) mismatch' : '$(warning) —';
        return `| ${project.name} | ${required} | ${state} |`;
    });
    lines.push(['| Project | Required | Status |', '|---|---|---|', ...rows].join('\n'));
    return lines.join('\n\n');
}

function scriptsSection(projects: FooterProject[]): string {
    const entries: string[] = [];
    const multiple = projects.length > 1;
    for (const project of projects) {
        if (multiple) {entries.push(`$(json) \`${project.label}\``);}
        for (const item of project.scripts) {
            const ref = { dir: item.dir, script: item.script };
            const ports = item.ports.length ? ` \`${item.ports.map((port) => `:${port}`).join(' ')}\`` : '';
            entries.push(item.running
                ? `$(sync~spin) **${item.script}**${ports} — ${link('$(debug-restart) Restart', 'wlyNvmrc.scripts.restart', [ref])} · ${link('$(debug-stop) Stop', 'wlyNvmrc.scripts.stop', [ref])}`
                : `${link(`$(play) ${item.script}`, 'wlyNvmrc.scripts.run', [ref])}${ports}`);
        }
    }
    entries.push(link('$(list-unordered) Run another script…', 'wlyNvmrc.scripts.run'));
    return section('$(tools) **Scripts**', entries);
}

function nodeSection(status: NvmrcStatus): string {
    const entries = [
        link('$(sync) Switch to .nvmrc version (nvm use)', 'wlyNvmrc.useRequiredVersion'),
        link('$(cloud-download) Install .nvmrc version (nvm install)', 'wlyNvmrc.installRequiredVersion')
    ];
    const missing = status.projects.some((project) => project.source !== 'nvmrc');
    const existing = status.projects.some((project) => project.source === 'nvmrc');
    if (missing) {entries.push(link('$(add) Create .nvmrc', 'wlyNvmrc.createNvmrc'));}
    if (existing) {entries.push(link('$(go-to-file) Open .nvmrc', 'wlyNvmrc.openNvmrcFile'));}
    entries.push(link('$(list-selection) Manage projects…', 'wlyNvmrc.openMenu'));
    return section('$(versions) **Node Version**', entries);
}

function settingsSection(): string {
    return section('$(gear) **Settings**', [
        link('$(refresh) Refresh', 'wlyNvmrc.refresh'),
        link('$(settings-gear) Settings', 'workbench.action.openSettings', ['wlyNvmrc'])
    ]);
}

function buildTooltip(status: NvmrcStatus, scripts: FooterProject[]): vscode.MarkdownString {
    const tooltip = new vscode.MarkdownString(
        [statusSection(status), scriptsSection(scripts), nodeSection(status), settingsSection()].join('\n\n---\n\n'),
        true
    );
    tooltip.isTrusted = true;
    return tooltip;
}

export class NvmrcStatusBar {
    private readonly item: vscode.StatusBarItem;
    private status: NvmrcStatus = { kind: 'not-node-project', projects: [] };
    private scripts: FooterProject[] = [];

    constructor() {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.item.command = 'wlyNvmrc.openMenu';
    }

    update(status: NvmrcStatus): void {
        this.status = status;
        this.render();
    }

    setScripts(scripts: FooterProject[]): void {
        this.scripts = scripts;
        this.render();
    }

    private render(): void {
        const status = this.status;
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
        const running = this.scripts.flatMap((project) => project.scripts).filter((script) => script.running).length;
        if (running > 0) {this.item.text += ` · $(play) ${running}`;}
        this.item.tooltip = buildTooltip(status, this.scripts);
        this.item.show();
    }

    dispose(): void {this.item.dispose();}
}
