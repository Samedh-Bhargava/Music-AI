import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Python backend port
  getPythonPort: () => ipcRenderer.invoke('get-python-port'),

  // File dialogs
  showOpenDialog: (options: Electron.OpenDialogOptions) => ipcRenderer.invoke('show-open-dialog', options),
  showSaveDialog: (options: Electron.SaveDialogOptions) => ipcRenderer.invoke('show-save-dialog', options),

  // File operations
  readFile: (filePath: string) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('write-file', filePath, content),

  // Dialogs
  showMessageBox: (options: Electron.MessageBoxOptions) => ipcRenderer.invoke('show-message-box', options),

  // External links
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),

  // Menu actions
  onMenuAction: (callback: (action: string) => void) => {
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

// Type declarations for TypeScript
declare global {
  interface Window {
    electronAPI: {
      getPythonPort: () => Promise<number>;
      showOpenDialog: (options: Electron.OpenDialogOptions) => Promise<Electron.OpenDialogReturnValue>;
      showSaveDialog: (options: Electron.SaveDialogOptions) => Promise<Electron.SaveDialogReturnValue>;
      readFile: (filePath: string) => Promise<string>;
      writeFile: (filePath: string, content: string) => Promise<void>;
      showMessageBox: (options: Electron.MessageBoxOptions) => Promise<Electron.MessageBoxReturnValue>;
      openExternal: (url: string) => Promise<void>;
      onMenuAction: (callback: (action: string) => void) => void;
      platform: NodeJS.Platform;
      isMac: boolean;
      isWindows: boolean;
      isLinux: boolean;
      appVersion: string;
      isDesktop: boolean;
    };
  }
}