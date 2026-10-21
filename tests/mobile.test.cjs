const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { buildSync } = require("esbuild");

function load(entry, mocks = {}) {
  const { text } = buildSync({
    entryPoints: [path.join(__dirname, "..", entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["vscode"],
    write: false,
  }).outputFiles[0];
  const module = { exports: {} };
  new Function("require", "module", "exports", text)(
    (name) => (name in mocks ? mocks[name] : require(name)),
    module,
    module.exports,
  );
  return module.exports;
}

const { isScriptShortcut } = load("src/services/scriptVisibility.ts");
const { identifyProcessScript } = load("src/services/processScript.ts");

const backendDir = path.resolve("workspace/backend");
const backendScripts = [
  { dir: backendDir, script: "dev", command: "tsx watch src/index.ts" },
  { dir: backendDir, script: "start", command: "node dist/index.js" },
];

test("shared backend port: npm ancestor identifies dev, not start", () => {
  const lines = [
    `node --require "${backendDir}/node_modules/tsx/dist/preflight.cjs" src/index.ts`,
    'node "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js" run dev',
  ];
  assert.equal(identifyProcessScript(lines, backendScripts)?.script, "dev");
});

test("direct production entry identifies start using an absolute path", () => {
  assert.equal(
    identifyProcessScript(
      [`node "${backendDir}/dist/index.js"`],
      backendScripts,
    )?.script,
    "start",
  );
});

test("tsx watch shell ancestor identifies dev without npm", () => {
  assert.equal(
    identifyProcessScript(
      [
        `node "${backendDir}/node_modules/tsx/dist/cli.mjs" watch src/index.ts`,
        "cmd.exe /c tsx watch src/index.ts",
      ],
      backendScripts,
    )?.script,
    "dev",
  );
});

test("same port without command evidence remains unknown", () => {
  assert.equal(
    identifyProcessScript(
      [`node "${backendDir}/opaque-server.js"`],
      backendScripts,
    ),
    undefined,
  );
  assert.equal(
    identifyProcessScript(
      ["node C:/other-project/server.js", "npm run dev"],
      backendScripts,
    ),
    undefined,
  );
});

test("identical script commands are ambiguous without a named npm invocation", () => {
  const candidates = [
    ...backendScripts,
    { ...backendScripts[1], script: "serve" },
  ];
  assert.equal(
    identifyProcessScript([`node "${backendDir}/dist/index.js"`], candidates),
    undefined,
  );
});

test("Next dev/start are distinguished by arguments and project directory", () => {
  const candidates = [
    { dir: backendDir, script: "dev", command: "next dev" },
    { dir: backendDir, script: "start", command: "next start" },
  ];
  assert.equal(
    identifyProcessScript(
      [`node "${backendDir}/node_modules/next/dist/bin/next" start`],
      candidates,
    )?.script,
    "start",
  );
});
const root = { dir: path.resolve("workspace"), scripts: {} };
const child = {
  dir: path.resolve("workspace/backend"),
  scripts: { dev: "tsx watch src/index.ts" },
};

test("root wrapper is hidden only if its target script is discovered", () => {
  assert.equal(
    isScriptShortcut(root, "npm run dev --prefix backend", [root, child]),
    true,
  );
  assert.equal(
    isScriptShortcut(root, "npm run dev --prefix backend", [root]),
    false,
  );
  assert.equal(
    isScriptShortcut(root, "npm run missing --prefix backend", [root, child]),
    false,
  );
});

test("wrappers with flags, setup or quoted commands retain their behavior", () => {
  assert.equal(
    isScriptShortcut(root, 'npm run dev --prefix "backend"', [child]),
    true,
  );
  assert.equal(
    isScriptShortcut(root, "npm run dev --prefix backend -- --clear", [child]),
    false,
  );
  assert.equal(
    isScriptShortcut(root, "node setup.js && npm run dev --prefix backend", [
      child,
    ]),
    false,
  );
});

function android({
  configured,
  present = [],
  avds = "",
  pick,
  trusted = true,
} = {}) {
  const tasks = [];
  const info = [];
  const service = load("src/services/androidService.ts", {
    fs: { existsSync: (file) => present.includes(file) },
    child_process: {
      execFile: (_cmd, _args, _options, callback) => callback(null, avds, ""),
    },
    vscode: {
      workspace: {
        isTrusted: trusted,
        getConfiguration: () => ({ get: () => configured }),
      },
      window: {
        showQuickPick: async () => pick,
        showInformationMessage: async (message) => info.push(message),
        showErrorMessage: async (message) => {
          throw new Error(message);
        },
      },
      Task: class {
        constructor(...args) {
          this.args = args;
        }
      },
      TaskScope: { Workspace: 1 },
      ProcessExecution: class {
        constructor(...args) {
          this.args = args;
        }
      },
      tasks: { executeTask: async (task) => tasks.push(task) },
    },
  });
  return { ...service, tasks, info };
}

const sdk = path.resolve("test-sdk");
const installed = [
  path.join(sdk, "platform-tools"),
  path.join(
    sdk,
    "emulator",
    process.platform === "win32" ? "emulator.exe" : "emulator",
  ),
];

test("detects configured SDK and rejects missing installation", () => {
  assert.equal(
    android({ configured: sdk, present: installed }).androidSdk(),
    sdk,
  );
  assert.equal(android({ configured: sdk }).androidSdk(), undefined);
  assert.equal(
    android({ configured: sdk, present: [installed[0]] }).androidReady(),
    false,
  );
});

test("auto-selects the only AVD without a hardcoded name", async () => {
  const service = android({
    configured: sdk,
    present: installed,
    avds: "Any_Device\r\n",
  });
  await service.startAndroidEmulator();
  assert.equal(service.tasks.length, 1);
  assert.deepEqual(service.tasks[0].args[4].args[1], ["-avd", "Any_Device"]);
});

test("canceling multiple AVD picker launches nothing", async () => {
  const service = android({
    configured: sdk,
    present: installed,
    avds: "One\nTwo\n",
  });
  await service.startAndroidEmulator();
  assert.equal(service.tasks.length, 0);
});

test("missing virtual device gives actionable feedback", async () => {
  const service = android({ configured: sdk, present: installed });
  await service.startAndroidEmulator();
  assert.match(service.info[0], /Device Manager/);
  assert.equal(service.tasks.length, 0);
});

test("untrusted workspace cannot launch an emulator task", async () => {
  const service = android({
    configured: sdk,
    present: installed,
    avds: "One",
    trusted: false,
  });
  await service.startAndroidEmulator();
  assert.equal(service.tasks.length, 0);
});

test("detects Android Studio default directory without configured variables", () => {
  const standard =
    process.platform === "win32"
      ? path.join(
          process.env.LOCALAPPDATA ||
            path.join(os.homedir(), "AppData", "Local"),
          "Android",
          "Sdk",
        )
      : path.join(
          os.homedir(),
          process.platform === "darwin" ? "Library/Android/sdk" : "Android/Sdk",
        );
  assert.equal(
    android({ present: [path.join(standard, "platform-tools")] }).androidSdk(),
    standard,
  );
});

test("missing SDK opens setup chooser and can be canceled", async () => {
  const service = android();
  await service.startAndroidEmulator();
  assert.equal(service.tasks.length, 0);
});

test("shortcuts with npm lifecycle hooks stay visible", () => {
  const project = {
    ...root,
    scripts: {
      backend: "npm run dev --prefix backend",
      prebackend: "node prepare.js",
    },
  };
  assert.equal(
    isScriptShortcut(project, project.scripts.backend, [child]),
    false,
  );
});

const fs = require("node:fs/promises");
const { discoverScriptFiles } = load("src/services/scriptFiles.ts");

test("script files: nested files, spaces and tests keep separate Node arguments", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wly-scripts-"));
  try {
    await fs.mkdir(path.join(dir, "scripts", "nested folder"), {
      recursive: true,
    });
    await fs.mkdir(path.join(dir, "scripts", "node_modules"));
    await Promise.all([
      fs.writeFile(
        path.join(dir, "scripts", "nested folder", "worker name.cjs"),
        "",
      ),
      fs.writeFile(path.join(dir, "scripts", "selling.test.cjs"), ""),
      fs.writeFile(path.join(dir, "scripts", "README.md"), ""),
      fs.writeFile(path.join(dir, "scripts", "node_modules", "ignored.js"), ""),
    ]);
    const files = await discoverScriptFiles(dir);
    assert.equal(files.length, 2);
    assert.deepEqual(
      files.find((file) => file.relativePath.endsWith("selling.test.cjs")).args,
      ["--test", path.join("scripts", "selling.test.cjs")],
    );
    assert.deepEqual(
      files.find((file) => file.relativePath.endsWith("worker name.cjs")).args,
      [path.join("scripts", "nested folder", "worker name.cjs")],
    );
    assert.deepEqual(await discoverScriptFiles(path.join(dir, "missing")), []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

const { matchScriptProcesses, runtimeKey } = load(
  "src/services/scriptProcesses.ts",
);
const workerFile = path.join("scripts", "worker name.cjs");
const runtimeCandidates = [
  {
    dir: backendDir,
    script: "worker",
    command: 'node "scripts/worker name.cjs"',
  },
  {
    dir: backendDir,
    script: `file:${workerFile}`,
    command: 'node "scripts/worker name.cjs"',
    file: workerFile,
  },
];

test("external workers without ports mark both npm command and file; exit clears state", () => {
  const worker = {
    pid: 1234,
    parent: 0,
    name: "node.exe",
    commandLine: `node "${path.join(backendDir, workerFile)}"`,
  };
  const found = matchScriptProcesses([worker], runtimeCandidates);
  assert.deepEqual(found.get(runtimeKey(backendDir, "worker")), [1234]);
  assert.deepEqual(
    found.get(runtimeKey(backendDir, `file:${workerFile}`)),
    [1234],
  );
  assert.equal(matchScriptProcesses([], runtimeCandidates).size, 0);
});

test("same worker filename in another project does not mark this project", () => {
  const worker = {
    pid: 2345,
    parent: 0,
    name: "node",
    commandLine: `node "${path.resolve("other/backend", workerFile)}"`,
  };
  assert.equal(matchScriptProcesses([worker], runtimeCandidates).size, 0);
  assert.equal(
    matchScriptProcesses(
      [{ ...worker, commandLine: `node "${workerFile}"` }],
      runtimeCandidates,
    ).size,
    0,
  );
});

test("preload and eval are not mistaken for the running script", () => {
  const absolute = path.join(backendDir, workerFile);
  const worker = {
    pid: 3456,
    parent: 0,
    name: "node",
    commandLine: `node -r dotenv/config "${absolute}"`,
  };
  const key = runtimeKey(backendDir, `file:${workerFile}`);
  assert.deepEqual(
    matchScriptProcesses([worker], runtimeCandidates).get(key),
    [3456],
  );
  assert.equal(
    matchScriptProcesses(
      [{ ...worker, commandLine: `node -r "${absolute}" different.js` }],
      runtimeCandidates,
    ).has(key),
    false,
  );
  assert.equal(
    matchScriptProcesses(
      [{ ...worker, commandLine: `node -e 'console.log("${absolute}")'` }],
      runtimeCandidates,
    ).has(key),
    false,
  );
});

test("relative worker paths need project evidence from cwd or ancestry", () => {
  const worker = {
    pid: 4567,
    parent: 0,
    name: "node",
    cwd: backendDir,
    commandLine: `node "${workerFile}"`,
  };
  assert.deepEqual(
    matchScriptProcesses([worker], runtimeCandidates).get(
      runtimeKey(backendDir, `file:${workerFile}`),
    ),
    [4567],
  );
});

test("tree shows external PID, stopped state and debugging state from runtime updates", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wly-runtime-"));
  let alive = true;
  let mode;
  const events = [];
  class EventEmitter {
    event = () => ({ dispose() {} });
    fire(value) {
      events.push(value);
    }
    dispose() {}
  }
  class ThemeIcon {
    constructor(id, color) {
      this.id = id;
      this.color = color;
    }
  }
  class TreeItem {
    constructor(label) {
      this.label = label;
    }
  }
  const { ScriptsTree } = load("src/ui/scriptsTree.ts", {
    vscode: {
      EventEmitter,
      ThemeIcon,
      TreeItem,
      ThemeColor: class {},
      TreeItemCollapsibleState: { Expanded: 2 },
    },
    child_process: {
      execFile(command, args, options, callback) {
        const file = path.join(dir, "scripts", "worker.cjs");
        callback(
          null,
          process.platform === "win32"
            ? JSON.stringify(
                alive
                  ? [
                      {
                        ProcessId: 7890,
                        ParentProcessId: 0,
                        Name: "node.exe",
                        CommandLine: `node "${file}"`,
                        Cwd: dir,
                      },
                    ]
                  : [],
              )
            : alive
              ? `7890 0 node node "${file}"`
              : "",
          "",
        );
      },
    },
  });
  try {
    await fs.mkdir(path.join(dir, "scripts"));
    await fs.writeFile(path.join(dir, "scripts", "worker.cjs"), "");
    const project = { dir, scripts: {}, label: "backend/package.json" };
    const catalog = {
      getProjects: async () => [project],
      onDidChange: () => ({ dispose() {} }),
    };
    const tree = new ScriptsTree(catalog, { runningMode: () => mode });
    const [node] = await tree.getChildren({
      kind: "group",
      project,
      source: "files",
    });
    await tree.refreshRuntime();
    let item = tree.getTreeItem(node);
    assert.equal(item.contextValue, "wlyScriptExternal");
    assert.equal(item.iconPath.id, "pass-filled");
    assert.match(item.description, /PID 7890/);
    alive = false;
    await tree.refreshRuntime();
    item = tree.getTreeItem(node);
    assert.equal(item.description, "Parado");
    assert.equal(item.contextValue, "wlyScriptFile");
    mode = "debug";
    item = tree.getTreeItem(node);
    assert.equal(item.iconPath.id, "debug-alt");
    assert.equal(item.contextValue, "wlyScriptRunning");
    assert.ok(events.length >= 2);
    tree.dispose();
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("status menu puts all services before support and highlights running workers", () => {
  const item = { show() {}, hide() {}, dispose() {} };
  const { NvmrcStatusBar } = load("src/ui/statusBar.ts", {
    vscode: {
      StatusBarAlignment: { Right: 1 },
      window: { createStatusBarItem: () => item },
      ThemeColor: class {},
      MarkdownString: class {
        constructor(value) {
          this.value = value;
        }
      },
    },
  });
  const bar = new NvmrcStatusBar();
  const script = (name, ports = [], state = "idle") => ({
    dir: backendDir,
    script: name,
    command: "node worker.cjs",
    ports,
    state,
    listeners: [],
    pids: state === "external" ? [7890] : [],
  });
  bar.update({ kind: "ready", current: "22.0.0", projects: [] });
  bar.setScripts([
    {
      label: "mobile",
      scripts: [
        script("lint"),
        script("android"),
        script("build"),
        script("z-worker", [], "external"),
        script("dev", [8081]),
      ],
    },
    {
      label: "backend",
      scripts: [script("start", [3011]), script("dev", [3011], "task")],
    },
  ]);
  const text = item.tooltip.value;
  assert.ok(text.indexOf("**start**") < text.indexOf("**android**"));
  assert.ok(text.indexOf("**build**") < text.indexOf("**lint**"));
  assert.ok(text.indexOf("**z-worker**") < text.indexOf("**lint**"));
  assert.match(text, /\$\(run-all\).*\*\*z-worker\*\*/);
  assert.match(text, /PID 7890/);
  assert.match(text, /\$\(sync~spin\)/);
  assert.match(item.text, /\$\(play\) 2/);
  assert.match(text, /\*\*z-worker\*\*[^\n]*command:wlyNvmrc.scripts.kill/);
  assert.match(text, /Matar processo: PID 7890/);
  bar.dispose();
});
