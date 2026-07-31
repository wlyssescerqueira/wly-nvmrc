import * as vscode from 'vscode';
import * as path from 'path';

export type NodeProject = {
    name: string;
    path: string;
    workspaceFolder: vscode.WorkspaceFolder;
};

function projectName(projectPath: string, folder: vscode.WorkspaceFolder): string {
    return projectPath === folder.uri.fsPath ? folder.name : path.basename(projectPath);
}

/** Finds every Node project in every workspace folder, without walking dependencies. */
export async function findNodeProjects(): Promise<NodeProject[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const projects = new Map<string, NodeProject>();
    const generatedDirectories = '**/{node_modules,.next,.nuxt,.output,dist,build,coverage,out}/**';

    for (const folder of folders) {
        const pattern = new vscode.RelativePattern(folder, '**/{package.json,.nvmrc}');
        const files = await vscode.workspace.findFiles(pattern, generatedDirectories);

        for (const file of files) {
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
