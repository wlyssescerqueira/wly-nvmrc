import * as vscode from 'vscode';
import { NvmrcController } from '../controller';
import { writeNvmrc, nvmrcExists } from '../services/nvmrcService';
import { getActiveNodeVersion } from '../services/nodeVersionService';
import { isNvmAvailable, useVersion, installVersion } from '../services/nvmService';
import { pathNvmrc } from '../config/paths';
import { toast } from '../utils/output';

async function createNvmrc(controller: NvmrcController): Promise<void> {
    const status = controller.getStatus();
    const suggested = status.kind === 'no-nvmrc' ? status.current : await getActiveNodeVersion();

    if (!suggested) {
        toast('Não foi possível detectar a versão ativa do Node para sugerir no .nvmrc.', 'warn');
        return;
    }

    const version = await vscode.window.showInputBox({
        title: 'Criar .nvmrc',
        prompt: 'Versão do Node a ser fixada neste projeto',
        value: suggested,
        ignoreFocusOut: true
    });
    if (!version) {return;}

    writeNvmrc(version.trim());
    toast(`.nvmrc criado com a versão ${version.trim()}.`);
    await openNvmrcFile();
    await controller.refresh();
}

async function openNvmrcFile(): Promise<void> {
    if (!nvmrcExists()) {
        toast('Arquivo .nvmrc não encontrado neste projeto.', 'warn');
        return;
    }
    const doc = await vscode.workspace.openTextDocument(pathNvmrc);
    await vscode.window.showTextDocument(doc);
}

async function requireNvm(): Promise<boolean> {
    if (await isNvmAvailable()) {return true;}
    toast('nvm não foi encontrado no PATH. Instale o nvm-windows para trocar de versão automaticamente.', 'error');
    return false;
}

async function useRequiredVersion(controller: NvmrcController): Promise<void> {
    const status = controller.getStatus();
    if (status.kind !== 'mismatch' && status.kind !== 'match') {
        toast('Nenhuma versão requerida pelo .nvmrc para usar.', 'warn');
        return;
    }
    if (!(await requireNvm())) {return;}

    const required = status.required;
    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Executando "nvm use ${required}"...` },
        async () => {
            try {
                await useVersion(required);
                toast(`Node v${required} ativado via nvm.`);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const choice = await vscode.window.showErrorMessage(
                    `Falha ao executar "nvm use ${required}": ${message}`,
                    'Instalar via nvm'
                );
                if (choice === 'Instalar via nvm') {await installRequiredVersion(controller);}
                return;
            }
        }
    );
    await controller.refresh();
}

async function installRequiredVersion(controller: NvmrcController): Promise<void> {
    const status = controller.getStatus();
    if (status.kind !== 'mismatch' && status.kind !== 'match') {
        toast('Nenhuma versão requerida pelo .nvmrc para instalar.', 'warn');
        return;
    }
    if (!(await requireNvm())) {return;}

    const required = status.required;
    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Executando "nvm install ${required}"...` },
        async () => {
            try {
                await installVersion(required);
                toast(`Node v${required} instalado via nvm.`);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                toast(`Falha ao executar "nvm install ${required}": ${message}`, 'error');
                return;
            }
        }
    );

    const choice = await vscode.window.showInformationMessage(`Usar v${required} agora?`, 'Usar via nvm');
    if (choice === 'Usar via nvm') {await useRequiredVersion(controller);}
    else {await controller.refresh();}
}

async function openMenu(controller: NvmrcController): Promise<void> {
    const status = controller.getStatus();
    type Pick = { label: string; description?: string; action: () => Promise<void> };
    const picks: Pick[] = [];

    if (status.kind === 'no-nvmrc') {
        picks.push({
            label: '$(add) Criar .nvmrc com a versão atual',
            description: `v${status.current}`,
            action: () => createNvmrc(controller)
        });
    }

    if (status.kind === 'mismatch') {
        picks.push({
            label: `$(sync) Usar v${status.required} (nvm use)`,
            action: () => useRequiredVersion(controller)
        });
        picks.push({
            label: `$(cloud-download) Instalar v${status.required} (nvm install)`,
            action: () => installRequiredVersion(controller)
        });
    }

    if (status.kind === 'match' || status.kind === 'mismatch') {
        picks.push({ label: '$(go-to-file) Abrir .nvmrc', action: () => openNvmrcFile() });
    }

    if (status.kind === 'node-not-found') {
        picks.push({
            label: '$(info) Node.js não encontrado no PATH',
            description: 'instale o Node (ou nvm) e tente novamente',
            action: async () => undefined
        });
    }

    picks.push({ label: '$(refresh) Atualizar status', action: () => controller.refresh() });

    const selection = await vscode.window.showQuickPick(picks, {
        placeHolder: 'Wly Nvmrc - escolha uma ação',
        ignoreFocusOut: true
    });
    if (selection) {await selection.action();}
}

export function registerCommands(context: vscode.ExtensionContext, controller: NvmrcController): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('wlyNvmrc.refresh', () => controller.refresh()),
        vscode.commands.registerCommand('wlyNvmrc.openMenu', () => openMenu(controller)),
        vscode.commands.registerCommand('wlyNvmrc.createNvmrc', () => createNvmrc(controller)),
        vscode.commands.registerCommand('wlyNvmrc.openNvmrcFile', () => openNvmrcFile()),
        vscode.commands.registerCommand('wlyNvmrc.useRequiredVersion', () => useRequiredVersion(controller)),
        vscode.commands.registerCommand('wlyNvmrc.installRequiredVersion', () => installRequiredVersion(controller))
    );
}
