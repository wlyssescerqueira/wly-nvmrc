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
        toast('Could not detect the active Node version to suggest for .nvmrc.', 'warn');
        return;
    }

    const version = await vscode.window.showInputBox({
        title: 'Create .nvmrc',
        prompt: 'Node version to pin for this project',
        value: suggested,
        ignoreFocusOut: true
    });
    if (!version) {return;}

    writeNvmrc(version.trim());
    toast(`.nvmrc created with version ${version.trim()}.`);
    await openNvmrcFile();
    await controller.refresh();
}

async function openNvmrcFile(): Promise<void> {
    if (!nvmrcExists()) {
        toast('No .nvmrc file found in this project.', 'warn');
        return;
    }
    const doc = await vscode.workspace.openTextDocument(pathNvmrc);
    await vscode.window.showTextDocument(doc);
}

async function requireNvm(): Promise<boolean> {
    if (await isNvmAvailable()) {return true;}
    toast('nvm was not found on PATH. Install nvm-windows to switch versions automatically.', 'error');
    return false;
}

async function useRequiredVersion(controller: NvmrcController): Promise<void> {
    const status = controller.getStatus();
    if (status.kind !== 'mismatch' && status.kind !== 'match') {
        toast('No version required by .nvmrc to use.', 'warn');
        return;
    }
    if (!(await requireNvm())) {return;}

    const required = status.required;
    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Running "nvm use ${required}"...` },
        async () => {
            try {
                await useVersion(required);
                toast(`Node v${required} activated via nvm.`);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const choice = await vscode.window.showErrorMessage(
                    `Failed to run "nvm use ${required}": ${message}`,
                    'Install via nvm'
                );
                if (choice === 'Install via nvm') {await installRequiredVersion(controller);}
                return;
            }
        }
    );
    await controller.refresh();
}

async function installRequiredVersion(controller: NvmrcController): Promise<void> {
    const status = controller.getStatus();
    if (status.kind !== 'mismatch' && status.kind !== 'match') {
        toast('No version required by .nvmrc to install.', 'warn');
        return;
    }
    if (!(await requireNvm())) {return;}

    const required = status.required;
    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Running "nvm install ${required}"...` },
        async () => {
            try {
                await installVersion(required);
                toast(`Node v${required} installed via nvm.`);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                toast(`Failed to run "nvm install ${required}": ${message}`, 'error');
                return;
            }
        }
    );

    const choice = await vscode.window.showInformationMessage(`Use v${required} now?`, 'Use via nvm');
    if (choice === 'Use via nvm') {await useRequiredVersion(controller);}
    else {await controller.refresh();}
}

async function openMenu(controller: NvmrcController): Promise<void> {
    const status = controller.getStatus();
    type Pick = { label: string; description?: string; action: () => Promise<void> };
    const picks: Pick[] = [];

    if (status.kind === 'no-nvmrc') {
        picks.push({
            label: '$(add) Create .nvmrc with the current version',
            description: `v${status.current}`,
            action: () => createNvmrc(controller)
        });
    }

    if (status.kind === 'mismatch') {
        picks.push({
            label: `$(sync) Use v${status.required} (nvm use)`,
            action: () => useRequiredVersion(controller)
        });
        picks.push({
            label: `$(cloud-download) Install v${status.required} (nvm install)`,
            action: () => installRequiredVersion(controller)
        });
    }

    if (status.kind === 'match' || status.kind === 'mismatch') {
        picks.push({ label: '$(go-to-file) Open .nvmrc', action: () => openNvmrcFile() });
    }

    if (status.kind === 'node-not-found') {
        picks.push({
            label: '$(info) Node.js not found on PATH',
            description: 'install Node (or nvm) and try again',
            action: async () => undefined
        });
    }

    picks.push({ label: '$(refresh) Refresh status', action: () => controller.refresh() });

    const selection = await vscode.window.showQuickPick(picks, {
        placeHolder: 'Wly Nvmrc - choose an action',
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
