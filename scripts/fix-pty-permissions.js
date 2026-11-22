#!/usr/bin/env node
// node-pty starts every shell through a small program called spawn-helper.
// The copy that ships prebuilt inside the npm package is not marked as
// executable, so when the local rebuild is skipped or fails (as it does on
// some CI machines) every terminal fails with "posix_spawnp failed".
// Marking the helper executable fixes that. Safe to run any number of times.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'node_modules', 'node-pty');
const candidates = [path.join(root, 'build', 'Release', 'spawn-helper')];

const prebuilds = path.join(root, 'prebuilds');
if (fs.existsSync(prebuilds)) {
  for (const dir of fs.readdirSync(prebuilds)) {
    candidates.push(path.join(prebuilds, dir, 'spawn-helper'));
  }
}

let fixed = 0;
for (const file of candidates) {
  if (!fs.existsSync(file)) continue;
  const mode = fs.statSync(file).mode;
  if ((mode & 0o111) !== 0o111) {
    fs.chmodSync(file, mode | 0o755);
    fixed++;
    console.log(`made executable: ${path.relative(path.join(__dirname, '..'), file)}`);
  }
}
if (fixed === 0) console.log('spawn-helper permissions already fine');
