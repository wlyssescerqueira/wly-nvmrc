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
