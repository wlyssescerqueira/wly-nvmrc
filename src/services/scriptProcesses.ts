import * as path from "path";
import * as fs from "fs/promises";
import { run } from "../utils/exec";
import { identifyProcessScript, type ScriptCandidate } from "./processScript";
import { windowsProcessSnapshot } from "./windowsProcessSnapshot";

export type ScriptProcess = {
  pid: number;
  parent: number;
  name: string;
  commandLine: string;
  cwd?: string;
};
export type RuntimeCandidate = ScriptCandidate & { file?: string };
export function runtimeKey(dir: string, script: string): string {
  return `${process.platform === "win32" ? dir.toLowerCase() : dir}|${script}`;
}
function normalize(value: string): string {
  const text = value.replace(/\\/g, "/");
  return process.platform === "win32" ? text.toLowerCase() : text;
}

/** A fresh snapshot: do not cache PIDs, which can exit or be reused between polls. */
export async function listScriptProcesses(): Promise<ScriptProcess[]> {
  if (process.platform === "win32") {
    const { stdout } = await run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      windowsProcessSnapshot,
    ]);
    const rows = JSON.parse(stdout || "[]");
    return (Array.isArray(rows) ? rows : [rows]).map((row) => ({
      pid: row.ProcessId,
      parent: row.ParentProcessId,
      name: row.Name,
      commandLine: row.CommandLine || "",
      cwd: row.Cwd || undefined,
    }));
  }
  const [{ stdout }, { stdout: names }] = await Promise.all([
    run("ps", ["-axww", "-o", "pid=,ppid=,args="]),
    run("ps", ["-ax", "-o", "pid=,comm="]),
  ]);
  const byPid = new Map(
    names.split(/\r?\n/).flatMap((line) => {
      const match = /^\s*(\d+)\s+(.*)$/.exec(line);
      return match
        ? [[Number(match[1]), path.basename(match[2].trim())] as const]
        : [];
    }),
  );
  const rows = await Promise.all(
    stdout
      .split(/\r?\n/)
      .flatMap((line) => {
        const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
        return match
          ? [
              async () => ({
                pid: Number(match[1]),
                parent: Number(match[2]),
                name: byPid.get(Number(match[1])) ?? "unknown",
                commandLine: match[3],
                cwd:
                  process.platform === "linux"
                    ? await fs
                        .readlink(`/proc/${match[1]}/cwd`)
                        .catch(() => undefined)
                    : undefined,
              }),
            ]
          : [];
      })
      .map((read) => read()),
  );
  if (process.platform === "darwin") {
    const pids = rows
      .filter((row) => /^(node|nodejs|bun|deno|npm|pnpm|yarn)$/.test(row.name))
      .map((row) => row.pid);
    if (pids.length) {
      const { stdout: directories } = await run("lsof", [
        "-a",
        "-p",
        pids.join(","),
        "-d",
        "cwd",
        "-Fn",
      ]).catch((error) => {
        if (error.code === 1) {
          return { stdout: "" };
        }
        throw error;
      });
      let pid = 0;
      for (const line of directories.split(/\r?\n/)) {
        if (line.startsWith("p")) {
          pid = Number(line.slice(1));
        }
        if (line.startsWith("n")) {
          const row = rows.find((row) => row.pid === pid);
          if (row) {
            row.cwd = line.slice(1);
          }
        }
      }
    }
  }
  return rows;
}

export function matchScriptProcesses(
  processes: ScriptProcess[],
  candidates: RuntimeCandidate[],
): Map<string, number[]> {
  const result = new Map<string, number[]>();
  const byPid = new Map(processes.map((item) => [item.pid, item]));
  const add = (candidate: RuntimeCandidate, pid: number) => {
    const key = runtimeKey(candidate.dir, candidate.script);
    result.set(key, [...new Set([...(result.get(key) ?? []), pid])]);
  };
  for (const item of processes) {
    if (
      !/^(?:node|nodejs|bun|deno|npm|pnpm|yarn)(?:\.exe)?$/i.test(item.name)
    ) {
      continue;
    }
    const lines: string[] = [];
    let ancestor: ScriptProcess | undefined = item;
    const visited = new Set<number>();
    while (ancestor && !visited.has(ancestor.pid) && visited.size < 5) {
      visited.add(ancestor.pid);
      lines.push(ancestor.commandLine);
      if (ancestor.cwd) {
        lines.push(`${ancestor.cwd}/`);
      }
      ancestor = byPid.get(ancestor.parent);
    }
    const npm = identifyProcessScript(
      lines,
      candidates.filter((candidate) => !candidate.file),
    );
    if (npm) {
      add(npm, item.pid);
    }
    const args = (item.commandLine.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? []).map(
      (token) => token.replace(/^["']|["']$/g, ""),
    );
    // Locate the actual Node entry, excluding eval text, preload modules and option values.
    let entry: string | undefined;
    for (let index = 1; index < args.length; index++) {
      const arg = args[index];
      if (
        ["-e", "--eval", "-p", "--print"].includes(arg) ||
        /^(?:--eval|--print)=/.test(arg)
      ) {
        break;
      }
      if (
        [
          "-r",
          "--require",
          "--import",
          "--loader",
          "--experimental-loader",
          "--inspect-port",
          "--test-name-pattern",
        ].includes(arg)
      ) {
        index++;
        continue;
      }
      if (arg.startsWith("-")) {
        continue;
      }
      entry = arg;
      break;
    }
    if (!entry) {
      continue;
    }
    for (const candidate of candidates.filter((candidate) => candidate.file)) {
      const absolute = normalize(path.resolve(candidate.dir, candidate.file!));
      const actual = normalize(entry);
      const resolved = item.cwd
        ? normalize(path.resolve(item.cwd, entry))
        : undefined;
      const relative = normalize(candidate.file!).replace(/^\.\//, "");
      const scoped = lines.some((line) =>
        normalize(line).includes(
          `${normalize(candidate.dir).replace(/\/$/, "")}/`,
        ),
      );
      if (
        actual === absolute ||
        resolved === absolute ||
        (!path.isAbsolute(entry) &&
          !item.cwd &&
          scoped &&
          actual.replace(/^\.\//, "") === relative)
      ) {
        add(candidate, item.pid);
      }
    }
  }
  return result;
}
