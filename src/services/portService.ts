import * as fs from "fs";
import * as path from "path";
import { run } from "../utils/exec";
import { readScripts } from "./scriptsService";
import { listScriptProcesses } from "./scriptProcesses";

export type PortListener = {
  port: number;
  pid: number;
  processName: string;
  /** Command lines of the listener and its ancestors (closest first), used to tell which project owns it. */
  commandLines: string[];
};

type ProcessInfo = { name: string; parent: number; commandLine: string };

const PORT = "(\\d{2,5})";

function readText(file: string, maxBytes = 200_000): string | undefined {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > maxBytes) {
      return undefined;
    }
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

function toPort(value: string | undefined): number | undefined {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined;
}

/** PORT from the project's dotenv files (later files win, like most loaders). */
function envPort(dir: string): number | undefined {
  let port: number | undefined;
  for (const name of [
    ".env",
    ".env.development",
    ".env.local",
    ".env.development.local",
  ]) {
    const text = readText(path.join(dir, name));
    const match =
      text &&
      new RegExp(`^\\s*(?:export\\s+)?PORT\\s*=\\s*["']?${PORT}`, "m").exec(
        text,
      );
    if (match) {
      port = toPort(match[1]);
    }
  }
  return port;
}

/** `process.env.PORT || 3011` / `?? 3011` fallback written in the server entry file. */
function entryFilePort(dir: string, command: string): number | undefined {
  const entries = [
    ...command.matchAll(/(?:^|\s)([\w./\\-]+\.(?:[cm]?[jt]s))(?=\s|$)/g),
  ].map((match) => match[1]);
  if (/\bnest\s+start\b/.test(command)) {
    entries.push("src/main.ts");
  }
  for (const entry of entries) {
    const text = readText(path.join(dir, entry));
    const match =
      text &&
      new RegExp(
        `process\\.env\\.PORT\\s*(?:\\|\\||\\?\\?)\\s*["']?${PORT}`,
      ).exec(text);
    if (match) {
      return toPort(match[1]);
    }
  }
  return undefined;
}

function configPort(
  dir: string,
  files: string[],
  pattern: RegExp,
): number | undefined {
  for (const file of files) {
    const match = readText(path.join(dir, file))?.match(pattern);
    if (match) {
      return toPort(match[1]);
    }
  }
  return undefined;
}

/** Port a single command line listens on, judged by explicit flags, config and framework defaults. */
function commandPort(
  dir: string,
  script: string,
  command: string,
): number | undefined {
  const explicit =
    new RegExp(`(?:--port|(?:^|\\s)-p)(?:=|\\s+)${PORT}\\b`).exec(command) ??
    new RegExp(`\\bPORT=${PORT}\\b`).exec(command);
  if (explicit) {
    return toPort(explicit[1]);
  }

  if (/\bnext\s+(?:dev|start)\b|\bnext\s*$/.test(command)) {
    return 3000;
  } // Next ignores PORT in .env
  if (/\bvite\s+preview\b/.test(command)) {
    return 4173;
  }
  if (
    /\bvite\b(?!\s+(?:build|optimize))/.test(command) ||
    /\bremix\s+vite:dev\b/.test(command)
  ) {
    return (
      configPort(
        dir,
        [
          "vite.config.ts",
          "vite.config.js",
          "vite.config.mts",
          "vite.config.mjs",
        ],
        /\bport\s*:\s*(\d{2,5})/,
      ) ?? 5173
    );
  }
  if (/\bng\s+serve\b/.test(command)) {
    return configPort(dir, ["angular.json"], /"port"\s*:\s*(\d{2,5})/) ?? 4200;
  }
  if (/\breact-scripts\s+start\b/.test(command)) {
    return envPort(dir) ?? 3000;
  }
  if (/\bnuxi?\s+dev\b/.test(command)) {
    return envPort(dir) ?? 3000;
  }
  if (/\bastro\s+dev\b/.test(command)) {
    return 4321;
  }
  if (/\bexpo\s+start\b/.test(command)) {
    return 8081;
  }
  if (/\bgatsby\s+develop\b/.test(command)) {
    return 8000;
  }
  if (/\bstorybook\s+dev\b|\bstart-storybook\b/.test(command)) {
    return 6006;
  }
  if (/\bwebpack(?:-dev-server|\s+serve)\b/.test(command)) {
    return 8080;
  }
  // Plain runtimes also run one-off tools (seeds, tests), so only treat
  // long-running scripts as servers.
  const serverLike =
    /^(?:dev|start|serve|server|preview|watch)(?:$|:)/.test(script) ||
    /\bwatch\b|\bnodemon\b|\bnest\s+start\b|\bts-node-dev\b/.test(command);
  if (
    serverLike &&
    /\b(?:node|tsx|ts-node|ts-node-dev|nodemon|nest\s+start)\b/.test(command)
  ) {
    return envPort(dir) ?? entryFilePort(dir, command);
  }
  return undefined;
}

