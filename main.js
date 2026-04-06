const { app, BrowserWindow, ipcMain, Menu, globalShortcut, dialog } = require('electron');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const pty = require('node-pty');
const Store = require('electron-store');

const store = new Store({ name: 'snippets', defaults: { snippets: [] } });

let mainWindow;
const terminals = new Map();
let terminalIdCounter = 0;

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
          accelerator: 'CmdOrCtrl+T',
          click: () => mainWindow.webContents.send('new-tab'),
        },
        {
          label: 'New Tab in Folder...',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => mainWindow.webContents.send('new-tab-in-folder'),
        },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => mainWindow.webContents.send('close-tab'),
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
  terminals.forEach((term) => term.kill());
  terminals.clear();
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
  const id = ++terminalIdCounter;
  const shell = process.env.SHELL || '/bin/zsh';

  const ptyProcess = pty.spawn(shell, ['--login'], {
    name: 'xterm-256color',
    cols: cols || 80,
    rows: rows || 24,
    cwd: cwd || os.homedir(),
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    },
  });

  terminals.set(id, ptyProcess);

  ptyProcess.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal-data', { id, data });
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    terminals.delete(id);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal-exit', { id, exitCode });
    }
  });

  return id;
});

ipcMain.on('terminal-input', (event, { id, data }) => {
  const term = terminals.get(id);
  if (term) term.write(data);
});

ipcMain.on('terminal-resize', (event, { id, cols, rows }) => {
  const term = terminals.get(id);
  if (term) {
    try {
      term.resize(cols, rows);
    } catch (e) {
      // ignore resize errors
    }
  }
});

ipcMain.on('terminal-kill', (event, { id }) => {
  const term = terminals.get(id);
  if (term) {
    term.kill();
    terminals.delete(id);
  }
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

ipcMain.handle('get-cwd', (event, { id }) => {
  const term = terminals.get(id);
  if (term) {
    try {
      const result = execFileSync('lsof', ['-a', '-d', 'cwd', '-p', String(term.pid), '-Fn'], { encoding: 'utf8', timeout: 2000 });
      const match = result.match(/\nn(.*)/);
      if (match) return match[1];
    } catch {}
    return os.homedir();
  }
  return os.homedir();
});
