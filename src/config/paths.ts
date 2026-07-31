import * as vscode from 'vscode';
import * as path from 'path';

export const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
export const rootPath = workspaceFolder || '';

export const pathPackageJson = path.join(rootPath, 'package.json');
export const pathNodeModules = path.join(rootPath, 'node_modules');
export const pathNvmrc = path.join(rootPath, '.nvmrc');