type ScriptRef = { dir: string; script: string };

/** Scripts that `command` delegates to: `npm run x --prefix dir`, `cd dir && npm run x`, orchestrator `node scripts/dev.cjs`. */
function delegatedScripts(dir: string, command: string): ScriptRef[] {
  const refs: ScriptRef[] = [];
  for (const segment of command.split(/&&|\|\||;/)) {
    const cd = /^\s*cd\s+["']?([^"'\s]+)/.exec(segment);
    const base = cd ? path.resolve(dir, cd[1]) : dir;
    const runner =
      /\b(?:npm|pnpm|yarn|bun)\b(?:\s+--prefix[\s=]+(\S+))?\s+run\s+([\w:.-]+)(?:.*?--prefix[\s=]+(\S+))?/.exec(
        segment,
      );
    if (runner) {
      const prefix = runner[1] ?? runner[3];
      refs.push({
        dir: prefix ? path.resolve(base, prefix.replace(/["']/g, "")) : base,
        script: runner[2],
      });
    }
  }

  // Orchestrator scripts spawn `npm run <x>` inside sibling packages they name.
  const node = /^\s*node\s+([\w./\\-]+\.[cm]?js)\b/.exec(command);
  const source = node && readText(path.join(dir, node[1]));
  if (source) {
    const scripts = new Set([
      ...[...source.matchAll(/["']run["']\s*,\s*["']([\w:.-]+)["']/g)].map(
        (match) => match[1],
      ),
      ...[...source.matchAll(/\b(?:npm|pnpm|yarn)\s+run\s+([\w:.-]+)/g)].map(
        (match) => match[1],
      ),
    ]);
    let children: string[] = [];
    try {
      children = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() &&
            !entry.name.startsWith(".") &&
            entry.name !== "node_modules",
        )
        .map((entry) => entry.name)
        .filter(
          (name) =>
            fs.existsSync(path.join(dir, name, "package.json")) &&
            new RegExp(`["'\`/\\\\]${name}["'\`/\\\\]`).test(source),
        );
    } catch {
      /* unreadable dir: no children */
    }
    for (const child of children) {
      for (const script of scripts) {
        refs.push({ dir: path.join(dir, child), script });
      }
    }
  }
  return refs;
}

/** Every port the script is expected to listen on, following delegations to other scripts. */
export function detectScriptPorts(dir: string, script: string): number[] {
  const ports = new Set<number>();
  const visited = new Set<string>();
  const visit = (ref: ScriptRef, depth: number) => {
    const key = `${process.platform === "win32" ? ref.dir.toLowerCase() : ref.dir}|${ref.script}`;
    if (depth > 4 || visited.has(key)) {
      return;
    }
    visited.add(key);
    const command = readScripts(ref.dir)[ref.script];
    if (!command) {
      return;
    }
    const delegated = delegatedScripts(ref.dir, command);
    delegated.forEach((child) => visit(child, depth + 1));
    if (delegated.length === 0) {
      const port = commandPort(ref.dir, ref.script, command);
      if (port) {
        ports.add(port);
      }
    }
  };
  visit({ dir, script }, 0);
  return [...ports].sort((a, b) => a - b);
}

async function processName(pid: number): Promise<string> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await run("tasklist", [
        "/FI",
        `PID eq ${pid}`,
        "/FO",
        "CSV",
        "/NH",
      ]);
      return /^"([^"]+)"/.exec(stdout.trim())?.[1] ?? "unknown";
    }
    const { stdout } = await run("ps", ["-p", String(pid), "-o", "comm="]);
    return path.basename(stdout.trim()) || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Name, parent PID and command line of each process. On Windows the ancestors are
 * walked inside the same PowerShell call, since starting PowerShell is the slow part.
 */
async function queryProcesses(
  pids: number[],
  depth = 4,
): Promise<Map<number, ProcessInfo>> {
  const result = new Map<number, ProcessInfo>();
  if (pids.length === 0) {
    return result;
  }
  try {
    if (process.platform === "win32") {
      const script = [
        "$all = @{}",
        "Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,CommandLine | ForEach-Object { $all[[int]$_.ProcessId] = $_ }",
        `$queue = @(${pids.join(",")})`,
        `for ($d = 0; $d -le ${depth} -and $queue.Count -gt 0; $d++) {`,
        "  $next = @()",
        '  foreach ($id in $queue) { $p = $all[[int]$id]; if ($p) { "$($p.ProcessId)`t$($p.ParentProcessId)`t$($p.Name)`t$($p.CommandLine)"; if ($p.ParentProcessId -gt 4) { $next += [int]$p.ParentProcessId } } }',
        "  $queue = @($next | Select-Object -Unique)",
        "}",
      ].join("\n");
      const { stdout } = await run("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        script,
      ]);
      for (const line of stdout.split(/\r?\n/)) {
        const [pid, parent, name, ...rest] = line.split("\t");
        if (!pid || !name) {
          continue;
        }
        result.set(Number(pid), {
          name,
          parent: Number(parent),
          commandLine: rest.join("\t"),
        });
      }
    } else {
      const { stdout } = await run("ps", [
        "-ww",
        "-o",
        "pid=,ppid=,args=",
        "-p",
        pids.join(","),
      ]);
      for (const line of stdout.split(/\r?\n/)) {
        const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
        if (!match) {
          continue;
        }
        result.set(Number(match[1]), {
          name: path.basename(match[3].split(/\s+/)[0]),
          parent: Number(match[2]),
          commandLine: match[3],
        });
      }
    }
  } catch {
    /* leave unknown */
  }
  return result;
}

async function processInfo(
  pids: number[],
  cache: Map<number, ProcessInfo | undefined>,
): Promise<Map<number, ProcessInfo | undefined>> {
  const missing = [...new Set(pids)].filter((pid) => !cache.has(pid));
  const fetched = await queryProcesses(missing);
  missing.forEach((pid) => cache.set(pid, fetched.get(pid)));
  fetched.forEach((info, pid) => cache.set(pid, info));
  return new Map(pids.map((pid) => [pid, cache.get(pid)]));
}

/** Name of the process plus the command lines of it and up to `depth` ancestors. */
async function ancestry(
  pid: number,
  cache: Map<number, ProcessInfo | undefined>,
  depth = 4,
): Promise<{ name: string | undefined; commandLines: string[] }> {
  const commandLines: string[] = [];
  let name: string | undefined;
  let current = pid;
  for (let level = 0; level <= depth && current > 4; level++) {
    const info = (await processInfo([current], cache)).get(current);
    if (!info) {
      break;
    }
    if (level === 0) {
      name = info.name;
    }
    if (info.commandLine) {
      commandLines.push(info.commandLine);
    }
    if (info.parent === current) {
      break;
    }
    current = info.parent;
  }
  return { name, commandLines };
}

async function listeningPids(
  ports: number[],
): Promise<Map<number, Set<number>>> {
  const result = new Map<number, Set<number>>();
  const add = (port: number, pid: number) => {
    if (!ports.includes(port) || !pid) {
      return;
    }
    if (!result.has(port)) {
      result.set(port, new Set());
    }
    result.get(port)!.add(pid);
  };
  if (process.platform === "win32") {
    // State names are localized ("LISTENING", "ESCUTANDO"...), so identify
    // listeners by their wildcard remote address instead.
    const { stdout } = await run("netstat", ["-ano", "-p", "TCP"]).catch(
      () => ({ stdout: "" }),
    );
    const { stdout: stdout6 } = await run("netstat", [
      "-ano",
      "-p",
      "TCPv6",
    ]).catch(() => ({ stdout: "" }));
    for (const line of `${stdout}\n${stdout6}`.split(/\r?\n/)) {
      const columns = line.trim().split(/\s+/);
      if (
        columns.length < 5 ||
        !/^TCP/i.test(columns[0]) ||
        !/:0$/.test(columns[2])
      ) {
        continue;
      }
      add(
        Number(columns[1].slice(columns[1].lastIndexOf(":") + 1)),
        Number(columns[columns.length - 1]),
      );
    }
  } else {
    for (const port of ports) {
      const { stdout } = await run("lsof", [
        "-nP",
        `-iTCP:${port}`,
        "-sTCP:LISTEN",
        "-t",
      ]).catch(async (error) => {
        // lsof returns 1 when no sockets match. Missing tools must not look like free ports.
        if (error.code === 1) {
          return { stdout: "" };
        }
        if (process.platform !== "linux" || error.code !== "ENOENT") {
          throw error;
        }
        const { stdout: sockets } = await run("ss", ["-H", "-ltnp"]);
        const pids: number[] = [];
        for (const line of sockets.split(/\r?\n/)) {
          const columns = line.trim().split(/\s+/);
          if (Number(columns[3]?.split(":").pop()) !== port) {
            continue;
          }
          const matches = [...line.matchAll(/pid=(\d+)/g)];
          if (!matches.length) {
            throw new Error(
              `Port ${port} is occupied, but its PID is not visible to this user.`,
            );
          }
          pids.push(...matches.map((match) => Number(match[1])));
        }
        return { stdout: pids.join("\n") };
      });
      stdout
        .split(/\s+/)
        .filter(Boolean)
        .forEach((pid) => add(port, Number(pid)));
    }
  }
  return result;
}

export async function findPortListeners(
  ports: number[],
): Promise<PortListener[]> {
  if (ports.length === 0) {
    return [];
  }
  const listeners: PortListener[] = [];
  // Share ancestry only within this inspection; a later poll must recheck reused PIDs.
  const cache = new Map<number, ProcessInfo | undefined>();
  const byPort = await listeningPids(ports);
  // Warm the cache one ancestry level at a time so each level costs a single query.
  let level = [...new Set([...byPort.values()].flatMap((pids) => [...pids]))];
  for (let depth = 0; depth <= 4 && level.length > 0; depth++) {
    const infos = await processInfo(level, cache);
    level = [
      ...new Set(
        [...infos.values()]
          .map((info) => info?.parent ?? 0)
          .filter((pid) => pid > 4),
      ),
    ];
  }
  for (const [port, pids] of byPort) {
    for (const pid of pids) {
      const { name, commandLines } = await ancestry(pid, cache);
      listeners.push({
        port,
        pid,
        processName: name ?? (await processName(pid)),
        commandLines,
      });
    }
  }
  return listeners.sort((a, b) => a.port - b.port);
}

export async function killProcess(pid: number): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) {
    throw new Error("Refusing to terminate an invalid or protected PID.");
  }
  if (process.platform === "win32") {
    await run("taskkill", ["/PID", String(pid), "/T", "/F"]);
    return;
  }
  const snapshot = await listScriptProcesses();
  const root = snapshot.find((item) => item.pid === pid);
  if (!root) {
    return;
  }
  const targets = [root];
  const visited = new Set([pid]);
  for (let index = 0; index < targets.length; index++) {
    for (const child of snapshot.filter(
      (item) => item.parent === targets[index].pid,
    )) {
      if (
        !visited.has(child.pid) &&
        child.pid > 1 &&
        child.pid !== process.pid
      ) {
        visited.add(child.pid);
        targets.push(child);
      }
    }
  }
  const signal = (target: number, kind: NodeJS.Signals) => {
    try {
      process.kill(target, kind);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        throw error;
      }
    }
  };
  // Stop the supervisor first so it cannot respawn children while they terminate.
  for (const target of targets) {
    signal(target.pid, "SIGTERM");
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const remaining = await listScriptProcesses();
  for (const target of [...targets].reverse()) {
    if (
      remaining.some(
        (item) =>
          item.pid === target.pid &&
          item.commandLine === target.commandLine &&
          item.name === target.name,
      )
    ) {
      signal(target.pid, "SIGKILL");
    }
  }
}

/** Resolves true once none of the ports has a listener, false after the timeout. */
export async function waitForPortsFree(
  ports: number[],
  timeoutMs = 8000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await listeningPids(ports)).size === 0) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}
