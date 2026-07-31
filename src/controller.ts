import * as vscode from 'vscode';
import { computeStatus } from './services/statusService';
import { NvmrcStatusBar } from './ui/statusBar';
import { NvmrcWebviewProvider } from './ui/webviewProvider';
import type { NvmrcStatus } from './types';

export class NvmrcController {
    readonly statusBar = new NvmrcStatusBar();
    readonly webviewProvider = new NvmrcWebviewProvider();

    private status: NvmrcStatus = { kind: 'not-node-project' };
    private notifiedMismatchKey: string | null = null;

    getStatus(): NvmrcStatus {
        return this.status;
    }

    async refresh(): Promise<void> {
        this.status = await computeStatus();
        this.statusBar.update(this.status);
        this.webviewProvider.update(this.status);
        this.maybeNotify();
    }

    private maybeNotify(): void {
        const notify = vscode.workspace.getConfiguration('wlyNvmrc').get<boolean>('notifyOnMismatch', true);

        if (this.status.kind !== 'mismatch') {
            this.notifiedMismatchKey = null;
            return;
        }
        if (!notify) {return;}

        const key = `${this.status.current}=>${this.status.required}`;
        if (this.notifiedMismatchKey === key) {return;}
        this.notifiedMismatchKey = key;

        const { current, required } = this.status;
        vscode.window
            .showWarningMessage(`Active Node (v${current}) does not match .nvmrc (v${required}).`, 'Switch via nvm', 'Ignore')
            .then((choice) => {
                if (choice === 'Switch via nvm') {void vscode.commands.executeCommand('wlyNvmrc.useRequiredVersion');}
            });
    }

    dispose(): void {
        this.statusBar.dispose();
    }
}
