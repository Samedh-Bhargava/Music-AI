const electron = require('electron/main');
const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = electron;
const path = require('path');
const { spawn } = require('child_process');
const getPort = require('get-port-sync');

let mainWindow = null;
let pythonProcess = null;
let pythonPort = 0;
const isDev = process.env.NODE_ENV === 'development';
const isMac = process.platform === 'darwin';

function getPythonExecutable() {
  if (isDev) {
    return path.join(__dirname, '..', 'python', 'dist', 'venv', 'Scripts', 'python.exe');
  }

  const basePath = path.join(process.resourcesPath, 'python', 'dist');

  if (process.platform === 'win32') {
    return path.join(basePath, 'venv', 'Scripts', 'python.exe');
  } else {
    return path.join(basePath, 'venv', 'bin', 'python');
  }
}

function getServerScript() {
  if (isDev) {
    return path.join(__dirname, '..', '..', 'server', 'main.py');
  }
  return path.join(process.resourcesPath, 'server', 'main.py');
}

function getProjectRoot() {
  if (isDev) {
    return path.join(__dirname, '..', '..');
  }
  return process.resourcesPath;
}

async function startPythonServer() {
  return new Promise((resolve, reject) => {
    const pythonExe = getPythonExecutable();
    const serverScript = getServerScript();
    const projectRoot = getProjectRoot();

    const freePort = getPort();
    const port = freePort || 8000;

    const args = [serverScript, '--port', port.toString(), '--host', '127.0.0.1', '--desktop', '--root', projectRoot];

    console.log('Starting Python server:', pythonExe, args);

    pythonProcess = spawn(pythonExe, args, {
      env: {
        ...process.env,
        PYTHONPATH: path.join(projectRoot, 'server'),
        AUDIVERIS_BIN: path.join(process.resourcesPath, 'python', 'dist', 'audiveris', 'bin', 'Audiveris'),
        TESSDATA_PREFIX: path.join(process.resourcesPath, 'python', 'dist', 'tessdata'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    pythonProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      console.log('[Python]', output);

      if (output.includes('Uvicorn running on') || output.includes('Application startup complete')) {
        pythonPort = port;
        resolve(port);
      }
    });

    pythonProcess.stderr?.on('data', (data) => {
      console.error('[Python Error]', data.toString());
    });

    pythonProcess.on('error', (err) => {
      console.error('Failed to start Python:', err);
      reject(err);
    });

    pythonProcess.on('exit', (code) => {
      console.log('Python process exited with code:', code);
      pythonProcess = null;
    });

    setTimeout(() => {
      if (pythonPort === 0) {
        reject(new Error('Python server startup timeout'));
      }
    }, 30000);
  });
}

function stopPythonServer() {
  if (pythonProcess) {
    pythonProcess.kill();
    pythonProcess = null;
    pythonPort = 0;
  }
}

async function createWindow() {
  try {
    await startPythonServer();
    console.log('Python server started on port:', pythonPort);
  } catch (err) {
    console.error('Failed to start Python server:', err);
    dialog.showErrorBox('Startup Error', 'Failed to start local AI service. Some features may not work.');
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Sonora — Music Score Studio',
    icon: path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
    show: false,
    backgroundColor: '#f5f7f4',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 18, y: 18 } : undefined,
  });

  const landingPath = isDev
    ? path.join(__dirname, '..', '..', 'landing.html')
    : path.join(process.resourcesPath, 'landing.html');

  await mainWindow.loadFile(landingPath);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    if (isDev) {
      mainWindow?.webContents.openDevTools();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  createMenu();
}

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Score',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('menu-action', 'new-score'),
        },
        {
          label: 'Open Score...',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu-action', 'open-score'),
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('menu-action', 'save'),
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow?.webContents.send('menu-action', 'save-as'),
        },
        { type: 'separator' },
        {
          label: 'Import Audio...',
          accelerator: 'CmdOrCtrl+I',
          click: () => mainWindow?.webContents.send('menu-action', 'import-audio'),
        },
        {
          label: 'Import Video...',
          click: () => mainWindow?.webContents.send('menu-action', 'import-video'),
        },
        {
          label: 'Import Image (OCR)...',
          click: () => mainWindow?.webContents.send('menu-action', 'import-image'),
        },
        { type: 'separator' },
        {
          label: 'Export',
          submenu: [
            {
              label: 'MusicXML',
              click: () => mainWindow?.webContents.send('menu-action', 'export-musicxml'),
            },
            {
              label: 'MIDI',
              click: () => mainWindow?.webContents.send('menu-action', 'export-midi'),
            },
            {
              label: 'PDF',
              click: () => mainWindow?.webContents.send('menu-action', 'export-pdf'),
            },
            {
              label: 'Audio (WAV)',
              click: () => mainWindow?.webContents.send('menu-action', 'export-audio'),
            },
          ],
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' },
        ] : [
          { role: 'close' },
        ]),
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Learn More',
          click: () => shell.openExternal('https://github.com/sonora'),
        },
        {
          label: 'Report Issue',
          click: () => shell.openExternal('https://github.com/sonora/issues'),
        },
        { type: 'separator' },
        {
          label: 'About Sonora',
          click: () => dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'About Sonora',
            message: 'Sonora — Music Score Studio',
            detail: 'Version 1.0.0\nA local music workspace for scores, recordings, and practice.\n\nBuilt with Electron, FastAPI, and Spotify Basic Pitch.',
            buttons: ['OK'],
          }),
        },
      ],
    },
  ];

  if (isMac) {
    template.unshift({
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
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// IPC Handlers
ipcMain.handle('get-python-port', () => pythonPort);

ipcMain.handle('show-open-dialog', async (event, options) => {
  if (!mainWindow) return { canceled: true, filePaths: [] };
  return dialog.showOpenDialog(mainWindow, options);
});

ipcMain.handle('show-save-dialog', async (event, options) => {
  if (!mainWindow) return { canceled: true, filePath: undefined };
  return dialog.showSaveDialog(mainWindow, options);
});

ipcMain.handle('read-file', async (event, filePath) => {
  const fs = require('fs').promises;
  return fs.readFile(filePath, 'utf-8');
});

ipcMain.handle('write-file', async (event, filePath, content) => {
  const fs = require('fs').promises;
  return fs.writeFile(filePath, content, 'utf-8');
});

ipcMain.handle('show-message-box', async (event, options) => {
  if (!mainWindow) return { response: 0 };
  return dialog.showMessageBox(mainWindow, options);
});

ipcMain.handle('open-external', async (event, url) => {
  return shell.openExternal(url);
});

ipcMain.on('menu-action', (event, action) => {
  mainWindow?.webContents.send('menu-action', action);
});

// App lifecycle
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  stopPythonServer();
  if (!isMac) app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  stopPythonServer();
});

// Security: Prevent new window creation
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, navigationUrl) => {
    event.preventDefault();
    shell.openExternal(navigationUrl);
  });
});