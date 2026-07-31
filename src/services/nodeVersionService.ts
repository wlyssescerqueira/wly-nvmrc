import { run } from '../utils/exec';

/**
 * Returns the version of the Node currently on PATH (via a child process), never
 * process.version - the extension host runs on VS Code's own bundled Node, not
 * the user's project toolchain.
 */
export async function getActiveNodeVersion(): Promise<string | null> {
    try {
        const { stdout } = await run('node', ['--version']);
        const version = stdout.trim().replace(/^v/i, '');
        return version || null;
    } catch {
        return null;
    }
}
