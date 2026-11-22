const { app, BrowserWindow, ipcMain, Menu, dialog, Notification, screen } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const pty = require('node-pty');
const Store = require('electron-store');
const { getShellConfig } = require('./lib/shell');
const { createTerminalStore } = require('./lib/terminal-store');
const { sanitizeSavedTabs, looksLikeVersion, cleanProcessName } = require('./lib/tabs');

const execFileAsync = promisify(execFile);

const store = new Store({ name: 'snippets', defaults: { snippets: [] } });

// Things the app remembers between launches: window placement, open tabs,
// and whether to notify when a background tab finishes.
const appState = new Store({
  name: 'state',
  defaults: { window: null, tabs: null, notify: true },
});

// Saved bounds are only reused if they still land on a connected display;
// otherwise a window saved on an unplugged monitor would open off-screen.
function savedWindowBounds() {
  const b = appState.get('window');
  if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite)) return null;
  const area = screen.getDisplayMatching(b).workArea;
  const overlapW = Math.min(b.x + b.width, area.x + area.width) - Math.max(b.x, area.x);
  const overlapH = Math.min(b.y + b.height, area.y + area.height) - Math.max(b.y, area.y);
  if (overlapW < 200 || overlapH < 100) return null;
  return { x: b.x, y: b.y, width: Math.max(600, b.width), height: Math.max(400, b.height) };
}

let mainWindow;
const terminals = createTerminalStore();

// PTY → renderer batching. Bursty output (npm install, log tails, `seq`) used
// to fire one IPC per chunk; coalescing per event-loop tick collapses those
// into one larger send and saves the main↔renderer round trips.
const pendingData = new Map(); // id -> string[]
let flushScheduled = false;

function flushPendingData() {
  flushScheduled = false;
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingData.clear();
    return;
  }
  for (const [id, chunks] of pendingData) {
    mainWindow.webContents.send('terminal-data', { id, data: chunks.join('') });
  }
  pendingData.clear();
}

function queueTerminalData(id, data) {
  let chunks = pendingData.get(id);
  if (!chunks) pendingData.set(id, (chunks = []));
  chunks.push(data);
  if (!flushScheduled) {
    flushScheduled = true;
    setImmediate(flushPendingData);
  }
}

