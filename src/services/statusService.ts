import * as path from 'path';
import { findNodeProjects } from './nodeProjectService';
import { readEnginesNode, readNvmrc, versionsMatch } from './nvmrcService';
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

    const nvmrcByPath = new Map(discovered.map((project) => [project.path, readNvmrc(project.path)]));
    const isInside = (child: string, parent: string): boolean => {
        const relative = path.relative(parent, child);
        return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
    };
    // A folder without its own .nvmrc that contains sub-projects with .nvmrc is a
    // workspace/monorepo root (e.g. scripts orchestrating backend/frontend/mobile):
    // the pinned versions live in the sub-projects, so it is not reported itself.
    const managed = discovered.filter((project) => {
        if (nvmrcByPath.get(project.path)) {return true;}
        const container = discovered.some((other) => nvmrcByPath.get(other.path) && isInside(other.path, project.path));
        if (container) {log(`[computeStatus] skipping "${project.name}" (${project.path}) — workspace root without .nvmrc; sub-projects pin their own versions`);}
        return !container;
    });

    const projects: ProjectStatus[] = managed.map((project) => {
        const nvmrc = nvmrcByPath.get(project.path) ?? null;
        const engines = nvmrc ? null : readEnginesNode(project.path);
        const required = nvmrc ?? engines;
        const source = nvmrc ? 'nvmrc' : engines ? 'engines' : null;
        log(`[computeStatus] project "${project.name}" (${project.path}) required=${required ?? '(no .nvmrc / engines.node)'} source=${source ?? '-'}`);
        return {
            name: project.name,
            path: project.path,
            required,
            source,
            matches: current && required ? versionsMatch(current, required) : null
        };
    });

    return current ? { kind: 'ready', current, projects } : { kind: 'node-not-found', projects };
}
