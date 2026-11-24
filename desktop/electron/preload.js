const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Python backend port
  getPythonPort: () => ipcRenderer.invoke('get-python-port'),

  // File dialogs
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),

  // File operations
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),

  // Dialogs
  showMessageBox: (options) => ipcRenderer.invoke('show-message-box', options),

  // External links
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Menu actions
  onMenuAction: (callback) => {
    ipcRenderer.on('menu-action', (_event, action) => callback(action));
  },

  // Platform info
  platform: process.platform,
  isMac: process.platform === 'darwin',
  isWindows: process.platform === 'win32',
  isLinux: process.platform === 'linux',

  // App version
  appVersion: process.env.npm_package_version || '1.0.0',

  // Check if running in desktop app
  isDesktop: true,
});