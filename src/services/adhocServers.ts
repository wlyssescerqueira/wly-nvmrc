import * as path from "path";
import type { ScriptProcess } from "./scriptProcesses";

/** A Node server of a workspace project that holds a port but was not started by one of its scripts (`npx next dev`, a terminal, another tool). */
export type AdhocServer = {
  dir: string;
  /** Topmost Node process of the server inside the project: killing it ends the whole tree. */
  pid: number;
  commandLine: string;
  /** Short form for the menu, such as `next dev --port 8292`. */
  command: string;
  ports: number[];
  listeners: { port: number; pid: number; processName: string }[];
};

const RUNTIME = /^(?:node|nodejs|bun|deno)(?:\.exe)?$/i;
const PACKAGE_MANAGER =
  /(?:^|[\\/])(?:npm-cli|npx-cli|pnpm|pnpx|yarn)(?:\.c?js)?$/i;

function normalize(value: string): string {
  const text = value.replace(/\\/g, "/");
  return process.platform === "win32" ? text.toLowerCase() : text;
}

function tokens(commandLine: string): string[] {
  return (commandLine.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? []).map((token) =>
    token.replace(/^["']|["']$/g, ""),
  );
}

function folder(dir: string): string {
  return `${normalize(dir).replace(/\/$/, "")}/`;
}

/** Project whose folder the process names in its command line, or runs a relative entry from. Most specific folder wins. */
function projectOf(item: ScriptProcess, dirs: string[]): string | undefined {
  const line = normalize(item.commandLine);
  const entry = tokens(item.commandLine)
    .slice(1)
    .find((token) => !token.startsWith("-"));
  const relativeEntry =
    entry !== undefined &&
    !path.isAbsolute(entry) &&
    !/^[a-z]:/i.test(entry) &&
    /\.[cm]?[jt]s$/.test(entry);
  return dirs
    .filter(
      (dir) =>
        line.includes(folder(dir)) ||
        (relativeEntry &&
          item.cwd !== undefined &&
          folder(item.cwd) === folder(dir)),
    )
    .sort((a, b) => b.length - a.length)[0];
}

/** `node …/node_modules/.bin/../next/dist/bin/next dev --port 8292` → `next dev --port 8292`. */
export function shortCommand(commandLine: string, dir: string): string {
  const args = tokens(commandLine);
  let runtime = "";
  if (args.length && RUNTIME.test(path.basename(args[0].replace(/\\/g, "/")))) {
    runtime = path
      .basename(args.shift()!.replace(/\\/g, "/"))
      .replace(/\.exe$/i, "");
    // Runtime flags (`--use-system-ca`, `-r dotenv/config`) only add noise to the label.
    while (args[0]?.startsWith("-")) {
      const flag = args.shift()!;
      if (
        /^(?:-r|--require|--import|--loader|--experimental-loader)$/.test(flag)
      ) {
        args.shift();
      }
    }
  }
  const root = folder(dir);
  const label = args.map((arg) => {
    const unified = arg.replace(/\\/g, "/");
    const bin =
      /node_modules\/(?:\.bin\/\.\.\/)?(?:@[^/]+\/)?[^/]+\/(?:.*\/)?bin\/([^/]+?)(?:\.[cm]?js)?$/.exec(
        unified,
      );
    if (bin) {
      return bin[1];
    }
    if (normalize(unified).startsWith(root)) {
      return unified.slice(root.length);
    }
    return /[\\/]/.test(arg) && !arg.startsWith("-")
      ? path.posix.basename(unified)
      : arg;
  });
  // A package bin reads as its own command (`next dev`); a plain entry file keeps the runtime (`node server.cjs`).
  return runtime && label[0] && /\.[cm]?[jt]s$/.test(label[0])
    ? [runtime, ...label].join(" ")
    : label.join(" ");
}

/**
 * Groups listeners into servers of workspace projects, leaving out ports a script
 * already accounts for and processes descending from a recognised script run.
 */
export function findAdhocServers(
  processes: ScriptProcess[],
  listeners: { port: number; pid: number }[],
  dirs: string[],
  knownPids: Set<number>,
  knownPorts: Set<number>,
): AdhocServer[] {
  const byPid = new Map(processes.map((item) => [item.pid, item]));
  const servers = new Map<number, AdhocServer>();
  for (const listener of listeners) {
    const item = byPid.get(listener.pid);
    if (knownPorts.has(listener.port) || !item || !RUNTIME.test(item.name)) {
      continue;
    }
    const chain: ScriptProcess[] = [];
    for (
      let current: ScriptProcess | undefined = item;
      current && chain.length < 8 && !chain.includes(current);
      current = byPid.get(current.parent)
    ) {
      chain.push(current);
    }
    if (chain.some((ancestor) => knownPids.has(ancestor.pid))) {
      continue;
    }
    const dir = projectOf(item, dirs);
    if (!dir) {
      continue;
    }
    // Climb through the server's own Node processes, stopping at shells and package managers.
    let root = item;
    for (const ancestor of chain.slice(1)) {
      if (
        !RUNTIME.test(ancestor.name) ||
        tokens(ancestor.commandLine).some((token) =>
          PACKAGE_MANAGER.test(token),
        ) ||
        projectOf(ancestor, dirs) !== dir
      ) {
        break;
      }
      root = ancestor;
    }
    const server = servers.get(root.pid) ?? {
      dir,
      pid: root.pid,
      commandLine: root.commandLine,
      command: shortCommand(root.commandLine, dir),
      ports: [],
      listeners: [],
    };
    if (!server.ports.includes(listener.port)) {
      server.ports.push(listener.port);
    }
    server.listeners.push({ ...listener, processName: item.name });
    servers.set(root.pid, server);
  }
  return [...servers.values()].map((server) => ({
    ...server,
    ports: server.ports.sort((a, b) => a - b),
  }));
}
