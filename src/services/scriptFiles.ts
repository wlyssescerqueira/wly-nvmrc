import * as fs from "fs/promises";
import * as path from "path";

export type ScriptFile = { relativePath: string; args: string[] };

/** Only JavaScript has a predictable runtime across supported Node versions. */
export async function discoverScriptFiles(dir: string): Promise<ScriptFile[]> {
  const result: ScriptFile[] = [];
  async function visit(relative: string): Promise<void> {
    const entries = await fs
      .readdir(path.join(dir, relative), { withFileTypes: true })
      .catch(() => []);
    for (const entry of entries) {
      if (
        entry.isSymbolicLink() ||
        entry.name.startsWith(".") ||
        ["node_modules", "dist", "coverage"].includes(entry.name)
      ) {
        continue;
      }
      const file = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        await visit(file);
      } else if (entry.isFile() && /\.(?:cjs|mjs|js)$/i.test(entry.name)) {
        const test = /(?:^|[.\-_])(?:test|spec)\.(?:cjs|mjs|js)$/i.test(
          entry.name,
        );
        result.push({
          relativePath: file,
          args: [...(test ? ["--test"] : []), file],
        });
      }
    }
  }
  await visit("scripts");
  return result.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
