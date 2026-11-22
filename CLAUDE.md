# TerminalHub

## Notes

### Packaging: node-pty and asar archives

When packaging with `electron-packager`, `node-pty` must be fully unpacked from the `.asar` archive using `--asar.unpackDir=node_modules/node-pty`. Without this, the `spawn-helper` binary (needed by `node-pty` to fork shell processes) gets trapped inside the archive and can't be executed, causing `posix_spawnp failed` errors when creating terminals. The packager only auto-extracts `.node` files by default, which is not enough for `node-pty`.

### Packaging: spawn-helper must be executable

The `spawn-helper` that ships prebuilt in the `node-pty` npm package is not marked executable. When `electron-rebuild` is skipped or fails silently (it did on GitHub's macOS runners), the app falls back to that prebuilt copy and every terminal fails with `posix_spawnp failed`. `scripts/fix-pty-permissions.js` runs after install and before packaging to fix the permission. Release 1.1.0 shipped broken because of this; the release workflow now smoke tests the built app.
