// Some bundled deps reference `process.env.*` at module-load. Stub it before
// the requires below evaluate, so we can drop the inline script in index.html
// and keep CSP tight (script-src 'self').
if (typeof window !== 'undefined' && !window.process) {
  window.process = { env: {} };
}

const { Terminal } = require('@xterm/xterm');
const { FitAddon } = require('@xterm/addon-fit');
const { WebLinksAddon } = require('@xterm/addon-web-links');
const { SearchAddon } = require('@xterm/addon-search');
const { WebglAddon } = require('@xterm/addon-webgl');
const { shellQuote } = require('../lib/shell');
const { pickAdjacentDivider } = require('../lib/divider');

// ──────────────────────────────────────
// Tiny DOM builder — user data flows through textContent, not innerHTML,
// so values can never escape into markup. Use the `html:` attr only for
// trusted static markup like inline SVG icons.
// ──────────────────────────────────────
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'html') node.innerHTML = v; // trusted static only
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v === true) {
      node.setAttribute(k, '');
    } else {
      node.setAttribute(k, v);
    }
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

// Inline SVG icons — static markup, never interpolates user data.
const ICONS = {
  prompt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>',
};

// DOM refs
const sidebar = document.getElementById('sidebar');
const terminalListEl = document.getElementById('terminal-list');
const containerEl = document.getElementById('terminal-container');
const mainTitle = document.getElementById('main-title');
const statsText = document.getElementById('stats-text');
const searchBar = document.getElementById('search-bar');
const searchInput = document.getElementById('search-input');
const emptyState = document.getElementById('empty-state');

let sessions = []; // { id, panes[], wrapperEl, splitDirection, title, createdAt }
let activeId = null;
// Direct ptyId → pane lookup. Without this, every incoming chunk walks every
// session and every pane to find the target, which gets quadratic with many
// streaming panes.
const paneByPtyId = new Map();
let fontSize = 14;
let sessionCounter = 0;

