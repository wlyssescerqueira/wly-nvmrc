import * as vscode from 'vscode';
import * as path from 'path';
import type { ScriptProject } from './scriptsService';

export const SCRIPT_TASK_TYPE = 'wlyNvmrc-script';

type ScriptTaskDefinition = vscode.TaskDefinition & { script: string; path: string };

function key(dir: string, script: string): string {
    return `${process.platform === 'win32' ? dir.toLowerCase() : dir}|${script}`;
}

/** Runs package.json scripts as VS Code tasks and tracks which ones are alive. */
export class ScriptRunner implements vscode.Disposable {
    private readonly running = new Map<string, vscode.TaskExecution>();
    private readonly changed = new vscode.EventEmitter<void>();
    readonly onDidChange = this.changed.event;
    private readonly disposables: vscode.Disposable[] = [this.changed];

    constructor() {
        this.disposables.push(
            vscode.tasks.onDidStartTask((event) => this.track(event.execution, true)),
            vscode.tasks.onDidEndTask((event) => this.track(event.execution, false))
        );
    }

    private track(execution: vscode.TaskExecution, alive: boolean): void {
        const definition = execution.task.definition as ScriptTaskDefinition;
        if (definition.type !== SCRIPT_TASK_TYPE) {return;}
        const id = key(definition.path, definition.script);
        if (alive) {this.running.set(id, execution);}
        else if (this.running.get(id) === execution) {this.running.delete(id);}
        else {return;}
        this.changed.fire();
    }

    isRunning(dir: string, script: string): boolean {return this.running.has(key(dir, script));}

    async start(project: ScriptProject, script: string): Promise<void> {
        const definition: ScriptTaskDefinition = { type: SCRIPT_TASK_TYPE, script, path: project.dir };
        const owner = path.basename(project.dir);
        const task = new vscode.Task(
            definition, project.workspaceFolder, `${owner}: ${script}`, 'wly',
            new vscode.ShellExecution(project.packageManager, ['run', script], { cwd: project.dir })
        );
        task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated, clear: true };
        await vscode.tasks.executeTask(task);
    }

    /** Terminates the script's task and waits for it to end (or the timeout). */
    async stop(dir: string, script: string, timeoutMs = 8000): Promise<void> {
        const execution = this.running.get(key(dir, script));
        if (!execution) {return;}
        const ended = new Promise<void>((resolve) => {
            const timer = setTimeout(() => {listener.dispose(); resolve();}, timeoutMs);
            const listener = vscode.tasks.onDidEndTask((event) => {
                if (event.execution !== execution) {return;}
                clearTimeout(timer);
                listener.dispose();
                resolve();
            });
        });
        execution.terminate();
        await ended;
    }

    dispose(): void {this.disposables.forEach((disposable) => disposable.dispose());}
}
