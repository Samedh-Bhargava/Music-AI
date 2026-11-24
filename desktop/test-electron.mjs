import * as electron from 'electron/main';
console.log('electron:', typeof electron);
console.log('ipcMain:', typeof electron.ipcMain);
console.log('app:', typeof electron.app);
console.log('BrowserWindow:', typeof electron.BrowserWindow);