function createWindow() {
  const savedBounds = savedWindowBounds();
  const wasFullscreen = !!(appState.get('window') || {}).fullscreen;

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    ...(savedBounds || {}),
    // Only ever pass `fullscreen: true`. Electron treats an explicit
    // `false` as "this window may never go full screen" and disables the
    // green button and the menu item.
    ...(wasFullscreen ? { fullscreen: true } : {}),
    minWidth: 600,
    minHeight: 400,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // Without this, Electron clamps the renderer's rAF/timers when the
      // window loses focus, which stalls long-running PTY output.
      backgroundThrottling: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  const win = mainWindow;

  // In full screen macOS hides the traffic lights, so the renderer stops
  // reserving space for them.
  const sendFullscreen = () => {
    if (!win.isDestroyed()) win.webContents.send('fullscreen-changed', win.isFullScreen());
  };
  win.on('enter-full-screen', sendFullscreen);
  win.on('leave-full-screen', sendFullscreen);
  win.webContents.on('did-finish-load', sendFullscreen);

  // Remember where the window is. getNormalBounds() is the windowed size
  // even while full screen, so leaving full screen later restores it.
  let boundsTimer = null;
  const saveBounds = () => {
    if (win.isDestroyed()) return;
    appState.set('window', { ...win.getNormalBounds(), fullscreen: win.isFullScreen() });
  };
  const saveBoundsSoon = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(saveBounds, 500);
  };
  win.on('resize', saveBoundsSoon);
  win.on('move', saveBoundsSoon);
  win.on('enter-full-screen', saveBoundsSoon);
  win.on('leave-full-screen', saveBoundsSoon);
  win.on('focus', () => win.webContents.send('window-focus'));

  // Closing the window kills every session in it, so always ask first.
  // This covers the red button, Cmd+Q and the Quit menu item, since they
  // all go through the window's close event.
  let closeConfirmed = false;
  let closePromptOpen = false;
  win.on('close', (event) => {
    clearTimeout(boundsTimer);
    saveBounds();
    if (closeConfirmed) return;
    event.preventDefault();
    if (closePromptOpen) return;
    closePromptOpen = true;

    const count = terminals.size();
    const detail = count > 0
      ? `This will end ${count} running session${count === 1 ? '' : 's'}.`
      : 'All tabs will be closed.';

    // Async on purpose: the sync dialog would block the main process and
    // stall pty output while the prompt is up.
    dialog.showMessageBox(win, {
      type: 'warning',
      message: 'Quit TerminalHub?',
      detail,
      buttons: ['Quit', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      closePromptOpen = false;
      if (response !== 0 || win.isDestroyed()) return;
      closeConfirmed = true;
      win.close();
    }).catch(() => {
      closePromptOpen = false;
    });
  });

  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Terminal',
      submenu: [
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow.webContents.send('new-tab'),
        },
        {
          label: 'New Tab in Folder...',
          accelerator: 'CmdOrCtrl+M',
          click: () => mainWindow.webContents.send('new-tab-in-folder'),
        },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => mainWindow.webContents.send('close-tab'),
        },
        {
          label: 'Rename Tab',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow.webContents.send('rename-tab'),
        },
        { type: 'separator' },
        {
          label: 'Close Pane',
          accelerator: 'CmdOrCtrl+Shift+W',
          click: () => mainWindow.webContents.send('close-pane'),
        },
        { type: 'separator' },
        {
          label: 'Split Horizontally',
          accelerator: 'CmdOrCtrl+D',
          click: () => mainWindow.webContents.send('split-horizontal'),
        },
        {
          label: 'Split Vertically',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => mainWindow.webContents.send('split-vertical'),
        },
        { type: 'separator' },
        {
          label: 'Next Tab',
          accelerator: 'CmdOrCtrl+Shift+]',
          click: () => mainWindow.webContents.send('next-tab'),
        },
        {
          label: 'Previous Tab',
          accelerator: 'CmdOrCtrl+Shift+[',
          click: () => mainWindow.webContents.send('prev-tab'),
        },
        // ⌘1 to ⌘9 jump straight to a tab. Hidden so they don't fill the
        // menu; on macOS accelerators of hidden items still work.
        ...Array.from({ length: 9 }, (_, i) => ({
          label: `Go to Tab ${i + 1}`,
          accelerator: `CmdOrCtrl+${i + 1}`,
          visible: false,
          click: () => mainWindow.webContents.send('goto-tab', i + 1),
        })),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'copy' },
        { role: 'paste' },
        {
          // Not the selectAll role: that grabs the whole buffer. The
          // renderer selects the line being edited first, everything on a
          // second press.
          label: 'Select All',
          accelerator: 'CmdOrCtrl+A',
          click: () => {
            // DevTools is its own webContents; the custom accelerator would
            // otherwise steal Cmd+A from its inputs.
            if (mainWindow.webContents.isDevToolsFocused()) {
              mainWindow.webContents.devToolsWebContents?.selectAll();
              return;
            }
            mainWindow.webContents.send('select-all');
          },
        },
        { type: 'separator' },
        {
          label: 'Find',
          accelerator: 'CmdOrCtrl+F',
          click: () => mainWindow.webContents.send('toggle-search'),
        },
        {
          label: 'Clear Terminal',
          accelerator: 'CmdOrCtrl+K',
          click: () => mainWindow.webContents.send('clear-terminal'),
        },
        { type: 'separator' },
        {
          label: 'Snippets',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow.webContents.send('toggle-snippets'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+=',
          click: () => mainWindow.webContents.send('zoom-in'),
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => mainWindow.webContents.send('zoom-out'),
        },
        {
          label: 'Reset Zoom',
          accelerator: 'CmdOrCtrl+0',
          click: () => mainWindow.webContents.send('zoom-reset'),
        },
        { type: 'separator' },
        {
          label: 'Notify When a Tab Finishes',
          type: 'checkbox',
          checked: appState.get('notify'),
          click: (item) => appState.set('notify', item.checked),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  for (const term of terminals.takeAll()) term.kill();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('get-homedir', () => os.homedir());

ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Open Terminal in Folder',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('create-terminal', (event, { cols, rows, cwd }) => {
  const { shell, args } = getShellConfig({ platform: process.platform, env: process.env });
  const sender = event.sender.id;

  // Strip vars npm seeds when TerminalHub is launched via `npm start` / the
  // bin script. Without this, every spawned shell inherits npm_lifecycle_event,
  // npm_config_*, etc., and tools that branch on those (eg. `npm` itself) think
  // they're running inside a script. NODE_OPTIONS goes too so user `node`
  // invocations don't pick up flags meant for the Electron host.
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !k.startsWith('npm_') && k !== 'NODE_OPTIONS'
    )
  );

  // A remembered folder (restored tab, snippet) may be gone by now. Spawning
  // into a missing folder fails outright, so fall back to home.
  let startDir = os.homedir();
  if (typeof cwd === 'string' && cwd) {
    try {
      if (fs.statSync(cwd).isDirectory()) startDir = cwd;
    } catch { /* missing or unreadable: keep home */ }
  }

  let ptyProcess;
  try {
    ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: startDir,
      env: {
        ...cleanEnv,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        LANG: process.env.LANG || 'en_US.UTF-8',
        TERM_PROGRAM: 'TerminalHub',
        TERM_PROGRAM_VERSION: app.getVersion(),
      },
    });
  } catch (err) {
    // Rethrowing causes ipcRenderer.invoke() in the renderer to reject,
    // so createPane() can clean up its half-built DOM.
    throw new Error(`Failed to spawn shell (${shell}): ${err.message}`);
  }

  const id = terminals.create(sender, ptyProcess);

  // Release this sender's terminals when its frame goes away (renderer
  // reload, window close), so we don't leak ptys or end up with stale
  // ownership records.
  event.sender.once('destroyed', () => {
    for (const term of terminals.takeAllForSender(sender)) {
      try { term.kill(); } catch {}
    }
  });

  ptyProcess.onData((data) => queueTerminalData(id, data));

  ptyProcess.onExit(({ exitCode }) => {
    // Drain any buffered output for this pty before announcing exit, otherwise
    // the renderer may see "closed" while final bytes are still queued.
    const chunks = pendingData.get(id);
    if (chunks && chunks.length && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal-data', { id, data: chunks.join('') });
    }
    pendingData.delete(id);

    // The pty exited on its own; reclaim the slot. take() is safe even
    // if the sender already cleaned up.
    terminals.take(sender, id);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal-exit', { id, exitCode });
    }
  });

  return id;
});

