# Wly Nvmrc - Node Version Guard

Avoids the "version soup" when switching between projects (plain Node, Angular/AngularJS, Salesforce LWC/Aura, etc).

## What it does

1. Detects whether the workspace is a Node project (`package.json`, `node_modules` or `.nvmrc`).
2. If it is, it looks for a `.nvmrc` at the root:
   - **Exists and matches** the active Node version → status bar shows `✓ Node vX.X.X`.
   - **Exists and mismatches** → status bar shows an alert and lets you switch versions via `nvm use`/`nvm install` right from the menu.
   - **Doesn't exist** → status bar warns that `.nvmrc` is missing and offers to create one with the current Node version.
3. Everything also shows up in the sidebar view (icon in the Activity Bar) with the same actions.

## Requirements

- [nvm-windows](https://github.com/coreybutler/nvm-windows) installed and on PATH to use the "nvm use" / "nvm install" actions. Without nvm, the extension still detects and flags mismatches, it just can't switch the version automatically.

## Settings

- `wlyNvmrc.notifyOnMismatch` (default `true`): shows a toast when a version mismatch is detected.
- `wlyNvmrc.pollIntervalSeconds` (default `15`): interval to re-check the active Node version while the window is focused (`0` disables polling; the focus and `.nvmrc`-change checks stay active).

## Development

```
npm install
npm run watch:esbuild
```

Press `F5` in VS Code to open an Extension Development Host window.
