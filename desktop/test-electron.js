const {ipcMain} = require('electron');
console.log('ipcMain:', typeof ipcMain);
console.log('ipcMain handle:', typeof ipcMain.handle);

const {app, BrowserWindow} = require('electron');
console.log('app:', typeof app);
console.log('BrowserWindow:', typeof BrowserWindow);