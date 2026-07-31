import { findNodeProjects } from './nodeProjectService';
import { readNvmrc, versionsMatch } from './nvmrcService';
import { getActiveNodeVersion } from './nodeVersionService';
import type { NvmrcStatus, ProjectStatus } from '../types';

export async function computeStatus(): Promise<NvmrcStatus> {
    const discovered = await findNodeProjects();
    if (discovered.length === 0) {return { kind: 'not-node-project', projects: [] };}

    const current = await getActiveNodeVersion();
    const projects: ProjectStatus[] = discovered.map((project) => {
        const required = readNvmrc(project.path);
        return {
            name: project.name,
            path: project.path,
            required,
            matches: current && required ? versionsMatch(current, required) : null
        };
    });

    return current ? { kind: 'ready', current, projects } : { kind: 'node-not-found', projects };
}
