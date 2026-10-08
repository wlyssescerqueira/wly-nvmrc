import * as vscode from 'vscode';
import { NvmrcController } from './controller';
import { registerCommands } from './commands/index';
import { registerScriptCommands } from './commands/scripts';

export function activate(context: vscode.ExtensionContext): void {
    const controller = new NvmrcController();
    context.subscriptions.push(controller);
    registerCommands(context, controller);
    const scripts = registerScriptCommands(context, controller);

    for (const glob of ['**/.nvmrc', '**/package.json']) {
        const watcher = vscode.workspace.createFileSystemWatcher(glob);
        const onFileEvent = () => {
            void controller.refresh();
            scripts.reload();
        };
        watcher.onDidCreate(onFileEvent);
        watcher.onDidChange(onFileEvent);
        watcher.onDidDelete(onFileEvent);
        context.subscriptions.push(watcher);
    }

    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            void controller.refresh();
            scripts.reload();
        }),
        vscode.window.onDidChangeWindowState((state) => {if (state.focused) {void controller.refresh();}})
    );

    let pollTimer: ReturnType<typeof setInterval> | undefined;
    const restartPolling = () => {
        if (pollTimer) {clearInterval(pollTimer);}
        const seconds = vscode.workspace.getConfiguration('wlyNvmrc').get<number>('pollIntervalSeconds', 15);
        if (seconds > 0) {pollTimer = setInterval(() => void controller.refresh(), seconds * 1000);}
    };
    restartPolling();
    context.subscriptions.push({ dispose: () => pollTimer && clearInterval(pollTimer) });
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('wlyNvmrc.pollIntervalSeconds')) {restartPolling();}
    }));

    void controller.refresh();
    // The first findFiles() right after startup can race VS Code's file
    // index and come back empty on large/slow workspaces. Re-check shortly
    // after so the cached status self-corrects before a user opens the menu.
    const warmupTimer = setTimeout(() => void controller.refresh(), 3000);
    context.subscriptions.push({ dispose: () => clearTimeout(warmupTimer) });
}

export function deactivate(): void { }
