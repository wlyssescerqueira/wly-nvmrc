import { run } from "../utils/exec";
import { activateNode, nvmCommand, nvmScript } from "./posixNvm";

/**
 * Returns the version of the Node currently on PATH (via a child process), never
 * process.version - the extension host runs on VS Code's own bundled Node, not
 * the user's project toolchain.
 */
export async function getActiveNodeVersion(): Promise<string | null> {
  try {
    const { stdout } = await run("node", ["--version"]);
    const version = stdout.trim().replace(/^v/i, "");
    return version || null;
  } catch {
    if (process.platform !== "win32" && nvmScript()) {
      try {
        const { stdout } = await run("/bin/sh", [
          "-c",
          nvmCommand(["which", "default"]),
        ]);
        activateNode(stdout);
        const result = await run(stdout.trim(), ["--version"]);
        return result.stdout.trim().replace(/^v/i, "") || null;
      } catch {
        /* no installed default version */
      }
    }
    return null;
  }
}
