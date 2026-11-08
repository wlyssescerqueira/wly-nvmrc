import * as vscode from "vscode";
import * as path from "path";
import { NvmrcController } from "../controller";
import { ScriptCatalog, type ScriptNode } from "../services/scriptCatalog";
import { ScriptRunner, type RunMode } from "../services/scriptRunner";
import { revealScript } from "../services/scriptsService";
import {
  listScriptProcesses,
  matchScriptProcesses,
  runtimeKey,
} from "../services/scriptProcesses";
import { discoverScriptFiles } from "../services/scriptFiles";
import { isScriptShortcut } from "../services/scriptVisibility";
import { identifyProcessScript } from "../services/processScript";
import {
  androidReady,
  configureAndroid,
  startAndroidEmulator,
} from "../services/androidService";
import {
  detectScriptPorts,
  findPortListeners,
  killProcess,
  listAllListeners,
  waitForPortsFree,
} from "../services/portService";
import { findAdhocServers } from "../services/adhocServers";
import {
  isNvmAvailable,
  useVersion,
  nvmUnavailableMessage,
} from "../services/nvmService";
import { log, toast } from "../utils/output";
import type {
  FooterListener,
  FooterProject,
  FooterState,
} from "../ui/statusBar";
import { isAndroidProject, openApkFolder } from "../services/mobileService";

function setting<T>(name: string, fallback: T): T {
  return vscode.workspace
    .getConfiguration("wlyNvmrc.scripts")
    .get<T>(name, fallback);
}

/** Returns false when the user cancelled. */
async function ensureNodeVersion(
  controller: NvmrcController,
  node: ScriptNode,
): Promise<boolean> {
  if (!setting("checkNodeVersion", true)) {
    return true;
  }
  const status = controller.getStatus();
  if (status.kind !== "ready") {
    return true;
  }
  const dir =
    process.platform === "win32"
      ? node.project.dir.toLowerCase()
      : node.project.dir;
  const project = status.projects.find(
    (item) =>
      (process.platform === "win32" ? item.path.toLowerCase() : item.path) ===
      dir,
  );
  if (project?.matches !== false || !project.required) {
    return true;
  }

  const switchLabel = `Switch to v${project.required} and run`;
  const choice = await vscode.window.showWarningMessage(
    `${node.project.label} requires Node v${project.required}, but the active version is v${status.current}.`,
    { modal: true },
    switchLabel,
    "Run anyway",
  );
  if (choice === "Run anyway") {
    return true;
  }
  if (choice !== switchLabel) {
    return false;
  }
  if (!(await isNvmAvailable())) {
    toast(nvmUnavailableMessage, "error");
    return false;
  }
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Running "nvm use ${project.required}"...`,
      },
      () => useVersion(project.required!),
    );
  } catch (error) {
    toast(
      `Failed to run "nvm use ${project.required}": ${error instanceof Error ? error.message : String(error)}`,
      "error",
    );
    return false;
  }
  await controller.refresh();
  return true;
}

/** Warns about busy ports and offers to kill whatever holds them. Returns false when the user cancelled. */
async function ensurePortsFree(node: ScriptNode): Promise<boolean> {
  if (!setting("checkPorts", true)) {
    return true;
  }
  const ports = detectScriptPorts(node.project.dir, node.script);
  if (ports.length === 0) {
    return true;
  }
  const listeners = await findPortListeners(ports);
  if (listeners.length === 0) {
    return true;
  }

  const summary = listeners
    .map((item) => `Port ${item.port} — ${item.processName} (PID ${item.pid})`)
    .join("\n");
  const plural = listeners.length > 1;
  const choice = await vscode.window.showWarningMessage(
    `${plural ? "Ports are" : `Port ${listeners[0].port} is`} already in use. Kill ${plural ? "them" : "it"} and start "${node.script}"?`,
    { modal: true, detail: summary },
    "Kill and start",
    "Start anyway",
  );
  if (choice === "Start anyway") {
    return true;
  }
  if (choice !== "Kill and start") {
    return false;
  }

  for (const pid of new Set(listeners.map((item) => item.pid))) {
    try {
      await killProcess(pid);
      log(
        `[scripts] killed PID ${pid} holding ${listeners
          .filter((item) => item.pid === pid)
          .map((item) => item.port)
          .join(", ")}`,
      );
    } catch (error) {
      toast(
        `Could not kill PID ${pid}: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
      return false;
    }
  }
  if (!(await waitForPortsFree(ports))) {
    const retry = await vscode.window.showWarningMessage(
      `Port ${ports.join(", ")} is still busy after killing the process.`,
      { modal: true },
      "Start anyway",
    );
    return retry === "Start anyway";
  }
  return true;
}

