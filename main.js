const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const pty = require('node-pty');
const Store = require('electron-store');
const { getShellConfig } = require('./lib/shell');
const { createTerminalStore } = require('./lib/terminal-store');

const execFileAsync = promisify(execFile);

const store = new Store({ name: 'snippets', defaults: { snippets: [] } });

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
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
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
          accelerator: 'CmdOrCtrl+T',
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
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
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

  let ptyProcess;
  try {
    ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: cwd || os.homedir(),
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