ipcMain.on('terminal-input', (event, { id, data }) => {
  const term = terminals.get(event.sender.id, id);
  if (term) term.write(data);
});

ipcMain.on('terminal-resize', (event, { id, cols, rows }) => {
  const term = terminals.get(event.sender.id, id);
  if (term) {
    try {
      term.resize(cols, rows);
    } catch {
      // xterm can throw on degenerate sizes during animation; safe to ignore.
    }
  }
});

ipcMain.on('terminal-kill', (event, { id }) => {
  const term = terminals.take(event.sender.id, id);
  if (term) term.kill();
});

// ──────────────────────────────────────
// Snippets CRUD
// ──────────────────────────────────────

ipcMain.handle('get-snippets', () => store.get('snippets'));

ipcMain.handle('save-snippet', (event, snippet) => {
  const snippets = store.get('snippets');
  const idx = snippets.findIndex((s) => s.id === snippet.id);
  if (idx >= 0) {
    snippets[idx] = snippet;
  } else {
    snippets.push(snippet);
  }
  store.set('snippets', snippets);
  return snippets;
});

ipcMain.handle('delete-snippet', (event, id) => {
  const snippets = store.get('snippets').filter((s) => s.id !== id);
  store.set('snippets', snippets);
  return snippets;
});

// ──────────────────────────────────────
// Remembered tabs, notifications, Dock badge
// ──────────────────────────────────────

