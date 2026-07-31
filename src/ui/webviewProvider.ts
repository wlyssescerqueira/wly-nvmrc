import * as vscode from 'vscode';
import type { NvmrcStatus } from '../types';

type WebviewMessage =
    | { type: 'runCommand'; command: string }
    | { type: 'toggleNotify' }
    | { type: 'togglePolling' };

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function nonce(): string {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {text += chars.charAt(Math.floor(Math.random() * chars.length));}
    return text;
}

function row(label: string, value: string, linkLabel?: string, linkMessage?: string): string {
    const link = linkLabel && linkMessage
        ? `<a href="#" class="row-link" data-message='${escapeHtml(linkMessage)}'>${escapeHtml(linkLabel)}</a>`
        : '';
    return `
        <div class="row">
            <span class="row-label">${escapeHtml(label)}</span>
            <span class="row-value">${escapeHtml(value)}${link ? ` &middot; ${link}` : ''}</span>
        </div>`;
}

function metricSection(status: NvmrcStatus): string {
    if (status.kind === 'not-node-project') {
        return `<div class="metric"><div class="metric-caption">No Node project detected in this workspace.</div></div>`;
    }
    if (status.kind === 'node-not-found') {
        return `
            <div class="metric">
                <div class="metric-row"><span>Active Node</span><span class="value">not found</span></div>
                <div class="bar"><div class="bar-fill state-error" style="width:100%"></div></div>
                <div class="metric-caption">Node.js was not found on PATH.</div>
            </div>`;
    }
    if (status.kind === 'no-nvmrc') {
        return `
            <div class="metric">
                <div class="metric-row"><span>Active Node</span><span class="value">v${escapeHtml(status.current)}</span></div>
                <div class="bar"><div class="bar-fill state-neutral" style="width:100%"></div></div>
                <div class="metric-caption">No .nvmrc in this project yet.</div>
            </div>`;
    }
    if (status.kind === 'match') {
        return `
            <div class="metric">
                <div class="metric-row"><span>Active Node</span><span class="value">v${escapeHtml(status.current)}</span></div>
                <div class="bar"><div class="bar-fill state-ok" style="width:100%"></div></div>
                <div class="metric-caption">Matches .nvmrc (v${escapeHtml(status.required)}).</div>
            </div>`;
    }
    return `
        <div class="metric">
            <div class="metric-row"><span>Active Node</span><span class="value">v${escapeHtml(status.current)}</span></div>
            <div class="bar"><div class="bar-fill state-error" style="width:45%"></div></div>
            <div class="metric-caption">Requires v${escapeHtml(status.required)} from .nvmrc.</div>
        </div>`;
}

function actionRows(status: NvmrcStatus, notifyEnabled: boolean, pollSeconds: number): string {
    const rows: string[] = [];

    if (status.kind === 'no-nvmrc') {
        rows.push(row('.nvmrc', 'Missing', 'Create?', JSON.stringify({ type: 'runCommand', command: 'wlyNvmrc.createNvmrc' })));
    } else if (status.kind === 'match' || status.kind === 'mismatch') {
        rows.push(row('.nvmrc', `Found (v${status.required})`, 'Open', JSON.stringify({ type: 'runCommand', command: 'wlyNvmrc.openNvmrcFile' })));
    }

    if (status.kind === 'mismatch') {
        rows.push(row('nvm use', `Switch to v${status.required}`, 'Run', JSON.stringify({ type: 'runCommand', command: 'wlyNvmrc.useRequiredVersion' })));
        rows.push(row('nvm install', `Install v${status.required}`, 'Run', JSON.stringify({ type: 'runCommand', command: 'wlyNvmrc.installRequiredVersion' })));
    }

    rows.push(row('Auto-refresh', pollSeconds > 0 ? `Every ${pollSeconds}s` : 'Disabled', pollSeconds > 0 ? 'Disable?' : 'Enable?', JSON.stringify({ type: 'togglePolling' })));
    rows.push(row('Notify on mismatch', notifyEnabled ? 'Enabled' : 'Disabled', notifyEnabled ? 'Disable?' : 'Enable?', JSON.stringify({ type: 'toggleNotify' })));

    return rows.join('');
}

