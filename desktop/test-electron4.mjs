import electronDefault from 'electron/main';
console.log('electronDefault:', electronDefault);
console.log('constructor:', electronDefault?.constructor?.name);
console.log('toString:', electronDefault?.toString?.());

// Try common properties
console.log('ipcMain:', electronDefault.ipcMain);
console.log('app:', electronDefault.app);
console.log('BrowserWindow:', electronDefault.BrowserWindow);
console.log('Menu:', electronDefault.Menu);
console.log('dialog:', electronDefault.dialog);
console.log('shell:', electronDefault.shell);

// Check if it's a function
console.log('is function:', typeof electronDefault === 'function');