// Wrap fitAddon.fit() to preserve scroll position across reflows.
// fit() can reflow the buffer (e.g. on window resize, visibility toggle),
// which leaves scrollTop at an arbitrary position. We explicitly restore:
//   - if the user was scrolled up, keep them on the same line
//   - if the user was at the bottom, pin them to the bottom
// The follow-up scrollToBottom() in rAF catches cases where xterm's
// render is debounced and a single sync call gets overwritten by a late
// reflow during rapid resize events.
function safeFit(pane) {
  const buffer = pane.term.buffer.active;
  const atBottom = buffer.viewportY >= buffer.baseY;
  const savedLine = buffer.viewportY;
  pane.fitAddon.fit();
  if (atBottom) {
    pane.term.scrollToBottom();
    requestAnimationFrame(() => pane.term.scrollToBottom());
  } else {
    pane.term.scrollToLine(savedLine);
  }
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ──────────────────────────────────────
// Terminal theme — warm dark to match UI
// ──────────────────────────────────────

const termTheme = {
  background: '#292724',
  foreground: '#e8e0d6',
  cursor: '#da7756',
  cursorAccent: '#292724',
  selectionBackground: '#4a453f',
  selectionForeground: '#e8e0d6',
  black: '#1c1b1a',
  red: '#e05f5f',
  green: '#8fba6a',
  yellow: '#d4a84b',
  blue: '#6ba3d6',
  magenta: '#c07ed6',
  cyan: '#5fbfb7',
  white: '#e8e0d6',
  brightBlack: '#5a534b',
  brightRed: '#e87878',
  brightGreen: '#a3d07a',
  brightYellow: '#e0b85e',
  brightBlue: '#82b6e0',
  brightMagenta: '#d094e5',
  brightCyan: '#78d1c9',
  brightWhite: '#f5efe8',
};

// ──────────────────────────────────────
// Create a terminal pane
// ──────────────────────────────────────

async function createPane(container, cwd) {
  const paneEl = document.createElement('div');
  paneEl.className = 'split-pane';
  container.appendChild(paneEl);

  // Close button overlay
  const closeBtn = document.createElement('button');
  closeBtn.className = 'pane-close-btn';
  closeBtn.innerHTML = '&times;';
  closeBtn.title = 'Close pane (Cmd+Shift+W)';
  paneEl.appendChild(closeBtn);

  const term = new Terminal({
    fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', 'Cascadia Code', Menlo, monospace",
    fontSize,
    // Integer lineHeight keeps the WebGL glyph atlas on whole-pixel boundaries.
    // 1.3 produces fractional cell heights at most font sizes (e.g. 14*1.3=18.2px),
    // which the WebGL renderer clears and redraws at slightly different sub-pixel
    // positions, leaving residual glyph fragments on in-place TUI rewrites.
    lineHeight: 1,
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 10000,
    allowProposedApi: true,
    macOptionIsMeta: true,
    theme: termTheme,
  });

  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());
  term.loadAddon(searchAddon);

  term.open(paneEl);

  await new Promise((r) => requestAnimationFrame(r));
  fitAddon.fit();

  // GPU renderer for streaming text. Loaded after fit() so the glyph atlas
  // is built against the final cell metrics, not the default 80x24 canvas.
  // Loading before fit causes ghosting on in-place updates (TUI spinners).
  // Falls back to DOM if the WebGL context is lost (eg. tab backgrounded too
  // long, GPU process restart) so the pane keeps working instead of freezing.
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    term.loadAddon(webgl);
  } catch (err) {
    console.warn('WebGL renderer unavailable, falling back to DOM:', err);
  }

  let ptyId;
  try {
    ptyId = await window.terminalAPI.createTerminal({
      cols: term.cols,
      rows: term.rows,
      cwd,
    });
  } catch (err) {
    // Spawn failed — clean up the half-built pane so the session doesn't
    // end up with an orphan element + undefined ptyId.
    console.error('Failed to create terminal:', err);
    term.dispose();
    paneEl.remove();
    throw err;
  }

  term.onData((data) => window.terminalAPI.sendInput(ptyId, data));
  term.onResize(({ cols, rows }) => window.terminalAPI.resize(ptyId, cols, rows));

  // Clean up copied text: trim trailing whitespace and rejoin soft-wrapped lines
  term.attachCustomKeyEventHandler((e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'c' && term.hasSelection()) {
      e.preventDefault();
      const raw = term.getSelection();
      const cols = term.cols;
      const lines = raw.split('\n');
      const cleaned = lines
        .map((line) => line.trim())
        .reduce((acc, line, i, arr) => {
          if (i === 0) return [line];
          // If the previous trimmed line filled the terminal width, it was soft-wrapped
          if (arr[i - 1].length >= cols && line.length > 0) {
            acc[acc.length - 1] += line;
          } else {
            acc.push(line);
          }
          return acc;
        }, [])
        .join('\n');
      navigator.clipboard.writeText(cleaned);
      return false;
    }
    return true;
  });

  term.textarea.addEventListener('focus', () => {
    document.querySelectorAll('.split-pane.focused').forEach((el) => el.classList.remove('focused'));
    paneEl.classList.add('focused');
  });

  const pane = {
    ptyId, term, fitAddon, searchAddon, el: paneEl, session: null,
    // Activity tracking for the sidebar status dot. recentChunks is a rolling
    // window of (timestamp, byteCount) entries from the last RUNNING_WINDOW_MS.
    // We classify as "running" based on bytes-per-window, not just "any byte
    // recently", so a TUI cursor blink (a few bytes per second) doesn't keep
    // the dot pulsing forever.
    recentChunks: [],
    bell: false,
  };
  paneByPtyId.set(ptyId, pane);

  term.onBell(() => {
    // Only record bells that happened while the user wasn't on the tab.
    // Recording bells on the active session would create false positives:
    // you'd see a "you missed something" indicator for events you watched
    // live, as soon as you switched away.
    if (pane.session && pane.session.id !== activeId) {
      pane.bell = true;
      refreshDots();
    }
  });

  closeBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (await confirmClose()) closePaneInSession(pane);
  });

  // Drag-and-drop: drop a file onto the pane to paste its path
  paneEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  paneEl.addEventListener('drop', (e) => {
    e.preventDefault();
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => window.terminalAPI.getFilePath(f))
      .filter(Boolean)
      .map(shellQuote);
    if (paths.length) {
      window.terminalAPI.sendInput(ptyId, paths.join(' '));
      term.focus();
    }
  });

  return pane;
}

// ──────────────────────────────────────
// Session (conversation) management
// ──────────────────────────────────────

async function createSession(cwd) {
  const id = genId();
  sessionCounter++;

  const wrapperEl = document.createElement('div');
  wrapperEl.className = 'terminal-wrapper';
  wrapperEl.dataset.sessionId = id;
  containerEl.appendChild(wrapperEl);

  let pane;
  try {
    pane = await createPane(wrapperEl, cwd);
  } catch (err) {
    // createPane already disposed its own DOM; just remove the wrapper
    // and bail so the empty state appears instead of a phantom session.
    wrapperEl.remove();
    sessionCounter--;
    throw err;
  }

  const session = {
    id,
    panes: [pane],
    wrapperEl,
    splitDirection: null,
    title: `Terminal ${sessionCounter}`,
    customTitle: false,
    createdAt: new Date(),
  };
  pane.session = session;

  sessions.unshift(session);
  renderSidebar();
  activateSession(id);
  pane.term.focus();
  updateUI();
  return session;
}