ipcMain.handle('get-saved-tabs', () => sanitizeSavedTabs(appState.get('tabs')));

ipcMain.on('save-tabs', (event, snapshot) => {
  appState.set('tabs', sanitizeSavedTabs(snapshot));
});

// Hold references so a notification isn't garbage-collected before the
// user clicks it.
const liveNotifications = new Set();

ipcMain.on('notify-tab', (event, { id, title, body }) => {
  if (!appState.get('notify') || !Notification.isSupported()) return;
  const n = new Notification({
    title: String(title || 'TerminalHub').slice(0, 120),
    body: String(body || '').slice(0, 200),
  });
  liveNotifications.add(n);
  const done = () => liveNotifications.delete(n);
  n.on('click', () => {
    done();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('activate-session', id);
  });
  n.on('close', done);
  n.show();
});

ipcMain.on('set-badge', (event, count) => {
  if (!app.dock) return;
  const n = Number.isInteger(count) && count > 0 ? count : 0;
  app.dock.setBadge(n ? String(n) : '');
});

// Folder and foreground program of a pty, for tab names. `proc` is the
// name of whatever currently owns the terminal: the shell when idle, or
// the program the user started.
ipcMain.handle('get-pane-info', async (event, { id }) => {
  const term = terminals.get(event.sender.id, id);
  if (!term) return null;
  let proc = null;
  try { proc = term.process || null; } catch { /* pty already gone */ }
  // A version-number name means the program runs through a link (see
  // looksLikeVersion). Ask ps for the name it was started under: find the
  // process that owns the terminal right now, then read its command.
  if (looksLikeVersion(proc) && process.platform !== 'win32') {
    try {
      const fg = await execFileAsync('ps', ['-o', 'tpgid=', '-p', String(term.pid)], { encoding: 'utf8', timeout: 2000 });
      const fgPid = parseInt(fg.stdout, 10);
      if (fgPid > 0) {
        const named = await execFileAsync('ps', ['-o', 'comm=', '-p', String(fgPid)], { encoding: 'utf8', timeout: 2000 });
        const name = cleanProcessName(named.stdout);
        if (name && !looksLikeVersion(name)) proc = name;
      }
    } catch { /* keep the kernel's name */ }
  }
  let cwd = null;
  if (process.platform !== 'win32') {
    try {
      const { stdout } = await execFileAsync(
        'lsof',
        ['-a', '-d', 'cwd', '-p', String(term.pid), '-Fn'],
        { encoding: 'utf8', timeout: 2000 }
      );
      const match = stdout.match(/\nn(.*)/);
      cwd = match ? match[1] : null;
    } catch { /* leave null: the renderer keeps its last known folder */ }
  }
  return { cwd, proc };
});

// Resolve a pty's working directory via lsof. Async so the main process
// isn't blocked on every keystroke debounce. Returns null on failure, on
// Windows (no lsof), or for unknown ids — the renderer treats null as
// "no update", avoiding mislabelling sessions as the home directory.
ipcMain.handle('get-cwd', async (event, { id }) => {
  if (process.platform === 'win32') return null;
  const term = terminals.get(event.sender.id, id);
  if (!term) return null;
  try {
    const { stdout } = await execFileAsync(
      'lsof',
      ['-a', '-d', 'cwd', '-p', String(term.pid), '-Fn'],
      { encoding: 'utf8', timeout: 2000 }
    );
    const match = stdout.match(/\nn(.*)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
});
