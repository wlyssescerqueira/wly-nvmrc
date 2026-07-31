import * as vscode from 'vscode';
import { NvmrcController } from './controller';
import { registerCommands } from './commands/index';
import { pathNvmrc } from './config/paths';

export function activate(context: vscode.ExtensionContext): void {
    const controller = new NvmrcController();
    context.subscriptions.push(controller);

    registerCommands(context, controller);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('wlyNvmrc.view', controller.webviewProvider)
    );

    const nvmrcWatcher = vscode.workspace.createFileSystemWatcher(pathNvmrc);
    nvmrcWatcher.onDidCreate(() => controller.refresh());
    nvmrcWatcher.onDidChange(() => controller.refresh());
    nvmrcWatcher.onDidDelete(() => controller.refresh());
    context.subscriptions.push(nvmrcWatcher);

    context.subscriptions.push(
        vscode.window.onDidChangeWindowState((state) => {
            if (state.focused) {void controller.refresh();}
        })
    );

    let pollTimer: ReturnType<typeof setInterval> | undefined;
    const restartPolling = () => {
        if (pollTimer) {clearInterval(pollTimer);}
        const seconds = vscode.workspace.getConfiguration('wlyNvmrc').get<number>('pollIntervalSeconds', 15);
        if (seconds > 0) {
            pollTimer = setInterval(() => void controller.refresh(), seconds * 1000);
        }
    };
    restartPolling();
    context.subscriptions.push({ dispose: () => pollTimer && clearInterval(pollTimer) });

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('wlyNvmrc.pollIntervalSeconds')) {restartPolling();}
        })
    );

    void controller.refresh();
}

export function deactivate(): void { }
