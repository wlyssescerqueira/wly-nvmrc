# Wly Nvmrc - Node Version Guard

Avoids the "version soup" when switching between projects (plain Node, Angular/AngularJS, Salesforce LWC/Aura, etc).

## What it does

1. Detects every Node project in all open workspace folders by recursively finding `package.json` and `.nvmrc` files. Dependencies, internal folders, test hosts, caches and generated build directories such as `node_modules`, `.vscode-test`, `.next`, `.nuxt`, `dist`, `build`, `coverage` and `out` are ignored.
2. Each project directory has its own `.nvmrc` and status:
   - **Exists and matches** the active Node version → status bar shows `✓ Node vX.X.X`.
   - **Exists and mismatches** → status bar shows an alert and lets you switch versions via `nvm use`/`nvm install` right from the menu.
   - **Doesn't exist** → status bar warns that `.nvmrc` is missing and offers to create one with the current Node version.
3. Click the status bar item to choose and manage a specific project.

This works both when opening a project directory by itself and when opening a repository that contains several projects (for example `backend`, `frontend` and `mobile`). A root-level `package.json` is treated as its own project and does not override the versions pinned by child projects.

## Scripts

The status bar menu lists the `package.json` scripts that start servers or are running, with Debug/Run (and Restart/Stop while running) actions. Debug runs the script in a JavaScript Debug Terminal (`node-terminal`). An icon in front of each script shows its state, re-checked on the `pollIntervalSeconds` interval:

| Icon                            | State                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `$(circle-outline)`             | stopped (ports free)                                                                                                           |
| `$(sync~spin)` / `$(debug-alt)` | running / debugging from this window                                                                                           |
| `$(pass-filled)`                | its ports are held by a process of this workspace started elsewhere (a terminal, another window) — can be killed from the menu |
| `$(warning)`                    | a port is held by a process of another project — shows the process and PID, can be killed from the menu                        |

A process belongs to the workspace when its command line (or one of its parents') contains a workspace folder path. **Wlytech - nvmrc: Run Script** in the Command Palette picks any script and runs it as a task.

Before running, the extension:

1. **Checks the Node version** — if the project's `.nvmrc`/`engines` doesn't match the active Node, offers to `nvm use` and run, or run anyway.
2. **Checks the ports** — detects the ports the script will listen on and, if any is busy, shows which process holds it and asks to **Kill and start** / **Start anyway**.

Ports are detected from explicit flags (`--port 3000`, `-p 3000`, `PORT=3000`), framework config/defaults (Next, Vite, Angular, CRA, Nuxt, Astro, Expo, Storybook, webpack-dev-server…), the project's `.env` `PORT` and `process.env.PORT || 3011` fallbacks in the server entry file. Delegating scripts are followed (`npm run dev --prefix backend`, `cd x && npm run y`, `node scripts/dev.cjs` that spawns `npm run dev` in sibling packages), so a root `dev` checks every port it starts. Running scripts show Restart/Stop actions.

## Requirements

### Mobile shortcuts

Mobile projects show **Start Android emulator…**, with a picker when multiple virtual devices exist. No AVD name needs to be fixed in `package.json`. The SDK is detected from the extension's `wlyNvmrc.android.sdkPath` setting, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, or the default Android Studio SDK directory. Detected SDK paths are passed to mobile tasks/debug sessions as environment variables without changing the machine environment.

When the SDK/emulator is missing, **Configure Android SDK / emulator…** offers a folder selector and setup instructions, including a suggested SDK path and an optional command for setting `ANDROID_HOME` in external terminals. No environment changes are executed by the help screen. Create virtual devices through Android Studio's Device Manager.

Keep normal Expo commands in the mobile package: `start` starts Metro, `android` can use `npm run start -- --android` to open the installed app, and `android:build` can use `expo run:android` for a native build. Native modules may require a development build. Scripts named `emulator`, `avd`, `android` or `ios` remain visible even without a detected port. Other scripts remain available through **Run another script…**.

Simple root shortcuts such as `npm run dev --prefix backend` are hidden from the hover when the target package is already listed. Running shortcuts and commands with setup steps or extra arguments remain visible. Package changes automatically refresh the catalog.

Android, Expo and React Native projects also show **Open APK folder**. It opens the directory containing a local APK in the system file manager; when multiple directories contain APKs, it offers a picker. Without APK files, it opens `android/app/build/outputs/apk` if that directory exists, or explains that a build/download is needed. It does not build or download APKs.

- [nvm-windows](https://github.com/coreybutler/nvm-windows) installed and on PATH to use the "nvm use" / "nvm install" actions. Without nvm, the extension still detects and flags mismatches, it just can't switch the version automatically.

## Settings

- `wlyNvmrc.pollIntervalSeconds` (default `15`): interval to re-check the active Node version while the window is focused (`0` disables polling; the focus and `.nvmrc`-change checks stay active).

- `wlyNvmrc.scripts.checkPorts` (default `true`): check busy ports before running a script.
- `wlyNvmrc.scripts.checkNodeVersion` (default `true`): check the Node version before running a script.

## Development

```
npm install
npm run watch:esbuild
```

Press `F5` in VS Code to open an Extension Development Host window.
