// Pure, side-effect-free shell helpers. Imported by both main.js (via Node
// require) and renderer.js (via esbuild bundle). No DOM, no Electron, no fs.

// POSIX single-quote escaping. Inside single quotes EVERY character is
// literal except `'`, so we wrap the string in `'...'` and escape any
// embedded single quote as `'\''` (close, escaped quote, reopen).
function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

// Resolve the shell binary + args for a target platform. Pure so it can be
// tested with any platform/env pair, not just the host's.
function getShellConfig({ platform, env = {} }) {
  if (platform === 'darwin') {
    return { shell: env.SHELL || '/bin/zsh', args: ['--login'] };
  }
  if (platform === 'linux') {
    return { shell: env.SHELL || '/bin/bash', args: ['--login'] };
  }
  if (platform === 'win32') {
    // Windows shells don't accept --login. Prefer ComSpec (cmd.exe by
    // default) and fall back to PowerShell.
    return { shell: env.ComSpec || 'powershell.exe', args: [] };
  }
  // BSDs and friends — assume POSIX sh exists.
  return { shell: '/bin/sh', args: [] };
}

module.exports = { shellQuote, getShellConfig };
