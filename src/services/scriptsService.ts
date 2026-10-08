import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { findNodeProjects } from './nodeProjectService';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export type ScriptProject = {
    /** Directory that holds the package.json. */
    dir: string;
    packageJson: vscode.Uri;
    /** Label shown in the status bar menu, e.g. `frontend\package.json`. */
    label: string;
    workspaceFolder: vscode.WorkspaceFolder;
    packageManager: PackageManager;
    scripts: Record<string, string>;
};

export function readScripts(dir: string): Record<string, string> {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        const scripts = pkg?.scripts;
        if (!scripts || typeof scripts !== 'object') {return {};}
        return Object.fromEntries(Object.entries(scripts).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    } catch {
        return {};
    }
}

function detectPackageManager(dir: string, workspaceRoot: string): PackageManager {
    // Lock files may live in the project or at the monorepo root.
    for (const candidate of dir === workspaceRoot ? [dir] : [dir, workspaceRoot]) {
        if (fs.existsSync(path.join(candidate, 'pnpm-lock.yaml'))) {return 'pnpm';}
        if (fs.existsSync(path.join(candidate, 'yarn.lock'))) {return 'yarn';}
        if (fs.existsSync(path.join(candidate, 'bun.lockb')) || fs.existsSync(path.join(candidate, 'bun.lock'))) {return 'bun';}
        if (fs.existsSync(path.join(candidate, 'package-lock.json'))) {return 'npm';}
    }
    return 'npm';
}

export async function findScriptProjects(): Promise<ScriptProject[]> {
    const multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
    const result: ScriptProject[] = [];
    for (const project of await findNodeProjects()) {
        const packageJson = vscode.Uri.file(path.join(project.path, 'package.json'));
        if (!fs.existsSync(packageJson.fsPath)) {continue;}
        result.push({
            dir: project.path,
            packageJson,
            label: vscode.workspace.asRelativePath(packageJson, multiRoot).split('/').join(path.sep),
            workspaceFolder: project.workspaceFolder,
            packageManager: detectPackageManager(project.path, project.workspaceFolder.uri.fsPath),
            scripts: readScripts(project.path)
        });
    }
    return result;
}

/** Opens package.json with the cursor on the script's key. */
export async function revealScript(project: ScriptProject, script: string): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(project.packageJson);
    const text = doc.getText();
    const scriptsStart = Math.max(0, text.search(/"scripts"\s*:/));
    const escaped = script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`"${escaped}"\\s*:`).exec(text.slice(scriptsStart));
    const offset = match ? scriptsStart + match.index + 1 : scriptsStart;
    const position = doc.positionAt(offset);
    await vscode.window.showTextDocument(doc, { selection: new vscode.Range(position, position.translate(0, match ? script.length : 0)) });
}