function removeSession(id) {
  const idx = sessions.findIndex((s) => s.id === id);
  if (idx === -1) return;

  const session = sessions[idx];
  session.panes.forEach((p) => {
    window.terminalAPI.kill(p.ptyId);
    paneByPtyId.delete(p.ptyId);
    p.term.dispose();
  });
  session.wrapperEl.remove();
  sessions.splice(idx, 1);

  if (sessions.length === 0) {
    activeId = null;
    renderSidebar();
    updateUI();
    return;
  }

  if (activeId === id) {
    const newIdx = Math.min(idx, sessions.length - 1);
    activateSession(sessions[newIdx].id);
  }

  renderSidebar();
  updateUI();
}

function activateSession(id) {
  activeId = id;

  document.querySelectorAll('.terminal-wrapper').forEach((el) => el.classList.remove('active'));
  document.querySelectorAll('.terminal-item').forEach((el) => el.classList.remove('active'));

  const session = sessions.find((s) => s.id === id);
  if (!session) return;

  // Looking at a session clears any pending bell on its panes.
  session.panes.forEach((p) => { p.bell = false; });

  session.wrapperEl.classList.add('active');

  const itemEl = document.querySelector(`.terminal-item[data-id="${id}"]`);
  if (itemEl) itemEl.classList.add('active');

  requestAnimationFrame(() => {
    session.panes.forEach((p) => safeFit(p));
    const focused = session.panes.find((p) => p.el.classList.contains('focused')) || session.panes[0];
    focused.term.focus();
  });

  updateUI();
}

// ──────────────────────────────────────
// Sidebar rendering — Claude chat list style
// ──────────────────────────────────────

function renderSidebar() {
  terminalListEl.innerHTML = '';

  sessions.forEach((session) => {
    const paneLabel = session.panes.length > 1 ? ` \u00b7 ${session.panes.length} panes` : '';
    const timeStr = session.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const iconEl = el('div', { class: 'item-icon', html: ICONS.prompt });
    const titleEl = el('div', { class: 'item-title' }, session.title);
    const subtitleEl = el('div', { class: 'item-subtitle' }, `${timeStr}${paneLabel}`);
    const infoEl = el('div', { class: 'item-info' }, [titleEl, subtitleEl]);
    const dotEl = el('span', { class: 'item-dot' });
    const closeBtn = el('button', { class: 'item-close', 'data-action': 'close' }, '\u00d7');

    const itemEl = el('div', {
      class: 'terminal-item' + (session.id === activeId ? ' active' : ''),
      dataset: { id: session.id },
    }, [iconEl, infoEl, dotEl, closeBtn]);

    let clickTimer = null;
    itemEl.addEventListener('click', async (e) => {
      if (e.target.closest('[data-action="close"]')) {
        if (await confirmClose()) removeSession(session.id);
        return;
      }
      // Delay single-click to distinguish from double-click
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; return; }
      clickTimer = setTimeout(() => {
        clickTimer = null;
        activateSession(session.id);
      }, 250);
    });

    itemEl.addEventListener('dblclick', (e) => {
      if (e.target.closest('[data-action="close"]')) return;
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
      startRename(session, titleEl);
    });

    terminalListEl.appendChild(itemEl);
  });

  refreshDots();
}

// Activity dot state, computed on demand from pane.recentChunks + pane.bell.
// Priority: bell > running > idle. We poll every 500ms to flip running→idle
// once output stops streaming; we don't full-rerender the sidebar, just swap
// the dot's class so we never thrash layout while a process is chatty.
//
// "Running" is rate-based, not presence-based. A TUI sitting idle (Claude
// Code, vim, etc.) still emits a trickle of bytes for cursor blinks and
// status redraws; if we counted those as "running" the dot would pulse
// forever. The threshold below filters that noise out while still catching
// real streaming output, which is orders of magnitude larger.
const RUNNING_WINDOW_MS = 2000;
const RUNNING_BYTE_THRESHOLD = 400;
const STATE_PRIORITY = { idle: 0, running: 1, bell: 2 };

function recentBytes(pane) {
  if (!pane.recentChunks || pane.recentChunks.length === 0) return 0;
  const cutoff = Date.now() - RUNNING_WINDOW_MS;
  while (pane.recentChunks.length > 0 && pane.recentChunks[0].t < cutoff) {
    pane.recentChunks.shift();
  }
  let total = 0;
  for (const c of pane.recentChunks) total += c.n;
  return total;
}

function paneState(pane) {
  if (pane.bell) return 'bell';
  if (recentBytes(pane) >= RUNNING_BYTE_THRESHOLD) return 'running';
  return 'idle';
}

function sessionState(session) {
  let best = 'idle';
  for (const pane of session.panes) {
    let s = paneState(pane);
    // "Bell" is a look-at-me signal, pointless on the tab you're already
    // looking at, so demote it to the underlying activity state there.
    if (s === 'bell' && session.id === activeId) {
      s = recentBytes(pane) >= RUNNING_BYTE_THRESHOLD ? 'running' : 'idle';
    }
    if (STATE_PRIORITY[s] > STATE_PRIORITY[best]) best = s;
  }
  return best;
}

