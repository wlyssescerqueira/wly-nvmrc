import * as fs from 'fs';
import * as path from 'path';
import { run } from '../utils/exec';
import { readScripts } from './scriptsService';

export type PortListener = {
    port: number;
    pid: number;
    processName: string;
};

const PORT = '(\\d{2,5})';

function readText(file: string, maxBytes = 200_000): string | undefined {
    try {
        const stat = fs.statSync(file);
        if (!stat.isFile() || stat.size > maxBytes) {return undefined;}
        return fs.readFileSync(file, 'utf8');
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
    for (const name of ['.env', '.env.development', '.env.local', '.env.development.local']) {
        const text = readText(path.join(dir, name));
        const match = text && new RegExp(`^\\s*(?:export\\s+)?PORT\\s*=\\s*["']?${PORT}`, 'm').exec(text);
        if (match) {port = toPort(match[1]);}
    }
    return port;
}

/** `process.env.PORT || 3011` / `?? 3011` fallback written in the server entry file. */
function entryFilePort(dir: string, command: string): number | undefined {
    const entries = [...command.matchAll(/(?:^|\s)([\w./\\-]+\.(?:[cm]?[jt]s))(?=\s|$)/g)].map((match) => match[1]);
    if (/\bnest\s+start\b/.test(command)) {entries.push('src/main.ts');}
    for (const entry of entries) {
        const text = readText(path.join(dir, entry));
        const match = text && new RegExp(`process\\.env\\.PORT\\s*(?:\\|\\||\\?\\?)\\s*["']?${PORT}`).exec(text);
        if (match) {return toPort(match[1]);}
    }
    return undefined;
}

function configPort(dir: string, files: string[], pattern: RegExp): number | undefined {
    for (const file of files) {
        const match = readText(path.join(dir, file))?.match(pattern);
        if (match) {return toPort(match[1]);}
    }
    return undefined;
}

/** Port a single command line listens on, judged by explicit flags, config and framework defaults. */
function commandPort(dir: string, script: string, command: string): number | undefined {
    const explicit = new RegExp(`(?:--port|(?:^|\\s)-p)(?:=|\\s+)${PORT}\\b`).exec(command)
        ?? new RegExp(`\\bPORT=${PORT}\\b`).exec(command);
    if (explicit) {return toPort(explicit[1]);}

    if (/\bnext\s+(?:dev|start)\b|\bnext\s*$/.test(command)) {return 3000;} // Next ignores PORT in .env
    if (/\bvite\s+preview\b/.test(command)) {return 4173;}
    if (/\bvite\b(?!\s+(?:build|optimize))/.test(command) || /\bremix\s+vite:dev\b/.test(command)) {
        return configPort(dir, ['vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs'], /\bport\s*:\s*(\d{2,5})/) ?? 5173;
    }
    if (/\bng\s+serve\b/.test(command)) {return configPort(dir, ['angular.json'], /"port"\s*:\s*(\d{2,5})/) ?? 4200;}
    if (/\breact-scripts\s+start\b/.test(command)) {return envPort(dir) ?? 3000;}
    if (/\bnuxi?\s+dev\b/.test(command)) {return envPort(dir) ?? 3000;}
    if (/\bastro\s+dev\b/.test(command)) {return 4321;}
    if (/\bexpo\s+start\b/.test(command)) {return 8081;}
    if (/\bgatsby\s+develop\b/.test(command)) {return 8000;}
    if (/\bstorybook\s+dev\b|\bstart-storybook\b/.test(command)) {return 6006;}
    if (/\bwebpack(?:-dev-server|\s+serve)\b/.test(command)) {return 8080;}
    // Plain runtimes also run one-off tools (seeds, tests), so only treat
    // long-running scripts as servers.
    const serverLike = /^(?:dev|start|serve|server|preview|watch)(?:$|:)/.test(script)
        || /\bwatch\b|\bnodemon\b|\bnest\s+start\b|\bts-node-dev\b/.test(command);
    if (serverLike && /\b(?:node|tsx|ts-node|ts-node-dev|nodemon|nest\s+start)\b/.test(command)) {
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
        const runner = /\b(?:npm|pnpm|yarn|bun)\b(?:\s+--prefix[\s=]+(\S+))?\s+run\s+([\w:.-]+)(?:.*?--prefix[\s=]+(\S+))?/.exec(segment);
        if (runner) {
            const prefix = runner[1] ?? runner[3];
            refs.push({ dir: prefix ? path.resolve(base, prefix.replace(/["']/g, '')) : base, script: runner[2] });
        }
    }

    // Orchestrator scripts spawn `npm run <x>` inside sibling packages they name.
    const node = /^\s*node\s+([\w./\\-]+\.[cm]?js)\b/.exec(command);
    const source = node && readText(path.join(dir, node[1]));
    if (source) {
        const scripts = new Set([
            ...[...source.matchAll(/["']run["']\s*,\s*["']([\w:.-]+)["']/g)].map((match) => match[1]),
            ...[...source.matchAll(/\b(?:npm|pnpm|yarn)\s+run\s+([\w:.-]+)/g)].map((match) => match[1])
        ]);
        let children: string[] = [];
        try {
            children = fs.readdirSync(dir, { withFileTypes: true })
                .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
                .map((entry) => entry.name)
                .filter((name) => fs.existsSync(path.join(dir, name, 'package.json')) && new RegExp(`["'\`/\\\\]${name}["'\`/\\\\]`).test(source));
        } catch { /* unreadable dir: no children */ }
        for (const child of children) {
            for (const script of scripts) {refs.push({ dir: path.join(dir, child), script });}
        }
    }
    return refs;
}

/** Every port the script is expected to listen on, following delegations to other scripts. */
export function detectScriptPorts(dir: string, script: string): number[] {
    const ports = new Set<number>();
    const visited = new Set<string>();
    const visit = (ref: ScriptRef, depth: number) => {
        const key = `${ref.dir.toLowerCase()}|${ref.script}`;
        if (depth > 4 || visited.has(key)) {return;}
        visited.add(key);
        const command = readScripts(ref.dir)[ref.script];
        if (!command) {return;}
        const delegated = delegatedScripts(ref.dir, command);
        delegated.forEach((child) => visit(child, depth + 1));
        if (delegated.length === 0) {
            const port = commandPort(ref.dir, ref.script, command);
            if (port) {ports.add(port);}
        }
    };
    visit({ dir, script }, 0);
    return [...ports].sort((a, b) => a - b);
}

async function processName(pid: number): Promise<string> {
    try {
        if (process.platform === 'win32') {
            const { stdout } = await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
            return /^"([^"]+)"/.exec(stdout.trim())?.[1] ?? 'unknown';
        }
        const { stdout } = await run('ps', ['-p', String(pid), '-o', 'comm=']);
        return path.basename(stdout.trim()) || 'unknown';
    } catch {
        return 'unknown';
    }
}

async function listeningPids(ports: number[]): Promise<Map<number, Set<number>>> {
    const result = new Map<number, Set<number>>();
    const add = (port: number, pid: number) => {
        if (!ports.includes(port) || !pid) {return;}
        if (!result.has(port)) {result.set(port, new Set());}
        result.get(port)!.add(pid);
    };
    if (process.platform === 'win32') {
        // State names are localized ("LISTENING", "ESCUTANDO"...), so identify
        // listeners by their wildcard remote address instead.
        const { stdout } = await run('netstat', ['-ano', '-p', 'TCP']).catch(() => ({ stdout: '' }));
        const { stdout: stdout6 } = await run('netstat', ['-ano', '-p', 'TCPv6']).catch(() => ({ stdout: '' }));
        for (const line of `${stdout}\n${stdout6}`.split(/\r?\n/)) {
            const columns = line.trim().split(/\s+/);
            if (columns.length < 5 || !/^TCP/i.test(columns[0]) || !/:0$/.test(columns[2])) {continue;}
            add(Number(columns[1].slice(columns[1].lastIndexOf(':') + 1)), Number(columns[columns.length - 1]));
        }
    } else {
        for (const port of ports) {
            const { stdout } = await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']).catch(() => ({ stdout: '' }));
            stdout.split(/\s+/).filter(Boolean).forEach((pid) => add(port, Number(pid)));
        }
    }
    return result;
}

export async function findPortListeners(ports: number[]): Promise<PortListener[]> {
    if (ports.length === 0) {return [];}
    const listeners: PortListener[] = [];
    for (const [port, pids] of await listeningPids(ports)) {
        for (const pid of pids) {listeners.push({ port, pid, processName: await processName(pid) });}
    }
    return listeners.sort((a, b) => a.port - b.port);
}

export async function killProcess(pid: number): Promise<void> {
    if (process.platform === 'win32') {
        await run('taskkill', ['/PID', String(pid), '/T', '/F']);
        return;
    }
    process.kill(pid, 'SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {process.kill(pid, 'SIGKILL');} catch { /* already gone */ }
}

/** Resolves true once none of the ports has a listener, false after the timeout. */
export async function waitForPortsFree(ports: number[], timeoutMs = 8000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if ((await listeningPids(ports)).size === 0) {return true;}
        await new Promise((resolve) => setTimeout(resolve, 400));
    }
    return false;
}