function headerButton(status: NvmrcStatus): { label: string; message: string } {
    if (status.kind === 'mismatch') {
        return { label: 'Fix', message: JSON.stringify({ type: 'runCommand', command: 'wlyNvmrc.openMenu' }) };
    }
    if (status.kind === 'no-nvmrc') {
        return { label: 'Create', message: JSON.stringify({ type: 'runCommand', command: 'wlyNvmrc.createNvmrc' }) };
    }
    return { label: 'Refresh', message: JSON.stringify({ type: 'runCommand', command: 'wlyNvmrc.refresh' }) };
}

function renderHtml(status: NvmrcStatus, cspSource: string): string {
    const csp = `default-src 'none'; img-src ${cspSource}; style-src 'unsafe-inline'; script-src 'nonce-${nonce()}'`;
    const scriptNonce = csp.match(/nonce-(\w+)/)?.[1] ?? '';
    const config = vscode.workspace.getConfiguration('wlyNvmrc');
    const notifyEnabled = config.get<boolean>('notifyOnMismatch', true);
    const pollSeconds = config.get<number>('pollIntervalSeconds', 15);
    const button = headerButton(status);
    const showDetails = status.kind !== 'not-node-project';

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
    body {
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        padding: 0 4px;
        font-size: 12px;
    }
    .header { display: flex; align-items: center; justify-content: space-between; padding: 10px 4px 8px; }
    .title { font-weight: 600; font-size: 13px; }
    button {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none; border-radius: 4px; padding: 3px 10px; cursor: pointer; font-size: 12px;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    hr { border: none; border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,.3)); margin: 6px 0; }
    .metric { padding: 4px 4px 8px; }
    .metric-row { display: flex; justify-content: space-between; font-weight: 600; margin-bottom: 4px; }
    .metric-row .value { font-weight: 700; }
    .bar { height: 4px; border-radius: 2px; background: var(--vscode-progressBar-background, rgba(128,128,128,.25)); overflow: hidden; }
    .bar-fill { height: 100%; }
    .state-ok { background: var(--vscode-testing-iconPassed, #3fb950); }
    .state-error { background: var(--vscode-testing-iconFailed, #f14c4c); }
    .state-neutral { background: var(--vscode-descriptionForeground, #888); }
    .metric-caption { margin-top: 5px; color: var(--vscode-descriptionForeground); }
    .row { display: flex; justify-content: space-between; align-items: center; padding: 5px 4px; }
    .row-label { color: var(--vscode-foreground); }
    .row-value { color: var(--vscode-descriptionForeground); }
    .row-link { color: var(--vscode-textLink-foreground); text-decoration: none; }
    .row-link:hover { text-decoration: underline; }
</style>
</head>
<body>
    <div class="header">
        <span class="title">Wly Nvmrc</span>
        <button id="primary-btn" data-message='${button.message}'>${escapeHtml(button.label)}</button>
    </div>
    <hr>
    ${metricSection(status)}
    ${showDetails ? `<hr>${actionRows(status, notifyEnabled, pollSeconds)}` : ''}
    <script nonce="${scriptNonce}">
        const vscode = acquireVsCodeApi();
        document.addEventListener('click', (event) => {
            const target = event.target.closest('[data-message]');
            if (!target) return;
            event.preventDefault();
            vscode.postMessage(JSON.parse(target.getAttribute('data-message')));
        });
    </script>
</body>
</html>`;
}

export class NvmrcWebviewProvider implements vscode.WebviewViewProvider {
    private view: vscode.WebviewView | undefined;
    private status: NvmrcStatus = { kind: 'not-node-project' };

    resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => this.handleMessage(message));
        this.render();
    }

    update(status: NvmrcStatus): void {
        this.status = status;
        this.render();
    }

    private handleMessage(message: WebviewMessage): void {
        if (message.type === 'runCommand') {
            void vscode.commands.executeCommand(message.command);
            return;
        }

        const config = vscode.workspace.getConfiguration('wlyNvmrc');
        if (message.type === 'toggleNotify') {
            const current = config.get<boolean>('notifyOnMismatch', true);
            void config.update('notifyOnMismatch', !current, vscode.ConfigurationTarget.Global).then(() => this.render());
        } else if (message.type === 'togglePolling') {
            const current = config.get<number>('pollIntervalSeconds', 15);
            void config.update('pollIntervalSeconds', current > 0 ? 0 : 15, vscode.ConfigurationTarget.Global).then(() => this.render());
        }
    }

    private render(): void {
        if (!this.view) {return;}
        this.view.webview.html = renderHtml(this.status, this.view.webview.cspSource);
    }
}
