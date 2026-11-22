const test = require('node:test');
const assert = require('node:assert/strict');
const { isShellProcess, looksLikeVersion, cleanProcessName, folderName, shortPath, tabSubtitle, moveItem, sanitizeSavedTabs } = require('../lib/tabs');

const HOME = '/Users/moe';

test('isShellProcess treats shells, login shells and nothing as idle', () => {
  for (const n of ['zsh', '-zsh', 'bash', '/bin/zsh', '', null, undefined]) assert.equal(isShellProcess(n), true, String(n));
  for (const n of ['claude', 'node', 'vim', 'npm']) assert.equal(isShellProcess(n), false, n);
});

test('folderName uses Home for home and the last folder otherwise', () => {
  assert.equal(folderName(HOME, HOME), 'Home');
  assert.equal(folderName(`${HOME}/Projects/TerminalHub`, HOME), 'TerminalHub');
  assert.equal(folderName('/', HOME), '/');
  assert.equal(folderName(null, HOME), null);
});

test('shortPath abbreviates home and keeps the tail of deep paths', () => {
  assert.equal(shortPath(HOME, HOME), '~');
  assert.equal(shortPath(`${HOME}/Downloads`, HOME), '~/Downloads');
  assert.equal(shortPath(`${HOME}/Downloads/Projects`, HOME), '~/Downloads/Projects');
  assert.equal(shortPath(`${HOME}/Downloads/Projects/TerminalHub`, HOME), '…/Projects/TerminalHub');
  assert.equal(shortPath('/usr/local/share/man', HOME), '…/share/man');
  assert.equal(shortPath('/usr/local', HOME), '/usr/local');
  // A sibling of home that merely shares its prefix is not inside home.
  assert.equal(shortPath(`${HOME}x/other`, HOME), '/Users/moex/other');
  assert.equal(shortPath(null, HOME), '');
});

test('tabSubtitle says what runs where, in plain words', () => {
  const proj = `${HOME}/Downloads/Projects/GruenderCafe`;
  assert.equal(tabSubtitle({ cwd: proj, proc: 'zsh', home: HOME, paneCount: 1 }), '\u2026/Projects/GruenderCafe');
  assert.equal(tabSubtitle({ cwd: HOME, proc: null, home: HOME, paneCount: 1 }), 'Home folder');
  assert.equal(tabSubtitle({ cwd: proj, proc: 'claude', home: HOME, paneCount: 1 }), 'claude in \u2026/Projects/GruenderCafe');
  assert.equal(tabSubtitle({ cwd: HOME, proc: 'claude', home: HOME, paneCount: 1 }), 'claude');
  assert.equal(tabSubtitle({ cwd: HOME, proc: 'claude', home: HOME, paneCount: 2 }), 'claude, 2 panes');
  assert.equal(tabSubtitle({ cwd: proj, proc: null, home: HOME, paneCount: 3 }), '\u2026/Projects/GruenderCafe, 3 panes');
  assert.equal(tabSubtitle({ cwd: null, proc: null, home: HOME, paneCount: 1 }), '');
});

test('moveItem reorders before and after a target', () => {
  const items = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  const ids = (xs) => xs.map((x) => x.id).join('');
  assert.equal(ids(moveItem(items, 'a', 'c', false)), 'bacd');
  assert.equal(ids(moveItem(items, 'a', 'c', true)), 'bcad');
  assert.equal(ids(moveItem(items, 'd', 'a', false)), 'dabc');
  assert.equal(ids(moveItem(items, 'b', 'b', true)), 'abcd');
  assert.equal(ids(moveItem(items, 'x', 'a', true)), 'abcd');
  assert.equal(ids(moveItem(items, 'a', 'x', true)), 'abcd');
  assert.equal(ids(items), 'abcd', 'input is not mutated');
});

test('sanitizeSavedTabs keeps good tabs and drops junk', () => {
  const out = sanitizeSavedTabs({
    active: 1,
    tabs: [
      { title: '  Work  ', split: 'vertical', panes: [{ cwd: '/a' }, { cwd: 'relative' }] },
      { title: 42, panes: [{ cwd: '/b' }] },
      { panes: [] },
      null,
      'nope',
    ],
  });
  assert.deepEqual(out, {
    active: 1,
    tabs: [
      { title: 'Work', split: 'vertical', panes: [{ cwd: '/a' }, { cwd: null }] },
      { title: null, split: 'horizontal', panes: [{ cwd: '/b' }] },
    ],
  });
});

test('sanitizeSavedTabs survives garbage and clamps the active index', () => {
  for (const junk of [null, undefined, 7, 'x', {}, { tabs: 'x' }]) {
    assert.deepEqual(sanitizeSavedTabs(junk), { tabs: [], active: 0 });
  }
  assert.equal(sanitizeSavedTabs({ active: 9, tabs: [{ panes: [{ cwd: '/a' }] }] }).active, 0);
  assert.equal(sanitizeSavedTabs({ active: -1, tabs: [{ panes: [{ cwd: '/a' }] }] }).active, 0);
});

test('looksLikeVersion spots version-number process names', () => {
  for (const n of ['2.1.330', '1.0', 'v20.11.1']) assert.equal(looksLikeVersion(n), true, n);
  for (const n of ['claude', 'node', 'python3.12', 'zsh', '7zip', '', null]) assert.equal(looksLikeVersion(n), false, String(n));
});

test('cleanProcessName reduces ps output to a program name', () => {
  assert.equal(cleanProcessName('claude\n'), 'claude');
  assert.equal(cleanProcessName('/bin/zsh'), 'zsh');
  assert.equal(cleanProcessName('-zsh'), 'zsh');
  assert.equal(cleanProcessName('  '), null);
});
