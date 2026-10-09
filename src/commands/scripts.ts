import * as vscode from 'vscode';
import { NvmrcController } from '../controller';
import { ScriptCatalog, type ScriptNode } from '../services/scriptCatalog';
import { ScriptRunner, type RunMode } from '../services/scriptRunner';
import { revealScript } from '../services/scriptsService';
import { detectScriptPorts, findPortListeners, killProcess, waitForPortsFree } from '../services/portService';
import { isNvmAvailable, useVersion } from '../services/nvmService';
import { log, toast } from '../utils/output';
import type { FooterListener, FooterProject, FooterState } from '../ui/statusBar';

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

async function runScript(controller: NvmrcController, runner: ScriptRunner, node: ScriptNode, mode: RunMode = 'task'): Promise<void> {
    if (runner.isRunning(node.project.dir, node.script)) {
        const choice = await vscode.window.showWarningMessage(`"${node.script}" is already running. Restart it?`, { modal: true }, 'Restart');
        if (choice !== 'Restart') {return;}
        await stopAndSettle(runner, node);
    }
    if (!(await ensureNodeVersion(controller, node))) {return;}
    if (!(await ensurePortsFree(node))) {return;}
    await runner.start(node.project, node.script, mode);
}

/** Restarts in the same mode (task or debug) the script was running in. */
async function restartScript(runner: ScriptRunner, node: ScriptNode): Promise<void> {
    const mode = runner.runningMode(node.project.dir, node.script) ?? 'task';
    await stopAndSettle(runner, node);
    if (!(await ensurePortsFree(node))) {return;}
    await runner.start(node.project, node.script, mode);
}

/** Kills whatever listens on the script's ports (e.g. a server started from a terminal). */
async function killScriptPorts(node: ScriptNode): Promise<void> {
    const listeners = await findPortListeners(detectScriptPorts(node.project.dir, node.script));
    if (listeners.length === 0) {toast(`Nothing is listening on the ports of "${node.script}".`); return;}
    const choice = await vscode.window.showWarningMessage(
        `Kill the process${listeners.length > 1 ? 'es' : ''} using the ports of "${node.script}"?`,
        { modal: true, detail: listeners.map((item) => `Port ${item.port} — ${item.processName} (PID ${item.pid})`).join('\n') }, 'Kill'
    );
    if (choice !== 'Kill') {return;}
    for (const pid of new Set(listeners.map((item) => item.pid))) {
        try {
            await killProcess(pid);
            log(`[scripts] killed PID ${pid}`);
        } catch (error) {
            toast(`Could not kill PID ${pid}: ${error instanceof Error ? error.message : String(error)}`, 'error');
        }
    }
}

function normalizePath(text: string): string {
    let unified = text.replace(/file:\/\/\/?/gi, '').replace(/\\/g, '/');
    try {unified = decodeURIComponent(unified);} catch { /* keep as is */ }
    return process.platform === 'win32' ? unified.toLowerCase() : unified;
}

/** True when the listener (or one of its ancestors) was launched from a folder of this workspace. */
function belongsToWorkspace(commandLines: string[]): boolean {
    const roots = (vscode.workspace.workspaceFolders ?? []).map((folder) => `${normalizePath(folder.uri.fsPath).replace(/\/$/, '')}/`);
    return commandLines.some((line) => {
        const normalized = normalizePath(line);
        return roots.some((root) => normalized.includes(root));
    });
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

/** Mirrors the scripts (servers and running ones) into the status bar menu, with who holds their ports. */
async function syncFooter(controller: NvmrcController, catalog: ScriptCatalog, runner: ScriptRunner): Promise<void> {
    const scripts = (await catalog.getProjects()).map((project) => ({
        label: project.label,
        scripts: Object.entries(project.scripts).map(([script, command]) => ({
            dir: project.dir, script, command,
            ports: detectScriptPorts(project.dir, script),
            mode: runner.runningMode(project.dir, script)
        })).filter((script) => script.mode || script.ports.length > 0)
    })).filter((project) => project.scripts.length > 0);

    const allPorts = [...new Set(scripts.flatMap((project) => project.scripts.flatMap((script) => script.ports)))];
    const listeners: FooterListener[] = (await findPortListeners(allPorts).catch(() => [])).map((item) => ({
        port: item.port, pid: item.pid, processName: item.processName, ours: belongsToWorkspace(item.commandLines)
    }));

    const projects: FooterProject[] = scripts.map((project) => ({
        label: project.label,
        scripts: project.scripts.map(({ mode, ...script }) => {
            const held = listeners.filter((listener) => script.ports.includes(listener.port));
            const state: FooterState = mode ?? (held.length === 0 ? 'idle' : held.every((listener) => listener.ours) ? 'external' : 'conflict');
            return { ...script, state, listeners: held };
        })
    }));
    controller.statusBar.setScripts(projects);
}

export function registerScriptCommands(context: vscode.ExtensionContext, controller: NvmrcController): ScriptCatalog {
    const runner = new ScriptRunner();
    const catalog = new ScriptCatalog(controller, runner);
    // Port owners change outside our control (servers started in a terminal,
    // another window), so the menu is re-synced on a timer too; runs never overlap.
    let syncing: Promise<void> | undefined;
    let pending = false;
    const footer = () => {
        if (syncing) {pending = true; return;}
        syncing = syncFooter(controller, catalog, runner)
            .catch((error) => log(`[scripts] footer sync failed: ${error instanceof Error ? error.message : String(error)}`))
            .finally(() => {
                syncing = undefined;
                if (pending) {pending = false; footer();}
            });
    };
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    const restartPolling = () => {
        if (pollTimer) {clearInterval(pollTimer);}
        const seconds = vscode.workspace.getConfiguration('wlyNvmrc').get<number>('pollIntervalSeconds', 15);
        if (seconds > 0) {pollTimer = setInterval(() => {if (vscode.window.state.focused) {footer();}}, seconds * 1000);}
    };
    restartPolling();
    context.subscriptions.push(
        runner, catalog,
        catalog.onDidChange(footer),
        vscode.commands.registerCommand('wlyNvmrc.scripts.refresh', () => catalog.reload()),
        vscode.commands.registerCommand('wlyNvmrc.scripts.run', async (arg?: ScriptNode | ScriptRef) => {
            const target = await resolveScript(catalog, arg);
            if (target) {await runScript(controller, runner, target);}
        }),
        vscode.commands.registerCommand('wlyNvmrc.scripts.debug', async (arg?: ScriptNode | ScriptRef) => {
            const target = await resolveScript(catalog, arg);
            if (target) {await runScript(controller, runner, target, 'debug');}
        }),
        vscode.commands.registerCommand('wlyNvmrc.scripts.kill', async (arg: ScriptNode | ScriptRef) => {
            const target = await resolveScript(catalog, arg);
            if (target) {await killScriptPorts(target); footer();}
        }),
        { dispose: () => pollTimer && clearInterval(pollTimer) },
        vscode.window.onDidChangeWindowState((state) => {if (state.focused) {footer();}}),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('wlyNvmrc.pollIntervalSeconds')) {restartPolling();}
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
