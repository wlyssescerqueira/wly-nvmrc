import { findNodeProjects } from './nodeProjectService';
import { readNvmrc, versionsMatch } from './nvmrcService';
import { getActiveNodeVersion } from './nodeVersionService';
import { log } from '../utils/output';
import type { NvmrcStatus, ProjectStatus } from '../types';

export async function computeStatus(): Promise<NvmrcStatus> {
    const discovered = await findNodeProjects();
    if (discovered.length === 0) {
        log('[computeStatus] no Node projects discovered -> kind: not-node-project (status bar stays hidden)');
        return { kind: 'not-node-project', projects: [] };
    }

    const current = await getActiveNodeVersion();
    log(`[computeStatus] active Node version: ${current ?? '(not found)'}`);

    const projects: ProjectStatus[] = discovered.map((project) => {
        const required = readNvmrc(project.path);
        log(`[computeStatus] project "${project.name}" (${project.path}) required=${required ?? '(no .nvmrc)'}`);
        return {
            name: project.name,
            path: project.path,
            required,
            matches: current && required ? versionsMatch(current, required) : null
        };
    });

    return current ? { kind: 'ready', current, projects } : { kind: 'node-not-found', projects };
}
