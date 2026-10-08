import * as vscode from 'vscode';
import { NvmrcController } from '../controller';
import { ScriptCatalog, type ScriptNode } from '../services/scriptCatalog';
import { ScriptRunner } from '../services/scriptRunner';
import { revealScript } from '../services/scriptsService';
import { detectScriptPorts, findPortListeners, killProcess, waitForPortsFree } from '../services/portService';
import { isNvmAvailable, useVersion } from '../services/nvmService';
import { log, toast } from '../utils/output';
import type { FooterProject } from '../ui/statusBar';

function setting<T>(name: string, fallback: T): T {
    return vscode.workspace.getConfiguration('wlyNvmrc.scripts').get<T>(name, fallback);
}

/** Returns false when the user cancelled. */
async function ensureNodeVersion(controller: NvmrcController, node: ScriptNode): Promise<boolean> {
    if (!setting('checkNodeVersion', true)) {return true;}
    const status = controller.getStatus();
    if (status.kind !== 'ready') {return true;}
    const dir = process.platform === 'win32' ? node.project.dir.toLowerCase() : node.project.dir;
    const project = status.projects.find((item) => (process.platform === 'win32' ? item.path.toLowerCase() : item.path) === dir);
    if (project?.matches !== false || !project.required) {return true;}

    const switchLabel = `Switch to v${project.required} and run`;
    const choice = await vscode.window.showWarningMessage(
        `${node.project.label} requires Node v${project.required}, but the active version is v${status.current}.`,
        { modal: true }, switchLabel, 'Run anyway'
    );
    if (choice === 'Run anyway') {return true;}
    if (choice !== switchLabel) {return false;}
    if (!(await isNvmAvailable())) {toast('nvm was not found on PATH. Install nvm-windows to switch versions automatically.', 'error'); return false;}
    try {
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Running "nvm use ${project.required}"...` },
            () => useVersion(project.required!)
        );
    } catch (error) {
        toast(`Failed to run "nvm use ${project.required}": ${error instanceof Error ? error.message : String(error)}`, 'error');
        return false;
    }
    await controller.refresh();
    return true;
}

/** Warns about busy ports and offers to kill whatever holds them. Returns false when the user cancelled. */
async function ensurePortsFree(node: ScriptNode): Promise<boolean> {
    if (!setting('checkPorts', true)) {return true;}
    const ports = detectScriptPorts(node.project.dir, node.script);
    if (ports.length === 0) {return true;}
    const listeners = await findPortListeners(ports);
    if (listeners.length === 0) {return true;}

    const summary = listeners.map((item) => `Port ${item.port} — ${item.processName} (PID ${item.pid})`).join('\n');
    const plural = listeners.length > 1;
    const choice = await vscode.window.showWarningMessage(
        `${plural ? 'Ports are' : `Port ${listeners[0].port} is`} already in use. Kill ${plural ? 'them' : 'it'} and start "${node.script}"?`,
        { modal: true, detail: summary }, 'Kill and start', 'Start anyway'
    );
    if (choice === 'Start anyway') {return true;}
    if (choice !== 'Kill and start') {return false;}

    for (const pid of new Set(listeners.map((item) => item.pid))) {
        try {
            await killProcess(pid);
            log(`[scripts] killed PID ${pid} holding ${listeners.filter((item) => item.pid === pid).map((item) => item.port).join(', ')}`);
        } catch (error) {
            toast(`Could not kill PID ${pid}: ${error instanceof Error ? error.message : String(error)}`, 'error');
            return false;
        }
    }
    if (!(await waitForPortsFree(ports))) {
        const retry = await vscode.window.showWarningMessage(`Port ${ports.join(', ')} is still busy after killing the process.`, { modal: true }, 'Start anyway');
        return retry === 'Start anyway';
    }
    return true;
}

/** Stops our own task and gives its server a moment to release the ports. */
async function stopAndSettle(runner: ScriptRunner, node: ScriptNode): Promise<void> {
    await runner.stop(node.project.dir, node.script);
    await waitForPortsFree(detectScriptPorts(node.project.dir, node.script), 3000);
}

async function runScript(controller: NvmrcController, runner: ScriptRunner, node: ScriptNode): Promise<void> {
    if (runner.isRunning(node.project.dir, node.script)) {
        const choice = await vscode.window.showWarningMessage(`"${node.script}" is already running. Restart it?`, { modal: true }, 'Restart');
        if (choice !== 'Restart') {return;}
        await stopAndSettle(runner, node);
    }
    if (!(await ensureNodeVersion(controller, node))) {return;}
    if (!(await ensurePortsFree(node))) {return;}
    await runner.start(node.project, node.script);
}

async function restartScript(runner: ScriptRunner, node: ScriptNode): Promise<void> {
    await stopAndSettle(runner, node);
    if (!(await ensurePortsFree(node))) {return;}
    await runner.start(node.project, node.script);
}

async function pickScript(catalog: ScriptCatalog): Promise<ScriptNode | undefined> {
    const items = (await catalog.getProjects()).flatMap((project) => Object.entries(project.scripts).map(([script, command]) => ({
        label: script, description: project.label, detail: command,
        node: { kind: 'script', project, script, command } as ScriptNode
    })));
    if (items.length === 0) {toast('No package.json scripts found in this workspace.', 'warn'); return undefined;}
    return (await vscode.window.showQuickPick(items, { placeHolder: 'Choose a script to run', matchOnDescription: true, matchOnDetail: true }))?.node;
}

/** Plain-JSON reference used by the status bar's command links. */
type ScriptRef = { dir: string; script: string };

async function resolveScript(catalog: ScriptCatalog, arg: ScriptNode | ScriptRef | undefined): Promise<ScriptNode | undefined> {
    if (!arg) {return pickScript(catalog);}
    if ('project' in arg) {return arg;}
    const project = (await catalog.getProjects()).find((item) => item.dir.toLowerCase() === arg.dir.toLowerCase());
    const command = project?.scripts[arg.script];
    return project && command !== undefined ? { kind: 'script', project, script: arg.script, command } : undefined;
}

/** Mirrors the scripts (servers and running ones) into the status bar menu. */
async function syncFooter(controller: NvmrcController, catalog: ScriptCatalog, runner: ScriptRunner): Promise<void> {
    const projects: FooterProject[] = (await catalog.getProjects()).map((project) => ({
        label: project.label,
        scripts: Object.keys(project.scripts).map((script) => ({
            dir: project.dir, script,
            ports: detectScriptPorts(project.dir, script),
            running: runner.isRunning(project.dir, script)
        })).filter((script) => script.running || script.ports.length > 0)
    })).filter((project) => project.scripts.length > 0);
    controller.statusBar.setScripts(projects);
}

export function registerScriptCommands(context: vscode.ExtensionContext, controller: NvmrcController): ScriptCatalog {
    const runner = new ScriptRunner();
    const catalog = new ScriptCatalog(controller, runner);
    const footer = () => void syncFooter(controller, catalog, runner);
    context.subscriptions.push(
        runner, catalog,
        catalog.onDidChange(footer),
        vscode.commands.registerCommand('wlyNvmrc.scripts.refresh', () => catalog.reload()),
        vscode.commands.registerCommand('wlyNvmrc.scripts.run', async (arg?: ScriptNode | ScriptRef) => {
            const target = await resolveScript(catalog, arg);
            if (target) {await runScript(controller, runner, target);}
        }),
        vscode.commands.registerCommand('wlyNvmrc.scripts.stop', async (arg: ScriptNode | ScriptRef) => {
            const target = await resolveScript(catalog, arg);
            if (target) {await runner.stop(target.project.dir, target.script);}
        }),
        vscode.commands.registerCommand('wlyNvmrc.scripts.restart', async (arg: ScriptNode | ScriptRef) => {
            const target = await resolveScript(catalog, arg);
            if (target) {await restartScript(runner, target);}
        }),
        vscode.commands.registerCommand('wlyNvmrc.scripts.open', async (arg: ScriptNode | ScriptRef) => {
            const target = await resolveScript(catalog, arg);
            if (target) {await revealScript(target.project, target.script);}
        })
    );
    footer();
    return catalog;
}
