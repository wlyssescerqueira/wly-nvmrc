import * as vscode from 'vscode';
import { computeStatus } from './services/statusService';
import { NvmrcStatusBar } from './ui/statusBar';
import type { NvmrcStatus } from './types';

export class NvmrcController {
    readonly statusBar = new NvmrcStatusBar();
    private status: NvmrcStatus = { kind: 'not-node-project', projects: [] };
    private notifiedMismatchKeys = new Set<string>();

    getStatus(): NvmrcStatus {return this.status;}

    async refresh(): Promise<void> {
        this.status = await computeStatus();
        this.statusBar.update(this.status);
        this.maybeNotify();
    }

    private maybeNotify(): void {
        const notify = vscode.workspace.getConfiguration('wlyNvmrc').get<boolean>('notifyOnMismatch', true);
        if (!notify || this.status.kind !== 'ready') {return;}

        const mismatches = this.status.projects.filter((project) => project.matches === false);
        const liveKeys = new Set(mismatches.map((project) => `${project.path}:${this.status.kind === 'ready' ? this.status.current : ''}=>${project.required}`));
        this.notifiedMismatchKeys = new Set([...this.notifiedMismatchKeys].filter((key) => liveKeys.has(key)));

        for (const project of mismatches) {
            const key = `${project.path}:${this.status.current}=>${project.required}`;
            if (this.notifiedMismatchKeys.has(key)) {continue;}
            this.notifiedMismatchKeys.add(key);
            void vscode.window.showWarningMessage(
                `${project.name}: active Node v${this.status.current} does not match ${project.source === 'engines' ? 'package.json engines' : '.nvmrc'} v${project.required}.`,
                'Open menu', 'Ignore'
            ).then((choice) => {
                if (choice === 'Open menu') {void vscode.commands.executeCommand('wlyNvmrc.openMenu');}
            });
        }
    }

    dispose(): void {this.statusBar.dispose();}
}
