const { Terminal } = require('@xterm/xterm');
const { FitAddon } = require('@xterm/addon-fit');
const { WebLinksAddon } = require('@xterm/addon-web-links');
const { SearchAddon } = require('@xterm/addon-search');

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
let fontSize = 14;
let sessionCounter = 0;

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
    lineHeight: 1.3,
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

  const ptyId = await window.terminalAPI.createTerminal({
    cols: term.cols,
    rows: term.rows,
    cwd,
  });

  term.onData((data) => window.terminalAPI.sendInput(ptyId, data));
  term.onResize(({ cols, rows }) => window.terminalAPI.resize(ptyId, cols, rows));

  term.textarea.addEventListener('focus', () => {
    document.querySelectorAll('.split-pane.focused').forEach((el) => el.classList.remove('focused'));
    paneEl.classList.add('focused');
  });

  const pane = { ptyId, term, fitAddon, searchAddon, el: paneEl };

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closePaneInSession(pane);
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

  const pane = await createPane(wrapperEl, cwd);

  const session = {
    id,
    panes: [pane],
    wrapperEl,
    splitDirection: null,
    title: `Terminal ${sessionCounter}`,
    customTitle: false,
    createdAt: new Date(),
  };

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

  session.wrapperEl.classList.add('active');

  const itemEl = document.querySelector(`.terminal-item[data-id="${id}"]`);
  if (itemEl) itemEl.classList.add('active');

  requestAnimationFrame(() => {
    session.panes.forEach((p) => p.fitAddon.fit());
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

  sessions.forEach((session, i) => {
    const el = document.createElement('div');
    el.className = 'terminal-item' + (session.id === activeId ? ' active' : '');
    el.dataset.id = session.id;

    const paneLabel = session.panes.length > 1 ? ` \u00b7 ${session.panes.length} panes` : '';
    const timeStr = session.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    el.innerHTML = `
      <div class="item-icon">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="4 17 10 11 4 5"></polyline>
          <line x1="12" y1="19" x2="20" y2="19"></line>
        </svg>
      </div>
      <div class="item-info">
        <div class="item-title">${session.title}</div>
        <div class="item-subtitle">${timeStr}${paneLabel}</div>
      </div>
      <span class="item-dot"></span>
      <button class="item-close" data-action="close">&times;</button>
    `;

    let clickTimer = null;
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="close"]')) {
        removeSession(session.id);
        return;
      }
      // Delay single-click to distinguish from double-click
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; return; }
      clickTimer = setTimeout(() => {
        clickTimer = null;
        activateSession(session.id);
      }, 250);
    });

    el.addEventListener('dblclick', (e) => {
      if (e.target.closest('[data-action="close"]')) return;
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
      const titleEl = el.querySelector('.item-title');
      if (titleEl) startRename(session, titleEl);
    });

    terminalListEl.appendChild(el);
  });
}

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
    newPane.term.focus();
  } else {
    const splitContainer = session._splitContainer;
    const divider = createDivider(splitContainer, session.splitDirection);
    splitContainer.appendChild(divider);

    const newPane = await createPane(splitContainer);
    session.panes.push(newPane);
    newPane.term.focus();
  }

  requestAnimationFrame(() => {
    session.panes.forEach((p) => p.fitAddon.fit());
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
      if (session) session.panes.forEach((p) => p.fitAddon.fit());
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
  pane.term.dispose();

  // Remove the pane element and its adjacent divider
  const container = session._splitContainer;
  const children = Array.from(container.children);
  const paneIndex = children.indexOf(pane.el);

  // Remove divider: prefer the one before, else the one after
  if (paneIndex > 0 && children[paneIndex - 1]?.classList.contains('split-divider')) {
    children[paneIndex - 1].remove();
  } else if (paneIndex < children.length - 1 && children[paneIndex + 1]?.classList.contains('split-divider')) {
    children[paneIndex + 1].remove();
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
    session.panes.forEach((p) => p.fitAddon.fit());
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
  for (const session of sessions) {
    for (const pane of session.panes) {
      if (pane.ptyId === id) {
        pane.term.write(data);
        // Debounced auto-title update — skip if user is renaming
        if (!session.customTitle && !isRenaming) {
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
        return;
      }
    }
  }
});

window.terminalAPI.onExit(({ id }) => {
  for (const session of sessions) {
    const pIdx = session.panes.findIndex((p) => p.ptyId === id);
    if (pIdx === -1) continue;

    const pane = session.panes[pIdx];
    pane.term.dispose();
    pane.el.remove();
    session.panes.splice(pIdx, 1);

    if (session.panes.length === 0) {
      removeSession(session.id);
    } else {
      const dividers = session._splitContainer?.querySelectorAll('.split-divider');
      if (dividers && dividers.length >= session.panes.length) {
        dividers[dividers.length - 1].remove();
      }
      session.panes.forEach((p) => p.fitAddon.fit());
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
    p.fitAddon.fit();
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
    if (session) session.panes.forEach((p) => p.fitAddon.fit());
  }, 300);
}

document.getElementById('sidebar-toggle').addEventListener('click', toggleSidebar);
expandBtn.addEventListener('click', toggleSidebar);

// ──────────────────────────────────────
// Button handlers
// ──────────────────────────────────────

document.getElementById('new-terminal-btn').addEventListener('click', () => createSession());
document.getElementById('new-terminal-folder-btn').addEventListener('click', async () => {
  const folder = await window.terminalAPI.pickFolder();
  if (folder) createSession(folder);
});
document.getElementById('empty-new-btn').addEventListener('click', createSession);
document.getElementById('split-h-btn').addEventListener('click', () => splitPane('horizontal'));
document.getElementById('split-v-btn').addEventListener('click', () => splitPane('vertical'));
document.getElementById('search-btn').addEventListener('click', toggleSearch);

// ──────────────────────────────────────
// Menu IPC
// ──────────────────────────────────────

window.terminalAPI.onNewTab(() => createSession());
window.terminalAPI.onNewTabInFolder(async () => {
  const folder = await window.terminalAPI.pickFolder();
  if (folder) createSession(folder);
});
window.terminalAPI.onCloseTab(() => { if (activeId) removeSession(activeId); });
window.terminalAPI.onClosePane(() => closeFocusedPane());
window.terminalAPI.onSplitHorizontal(() => splitPane('horizontal'));
window.terminalAPI.onSplitVertical(() => splitPane('vertical'));

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
    const el = document.createElement('div');
    el.className = 'snippet-item';
    el.innerHTML = `
      <div class="snippet-item-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="4 17 10 11 4 5"></polyline>
          <line x1="12" y1="19" x2="20" y2="19"></line>
        </svg>
      </div>
      <div class="snippet-item-info">
        <div class="snippet-item-name">${s.name}</div>
        <div class="snippet-item-command">${s.command}</div>
      </div>
      <button class="snippet-item-delete" data-action="delete" title="Delete snippet">&times;</button>
    `;

    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="delete"]')) return;
      pasteSnippet(s.command);
    });

    el.querySelector('[data-action="delete"]').addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.terminalAPI.deleteSnippet(s.id);
      await renderSnippets();
    });

    snippetsList.appendChild(el);
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
// Resize
// ──────────────────────────────────────

window.addEventListener('resize', () => {
  const session = sessions.find((s) => s.id === activeId);
  if (session) session.panes.forEach((p) => p.fitAddon.fit());
});

// ──────────────────────────────────────
// Boot — start with one terminal
// ──────────────────────────────────────

createSession();
