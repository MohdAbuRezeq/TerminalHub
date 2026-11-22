// Pure helpers for tab naming, ordering and restore. No DOM, no Electron.

const SHELLS = new Set(['zsh', 'bash', 'sh', 'fish', 'dash', 'ksh', 'tcsh', 'csh', 'nu', 'pwsh', 'login']);

// node-pty reports the foreground process of a pty. When that is the shell
// itself, nothing is running. Login shells can show up as "-zsh".
function isShellProcess(name) {
  if (!name) return true;
  const base = String(name).split('/').pop().replace(/^-/, '');
  return SHELLS.has(base);
}

// Some programs are installed as a file named after their version, with a
// friendly-named link pointing at it (Claude Code: `claude` links to a file
// called `2.1.330`). The kernel reports the file's name, so the tab would
// read "2.1.330". Such names need a second lookup.
function looksLikeVersion(name) {
  return /^v?\d+(\.\d+)+$/.test(String(name || ''));
}

// Turn `ps` output for a command ("/bin/zsh", "-zsh", "claude") into a bare
// program name.
function cleanProcessName(comm) {
  const base = String(comm || '').trim().split('/').pop().replace(/^-/, '');
  return base || null;
}

// Folder name for a tab title: "Home" for home, else the last path component.
function folderName(cwd, home) {
  if (!cwd) return null;
  if (home && cwd === home) return 'Home';
  return cwd.split('/').filter(Boolean).pop() || '/';
}

// Short path for the tab's second line. Home becomes "~", and deep paths
// keep only their last two folders, since the tail is what tells tabs apart.
function shortPath(cwd, home) {
  if (!cwd) return '';
  let p = cwd;
  if (home && (p === home || p.startsWith(home + '/'))) p = '~' + p.slice(home.length);
  const parts = p.split('/').filter(Boolean);
  if (p === '~' || parts.length <= 2) return p;
  if (parts.length === 3 && (parts[0] === '~' || p.startsWith('/'))) return p;
  return '…/' + parts.slice(-2).join('/');
}

// Second line of a tab, in plain words: what is running and where.
//   idle, in a project      "…/Projects/GruenderCafe"
//   idle, at home           "Home folder"
//   claude in a project     "claude in …/Projects/GruenderCafe"
//   claude at home          "claude"
// Returns '' when nothing is known yet.
function tabSubtitle({ cwd, proc, home, paneCount }) {
  const running = proc && !isShellProcess(proc) ? proc : null;
  const atHome = !!(cwd && home && cwd === home);
  const where = cwd && !atHome ? shortPath(cwd, home) : '';
  let text = '';
  if (running) text = where ? `${running} in ${where}` : running;
  else if (where) text = where;
  else if (atHome) text = 'Home folder';
  if (!text) return '';
  return paneCount > 1 ? `${text}, ${paneCount} panes` : text;
}

// Move the item with id `fromId` next to the item with id `toId`.
// Returns a new array; unknown ids or a no-op move return the input order.
function moveItem(items, fromId, toId, after) {
  const from = items.findIndex((i) => i.id === fromId);
  if (from === -1 || fromId === toId) return items.slice();
  const out = items.slice();
  const [moved] = out.splice(from, 1);
  const to = out.findIndex((i) => i.id === toId);
  if (to === -1) return items.slice();
  out.splice(to + (after ? 1 : 0), 0, moved);
  return out;
}

// Saved tabs come from disk, so trust nothing: keep only well-formed
// entries and clamp sizes. Returns { tabs, active }.
function sanitizeSavedTabs(saved) {
  const raw = saved && Array.isArray(saved.tabs) ? saved.tabs : [];
  const tabs = [];
  for (const t of raw.slice(0, 50)) {
    if (!t || !Array.isArray(t.panes) || t.panes.length === 0) continue;
    tabs.push({
      title: typeof t.title === 'string' && t.title.trim() ? t.title.trim().slice(0, 200) : null,
      split: t.split === 'vertical' ? 'vertical' : 'horizontal',
      panes: t.panes.slice(0, 8).map((p) => ({
        cwd: p && typeof p.cwd === 'string' && p.cwd.startsWith('/') ? p.cwd : null,
      })),
    });
  }
  const active = Number.isInteger(saved && saved.active) && saved.active >= 0 && saved.active < tabs.length
    ? saved.active
    : 0;
  return { tabs, active };
}

module.exports = {
  isShellProcess,
  looksLikeVersion,
  cleanProcessName,
  folderName,
  shortPath,
  tabSubtitle,
  moveItem,
  sanitizeSavedTabs,
};
