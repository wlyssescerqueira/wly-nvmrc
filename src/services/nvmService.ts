import * as vscode from 'vscode';
import { run } from '../utils/exec';

export async function isNvmAvailable(): Promise<boolean> {
    try {
        // nvm-windows refuses to run from a GUI process without a console and
        // displays a modal "Terminal Only" dialog. Check PATH without starting
        // nvm itself; actual nvm commands run in VS Code's integrated terminal.
        const locator = process.platform === 'win32' ? 'where.exe' : 'which';
        await run(locator, ['nvm']);
        return true;
    } catch {
        return false;
    }
}

async function runNvmInTerminal(args: string[]): Promise<void> {
    const task = new vscode.Task(
        { type: 'wly-nvmrc', command: args[0] },
        vscode.TaskScope.Workspace,
        `nvm ${args.join(' ')}`,
        'Wly Nvmrc',
        new vscode.ShellExecution('nvm', args)
    );
    task.presentationOptions = {
        reveal: vscode.TaskRevealKind.Always,
        panel: vscode.TaskPanelKind.Shared,
        focus: false,
        clear: false
    };

    const execution = await vscode.tasks.executeTask(task);
    await new Promise<void>((resolve, reject) => {
        const processSubscription = vscode.tasks.onDidEndTaskProcess((event) => {
            if (event.execution !== execution) {return;}
            processSubscription.dispose();
            taskSubscription.dispose();
            if (event.exitCode === 0) {
                resolve();
            } else {
                reject(new Error(`nvm exited with code ${event.exitCode ?? 'unknown'}`));
            }
        });
        const taskSubscription = vscode.tasks.onDidEndTask((event) => {
            if (event.execution !== execution) {return;}
            // Some task providers do not emit a process event. Let that event
            // win when available, otherwise avoid leaving the command pending.
            setTimeout(() => {
                processSubscription.dispose();
                taskSubscription.dispose();
                resolve();
            }, 0);
        });
    });
}

export async function useVersion(version: string): Promise<void> {
    await runNvmInTerminal(['use', version]);
}

export async function installVersion(version: string): Promise<void> {
    await runNvmInTerminal(['install', version]);
}
