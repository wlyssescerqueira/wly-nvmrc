import * as fs from 'fs';
import { pathPackageJson, pathNodeModules, pathNvmrc, rootPath } from '../config/paths';

/**
 * A "Node project" here means any workspace where pinning a Node version makes sense:
 * it has a package.json (npm/yarn/pnpm project - covers plain Node, Angular, AngularJS
 * and Salesforce LWC/Aura tooling alike), an existing node_modules, or already has a .nvmrc.
 */
export function isNodeProject(): boolean {
    if (!rootPath) {return false;}
    return fs.existsSync(pathPackageJson) || fs.existsSync(pathNodeModules) || fs.existsSync(pathNvmrc);
}
