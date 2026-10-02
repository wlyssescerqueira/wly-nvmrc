import * as vscode from 'vscode';
import * as path from 'path';
import { NvmrcController } from '../controller';
import { writeNvmrc } from '../services/nvmrcService';
import { getActiveNodeVersion } from '../services/nodeVersionService';
import { isNvmAvailable, useVersion, installVersion } from '../services/nvmService';
import { pathNvmrc } from '../config/paths';
import { toast } from '../utils/output';
import type { ProjectStatus } from '../types';

function requirementLabel(project: ProjectStatus): string {
    if (!project.required) {return '.nvmrc missing';}
    return project.source === 'engines' ? `requires v${project.required} (package.json engines)` : `requires v${project.required}`;
}

function projects(controller: NvmrcController): ProjectStatus[] {return controller.getStatus().projects;}

async function chooseProject(controller: NvmrcController, placeHolder: string): Promise<ProjectStatus | undefined> {
    const available = projects(controller);
    if (available.length === 1) {return available[0];}
    return vscode.window.showQuickPick(
        available.map((project) => ({
            label: project.name,
            description: vscode.workspace.asRelativePath(project.path),
            detail: requirementLabel(project),
            project
        })),
        { placeHolder, ignoreFocusOut: true }
    ).then((picked) => picked?.project);
}

async function createNvmrc(controller: NvmrcController, selected?: ProjectStatus): Promise<void> {
    const project = selected ?? await chooseProject(controller, 'Choose the project that will receive .nvmrc');
    if (!project) {return;}
    const status = controller.getStatus();
    const suggested = project.required ?? (status.kind === 'ready' ? status.current : await getActiveNodeVersion());
    if (!suggested) {toast('Could not detect the active Node version to suggest for .nvmrc.', 'warn'); return;}
    const version = await vscode.window.showInputBox({
        title: `Create .nvmrc — ${project.name}`,
        prompt: 'Node version to pin for this project', value: suggested, ignoreFocusOut: true
    });
    if (!version) {return;}
    writeNvmrc(project.path, version.trim());
    toast(`${project.name}: .nvmrc created with version ${version.trim()}.`);
    await openNvmrcFile(controller, project);
    await controller.refresh();
}

async function openNvmrcFile(controller: NvmrcController, selected?: ProjectStatus): Promise<void> {
    const candidates = projects(controller).filter((project) => project.source === 'nvmrc');
    const project = selected ?? (candidates.length === 1 ? candidates[0] : await chooseProject(controller, 'Choose a project'));
    if (project?.source !== 'nvmrc') {toast('No .nvmrc file found for this project.', 'warn'); return;}
    const doc = await vscode.workspace.openTextDocument(pathNvmrc(project.path));
    await vscode.window.showTextDocument(doc);
}

async function requireNvm(): Promise<boolean> {
    if (await isNvmAvailable()) {return true;}
    toast('nvm was not found on PATH. Install nvm-windows to switch versions automatically.', 'error');
    return false;
}

async function useRequiredVersion(controller: NvmrcController, selected?: ProjectStatus): Promise<void> {
    const project = selected ?? await chooseProject(controller, 'Choose the project version to activate');
    if (!project?.required) {toast('No version required by .nvmrc or package.json engines to use.', 'warn'); return;}
    if (!(await requireNvm())) {return;}
    try {
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `${project.name}: running "nvm use ${project.required}"...` },
            () => useVersion(project.required!)
        );
        toast(`Node v${project.required} activated for ${project.name}.`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const choice = await vscode.window.showErrorMessage(`Failed to run "nvm use ${project.required}": ${message}`, 'Install via nvm');
        if (choice === 'Install via nvm') {await installRequiredVersion(controller, project);}
    }
    await controller.refresh();
}

async function installRequiredVersion(controller: NvmrcController, selected?: ProjectStatus): Promise<void> {
    const project = selected ?? await chooseProject(controller, 'Choose the project version to install');
    if (!project?.required) {toast('No version required by .nvmrc or package.json engines to install.', 'warn'); return;}
    if (!(await requireNvm())) {return;}
    try {
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `${project.name}: running "nvm install ${project.required}"...` },
            () => installVersion(project.required!)
        );
        toast(`Node v${project.required} installed.`);
    } catch (error) {
        toast(`Failed to run "nvm install ${project.required}": ${error instanceof Error ? error.message : String(error)}`, 'error');
        return;
    }
    const choice = await vscode.window.showInformationMessage(`Use v${project.required} for ${project.name} now?`, 'Use via nvm');
    if (choice === 'Use via nvm') {await useRequiredVersion(controller, project);}
    else {await controller.refresh();}
}

async function openProjectMenu(controller: NvmrcController, project: ProjectStatus): Promise<void> {
    type Pick = { label: string; action: () => Promise<void> };
    const picks: Pick[] = [];
    if (!project.required) {
        picks.push({ label: '$(add) Create .nvmrc with the current version', action: () => createNvmrc(controller, project) });
    } else {
        picks.push({ label: `$(sync) Use v${project.required} (nvm use)`, action: () => useRequiredVersion(controller, project) });
        picks.push({ label: `$(cloud-download) Install v${project.required} (nvm install)`, action: () => installRequiredVersion(controller, project) });
        picks.push(project.source === 'nvmrc'
            ? { label: '$(go-to-file) Open .nvmrc', action: () => openNvmrcFile(controller, project) }
            : { label: `$(add) Create .nvmrc with v${project.required} (from engines)`, action: () => createNvmrc(controller, project) });
    }
    const selection = await vscode.window.showQuickPick(picks, {
        title: project.name,
        placeHolder: vscode.workspace.asRelativePath(project.path), ignoreFocusOut: true
    });
    if (selection) {await selection.action();}
}

async function openMenu(controller: NvmrcController): Promise<void> {
    const status = controller.getStatus();
    if (status.kind === 'not-node-project') {toast('No Node project detected in this workspace.', 'warn'); return;}
    const picks = status.projects.map((project) => ({
        label: project.matches === false ? `$(error) ${project.name}` : project.required ? `$(check) ${project.name}` : `$(warning) ${project.name}`,
        description: requirementLabel(project),
        detail: path.normalize(project.path), project
    }));
    const selection = await vscode.window.showQuickPick(picks, {
        placeHolder: 'Choose a Node project to manage', ignoreFocusOut: true
    });
    if (selection) {await openProjectMenu(controller, selection.project);}
}

export function registerCommands(context: vscode.ExtensionContext, controller: NvmrcController): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('wlyNvmrc.refresh', () => controller.refresh()),
        vscode.commands.registerCommand('wlyNvmrc.openMenu', () => openMenu(controller)),
        vscode.commands.registerCommand('wlyNvmrc.createNvmrc', () => createNvmrc(controller)),
        vscode.commands.registerCommand('wlyNvmrc.openNvmrcFile', () => openNvmrcFile(controller)),
        vscode.commands.registerCommand('wlyNvmrc.useRequiredVersion', () => useRequiredVersion(controller)),
        vscode.commands.registerCommand('wlyNvmrc.installRequiredVersion', () => installRequiredVersion(controller))
    );
}
