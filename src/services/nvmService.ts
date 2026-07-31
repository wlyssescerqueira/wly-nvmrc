import { run } from '../utils/exec';
import type { NvmInstalledVersion } from '../types';

export async function isNvmAvailable(): Promise<boolean> {
    try {
        await run('nvm', ['version']);
        return true;
    } catch {
        return false;
    }
}

export async function listInstalledVersions(): Promise<NvmInstalledVersion[]> {
    const { stdout } = await run('nvm', ['list']);
    const versions: NvmInstalledVersion[] = [];
    for (const line of stdout.split(/\r?\n/)) {
        const match = line.match(/(\d+\.\d+\.\d+)/);
        if (!match) {continue;}
        versions.push({ version: match[1], active: line.includes('*') });
    }
    return versions;
}

export async function useVersion(version: string): Promise<void> {
    await run('nvm', ['use', version], 30000);
}

export async function installVersion(version: string): Promise<void> {
    await run('nvm', ['install', version], 120000);
}
