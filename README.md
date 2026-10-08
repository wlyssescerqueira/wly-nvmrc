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

The status bar menu lists the `package.json` scripts that start servers or are running, with Run/Restart/Stop actions. **Wlytech - nvmrc: Run Script** in the Command Palette picks any script and runs it as a task.

Before running, the extension:

1. **Checks the Node version** — if the project's `.nvmrc`/`engines` doesn't match the active Node, offers to `nvm use` and run, or run anyway.
2. **Checks the ports** — detects the ports the script will listen on and, if any is busy, shows which process holds it and asks to **Kill and start** / **Start anyway**.

Ports are detected from explicit flags (`--port 3000`, `-p 3000`, `PORT=3000`), framework config/defaults (Next, Vite, Angular, CRA, Nuxt, Astro, Expo, Storybook, webpack-dev-server…), the project's `.env` `PORT` and `process.env.PORT || 3011` fallbacks in the server entry file. Delegating scripts are followed (`npm run dev --prefix backend`, `cd x && npm run y`, `node scripts/dev.cjs` that spawns `npm run dev` in sibling packages), so a root `dev` checks every port it starts. Running scripts show Restart/Stop actions.

## Requirements

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