function refreshDots() {
  for (const session of sessions) {
    const dot = terminalListEl.querySelector(`.terminal-item[data-id="${session.id}"] .item-dot`);
    if (!dot) continue;
    const state = sessionState(session);
    const cls = `item-dot ${state}`;
    if (dot.className !== cls) dot.className = cls;
  }
}

setInterval(refreshDots, 500);

function startRename(session, titleEl) {
  isRenaming = true;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rename-input';
  input.value = session.title;

  titleEl.replaceWith(input);
  input.focus();
  input.select();

  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    isRenaming = false;
    const val = input.value.trim();
    if (val && val !== session.title) {
      session.title = val;
      session.customTitle = true;
      updateUI();
    }
    renderSidebar();
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = session.title; input.blur(); }
  });
}

// ──────────────────────────────────────
// UI updates
// ──────────────────────────────────────

function updateUI() {
  const totalPanes = sessions.reduce((s, t) => s + t.panes.length, 0);
  statsText.textContent = `${sessions.length} terminal${sessions.length !== 1 ? 's' : ''}`;

  const session = sessions.find((s) => s.id === activeId);
  mainTitle.textContent = session ? session.title : '';

  emptyState.classList.toggle('hidden', sessions.length > 0);
  containerEl.style.display = sessions.length > 0 ? '' : 'none';
}

// ──────────────────────────────────────
// Split panes
// ──────────────────────────────────────

async function splitPane(direction) {
  const session = sessions.find((s) => s.id === activeId);
  if (!session) return;

  if (!session.splitDirection) {
    const splitContainer = document.createElement('div');
    splitContainer.className = `split-container ${direction}`;

    while (session.wrapperEl.firstChild) {
      splitContainer.appendChild(session.wrapperEl.firstChild);
    }
    session.wrapperEl.appendChild(splitContainer);
    session.splitDirection = direction;
    session._splitContainer = splitContainer;

    const divider = createDivider(splitContainer, direction);
    splitContainer.appendChild(divider);
    splitContainer.insertBefore(session.panes[0].el, divider);

    const newPane = await createPane(splitContainer);
    session.panes.push(newPane);
    newPane.session = session;
    newPane.term.focus();
  } else {
    const splitContainer = session._splitContainer;
    const divider = createDivider(splitContainer, session.splitDirection);
    splitContainer.appendChild(divider);

    const newPane = await createPane(splitContainer);
    session.panes.push(newPane);
    newPane.session = session;
    newPane.term.focus();
  }

  requestAnimationFrame(() => {
    session.panes.forEach((p) => safeFit(p));
  });

  renderSidebar();
  updateUI();
}

