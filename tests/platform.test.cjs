const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { buildSync } = require("esbuild");

function load(entry, platform, mocks = {}, overrides = {}) {
  const fakeProcess = Object.create(process);
  Object.defineProperties(fakeProcess, {
    platform: { value: platform },
    env: { value: { ...process.env, NVM_DIR: "/test nvm", PATH: "/usr/bin" } },
    ...Object.fromEntries(
      Object.entries(overrides).map(([key, value]) => [key, { value }]),
    ),
  });
  const { text } = buildSync({
    entryPoints: [path.join(__dirname, "..", entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["vscode"],
    write: false,
  }).outputFiles[0];
  const module = { exports: {} };
  new Function("require", "module", "exports", "process", text)(
    (name) =>
      name in mocks
        ? mocks[name]
        : name === "path"
          ? platform === "win32"
            ? path.win32
            : path.posix
          : require(name),
    module,
    module.exports,
    fakeProcess,
  );
  return { ...module.exports, fakeProcess };
}

for (const platform of ["win32", "darwin", "linux"]) {
  test(`${platform}: nvm discovery and use propagate the selected toolchain`, async () => {
    let onProcess;
    let onEnd;
    const tasks = [];
    const calls = [];
    class Execution {
      constructor(...args) {
        this.args = args;
      }
    }
    const service = load("src/services/nvmService.ts", platform, {
      fs: { existsSync: () => true },
      child_process: {
        execFile(command, args, options, callback) {
          calls.push([command, args]);
          callback(
            null,
            command === "where.exe"
              ? "C:\\nvm.exe"
              : "/nvm/versions/node/v22/bin/node\n",
            "",
          );
        },
      },
      vscode: {
        workspace: { isTrusted: true },
        Task: class {
          constructor(...args) {
            this.args = args;
          }
        },
        ShellExecution: Execution,
        ProcessExecution: Execution,
        TaskScope: { Workspace: 1 },
        TaskRevealKind: {},
        TaskPanelKind: {},
        tasks: {
          async executeTask(task) {
            tasks.push(task);
            const execution = { task };
            setImmediate(() => {
              onProcess({ execution, exitCode: 0 });
              onEnd({ execution });
            });
            return execution;
          },
          onDidEndTaskProcess(callback) {
            onProcess = callback;
            return { dispose() {} };
          },
          onDidEndTask(callback) {
            onEnd = callback;
            return { dispose() {} };
          },
        },
      },
    });
    assert.equal(await service.isNvmAvailable(), true);
    await service.useVersion("22");
    const execution = tasks[0].args[4];
    if (platform === "win32") {
      assert.equal(calls[0][0], "where.exe");
      assert.deepEqual(execution.args, ["nvm", ["use", "22"]]);
    } else {
      assert.equal(execution.args[0], "/bin/sh");
      assert.match(execution.args[1][1], /\. '\/test nvm\/nvm.sh' --no-use/);
      assert.match(
        service.fakeProcess.env.PATH,
        /^\/nvm\/versions\/node\/v22\/bin:/,
      );
      assert.equal(
        calls.some(([command]) => command === "which"),
        false,
      );
    }
  });

  test(`${platform}: script and file debugging use argument arrays`, async () => {
    const tasks = [];
    const configs = [];
    class Execution {
      constructor(...args) {
        this.args = args;
      }
    }
    const event = () => ({ dispose() {} });
    const { ScriptRunner } = load("src/services/scriptRunner.ts", platform, {
      fs: {
        existsSync: () => false,
        readFileSync() {
          throw new Error("no mobile project");
        },
      },
      vscode: {
        EventEmitter: class {
          event = event;
          fire() {}
          dispose() {}
        },
        tasks: {
          onDidStartTask: event,
          onDidEndTask: event,
          taskExecutions: [],
          executeTask: async (task) => tasks.push(task),
        },
        debug: {
          onDidStartDebugSession: event,
          onDidTerminateDebugSession: event,
          startDebugging: async (_, config) => configs.push(config),
        },
        Task: class {
          constructor(...args) {
            this.args = args;
          }
        },
        ProcessExecution: Execution,
        ShellExecution: Execution,
        TaskRevealKind: {},
        TaskPanelKind: {},
      },
    });
    const runner = new ScriptRunner();
    const project = {
      dir: platform === "win32" ? "C:\\my app" : "/my app",
      packageManager: "npm",
    };
    const args = ["--test", "scripts/my worker.cjs"];
    await runner.start(project, "file:scripts/my worker.cjs", "debug", args);
    await runner.start(project, "dev", "debug");
    assert.deepEqual(configs[0].runtimeArgs, args);
    assert.equal(configs[0].runtimeExecutable, "node");
    assert.deepEqual(configs[1].runtimeArgs, ["run", "dev"]);
    await runner.start(project, "dev");
    const execution = tasks[0].args[4];
    assert.equal(execution.args[0], platform === "win32" ? "npm" : "/bin/sh");
    assert.equal(execution.args[2].cwd, project.dir);
    runner.dispose();
  });

  test(`${platform}: process snapshot associates a relative worker with its cwd`, async () => {
    const dir = platform === "win32" ? "C:\\my app" : "/my app";
    const service = load("src/services/scriptProcesses.ts", platform, {
      "fs/promises": { readlink: async () => dir },
      child_process: {
        execFile(command, args, options, callback) {
          let stdout;
          if (platform === "win32")
            stdout = JSON.stringify([
              {
                ProcessId: 9100,
                ParentProcessId: 1,
                Name: "node.exe",
                CommandLine: "node scripts/worker.cjs",
                Cwd: dir,
              },
            ]);
          else if (command === "lsof") stdout = `p9100\nn${dir}\n`;
          else
            stdout = args.includes("pid=,comm=")
              ? "9100 /my tools/node\n"
              : "9100 1 node scripts/worker.cjs\n";
          callback(null, stdout, "");
        },
      },
    });
    const rows = await service.listScriptProcesses();
    assert.equal(rows[0].cwd, dir);
    assert.equal(rows[0].name, platform === "win32" ? "node.exe" : "node");
    assert.deepEqual(
      service
        .matchScriptProcesses(rows, [
          { dir, script: "worker", command: "node scripts/worker.cjs" },
        ])
        .get(service.runtimeKey(dir, "worker")),
      [9100],
    );
  });
}

test("POSIX arguments keep shell substitutions literal", () => {
  const { quotePosix } = load("src/utils/shell.ts", "linux");
  assert.equal(quotePosix("a'$(touch nope)"), "'a'\"'\"'$(touch nope)'");
});

test("Linux without lsof uses ss, including IPv6 listeners", async () => {
  const { findPortListeners } = load("src/services/portService.ts", "linux", {
    vscode: {},
    child_process: {
      execFile(command, args, options, callback) {
        if (command === "lsof")
          return callback(
            Object.assign(new Error("missing"), { code: "ENOENT" }),
            "",
            "",
          );
        const stdout =
          command === "ss"
            ? 'LISTEN 0 511 [::]:3011 [::]:* users:(("node",pid=9100,fd=20))\n'
            : "9100 1 node /my-app/server.js\n";
        callback(null, stdout, "");
      },
    },
  });
  const listeners = await findPortListeners([3011]);
  assert.equal(listeners[0].pid, 9100);
  assert.equal(listeners[0].port, 3011);
});

test("missing Unix port tools cannot be reported as free ports", async () => {
  const { findPortListeners } = load("src/services/portService.ts", "linux", {
    vscode: {},
    child_process: {
      execFile(command, args, options, callback) {
        callback(
          Object.assign(new Error(`missing ${command}`), { code: "ENOENT" }),
          "",
          "",
        );
      },
    },
  });
  await assert.rejects(findPortListeners([3011]), /missing ss/);
});

for (const platform of ["darwin", "linux"]) {
  test(`${platform}: kill terminates children and excludes reused PIDs`, async () => {
    let snapshots = 0;
    const signals = [];
    const { killProcess } = load(
      "src/services/portService.ts",
      platform,
      {
        vscode: {},
        "fs/promises": { readlink: async () => "/app" },
        child_process: {
          execFile(command, args, options, callback) {
            let stdout = "";
            if (command === "ps" && args.includes("pid=,comm="))
              stdout = "9100 node\n9101 node\n9200 node\n";
            else if (command === "ps") {
              snapshots++;
              stdout = `9100 1 node supervisor.js\n9101 ${snapshots === 1 ? "9100 node worker.js" : "1 node unrelated.js"}\n9200 1 node other.js\n`;
            }
            callback(null, stdout, "");
          },
        },
      },
      { kill: (pid, signal) => signals.push([pid, signal]) },
    );
    await killProcess(9100);
    assert.deepEqual(signals, [
      [9100, "SIGTERM"],
      [9101, "SIGTERM"],
      [9100, "SIGKILL"],
    ]);
    await assert.rejects(killProcess(-1), /protected PID/);
  });
}

test(
  "native host: identify a worker, find its ports and kill its tree",
  { timeout: 45000 },
  async () => {
    const fs = require("node:fs/promises");
    const os = require("node:os");
    const { fork } = require("node:child_process");
    const { once } = require("node:events");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wly platform "));
    const file = path.join(dir, "worker.cjs");
    const processes = load("src/services/scriptProcesses.ts", process.platform);
    const ports = load("src/services/portService.ts", process.platform, {
      vscode: {},
    });
    let worker;
    let childPid;
    try {
      await fs.writeFile(
        file,
        `
      const net = require('node:net');
      const { fork } = require('node:child_process');
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => {
        if (process.argv.includes('--child')) {
          process.send({ port: server.address().port, pid: process.pid });
        } else {
          const child = fork('worker.cjs', ['--child'], { cwd: process.cwd(), stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
          child.once('message', (message) => process.send({ ...message, parentPort: server.address().port }));
        }
      });
    `,
      );
      worker = fork("worker.cjs", [], {
        cwd: dir,
        stdio: ["ignore", "ignore", "inherit", "ipc"],
      });
      const [message] = await once(worker, "message");
      childPid = message.pid;
      const rows = await processes.listScriptProcesses();
      const matches = processes.matchScriptProcesses(rows, [
        {
          dir,
          script: "worker",
          command: "node worker.cjs",
          file: "worker.cjs",
        },
      ]);
      assert.ok(
        matches.get(processes.runtimeKey(dir, "worker"))?.includes(worker.pid),
      );
      const listeners = await ports.findPortListeners([
        message.port,
        message.parentPort,
      ]);
      assert.ok(
        listeners.some(
          (item) => item.pid === worker.pid && item.port === message.parentPort,
        ),
      );
      assert.ok(
        listeners.some(
          (item) => item.pid === childPid && item.port === message.port,
        ),
      );
      const exited = once(worker, "exit");
      await ports.killProcess(worker.pid);
      await exited;
      assert.equal(
        await ports.waitForPortsFree([message.port, message.parentPort], 5000),
        true,
      );
      assert.equal(
        (await ports.findPortListeners([message.port, message.parentPort]))
          .length,
        0,
      );
    } finally {
      if (worker && worker.exitCode === null && worker.signalCode === null) {
        await ports.killProcess(worker.pid).catch(() => worker.kill());
      }
      if (childPid) {
        const snapshot = await processes.listScriptProcesses().catch(() => []);
        if (
          snapshot.some((item) => item.pid === childPid && item.cwd === dir)
        ) {
          await ports.killProcess(childPid).catch(() => {});
        }
      }
      await fs.rm(dir, { recursive: true, force: true });
    }
  },
);