/** Stops our own task and gives its server a moment to release the ports. */
async function stopAndSettle(
  runner: ScriptRunner,
  node: ScriptNode,
): Promise<void> {
  await runner.stop(node.project.dir, node.script);
  await waitForPortsFree(
    detectScriptPorts(node.project.dir, node.script),
    3000,
  );
}

async function runScript(
  controller: NvmrcController,
  runner: ScriptRunner,
  node: ScriptNode,
  mode: RunMode = "task",
): Promise<void> {
  if (!vscode.workspace.isTrusted) {
    toast("Confie neste workspace antes de executar scripts.", "warn");
    return;
  }
  if (runner.isRunning(node.project.dir, node.script)) {
    const choice = await vscode.window.showWarningMessage(
      `"${node.script}" is already running. Restart it?`,
      { modal: true },
      "Restart",
    );
    if (choice !== "Restart") {
      return;
    }
    await stopAndSettle(runner, node);
  }
  if (!(await ensureNodeVersion(controller, node))) {
    return;
  }
  if (!(await ensurePortsFree(node))) {
    return;
  }
  await runner.start(node.project, node.script, mode, node.args);
}

/** Restarts in the same mode (task or debug) the script was running in. */
async function restartScript(
  runner: ScriptRunner,
  node: ScriptNode,
): Promise<void> {
  const mode = runner.runningMode(node.project.dir, node.script) ?? "task";
  await stopAndSettle(runner, node);
  if (!(await ensurePortsFree(node))) {
    return;
  }
  if (vscode.workspace.isTrusted) {
    await runner.start(node.project, node.script, mode, node.args);
  }
}