function createDivider(container, direction) {
  const divider = document.createElement('div');
  divider.className = 'split-divider';

  let startPos, startSizes;

  divider.addEventListener('mousedown', (e) => {
    e.preventDefault();
    divider.classList.add('dragging');
    const dividerIndex = Array.from(container.children).indexOf(divider);
    const before = container.children[dividerIndex - 1];
    const after = container.children[dividerIndex + 1];
    if (!before || !after) return;

    const isH = direction === 'horizontal';
    startPos = isH ? e.clientX : e.clientY;
    startSizes = {
      before: isH ? before.offsetWidth : before.offsetHeight,
      after: isH ? after.offsetWidth : after.offsetHeight,
    };

    const onMove = (e) => {
      const delta = (isH ? e.clientX : e.clientY) - startPos;
      const total = startSizes.before + startSizes.after;
      before.style.flex = `${Math.max(100, startSizes.before + delta) / total}`;
      after.style.flex = `${Math.max(100, startSizes.after - delta) / total}`;
      const session = sessions.find((s) => s.id === activeId);
      if (session) session.panes.forEach((p) => safeFit(p));
    };

    const onUp = () => {
      divider.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  return divider;
}

// ──────────────────────────────────────
// Close a pane
// ──────────────────────────────────────

function closePaneInSession(pane) {
  const session = sessions.find((s) => s.id === activeId);
  if (!session) return;

  const pIdx = session.panes.indexOf(pane);
  if (pIdx === -1) return;

  // If it's the only pane, close the whole session
  if (session.panes.length === 1) {
    removeSession(session.id);
    return;
  }

  // Kill the pty and dispose the terminal
  window.terminalAPI.kill(pane.ptyId);
  paneByPtyId.delete(pane.ptyId);
  pane.term.dispose();

  // Remove the pane element and its adjacent divider. Compute the
  // divider index BEFORE mutating the DOM. Shared logic with onExit.
  const container = session._splitContainer;
  const paneIndex = Array.from(container.children).indexOf(pane.el);
  const dividerIndex = pickAdjacentDivider(paneIndex, container.children.length);
  if (dividerIndex !== null) {
    const candidate = container.children[dividerIndex];
    if (candidate && candidate.classList.contains('split-divider')) {
      candidate.remove();
    }
  }

  pane.el.remove();
  session.panes.splice(pIdx, 1);

  // If only one pane left, unwrap from split container
  if (session.panes.length === 1) {
    const lastPane = session.panes[0];
    session.wrapperEl.innerHTML = '';
    session.wrapperEl.appendChild(lastPane.el);
    lastPane.el.style.flex = '';
    session.splitDirection = null;
    session._splitContainer = null;
  }

  // Refit and focus remaining panes
  requestAnimationFrame(() => {
    session.panes.forEach((p) => safeFit(p));
    session.panes[0].term.focus();
  });

  renderSidebar();
  updateUI();
}

function closeFocusedPane() {
  const session = sessions.find((s) => s.id === activeId);
  if (!session) return;

  const focused = session.panes.find((p) => p.el.classList.contains('focused')) || session.panes[session.panes.length - 1];
  if (focused) closePaneInSession(focused);
}

// ──────────────────────────────────────
// PTY data routing
// ──────────────────────────────────────

let isRenaming = false;
let titleUpdateTimer = null;

window.terminalAPI.onData(({ id, data }) => {
  const pane = paneByPtyId.get(id);
  if (!pane) return;
  pane.recentChunks.push({ t: Date.now(), n: data.length || 0 });
  pane.term.write(data);
  const session = pane.session;
  if (session && !session.customTitle && !isRenaming) {
    clearTimeout(titleUpdateTimer);
    titleUpdateTimer = setTimeout(() => {
      Promise.all([
        window.terminalAPI.getCwd(id),
        window.terminalAPI.getHomedir(),
      ]).then(([cwd, home]) => {
        if (cwd && !session.customTitle && !isRenaming) {
          const name = cwd === home ? '~' : (cwd.split('/').pop() || 'Terminal');
          if (session.title !== name && name !== '') {
            session.title = name;
            renderSidebar();
            updateUI();
          }
        }
      });
    }, 500);
  }
});

window.terminalAPI.onExit(({ id }) => {
  for (const session of sessions) {
    const pIdx = session.panes.findIndex((p) => p.ptyId === id);
    if (pIdx === -1) continue;

    const pane = session.panes[pIdx];

    // For multi-pane sessions: compute which divider to remove BEFORE we
    // mutate the DOM. Previously this handler always removed the LAST
    // divider, stranding a leading orphan when the first pane exited.
    let dividerToRemove = null;
    if (session._splitContainer && session.panes.length > 1) {
      const container = session._splitContainer;
      const paneIndex = Array.from(container.children).indexOf(pane.el);
      const dividerIndex = pickAdjacentDivider(paneIndex, container.children.length);
      if (dividerIndex !== null) {
        const candidate = container.children[dividerIndex];
        if (candidate && candidate.classList.contains('split-divider')) {
          dividerToRemove = candidate;
        }
      }
    }

    paneByPtyId.delete(pane.ptyId);
    pane.term.dispose();
    pane.el.remove();
    if (dividerToRemove) dividerToRemove.remove();
    session.panes.splice(pIdx, 1);

    if (session.panes.length === 0) {
      removeSession(session.id);
    } else {
      // If only one pane remains, unwrap from the split container so we
      // don't leave a single pane inside a split shell.
      if (session.panes.length === 1) {
        const lastPane = session.panes[0];
        session.wrapperEl.innerHTML = '';
        session.wrapperEl.appendChild(lastPane.el);
        lastPane.el.style.flex = '';
        session.splitDirection = null;
        session._splitContainer = null;
      }
      session.panes.forEach((p) => safeFit(p));
      session.panes[0].term.focus();
      renderSidebar();
    }
    return;
  }
});

// ──────────────────────────────────────
// Search
// ──────────────────────────────────────

let searchVisible = false;

function toggleSearch() {
  searchVisible = !searchVisible;
  searchBar.classList.toggle('hidden', !searchVisible);
  if (searchVisible) {
    searchInput.focus();
    searchInput.select();
  } else {
    const session = sessions.find((s) => s.id === activeId);
    if (session) {
      const p = session.panes.find((p) => p.el.classList.contains('focused')) || session.panes[0];
      p.term.focus();
    }
  }
}

function getActiveSearchAddon() {
  const session = sessions.find((s) => s.id === activeId);
  if (!session) return null;
  const p = session.panes.find((p) => p.el.classList.contains('focused')) || session.panes[0];
  return p?.searchAddon;
}

searchInput.addEventListener('input', () => {
  const a = getActiveSearchAddon();
  if (a) a.findNext(searchInput.value);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const a = getActiveSearchAddon();
    if (a) e.shiftKey ? a.findPrevious(searchInput.value) : a.findNext(searchInput.value);
  }
  if (e.key === 'Escape') toggleSearch();
});

document.getElementById('search-next').addEventListener('click', () => {
  const a = getActiveSearchAddon();
  if (a) a.findNext(searchInput.value);
});
document.getElementById('search-prev').addEventListener('click', () => {
  const a = getActiveSearchAddon();
  if (a) a.findPrevious(searchInput.value);
});
document.getElementById('search-close').addEventListener('click', toggleSearch);

// ──────────────────────────────────────
// Zoom
// ──────────────────────────────────────

function setFontSize(size) {
  fontSize = Math.max(8, Math.min(32, size));
  sessions.forEach((s) => s.panes.forEach((p) => {
    p.term.options.fontSize = fontSize;
    safeFit(p);
  }));
}

// ──────────────────────────────────────
// Sidebar toggle
// ──────────────────────────────────────

const expandBtn = document.getElementById('sidebar-expand');

function toggleSidebar() {
  sidebar.classList.toggle('collapsed');
  expandBtn.classList.toggle('visible', sidebar.classList.contains('collapsed'));
  setTimeout(() => {
    const session = sessions.find((s) => s.id === activeId);
    if (session) session.panes.forEach((p) => safeFit(p));
  }, 300);
}

document.getElementById('sidebar-toggle').addEventListener('click', toggleSidebar);
expandBtn.addEventListener('click', toggleSidebar);

// ──────────────────────────────────────
// Button handlers
// ──────────────────────────────────────

document.getElementById('new-terminal-btn').addEventListener('click', () => showNewTerminalPicker());
document.getElementById('new-terminal-folder-btn').addEventListener('click', async () => {
  const folder = await window.terminalAPI.pickFolder();
  if (folder) showNewTerminalPicker(folder);
});
document.getElementById('empty-new-btn').addEventListener('click', () => showNewTerminalPicker());
document.getElementById('split-h-btn').addEventListener('click', () => splitPane('horizontal'));
document.getElementById('split-v-btn').addEventListener('click', () => splitPane('vertical'));
document.getElementById('search-btn').addEventListener('click', toggleSearch);

// ──────────────────────────────────────
// Menu IPC
// ──────────────────────────────────────

window.terminalAPI.onNewTab(() => showNewTerminalPicker());
window.terminalAPI.onNewTabInFolder(async () => {
  const folder = await window.terminalAPI.pickFolder();
  if (folder) showNewTerminalPicker(folder);
});
window.terminalAPI.onCloseTab(async () => { if (activeId && await confirmClose()) removeSession(activeId); });
window.terminalAPI.onClosePane(async () => { if (await confirmClose()) closeFocusedPane(); });
window.terminalAPI.onSplitHorizontal(() => splitPane('horizontal'));
window.terminalAPI.onSplitVertical(() => splitPane('vertical'));

window.terminalAPI.onRenameTab(() => {
  if (!activeId) return;
  const session = sessions.find((s) => s.id === activeId);
  if (!session) return;
  const titleEl = terminalListEl.querySelector(
    `.terminal-item[data-id="${activeId}"] .item-title`
  );
  if (titleEl) startRename(session, titleEl);
});

window.terminalAPI.onNextTab(() => {
  const idx = sessions.findIndex((s) => s.id === activeId);
  if (sessions.length > 0) {
    const next = (idx + 1) % sessions.length;
    activateSession(sessions[next].id);
  }
});

window.terminalAPI.onPrevTab(() => {
  const idx = sessions.findIndex((s) => s.id === activeId);
  if (sessions.length > 0) {
    const prev = (idx - 1 + sessions.length) % sessions.length;
    activateSession(sessions[prev].id);
  }
});

window.terminalAPI.onToggleSearch(toggleSearch);

window.terminalAPI.onClearTerminal(() => {
  const session = sessions.find((s) => s.id === activeId);
  if (!session) return;
  const p = session.panes.find((p) => p.el.classList.contains('focused')) || session.panes[0];
  if (p) p.term.clear();
});

window.terminalAPI.onZoomIn(() => setFontSize(fontSize + 1));
window.terminalAPI.onZoomOut(() => setFontSize(fontSize - 1));
window.terminalAPI.onZoomReset(() => setFontSize(14));

// ──────────────────────────────────────
// New terminal picker (Blank + snippets)
// ──────────────────────────────────────

const newTerminalPickerOverlay = document.getElementById('new-terminal-picker-overlay');
const newTerminalPicker = document.getElementById('new-terminal-picker');
const newTerminalPickerHeader = document.getElementById('new-terminal-picker-header');
const newTerminalPickerList = document.getElementById('new-terminal-picker-list');

// Persist the picker's dragged position within the session so reopening it
// doesn't snap back to center every time.
let pickerOffsetX = 0;
let pickerOffsetY = 0;

function applyPickerOffset() {
  if (pickerOffsetX === 0 && pickerOffsetY === 0) {
    newTerminalPicker.style.transform = '';
  } else {
    newTerminalPicker.style.transform = `translate(${pickerOffsetX}px, ${pickerOffsetY}px)`;
  }
}

(function enablePickerDrag() {
  let dragging = false;
  let originX = 0;
  let originY = 0;

  newTerminalPickerHeader.addEventListener('mousedown', (e) => {
    dragging = true;
    originX = e.clientX - pickerOffsetX;
    originY = e.clientY - pickerOffsetY;
    newTerminalPickerHeader.classList.add('dragging');
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    pickerOffsetX = e.clientX - originX;
    pickerOffsetY = e.clientY - originY;
    applyPickerOffset();
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    newTerminalPickerHeader.classList.remove('dragging');
  });
})();

function hideNewTerminalPicker() {
  newTerminalPickerOverlay.classList.add('hidden');
}

// Wait for a newly-spawned shell to finish its startup output before writing
// to it. Sending input too early gets echoed by the PTY line discipline BEFORE
// the shell switches to raw mode, then zsh's line editor redraws the same
// characters on the prompt line — so the command appears twice. We debounce
// on data arrival: once the PTY has been quiet for `quietMs`, the shell is
// assumed ready. A hard ceiling guarantees the command still goes out if the
// PTY never produces output (rare: non-interactive shells, failed startup).
function sendWhenShellReady(ptyId, data) {
  const quietMs = 200;
  const maxWaitMs = 2500;
  let timer = null;
  let fired = false;

  const send = () => {
    if (fired) return;
    fired = true;
    if (timer) clearTimeout(timer);
    unsubscribe();
    window.terminalAPI.sendInput(ptyId, data);
  };

  const unsubscribe = window.terminalAPI.onData((payload) => {
    if (payload.id !== ptyId) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(send, quietMs);
  });

  setTimeout(send, maxWaitMs);
}

async function showNewTerminalPicker(cwd) {
  const snippets = await window.terminalAPI.getSnippets();

  newTerminalPickerList.innerHTML = '';

  // "Blank" option: creates an empty terminal with no injected command.
  const blankEl = el('div', { class: 'snippet-item' }, [
    el('div', { class: 'snippet-item-icon', html: ICONS.plus }),
    el('div', { class: 'snippet-item-info' }, [
      el('div', { class: 'snippet-item-name' }, 'Blank'),
      el('div', { class: 'snippet-item-command' }, 'Empty terminal'),
    ]),
  ]);
  blankEl.addEventListener('click', () => {
    hideNewTerminalPicker();
    createSession(cwd);
  });
  newTerminalPickerList.appendChild(blankEl);

  snippets.forEach((s) => {
    const row = el('div', { class: 'snippet-item' }, [
      el('div', { class: 'snippet-item-icon', html: ICONS.prompt }),
      el('div', { class: 'snippet-item-info' }, [
        el('div', { class: 'snippet-item-name' }, s.name),
        el('div', { class: 'snippet-item-command' }, s.command),
      ]),
    ]);
    row.addEventListener('click', async () => {
      hideNewTerminalPicker();
      const session = await createSession(cwd);
      const pane = session.panes[0];
      sendWhenShellReady(pane.ptyId, s.command);
    });
    newTerminalPickerList.appendChild(row);
  });

  newTerminalPickerOverlay.classList.remove('hidden');
}

newTerminalPickerOverlay.addEventListener('click', (e) => {
  if (e.target === newTerminalPickerOverlay) hideNewTerminalPicker();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !newTerminalPickerOverlay.classList.contains('hidden')) {
    hideNewTerminalPicker();
  }
});

// Arrow-key navigation. Capture phase so xterm's textarea handler doesn't
// swallow these before us. We pass through when an <input> is focused so
// search/rename keep their native Cmd+arrow line-start/end behaviour.
//   Cmd+Up/Down    → prev/next session in sidebar
//   Cmd+Left/Right → prev/next pane inside the active session
document.addEventListener('keydown', (e) => {
  if (!e.metaKey) return;
  if (e.altKey || e.shiftKey || e.ctrlKey) return;
  if (e.target && e.target.tagName === 'INPUT') return;

  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    if (sessions.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const idx = sessions.findIndex((s) => s.id === activeId);
    const start = idx === -1 ? 0 : idx;
    const delta = e.key === 'ArrowDown' ? 1 : -1;
    const next = (start + delta + sessions.length) % sessions.length;
    activateSession(sessions[next].id);
    return;
  }

  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const session = sessions.find((s) => s.id === activeId);
    if (!session || session.panes.length < 2) return;
    e.preventDefault();
    e.stopPropagation();
    const focusedIdx = session.panes.findIndex((p) => p.el.classList.contains('focused'));
    const start = focusedIdx === -1 ? 0 : focusedIdx;
    const delta = e.key === 'ArrowRight' ? 1 : -1;
    const next = (start + delta + session.panes.length) % session.panes.length;
    session.panes[next].term.focus();
  }
}, true);

