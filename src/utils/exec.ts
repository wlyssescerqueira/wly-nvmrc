import { execFile } from 'child_process';

export type ExecResult = {
    stdout: string;
    stderr: string;
};

export type ExecFailure = Error & {
    code?: string | number | null;
    stdout?: string;
    stderr?: string;
};

/**
 * Runs a command with an argument array (no shell interpolation), so values that
 * originate from files or user input (e.g. a version string) can never be used
 * for shell injection.
 */
export function run(command: string, args: string[] = [], timeoutMs = 15000): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
        execFile(command, args, { windowsHide: true, timeout: timeoutMs }, (error, stdout, stderr) => {
            if (error) {
                const failure: ExecFailure = error;
                failure.stdout = stdout;
                failure.stderr = stderr;
                reject(failure);
                return;
            }
            resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
        });
    });
}
