import * as path from "path";
import type { ScriptProject } from "./scriptsService";

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

/** Hide simple root shortcuts when their target package is also listed. Keep commands with setup steps or extra arguments. */
export function isScriptShortcut(
  project: ScriptProject,
  command: string,
  projects: ScriptProject[],
): boolean {
  const match =
    /^npm\s+run\s+([\w:.-]+)\s+--prefix\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))\s*$/.exec(
      command.trim(),
    );
  if (!match) {
    return false;
  }
  const script = Object.entries(project.scripts).find(
    ([, value]) => value === command,
  )?.[0];
  if (
    script &&
    (project.scripts[`pre${script}`] || project.scripts[`post${script}`])
  ) {
    return false;
  }
  const dir = path.resolve(project.dir, match[2] || match[3] || match[4]);
  return projects.some(
    (target) =>
      samePath(target.dir, dir) && typeof target.scripts[match[1]] === "string",
  );
}
