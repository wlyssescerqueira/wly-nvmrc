import * as vscode from 'vscode';
import type { NvmrcStatus } from '../types';

/** Process listening on one of the script's ports, and whether it belongs to this workspace. */
export type FooterListener = { port: number; pid: number; processName: string; ours: boolean };
/**
 * - `task` / `debug`: started from this window.
 * - `external`: its ports are held by processes of this workspace started elsewhere (a terminal, another window).
 * - `conflict`: a port is held by a process of another project.
 */
export type FooterState = 'idle' | 'task' | 'debug' | 'external' | 'conflict';
export type FooterScript = { dir: string; script: string; command: string; ports: number[]; state: FooterState; listeners: FooterListener[] };
export type FooterProject = { label: string; scripts: FooterScript[] };

function link(label: string, command: string, args?: unknown, title?: string): string {
    const query = args === undefined ? '' : `?${encodeURIComponent(JSON.stringify(args))}`;
    const hint = title ? ` "${title.replace(/["\\]/g, '\\$&')}"` : '';
    return `[${label}](command:${command}${query}${hint})`;
}

function escape(text: string): string {return text.replace(/[\\`*_[\]<>]/g, '\\$&');}

const STATE_ICONS: Record<FooterState, string> = {
    idle: '$(circle-outline)',
    task: '$(sync~spin)',
    debug: '$(debug-alt)',
    external: '$(pass-filled)',
    conflict: '$(warning)'
};

const LEGEND: Record<Exclude<FooterState, 'idle'>, string> = {
    task: 'running here',
    debug: 'debugging here',
    external: 'running outside this window (this project)',
    conflict: 'port used by another project'
};

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

function listenerText(listeners: FooterListener[]): string {
    return listeners.map((item) => `:${item.port} ${item.processName} #${item.pid}`).join(', ');
}

function scriptEntry(item: FooterScript): string {
    const ref = { dir: item.dir, script: item.script };
    const ports = item.ports.length ? ` \`${item.ports.map((port) => `:${port}`).join(' ')}\`` : '';
    const name = link(`**${escape(item.script)}**`, 'wlyNvmrc.scripts.open', [ref], item.command);
    const run = link('$(play)', 'wlyNvmrc.scripts.run', [ref], `Run "${item.script}"`);
    const debug = link('$(debug)', 'wlyNvmrc.scripts.debug', [ref], `Debug "${item.script}"`);
    const kill = (listeners: FooterListener[]) => link('$(close)', 'wlyNvmrc.scripts.kill', [ref], `Kill ${listenerText(listeners)}`);
    const head = `${STATE_ICONS[item.state]} ${name}${ports}`;
    switch (item.state) {
        case 'task':
        case 'debug':
            return `${head} ${link('$(debug-restart)', 'wlyNvmrc.scripts.restart', [ref], 'Restart')} ${link('$(debug-stop)', 'wlyNvmrc.scripts.stop', [ref], 'Stop')}`;
        case 'external':
            return `${head} *${escape(listenerText(item.listeners))}* ${kill(item.listeners)}`;
        case 'conflict': {
            const others = item.listeners.filter((listener) => !listener.ours);
            return `${head} *${escape(listenerText(others))}* ${debug} ${run} ${kill(item.listeners)}`;
        }
        default:
            return `${head} ${debug} ${run}`;
    }
}

function scriptsSection(projects: FooterProject[]): string {
    const entries: string[] = [];
    const multiple = projects.length > 1;
    projects.forEach((project, index) => {
        if (multiple) {
            if (index > 0) {entries.push('---');}
            entries.push(`$(json) **${escape(project.label)}**`);
        }
        project.scripts.forEach((item) => entries.push(scriptEntry(item)));
    });
    entries.push(link('$(list-unordered) Run another script…', 'wlyNvmrc.scripts.run'));
    const states = new Set(projects.flatMap((project) => project.scripts.map((item) => item.state)));
    const legend = (Object.keys(LEGEND) as (keyof typeof LEGEND)[])
        .filter((state) => states.has(state))
        .map((state) => `${STATE_ICONS[state]} ${LEGEND[state]}`);
    if (legend.length) {entries.push(`*${legend.join(' · ')}*`);}
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
        const running = this.scripts.flatMap((project) => project.scripts).filter((script) => script.state === 'task' || script.state === 'debug').length;
        if (running > 0) {this.item.text += ` · $(play) ${running}`;}
        this.item.tooltip = buildTooltip(status, this.scripts);
        this.item.show();
    }

    dispose(): void {this.item.dispose();}
}
