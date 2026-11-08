import * as vscode from "vscode";
import type { NvmrcStatus } from "../types";

/** Process listening on one of the script's ports, and whether it belongs to this workspace. */
export type FooterListener = {
  port: number;
  pid: number;
  processName: string;
  ours: boolean;
  owner?: { dir: string; script: string };
};
/**
 * - `task` / `debug`: started from this window.
 * - `external`: its ports are held by processes of this workspace started elsewhere (a terminal, another window).
 * - `conflict`: a port is held by a process of another project.
 */
export type FooterState =
  | "idle"
  | "task"
  | "debug"
  | "external"
  | "conflict"
  | "occupied"
  | "unknown";
export type FooterScript = {
  dir: string;
  script: string;
  command: string;
  ports: number[];
  state: FooterState;
  listeners: FooterListener[];
  pids?: number[];
  /** Root alias such as `npm run dev --prefix frontend` whose target script is also listed. */
  shortcut?: boolean;
  /** Server started outside the scripts (`npx next dev`, a terminal); `script` holds its short command. */
  adhoc?: { pid: number; commandLine: string };
};
export type FooterProject = {
  label: string;
  /** Folder name shown in the menu (`frontend`, or the workspace name for the root). */
  name: string;
  scripts: FooterScript[];
  /** Servers of this project holding ports outside its scripts. */
  adhoc?: FooterScript[];
  apkDir?: string;
  androidReady?: boolean;
};

function link(
  label: string,
  command: string,
  args?: unknown,
  title?: string,
): string {
  const query =
    args === undefined ? "" : `?${encodeURIComponent(JSON.stringify(args))}`;
  // Pipes are escaped too, because links also live inside table cells.
  const hint = title
    ? ` "${title.replace(/["\\]/g, "\\$&").replace(/\|/g, "\\|")}"`
    : "";
  return `[${label}](command:${command}${query}${hint})`;
}

