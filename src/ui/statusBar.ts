import * as vscode from 'vscode';
import type { NvmrcStatus } from '../types';

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
                this.item.text = '$(circle-slash) Node não encontrado';
                this.item.tooltip = 'Node.js não foi encontrado no PATH. Clique para ver as opções.';
                this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                break;

            case 'no-nvmrc':
                this.item.text = '$(warning) .nvmrc ausente';
                this.item.tooltip = `Nenhum .nvmrc neste projeto (Node ativo: v${status.current}). Clique para criar.`;
                this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                break;

            case 'match':
                this.item.text = `$(check) Node v${status.current}`;
                this.item.tooltip = `Versão do Node compatível com .nvmrc (requer ${status.required}).`;
                this.item.backgroundColor = undefined;
                break;

            case 'mismatch':
                this.item.text = `$(alert) Node v${status.current} ≠ v${status.required}`;
                this.item.tooltip = `Versão ativa (v${status.current}) diverge do .nvmrc (v${status.required}). Clique para trocar via nvm.`;
                this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                break;
        }

        this.item.show();
    }

    dispose(): void {
        this.item.dispose();
    }
}
