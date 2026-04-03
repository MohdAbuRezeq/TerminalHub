# TerminalHub

## Notes

### Packaging: node-pty and asar archives

When packaging with `electron-packager`, `node-pty` must be fully unpacked from the `.asar` archive using `--asar.unpackDir=node_modules/node-pty`. Without this, the `spawn-helper` binary (needed by `node-pty` to fork shell processes) gets trapped inside the archive and can't be executed, causing `posix_spawnp failed` errors when creating terminals. The packager only auto-extracts `.node` files by default, which is not enough for `node-pty`.
