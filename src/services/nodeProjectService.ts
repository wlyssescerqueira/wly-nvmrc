import * as vscode from 'vscode';
import * as path from 'path';

export type NodeProject = {
    name: string;
    path: string;
    workspaceFolder: vscode.WorkspaceFolder;
};

const ignoredDirectoryNames = new Set([
    'node_modules',
    '.next',
    '.nuxt',
    '.output',
    '.vscode-test',
    'dist',
    'build',
    'coverage',
    'out'
]);

function isGeneratedOrInternal(file: vscode.Uri, folder: vscode.WorkspaceFolder): boolean {
    const relativePath = path.relative(folder.uri.fsPath, file.fsPath);
    const directorySegments = path.dirname(relativePath).split(path.sep).filter(Boolean);
    return directorySegments.some((segment) => ignoredDirectoryNames.has(segment) || segment.startsWith('.'));
}

function projectName(projectPath: string, folder: vscode.WorkspaceFolder): string {
    return projectPath === folder.uri.fsPath ? folder.name : path.basename(projectPath);
}

/** Finds every Node project in every workspace folder, without walking dependencies. */
export async function findNodeProjects(): Promise<NodeProject[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const projects = new Map<string, NodeProject>();
    const generatedDirectories = '**/{node_modules,.next,.nuxt,.output,.vscode-test,dist,build,coverage,out}/**';

    for (const folder of folders) {
        // Check root markers directly. Besides being faster for the common case,
        // this does not depend on the workspace search index being ready or on
        // brace globs treating dotfiles consistently across VS Code versions.
        const rootMarkers = ['package.json', '.nvmrc'].map((name) => vscode.Uri.joinPath(folder.uri, name));
        const rootFiles = (await Promise.all(rootMarkers.map(async (file) => {
            try {
                const stat = await vscode.workspace.fs.stat(file);
                return stat.type === vscode.FileType.File ? file : null;
            } catch {
                return null;
            }
        }))).filter((file): file is vscode.Uri => file !== null);

        // Keep the patterns separate: some VS Code/file-search combinations do
        // not return a root .nvmrc from a brace expression containing dotfiles.
        const nestedFiles = (await Promise.all([
            vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/package.json'), generatedDirectories),
            vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/.nvmrc'), generatedDirectories)
        ])).flat();
        const files = [...rootFiles, ...nestedFiles];

        for (const file of files) {
            // Keep the result safe even when a VS Code/glob version does not apply
            // all brace exclusions (notably the downloaded host in .vscode-test).
            if (isGeneratedOrInternal(file, folder)) {continue;}
            const projectPath = path.dirname(file.fsPath);
            const key = process.platform === 'win32' ? projectPath.toLowerCase() : projectPath;
            projects.set(key, {
                name: projectName(projectPath, folder),
                path: projectPath,
                workspaceFolder: folder
            });
        }
    }

    return [...projects.values()].sort((a, b) => a.path.localeCompare(b.path));
}
