import * as fs from 'fs';
import { pathNvmrc } from '../config/paths';

export function nvmrcExists(): boolean {
    return fs.existsSync(pathNvmrc);
}

export function readNvmrc(): string | null {
    if (!nvmrcExists()) {return null;}
    try {
        const content = fs.readFileSync(pathNvmrc, 'utf8').trim();
        return content || null;
    } catch {
        return null;
    }
}

export function writeNvmrc(version: string): void {
    fs.writeFileSync(pathNvmrc, `${version}\n`, 'utf8');
}

export function normalizeVersion(version: string): string {
    return version.trim().replace(/^v/i, '');
}

/**
 * .nvmrc may pin a partial version ("18" or "18.20"). Match by segment prefix so
 * a required "18" is satisfied by an active "18.20.4", but "18.20" is not satisfied by "18.19.0".
 */
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
