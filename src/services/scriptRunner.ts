import * as vscode from 'vscode';
import * as path from 'path';
import type { ScriptProject } from './scriptsService';

export const SCRIPT_TASK_TYPE = 'wlyNvmrc-script';

export type RunMode = 'task' | 'debug';

type ScriptTaskDefinition = vscode.TaskDefinition & { script: string; path: string };
/** Marker added to our debug configurations so their sessions can be matched back to a script. */
type ScriptMarker = { script: string; path: string };

type Execution =
    | { mode: 'task'; execution: vscode.TaskExecution }
    | { mode: 'debug'; session: vscode.DebugSession };

function key(dir: string, script: string): string {
    return `${process.platform === 'win32' ? dir.toLowerCase() : dir}|${script}`;
}

function marker(session: vscode.DebugSession): ScriptMarker | undefined {
    const value = session.configuration.wlyNvmrcScript as ScriptMarker | undefined;
    return value && typeof value.script === 'string' && typeof value.path === 'string' ? value : undefined;
}

/** Runs package.json scripts as VS Code tasks or debug sessions and tracks which ones are alive. */
export class ScriptRunner implements vscode.Disposable {
    private readonly running = new Map<string, Execution>();
    private readonly changed = new vscode.EventEmitter<void>();
    readonly onDidChange = this.changed.event;
    private readonly disposables: vscode.Disposable[] = [this.changed];

    constructor() {
        this.disposables.push(
            vscode.tasks.onDidStartTask((event) => this.trackTask(event.execution, true)),
            vscode.tasks.onDidEndTask((event) => this.trackTask(event.execution, false)),
            vscode.debug.onDidStartDebugSession((session) => this.trackSession(session, true)),
            vscode.debug.onDidTerminateDebugSession((session) => this.trackSession(session, false))
        );
    }

    private set(id: string, alive: boolean, execution: Execution, same: (current: Execution) => boolean): void {
        if (alive) {this.running.set(id, execution);}
        else {
            const current = this.running.get(id);
            if (!current || !same(current)) {return;}
            this.running.delete(id);
        }
        this.changed.fire();
    }

    private trackTask(execution: vscode.TaskExecution, alive: boolean): void {
        const definition = execution.task.definition as ScriptTaskDefinition;
        if (definition.type !== SCRIPT_TASK_TYPE) {return;}
        this.set(key(definition.path, definition.script), alive, { mode: 'task', execution },
            (current) => current.mode === 'task' && current.execution === execution);
    }

    private trackSession(session: vscode.DebugSession, alive: boolean): void {
        const ref = marker(session);
        if (!ref) {return;}
        this.set(key(ref.path, ref.script), alive, { mode: 'debug', session },
            (current) => current.mode === 'debug' && current.session.id === session.id);
    }

    /** How the script is running in this window, or undefined when it isn't. */
    runningMode(dir: string, script: string): RunMode | undefined {return this.running.get(key(dir, script))?.mode;}

    isRunning(dir: string, script: string): boolean {return this.running.has(key(dir, script));}

    async start(project: ScriptProject, script: string, mode: RunMode = 'task'): Promise<void> {
        const owner = path.basename(project.dir);
        if (mode === 'debug') {
            // `node-terminal` (built-in js-debug) runs the command in a debug
            // terminal and auto-attaches to every Node process it spawns.
            await vscode.debug.startDebugging(project.workspaceFolder, {
                type: 'node-terminal',
                request: 'launch',
                name: `${owner}: ${script}`,
                command: `${project.packageManager} run ${script}`,
                cwd: project.dir,
                wlyNvmrcScript: { script, path: project.dir } satisfies ScriptMarker
            });
            return;
        }
        const definition: ScriptTaskDefinition = { type: SCRIPT_TASK_TYPE, script, path: project.dir };
        const task = new vscode.Task(
            definition, project.workspaceFolder, `${owner}: ${script}`, 'wly',
            new vscode.ShellExecution(project.packageManager, ['run', script], { cwd: project.dir })
        );
        task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated, clear: true };
        await vscode.tasks.executeTask(task);
    }

    /** Terminates the script's task / debug session and waits for it to end (or the timeout). */
    async stop(dir: string, script: string, timeoutMs = 8000): Promise<void> {
        const id = key(dir, script);
        const current = this.running.get(id);
        if (!current) {return;}
        const ended = new Promise<void>((resolve) => {
            const timer = setTimeout(() => {listener.dispose(); resolve();}, timeoutMs);
            const listener = this.onDidChange(() => {
                if (this.running.get(id) === current) {return;}
                clearTimeout(timer);
                listener.dispose();
                resolve();
            });
        });
        if (current.mode === 'task') {current.execution.terminate();}
        else {void vscode.debug.stopDebugging(current.session);}
        await ended;
    }

    dispose(): void {this.disposables.forEach((disposable) => disposable.dispose());}
}