// ──────────────────────────────────────
// Snippets palette
// ──────────────────────────────────────

const snippetsOverlay = document.getElementById('snippets-overlay');
const snippetsList = document.getElementById('snippets-list');
const snippetsEmpty = document.getElementById('snippets-empty');
const snippetForm = document.getElementById('snippet-form');
const snippetNameInput = document.getElementById('snippet-name');
const snippetCommandInput = document.getElementById('snippet-command');

let snippetsVisible = false;

function genSnippetId() {
  return 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function toggleSnippets() {
  snippetsVisible = !snippetsVisible;
  snippetsOverlay.classList.toggle('hidden', !snippetsVisible);
  if (snippetsVisible) {
    snippetForm.classList.add('hidden');
    await renderSnippets();
  }
}

async function renderSnippets() {
  const snippets = await window.terminalAPI.getSnippets();
  snippetsList.innerHTML = '';
  snippetsEmpty.classList.toggle('hidden', snippets.length > 0);

  snippets.forEach((s) => {
    const deleteBtn = el('button', {
      class: 'snippet-item-delete',
      'data-action': 'delete',
      title: 'Delete snippet',
    }, '×');

    const row = el('div', { class: 'snippet-item' }, [
      el('div', { class: 'snippet-item-icon', html: ICONS.prompt }),
      el('div', { class: 'snippet-item-info' }, [
        el('div', { class: 'snippet-item-name' }, s.name),
        el('div', { class: 'snippet-item-command' }, s.command),
      ]),
      deleteBtn,
    ]);

    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="delete"]')) return;
      pasteSnippet(s.command);
    });

    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.terminalAPI.deleteSnippet(s.id);
      await renderSnippets();
    });

    snippetsList.appendChild(row);
  });
}