/** Kills identified script processes, including workers without listening ports. */
async function killScriptPorts(node: ScriptNode): Promise<void> {
  if (!vscode.workspace.isTrusted) {
    toast("Confie neste workspace antes de encerrar processos.", "warn");
    return;
  }
  const candidate = {
    dir: node.project.dir,
    script: node.script,
    command: node.command,
    file: node.file,
  };
  const key = runtimeKey(candidate.dir, candidate.script);
  const processes = await listScriptProcesses();
  const pids = matchScriptProcesses(processes, [candidate]).get(key) ?? [];
  const listeners = await findPortListeners(
    detectScriptPorts(node.project.dir, node.script),
  );
  const targets = new Set([...pids, ...listeners.map((item) => item.pid)]);
  if (targets.size === 0) {
    toast(`Nenhum processo em execução para "${node.script}".`);
    return;
  }
  const choice = await vscode.window.showWarningMessage(
    `Matar processo de "${node.script}"?`,
    {
      modal: true,
      detail: [
        ...pids.map((pid) => `PID ${pid}`),
        ...listeners.map(
          (item) => `Port ${item.port} — ${item.processName} (PID ${item.pid})`,
        ),
      ].join("\n"),
    },
    "Matar processo",
  );
  if (choice !== "Matar processo") {
    return;
  }
  const fresh = await listScriptProcesses();
  const current = new Set(
    matchScriptProcesses(fresh, [candidate]).get(key) ?? [],
  );
  const currentListeners = await findPortListeners(
    detectScriptPorts(node.project.dir, node.script),
  );
  for (const pid of targets) {
    const sameProcess = processes.find((item) => item.pid === pid);
    const stillSame = fresh.some(
      (item) =>
        item.pid === pid &&
        sameProcess &&
        item.commandLine === sameProcess.commandLine &&
        item.parent === sameProcess.parent,
    );
    if (
      !stillSame ||
      (!current.has(pid) &&
        !currentListeners.some(
          (item) =>
            item.pid === pid &&
            listeners.some(
              (previous) => previous.pid === pid && previous.port === item.port,
            ),
        ))
    ) {
      continue;
    }
    try {
      await killProcess(pid);
      log(`[scripts] killed PID ${pid}`);
    } catch (error) {
      toast(
        `Could not kill PID ${pid}: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  }
}

/** Kills a server started outside the scripts, after checking the PID still runs the same command. */
async function killAdhocServer(target: {
  pid: number;
  commandLine: string;
  command?: string;
}): Promise<void> {
  if (!vscode.workspace.isTrusted) {
    toast("Confie neste workspace antes de encerrar processos.", "warn");
    return;
  }
  const same = (processes: Awaited<ReturnType<typeof listScriptProcesses>>) =>
    processes.some(
      (item) =>
        item.pid === target.pid && item.commandLine === target.commandLine,
    );
  if (!same(await listScriptProcesses())) {
    toast(`O processo ${target.pid} já terminou.`);
    return;
  }
  const choice = await vscode.window.showWarningMessage(
    `Matar "${target.command ?? target.commandLine}"?`,
    { modal: true, detail: `PID ${target.pid}\n${target.commandLine}` },
    "Matar processo",
  );
  if (choice !== "Matar processo" || !same(await listScriptProcesses())) {
    return;
  }
  try {
    await killProcess(target.pid);
    log(`[scripts] killed PID ${target.pid} (${target.commandLine})`);
  } catch (error) {
    toast(
      `Could not kill PID ${target.pid}: ${error instanceof Error ? error.message : String(error)}`,
      "error",
    );
  }
}

function normalizePath(text: string): string {
  let unified = text.replace(/file:\/\/\/?/gi, "").replace(/\\/g, "/");
  try {
    unified = decodeURIComponent(unified);
  } catch {
    /* keep as is */
  }
  return process.platform === "win32" ? unified.toLowerCase() : unified;
}

/** True when the listener (or one of its ancestors) was launched from a folder of this workspace. */
function belongsToWorkspace(commandLines: string[]): boolean {
  const roots = (vscode.workspace.workspaceFolders ?? []).map(
    (folder) => `${normalizePath(folder.uri.fsPath).replace(/\/$/, "")}/`,
  );
  return commandLines.some((line) => {
    const normalized = normalizePath(line);
    return roots.some((root) => normalized.includes(root));
  });
}

/** Every package.json script and scripts/ file, grouped by project. */
async function pickScript(
  catalog: ScriptCatalog,
): Promise<ScriptNode | undefined> {
  type Item = vscode.QuickPickItem & { node?: ScriptNode };
  const items: Item[] = [];
  for (const project of await catalog.getProjects()) {
    const nodes: ScriptNode[] = [
      ...Object.entries(project.scripts).map(
        ([script, command]): ScriptNode => ({
          kind: "script",
          project,
          script,
          command,
        }),
      ),
      ...(await discoverScriptFiles(project.dir)).map(
        (file): ScriptNode => ({
          kind: "script",
          project,
          script: `file:${file.relativePath}`,
          command: `node ${file.args.join(" ")}`,
          file: file.relativePath,
          args: file.args,
        }),
      ),
    ];
    if (nodes.length === 0) {
      continue;
    }
    items.push(
      { label: project.label, kind: vscode.QuickPickItemKind.Separator },
      ...nodes.map((node) => ({
        label: node.file ?? node.script,
        description: project.label,
        detail: node.command,
        node,
      })),
    );
  }
  if (items.length === 0) {
    toast("No package.json scripts found in this workspace.", "warn");
    return undefined;
  }
  return (
    await vscode.window.showQuickPick(items, {
      placeHolder: "Choose a script to run",
      matchOnDescription: true,
      matchOnDetail: true,
    })
  )?.node;
}

/** Plain-JSON reference used by the status bar's command links. */
type ScriptRef = { dir: string; script: string };

async function resolveScript(
  catalog: ScriptCatalog,
  arg: ScriptNode | ScriptRef | undefined,
): Promise<ScriptNode | undefined> {
  if (!arg) {
    return pickScript(catalog);
  }
  if ("project" in arg) {
    return arg;
  }
  const project = (await catalog.getProjects()).find(
    (item) => runtimeKey(item.dir, "") === runtimeKey(arg.dir, ""),
  );
  if (project && arg.script.startsWith("file:")) {
    const file = (await discoverScriptFiles(project.dir)).find(
      (file) => `file:${file.relativePath}` === arg.script,
    );
    return file
      ? {
          kind: "script",
          project,
          script: arg.script,
          command: `node ${file.args.join(" ")}`,
          file: file.relativePath,
          args: file.args,
        }
      : undefined;
  }
  const command = project?.scripts[arg.script];
  return project && command !== undefined
    ? { kind: "script", project, script: arg.script, command }
    : undefined;
}

/** Mirrors the scripts (servers and running ones) into the status bar menu, with who holds their ports. */
async function syncFooter(
  controller: NvmrcController,
  catalog: ScriptCatalog,
  runner: ScriptRunner,
): Promise<void> {
  const catalogProjects = await catalog.getProjects();
  const scripts = await Promise.all(
    catalogProjects.map(async (project) => ({
      label: project.label,
      name:
        project.dir === project.workspaceFolder.uri.fsPath
          ? project.workspaceFolder.name
          : path.basename(project.dir),
      dir: project.dir,
      android: isAndroidProject(project.dir),
      scripts: [
        ...Object.entries(project.scripts).map(([script, command]) => ({
          dir: project.dir,
          script,
          command,
          ports: detectScriptPorts(project.dir, script),
          mode: runner.runningMode(project.dir, script),
          shortcut: isScriptShortcut(project, command, catalogProjects),
        })),
        ...(await discoverScriptFiles(project.dir)).map((file) => ({
          dir: project.dir,
          script: `file:${file.relativePath}`,
          command: `node ${file.args.join(" ")}`,
          file: file.relativePath,
          ports: [] as number[],
          mode: runner.runningMode(project.dir, `file:${file.relativePath}`),
        })),
      ],
    })),
  );

  const processes = await listScriptProcesses().catch(() => []);
  const running = matchScriptProcesses(
    processes,
    scripts.flatMap((project) => project.scripts),
  );
  const allPorts = [
    ...new Set(
      scripts.flatMap((project) =>
        project.scripts.flatMap((script) => script.ports),
      ),
    ),
  ];
  const listeners: FooterListener[] = (
    await findPortListeners(allPorts).catch(() => [])
  ).map((item) => ({
    port: item.port,
    pid: item.pid,
    processName: item.processName,
    ours: belongsToWorkspace(item.commandLines),
    owner: identifyProcessScript(
      item.commandLines,
      scripts.flatMap((project) =>
        project.scripts.filter((script) => script.ports.includes(item.port)),
      ),
    ),
  }));

  // Servers started outside the scripts (`npx next dev`, a terminal) hold ports no script declares.
  const adhoc = findAdhocServers(
    processes,
    await listAllListeners().catch(() => []),
    scripts.map((project) => project.dir),
    new Set([
      ...[...running.values()].flat(),
      ...listeners.map((listener) => listener.pid),
    ]),
    new Set(allPorts),
  );

  const projects: FooterProject[] = scripts.map((project) => ({
    label: project.label,
    name: project.name,
    apkDir: project.android ? project.dir : undefined,
    androidReady: project.android ? androidReady() : undefined,
    adhoc: adhoc
      .filter(
        (server) => runtimeKey(server.dir, "") === runtimeKey(project.dir, ""),
      )
      .map((server) => ({
        dir: server.dir,
        script: server.command,
        command: server.commandLine,
        ports: server.ports,
        state: "external" as const,
        listeners: server.listeners.map((listener) => ({
          ...listener,
          ours: true,
        })),
        pids: [server.pid],
        adhoc: { pid: server.pid, commandLine: server.commandLine },
      })),
    scripts: project.scripts.map(({ mode, ...script }) => {
      const held = listeners.filter((listener) =>
        script.ports.includes(listener.port),
      );
      const pids = running.get(runtimeKey(script.dir, script.script)) ?? [];
      const state: FooterState =
        mode ??
        (pids.length ? "external" : undefined) ??
        (held.length === 0
          ? "idle"
          : held.some((listener) => !listener.ours)
            ? "conflict"
            : held.every(
                  (listener) =>
                    listener.owner?.dir === script.dir &&
                    listener.owner.script === script.script,
                )
              ? "external"
              : held.every((listener) => listener.owner)
                ? "occupied"
                : "unknown");
      return { ...script, state, listeners: held, pids };
    }),
  }));
  controller.statusBar.setScripts(projects);
}

export function registerScriptCommands(
  context: vscode.ExtensionContext,
  controller: NvmrcController,
): ScriptCatalog {
  const runner = new ScriptRunner();
  const catalog = new ScriptCatalog(controller, runner);
  // Port owners change outside our control (servers started in a terminal,
  // another window), so the menu is re-synced on a timer too; runs never overlap.
  let syncing: Promise<void> | undefined;
  let pending = false;
  const footer = () => {
    if (syncing) {
      pending = true;
      return;
    }
    syncing = syncFooter(controller, catalog, runner)
      .catch((error) =>
        log(
          `[scripts] footer sync failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
      .finally(() => {
        syncing = undefined;
        if (pending) {
          pending = false;
          footer();
        }
      });
  };
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  const restartPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
    }
    const seconds = vscode.workspace
      .getConfiguration("wlyNvmrc")
      .get<number>("pollIntervalSeconds", 15);
    if (seconds > 0) {
      pollTimer = setInterval(() => {
        if (vscode.window.state.focused) {
          footer();
        }
      }, seconds * 1000);
    }
  };
  restartPolling();
  context.subscriptions.push(
    runner,
    catalog,
    vscode.commands.registerCommand(
      "wlyNvmrc.android.startEmulator",
      startAndroidEmulator,
    ),
    vscode.commands.registerCommand(
      "wlyNvmrc.android.configure",
      configureAndroid,
    ),
    vscode.commands.registerCommand(
      "wlyNvmrc.scripts.openApkFolder",
      async (dir?: string) => {
        const projects = (await catalog.getProjects()).filter((project) =>
          isAndroidProject(project.dir),
        );
        const project = dir
          ? projects.find((project) => project.dir === dir)
          : projects.length === 1
            ? projects[0]
            : (
                await vscode.window.showQuickPick(
                  projects.map((project) => ({
                    label: project.label,
                    project,
                  })),
                  { placeHolder: "Choose an Android project" },
                )
              )?.project;
        if (project) {
          await openApkFolder(project.dir);
        }
      },
    ),
    catalog.onDidChange(footer),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("wlyNvmrc.android")) {
        footer();
      }
    }),
    vscode.commands.registerCommand("wlyNvmrc.scripts.refresh", () =>
      catalog.reload(),
    ),
    vscode.commands.registerCommand(
      "wlyNvmrc.scripts.run",
      async (arg?: ScriptNode | ScriptRef) => {
        const target = await resolveScript(catalog, arg);
        if (target) {
          await runScript(controller, runner, target);
        }
      },
    ),
    vscode.commands.registerCommand(
      "wlyNvmrc.scripts.debug",
      async (arg?: ScriptNode | ScriptRef) => {
        const target = await resolveScript(catalog, arg);
        if (target) {
          await runScript(controller, runner, target, "debug");
        }
      },
    ),
    vscode.commands.registerCommand(
      "wlyNvmrc.scripts.kill",
      async (arg: ScriptNode | ScriptRef) => {
        const target = await resolveScript(catalog, arg);
        if (target) {
          await killScriptPorts(target);
          footer();
        }
      },
    ),
    vscode.commands.registerCommand(
      "wlyNvmrc.scripts.killProcess",
      async (target?: {
        pid: number;
        commandLine: string;
        command?: string;
      }) => {
        if (
          target &&
          Number.isSafeInteger(target.pid) &&
          typeof target.commandLine === "string"
        ) {
          await killAdhocServer(target);
          footer();
        }
      },
    ),
    { dispose: () => pollTimer && clearInterval(pollTimer) },
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) {
        footer();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("wlyNvmrc.pollIntervalSeconds")) {
        restartPolling();
      }
    }),
    vscode.commands.registerCommand(
      "wlyNvmrc.scripts.stop",
      async (arg: ScriptNode | ScriptRef) => {
        const target = await resolveScript(catalog, arg);
        if (target) {
          await runner.stop(target.project.dir, target.script);
        }
      },
    ),
    vscode.commands.registerCommand(
      "wlyNvmrc.scripts.restart",
      async (arg: ScriptNode | ScriptRef) => {
        const target = await resolveScript(catalog, arg);
        if (target) {
          await restartScript(runner, target);
        }
      },
    ),
    vscode.commands.registerCommand(
      "wlyNvmrc.scripts.open",
      async (arg: ScriptNode | ScriptRef) => {
        const target = await resolveScript(catalog, arg);
        if (target) {
          if (target.file) {
            await vscode.window.showTextDocument(
              vscode.Uri.file(path.join(target.project.dir, target.file)),
            );
          } else {
            await revealScript(target.project, target.script);
          }
        }
      },
    ),
  );
  footer();
  return catalog;
}
