import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;

export function getOutput(): vscode.OutputChannel {
    if (!outputChannel) {outputChannel = vscode.window.createOutputChannel('Wly Nvmrc');}
    return outputChannel;
}

export function log(message: string): void {
    getOutput().appendLine(message);
}

export function toast(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    log(message);
    if (level === 'error') {vscode.window.showErrorMessage(message);}
    else if (level === 'warn') {vscode.window.showWarningMessage(message);}
    else {vscode.window.showInformationMessage(message);}
}