function pasteSnippet(command) {
  const session = sessions.find((s) => s.id === activeId);
  if (!session) return;
  const pane = session.panes.find((p) => p.el.classList.contains('focused')) || session.panes[0];
  if (pane) {
    window.terminalAPI.sendInput(pane.ptyId, command);
  }
  toggleSnippets();
  if (pane) pane.term.focus();
}

document.getElementById('snippets-add-btn').addEventListener('click', () => {
  snippetForm.classList.remove('hidden');
  snippetNameInput.value = '';
  snippetCommandInput.value = '';
  snippetNameInput.focus();
});

document.getElementById('snippet-cancel').addEventListener('click', () => {
  snippetForm.classList.add('hidden');
});

document.getElementById('snippet-save').addEventListener('click', async () => {
  const name = snippetNameInput.value.trim();
  const command = snippetCommandInput.value.trim();
  if (!name || !command) return;
  await window.terminalAPI.saveSnippet({ id: genSnippetId(), name, command });
  snippetForm.classList.add('hidden');
  await renderSnippets();
});

snippetCommandInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('snippet-save').click();
  if (e.key === 'Escape') toggleSnippets();
});

snippetNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') snippetCommandInput.focus();
  if (e.key === 'Escape') toggleSnippets();
});

snippetsOverlay.addEventListener('click', (e) => {
  if (e.target === snippetsOverlay) toggleSnippets();
});

