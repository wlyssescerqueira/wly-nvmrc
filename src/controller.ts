import * as vscode from 'vscode';
import { computeStatus } from './services/statusService';
import { NvmrcStatusBar } from './ui/statusBar';
import type { NvmrcStatus } from './types';

export class NvmrcController {
    readonly statusBar = new NvmrcStatusBar();
    private status: NvmrcStatus = { kind: 'not-node-project', projects: [] };
    private readonly changed = new vscode.EventEmitter<void>();
    /** Fires only when the computed status actually differs from the previous one. */
    readonly onDidChange = this.changed.event;

    getStatus(): NvmrcStatus {return this.status;}

    async refresh(): Promise<void> {
        const previous = JSON.stringify(this.status);
        this.status = await computeStatus();
        this.statusBar.update(this.status);
        if (JSON.stringify(this.status) !== previous) {this.changed.fire();}
    }

    dispose(): void {
        this.statusBar.dispose();
        this.changed.dispose();
    }
}
