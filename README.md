# TerminalHub

Manage all your terminals in one place. A macOS Electron app built on `node-pty` and `xterm.js`, with sessions in a sidebar, split panes, snippets, and search.

> **Platform note.** Currently macOS-only. The shell is hardcoded to `$SHELL` (or `/bin/zsh`), the `--login` flag and `lsof`-based cwd detection are POSIX, and the package script targets `darwin/arm64`. Linux mostly works at runtime but the chrome (traffic-light spacing, vibrancy) is mac-only. Windows would require swapping the shell logic and dropping `lsof`.

## Requirements

- Node 18+
- Electron 33+ (installed as a devDependency)
- Xcode Command Line Tools (for `node-pty` native build)

## Setup

```bash
npm install
```

`postinstall` runs `electron-rebuild -f -w node-pty` so the native module is built against Electron's Node ABI rather than the system Node. If you skip it, the first terminal-create will throw a native-module mismatch error. To rebuild manually:

```bash
npm run rebuild
```

## Run

```bash
npm start
```

This bundles the renderer (esbuild) and launches Electron.

## Test

```bash
npm test
```

Unit tests for the pure helpers in `lib/` run via Node's built-in `node --test` (no extra deps). Covered: shell selection per platform, POSIX shell-quoting, split-divider cleanup logic, and the sender-scoped terminal store. End-to-end testing with `playwright-electron` is not yet wired up.

## Package (macOS)

```bash
npm run package
```

Produces `dist/TerminalHub-darwin-arm64/TerminalHub.app`. Note: `node-pty` must be unpacked from the asar archive (handled by `--asar.unpackDir=node_modules/node-pty` in the script) so its `spawn-helper` binary is executable. See `CLAUDE.md` for the full reasoning.

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| New tab | ⌘T |
| New tab in folder... | ⇧⌘T |
| Close tab | ⌘W |
| Close pane | ⇧⌘W |
| Split horizontal | ⌘D |
| Split vertical | ⇧⌘D |
| Next / previous tab | ⇧⌘] / ⇧⌘[ |
| Find | ⌘F |
| Clear terminal | ⌘K |
| Snippets palette | ⇧⌘S |
| Zoom in / out / reset | ⌘= / ⌘- / ⌘0 |

## Project layout

```
main.js              Electron main: window, menu, IPC, pty lifecycle
preload.js           contextBridge surface (window.terminalAPI)
renderer/
  index.html         Shell HTML + CSP
  styles.css         All UI styles
  renderer.js        Sessions, panes, sidebar, snippets, search
  bundle.js          esbuild output (gitignored)
bin/terminalhub.js   `terminalhub` CLI entry (runs npm start)
```

The renderer is bundled by esbuild into `renderer/bundle.js`. Edit `renderer.js` and re-run `npm start` (or `npm run build`) to see changes.
