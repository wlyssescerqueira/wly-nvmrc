import { isNodeProject } from './nodeProjectService';
import { readNvmrc, versionsMatch } from './nvmrcService';
import { getActiveNodeVersion } from './nodeVersionService';
import type { NvmrcStatus } from '../types';

export async function computeStatus(): Promise<NvmrcStatus> {
    if (!isNodeProject()) {
        return { kind: 'not-node-project' };
    }

    const required = readNvmrc();
    const current = await getActiveNodeVersion();

    if (!current) {
        return { kind: 'node-not-found', required };
    }

    if (!required) {
        return { kind: 'no-nvmrc', current };
    }

    return versionsMatch(current, required)
        ? { kind: 'match', current, required }
        : { kind: 'mismatch', current, required };
}