function escape(text: string): string {
  return text.replace(/[\\`*_[\]<>|]/g, "\\$&");
}

/** Hovers only accept hex or `var(--vscode-…)` colors in a span's style. */
function colored(text: string, themeColor: string): string {
  return `<span style="color:var(--vscode-${themeColor});">${text}</span>`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Idle scripts get no icon, so the running ones stand out. */
const STATE_ICONS: Record<FooterState, string> = {
  idle: "",
  task: colored("$(sync~spin)", "debugIcon-startForeground"),
  debug: colored("$(debug-alt)", "debugIcon-startForeground"),
  external: colored("$(run-all)", "debugIcon-startForeground"),
  conflict: "$(warning)",
  occupied: "$(circle-outline)",
  unknown: "$(question)",
};

const LEGEND: Record<Exclude<FooterState, "idle">, string> = {
  task: "rodando nesta janela",
  debug: "depurando nesta janela",
  external: "rodando fora desta janela",
  conflict: "porta usada por outro projeto",
  occupied: "porta usada por outro script",
  unknown: "porta ocupada por processo não identificado",
};

function isActive(item: FooterScript): boolean {
  return (
    item.state === "task" || item.state === "debug" || item.state === "external"
  );
}

function table(header: string[], rows: string[][]): string {
  return [
    `| ${header.join(" | ")} |`,
    `|${header.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

/** Node version plus only the projects that need attention; matching ones are summarised. */
function nodeSection(status: NvmrcStatus): string {
  const problems = status.projects.filter(
    (project) => project.matches !== true,
  );
  const ok = status.projects.length - problems.length;
  const title =
    status.kind === "node-not-found"
      ? "$(circle-slash) **Node.js não encontrado**"
      : status.kind === "ready"
        ? `$(versions) **Node v${status.current}**`
        : "$(versions) **Node**";
  const summary =
    problems.length === 0
      ? `$(check) ${plural(ok, "projeto compatível", "projetos compatíveis")}`
      : ok > 0
        ? `${ok} de ${status.projects.length} compatíveis`
        : "";
  const lines = [summary ? `${title} · ${summary}` : title];
  if (problems.length) {
    lines.push(
      table(
        ["Projeto", "Exige", ""],
        problems.map((project) => [
          escape(project.name),
          !project.required
            ? "—"
            : `v${project.required}${project.source === "engines" ? " (engines)" : ""}`,
          project.matches === false
            ? "$(error) versão diferente"
            : !project.required
              ? "$(warning) sem .nvmrc"
              : "$(question) não verificado",
        ]),
      ),
    );
  }
  const actions: string[] = [];
  if (
    status.kind === "node-not-found" ||
    status.projects.some((project) => project.matches === false)
  ) {
    actions.push(
      link(
        "$(sync) nvm use",
        "wlyNvmrc.useRequiredVersion",
        undefined,
        "Trocar para a versão do .nvmrc",
      ),
      link(
        "$(cloud-download) nvm install",
        "wlyNvmrc.installRequiredVersion",
        undefined,
        "Instalar a versão do .nvmrc",
      ),
    );
  }
  // Projects pinned through "engines" are fine; "Projetos…" still offers to turn that into a .nvmrc.
  if (status.projects.some((project) => !project.required)) {
    actions.push(link("$(add) Criar .nvmrc", "wlyNvmrc.createNvmrc"));
  }
  if (status.projects.some((project) => project.source === "nvmrc")) {
    actions.push(link("$(go-to-file) Abrir .nvmrc", "wlyNvmrc.openNvmrcFile"));
  }
  if (actions.length) {
    lines.push(actions.join(" · "));
  }
  return lines.join("\n\n");
}

/** Who holds the script's ports, without repeating the port numbers. */
function holders(item: FooterScript, listeners: FooterListener[]): string {
  const names = [
    ...new Set(
      listeners.map((listener) => `${listener.processName} #${listener.pid}`),
    ),
  ];
  if (names.length) {
    return names.join(", ");
  }
  return item.pids?.length ? `PID ${item.pids.join(", ")}` : "";
}

function scriptRow(
  project: FooterProject,
  item: FooterScript,
  multiple: boolean,
): string[] {
  if (item.adhoc) {
    const listening = `${item.ports.map((value) => `:${value}`).join(" ")} · *${escape(holders(item, item.listeners))}*`;
    return [
      STATE_ICONS[item.state],
      ...(multiple ? [escape(project.name)] : []),
      `*${escape(item.script)}*`,
      listening,
      link(
        colored("$(close)", "errorForeground"),
        "wlyNvmrc.scripts.killProcess",
        [
          {
            pid: item.adhoc.pid,
            commandLine: item.adhoc.commandLine,
            command: item.script,
          },
        ],
        `Matar PID ${item.adhoc.pid} (${item.script})`,
      ),
    ];
  }
  const ref = { dir: item.dir, script: item.script };
  const name = link(
    `**${escape(item.script.replace(/^file:(?:scripts[\\/])?/, ""))}**`,
    "wlyNvmrc.scripts.open",
    [ref],
    item.command,
  );
  const run = link("$(play)", "wlyNvmrc.scripts.run", [ref], "Executar");
  const debug = link("$(debug)", "wlyNvmrc.scripts.debug", [ref], "Depurar");
  const kill = link(
    colored("$(close)", "errorForeground"),
    "wlyNvmrc.scripts.kill",
    [ref],
    `Matar ${holders(item, item.listeners)}`,
  );
  const restart = link(
    "$(debug-restart)",
    "wlyNvmrc.scripts.restart",
    [ref],
    "Reiniciar",
  );
  const stop = link(
    colored("$(debug-stop)", "errorForeground"),
    "wlyNvmrc.scripts.stop",
    [ref],
    "Parar",
  );
  const shown =
    item.state === "conflict"
      ? item.listeners.filter((listener) => !listener.ours)
      : item.listeners;
  const who =
    item.state === "idle" || item.state === "task" || item.state === "debug"
      ? ""
      : holders(item, shown);
  const port = [
    item.ports.map((value) => `:${value}`).join(" "),
    who ? `*${escape(who)}*` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const actions =
    item.state === "task" || item.state === "debug"
      ? [restart, stop]
      : item.state === "external"
        ? [kill]
        : item.state === "conflict"
          ? [debug, run, kill]
          : [debug, run];
  return [
    STATE_ICONS[item.state],
    ...(multiple ? [escape(project.name)] : []),
    name,
    port,
    actions.join(" "),
  ];
}

/**
 * One table with what matters right now: running scripts and servers (scripts with a port).
 * Root aliases of a listed script are dropped; every script stays one click away in the picker.
 */
function scriptsSection(projects: FooterProject[]): string {
  const multiple = projects.length > 1;
  const visible = projects.flatMap((project, order) =>
    [
      ...project.scripts.filter(
        (item) => isActive(item) || (item.ports.length > 0 && !item.shortcut),
      ),
      ...(project.adhoc ?? []),
    ].map((item) => ({ project, order, item })),
  );
  visible.sort(
    (a, b) =>
      Number(isActive(b.item)) - Number(isActive(a.item)) ||
      a.order - b.order ||
      a.item.script.localeCompare(b.item.script),
  );
  const total = projects.reduce(
    (count, project) => count + project.scripts.length,
    0,
  );
  const lines = ["$(tools) **Scripts**"];
  if (visible.length) {
    lines.push(
      table(
        ["", ...(multiple ? ["Projeto"] : []), "Script", "Porta", ""],
        visible.map(({ project, item }) => scriptRow(project, item, multiple)),
      ),
    );
  }
  const android = projects.filter((project) => project.apkDir);
  for (const project of android) {
    const prefix = android.length > 1 ? `${escape(project.name)}: ` : "";
    const emulator = project.androidReady
      ? link(
          "$(device-mobile) Emulador Android",
          "wlyNvmrc.android.startEmulator",
        )
      : link("$(warning) Configurar Android SDK", "wlyNvmrc.android.configure");
    const apk = link(
      "$(folder-opened) Pasta do APK",
      "wlyNvmrc.scripts.openApkFolder",
      [project.apkDir],
    );
    lines.push(`${prefix}${emulator} · ${apk}`);
  }
  lines.push(
    link(
      `$(list-unordered) Todos os scripts (${total})…`,
      "wlyNvmrc.scripts.run",
      undefined,
      "Escolher qualquer script do workspace",
    ),
  );
  const states = new Set(visible.map(({ item }) => item.state));
  const legend = (Object.keys(LEGEND) as (keyof typeof LEGEND)[])
    .filter((state) => states.has(state))
    .map((state) => `${STATE_ICONS[state]} ${LEGEND[state]}`);
  if (visible.some(({ item }) => item.adhoc)) {
    legend.push(
      "comando em itálico: iniciado fora dos scripts do package.json",
    );
  }
  if (legend.length) {
    lines.push(`*${legend.join(" · ")}*`);
  }
  return lines.join("\n\n");
}

function footerSection(): string {
  return [
    link("$(list-selection) Projetos…", "wlyNvmrc.openMenu"),
    link("$(refresh) Atualizar", "wlyNvmrc.refresh"),
    link("$(settings-gear) Configurações", "workbench.action.openSettings", [
      "wlyNvmrc",
    ]),
  ].join(" · ");
}

function buildTooltip(
  status: NvmrcStatus,
  scripts: FooterProject[],
): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString(
    [nodeSection(status), scriptsSection(scripts), footerSection()].join(
      "\n\n---\n\n",
    ),
    true,
  );
  tooltip.isTrusted = true;
  // Only for <span style="color:…"> around icons; text from files is escaped.
  tooltip.supportHtml = true;
  return tooltip;
}

export class NvmrcStatusBar {
  private readonly item: vscode.StatusBarItem;
  private status: NvmrcStatus = { kind: "not-node-project", projects: [] };
  private scripts: FooterProject[] = [];

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.item.command = "wlyNvmrc.openMenu";
  }

  update(status: NvmrcStatus): void {
    this.status = status;
    this.render();
  }

  setScripts(scripts: FooterProject[]): void {
    this.scripts = scripts;
    this.render();
  }

  private render(): void {
    const status = this.status;
    if (status.kind === "not-node-project") {
      this.item.hide();
      return;
    }
    if (status.kind === "node-not-found") {
      this.item.text = "$(circle-slash) Node not found";
      this.item.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.errorBackground",
      );
    } else {
      const mismatches = status.projects.filter(
        (project) => project.matches === false,
      ).length;
      const missing = status.projects.filter(
        (project) => !project.required,
      ).length;
      if (mismatches > 0) {
        this.item.text = `$(alert) Node v${status.current} · ${mismatches} mismatch${mismatches > 1 ? "es" : ""}`;
        this.item.backgroundColor = new vscode.ThemeColor(
          "statusBarItem.errorBackground",
        );
      } else if (missing > 0) {
        this.item.text = `$(warning) ${missing} .nvmrc missing`;
        this.item.backgroundColor = new vscode.ThemeColor(
          "statusBarItem.warningBackground",
        );
      } else {
        this.item.text = `$(check) Node v${status.current} · ${status.projects.length} project${status.projects.length > 1 ? "s" : ""}`;
        this.item.backgroundColor = undefined;
      }
    }
    const running = this.scripts
      .flatMap((project) => [...project.scripts, ...(project.adhoc ?? [])])
      .filter(isActive).length;
    if (running > 0) {
      this.item.text += ` · $(play) ${running}`;
    }
    this.item.tooltip = buildTooltip(status, this.scripts);
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
