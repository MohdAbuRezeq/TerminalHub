const test = require('node:test');
const assert = require('node:assert/strict');
const { shellQuote, getShellConfig } = require('../lib/shell');

// ──────────────────────────────────────
// shellQuote — POSIX single-quoting
// ──────────────────────────────────────

test('shellQuote wraps a plain word in single quotes', () => {
  assert.equal(shellQuote('hello'), `'hello'`);
});

test('shellQuote wraps a path with spaces in single quotes', () => {
  assert.equal(shellQuote('/Users/me/My Folder/file.txt'), `'/Users/me/My Folder/file.txt'`);
});

test('shellQuote neutralizes command substitution', () => {
  // The whole point: $(rm -rf ~) inside single quotes is literal text,
  // not a command. The old "wrap in double quotes if it has a space"
  // approach failed this case.
  assert.equal(shellQuote('foo$(rm -rf ~).txt'), `'foo$(rm -rf ~).txt'`);
});

test('shellQuote neutralizes backticks', () => {
  assert.equal(shellQuote('foo`whoami`.txt'), `'foo\`whoami\`.txt'`);
});

test('shellQuote escapes embedded single quotes via close-escape-reopen', () => {
  // POSIX idiom: 'it'\''s' — close, literal quote, reopen.
  assert.equal(shellQuote(`it's`), `'it'\\''s'`);
});

test('shellQuote handles the empty string', () => {
  assert.equal(shellQuote(''), `''`);
});

test('shellQuote coerces non-string input', () => {
  assert.equal(shellQuote(42), `'42'`);
});

// ──────────────────────────────────────
// getShellConfig — per-platform shell + args
// ──────────────────────────────────────

test('darwin uses $SHELL with --login when SHELL is set', () => {
  const cfg = getShellConfig({ platform: 'darwin', env: { SHELL: '/bin/zsh' } });
  assert.deepEqual(cfg, { shell: '/bin/zsh', args: ['--login'] });
});

test('darwin falls back to /bin/zsh when SHELL is unset', () => {
  const cfg = getShellConfig({ platform: 'darwin', env: {} });
  assert.deepEqual(cfg, { shell: '/bin/zsh', args: ['--login'] });
});

test('linux uses $SHELL with --login when SHELL is set', () => {
  const cfg = getShellConfig({ platform: 'linux', env: { SHELL: '/usr/bin/bash' } });
  assert.deepEqual(cfg, { shell: '/usr/bin/bash', args: ['--login'] });
});

test('linux falls back to /bin/bash when SHELL is unset', () => {
  const cfg = getShellConfig({ platform: 'linux', env: {} });
  assert.deepEqual(cfg, { shell: '/bin/bash', args: ['--login'] });
});

test('win32 prefers ComSpec when set', () => {
  const cfg = getShellConfig({
    platform: 'win32',
    env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
  });
  // Windows shells don't take --login.
  assert.deepEqual(cfg, { shell: 'C:\\Windows\\System32\\cmd.exe', args: [] });
});

test('win32 falls back to powershell.exe when ComSpec is unset', () => {
  const cfg = getShellConfig({ platform: 'win32', env: {} });
  assert.deepEqual(cfg, { shell: 'powershell.exe', args: [] });
});

test('unknown platform falls back to /bin/sh with no args', () => {
  const cfg = getShellConfig({ platform: 'freebsd', env: {} });
  assert.deepEqual(cfg, { shell: '/bin/sh', args: [] });
});
