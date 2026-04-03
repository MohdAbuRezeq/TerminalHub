const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('terminalAPI', {
  getHomedir: () => ipcRenderer.invoke('get-homedir'),
  createTerminal: (opts) => ipcRenderer.invoke('create-terminal', opts),
  sendInput: (id, data) => ipcRenderer.send('terminal-input', { id, data }),
  resize: (id, cols, rows) => ipcRenderer.send('terminal-resize', { id, cols, rows }),
  kill: (id) => ipcRenderer.send('terminal-kill', { id }),
  getCwd: (id) => ipcRenderer.invoke('get-cwd', { id }),

  onData: (callback) => {
    const handler = (event, payload) => callback(payload);
    ipcRenderer.on('terminal-data', handler);
    return () => ipcRenderer.removeListener('terminal-data', handler);
  },
  onExit: (callback) => {
    const handler = (event, payload) => callback(payload);
    ipcRenderer.on('terminal-exit', handler);
    return () => ipcRenderer.removeListener('terminal-exit', handler);
  },

  onNewTab: (cb) => ipcRenderer.on('new-tab', cb),
  onCloseTab: (cb) => ipcRenderer.on('close-tab', cb),
  onClosePane: (cb) => ipcRenderer.on('close-pane', cb),
  onSplitHorizontal: (cb) => ipcRenderer.on('split-horizontal', cb),
  onSplitVertical: (cb) => ipcRenderer.on('split-vertical', cb),
  onNextTab: (cb) => ipcRenderer.on('next-tab', cb),
  onPrevTab: (cb) => ipcRenderer.on('prev-tab', cb),
  onToggleSearch: (cb) => ipcRenderer.on('toggle-search', cb),
  onClearTerminal: (cb) => ipcRenderer.on('clear-terminal', cb),
  onZoomIn: (cb) => ipcRenderer.on('zoom-in', cb),
  onZoomOut: (cb) => ipcRenderer.on('zoom-out', cb),
  onZoomReset: (cb) => ipcRenderer.on('zoom-reset', cb),
});