document.getElementById('snippets-btn').addEventListener('click', toggleSnippets);
window.terminalAPI.onToggleSnippets(toggleSnippets);

// ──────────────────────────────────────
// Close confirmation dialog
// ──────────────────────────────────────

function confirmClose(message = 'Close this terminal?') {
  return new Promise((resolve) => {
    const overlay = document.getElementById('confirm-overlay');
    const msgEl = document.getElementById('confirm-message');
    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');

    msgEl.textContent = message;
    overlay.classList.remove('hidden');
    okBtn.focus();

    const cleanup = () => {
      overlay.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlay);
      document.removeEventListener('keydown', onKey);
    };

    const onOk = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };
    const onOverlay = (e) => { if (e.target === overlay) onCancel(); };
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); onOk(); }
      if (e.key === 'Escape') onCancel();
    };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlay);
    document.addEventListener('keydown', onKey);
  });
}

// ──────────────────────────────────────
// Resize
// ──────────────────────────────────────

// Throttle window resize to one call per animation frame. Without this,
// the browser fires resize many times per second during a drag, each call
// triggers a full buffer reflow, and the render lags behind — making
// pinned-to-bottom terminals appear to drift upward mid-drag.
let _resizeRaf = null;
window.addEventListener('resize', () => {
  if (_resizeRaf !== null) return;
  _resizeRaf = requestAnimationFrame(() => {
    _resizeRaf = null;
    const session = sessions.find((s) => s.id === activeId);
    if (session) session.panes.forEach((p) => safeFit(p));
  });
});

// ──────────────────────────────────────
// Prevent Electron from navigating when files are dragged onto the window
// ──────────────────────────────────────

document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());

// ──────────────────────────────────────
// Boot — start with one terminal
// ──────────────────────────────────────

createSession().catch((err) => {
  // Spawn failed at startup. Leave the empty state visible so the user
  // can click "Open a Terminal" to retry.
  console.error('Initial terminal failed to spawn:', err);
  updateUI();
});
