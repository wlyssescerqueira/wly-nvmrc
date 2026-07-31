import * as vscode from 'vscode';
import type { NvmrcStatus } from '../types';

type TreeNode =
    | { kind: 'info'; id: string; label: string; description?: string; icon: string }
    | { kind: 'action'; id: string; label: string; description?: string; icon: string; command: string };

function buildNodes(status: NvmrcStatus): TreeNode[] {
    switch (status.kind) {
        case 'not-node-project':
            return [
                { kind: 'info', id: 'info', label: 'Nenhum projeto Node detectado', icon: 'circle-slash' }
            ];

        case 'node-not-found':
            return [
                { kind: 'info', id: 'status', label: 'Node.js não encontrado no PATH', icon: 'circle-slash' },
                ...(status.required
                    ? [{ kind: 'info', id: 'required', label: `.nvmrc pede v${status.required}`, icon: 'file' } as TreeNode]
                    : [{ kind: 'info', id: 'required', label: '.nvmrc não encontrado', icon: 'file' } as TreeNode]),
                { kind: 'action', id: 'refresh', label: 'Atualizar status', icon: 'refresh', command: 'wlyNvmrc.refresh' }
            ];

        case 'no-nvmrc':
            return [
                { kind: 'info', id: 'current', label: `Node atual: v${status.current}`, icon: 'check' },
                { kind: 'info', id: 'nvmrc', label: '.nvmrc: não encontrado', icon: 'warning' },
                {
                    kind: 'action',
                    id: 'create',
                    label: `Criar .nvmrc com v${status.current}`,
                    description: 'mantém o padrão do projeto',
                    icon: 'add',
                    command: 'wlyNvmrc.createNvmrc'
                },
                { kind: 'action', id: 'refresh', label: 'Atualizar status', icon: 'refresh', command: 'wlyNvmrc.refresh' }
            ];

        case 'match':
            return [
                { kind: 'info', id: 'current', label: `Node atual: v${status.current}`, icon: 'check' },
                { kind: 'info', id: 'nvmrc', label: `.nvmrc: v${status.required}`, icon: 'file' },
                { kind: 'info', id: 'status', label: 'Versões compatíveis', icon: 'pass-filled' },
                { kind: 'action', id: 'open', label: 'Abrir .nvmrc', icon: 'go-to-file', command: 'wlyNvmrc.openNvmrcFile' },
                { kind: 'action', id: 'refresh', label: 'Atualizar status', icon: 'refresh', command: 'wlyNvmrc.refresh' }
            ];

        case 'mismatch':
            return [
                { kind: 'info', id: 'current', label: `Node atual: v${status.current}`, icon: 'alert' },
                { kind: 'info', id: 'nvmrc', label: `.nvmrc pede: v${status.required}`, icon: 'file' },
                {
                    kind: 'action',
                    id: 'use',
                    label: `Usar v${status.required} (nvm use)`,
                    icon: 'sync',
                    command: 'wlyNvmrc.useRequiredVersion'
                },
                {
                    kind: 'action',
                    id: 'install',
                    label: `Instalar v${status.required} (nvm install)`,
                    icon: 'cloud-download',
                    command: 'wlyNvmrc.installRequiredVersion'
                },
                { kind: 'action', id: 'open', label: 'Abrir .nvmrc', icon: 'go-to-file', command: 'wlyNvmrc.openNvmrcFile' },
                { kind: 'action', id: 'refresh', label: 'Atualizar status', icon: 'refresh', command: 'wlyNvmrc.refresh' }
            ];
    }
}

export class NvmrcSidebarProvider implements vscode.TreeDataProvider<TreeNode> {
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    private status: NvmrcStatus = { kind: 'not-node-project' };

    update(status: NvmrcStatus): void {
        this.status = status;
        this.onDidChangeTreeDataEmitter.fire();
    }

    getTreeItem(element: TreeNode): vscode.TreeItem {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon(element.icon);
        if (element.description) {item.description = element.description;}
        if (element.kind === 'action') {
            item.command = { command: element.command, title: element.label };
        }
        return item;
    }

    getChildren(element?: TreeNode): TreeNode[] {
        if (element) {return [];}
        return buildNodes(this.status);
    }
}
