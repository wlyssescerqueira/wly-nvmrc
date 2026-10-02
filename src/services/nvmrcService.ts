import * as fs from 'fs';
import * as path from 'path';
import { pathNvmrc } from '../config/paths';

export function nvmrcExists(projectPath: string): boolean {
    return fs.existsSync(pathNvmrc(projectPath));
}

export function readNvmrc(projectPath: string): string | null {
    if (!nvmrcExists(projectPath)) {return null;}
    try {
        const content = fs.readFileSync(pathNvmrc(projectPath), 'utf8').trim();
        return content || null;
    } catch {
        return null;
    }
}

/**
 * Reads an exact Node version from package.json "engines.node" (e.g. "22.18.0",
 * "v22", "=20.15.1"). Ranges such as ">=18" or "^20" are ignored because they
 * cannot be passed to `nvm use`.
 */
export function readEnginesNode(projectPath: string): string | null {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, 'package.json'), 'utf8'));
        const engine = typeof pkg?.engines?.node === 'string' ? pkg.engines.node.trim().replace(/^=+/, '') : '';
        return /^v?\d+(\.\d+){0,2}$/i.test(engine) ? normalizeVersion(engine) : null;
    } catch {
        return null;
    }
}

export function writeNvmrc(projectPath: string, version: string): void {
    fs.writeFileSync(pathNvmrc(projectPath), `${version}\n`, 'utf8');
}

export function normalizeVersion(version: string): string {
    return version.trim().replace(/^v/i, '');
}

export function versionsMatch(current: string, required: string): boolean {
    const cur = normalizeVersion(current).split('.');
    const req = normalizeVersion(required).split('.');
    if (req.length === 0 || req.some((segment) => !/^\d+$/.test(segment))) {
        return normalizeVersion(current) === normalizeVersion(required);
    }
    for (let i = 0; i < req.length; i++) {
        if (req[i] !== cur[i]) {return false;}
    }
    return true;
}
