import * as path from 'path';

export function pathNvmrc(projectPath: string): string {
    return path.join(projectPath, '.nvmrc');
}
