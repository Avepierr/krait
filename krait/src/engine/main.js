'use strict';
/**
 * krait Electron main process.
 * Creates the window with the Code view UI, sets taskbar/icon, frameless.
 */

const { app, BrowserWindow, ipcMain, nativeImage, Tray } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { Keychain } = require('./keychain');
const { SessionStore } = require('./session');
const { Harness } = require('./harness');

const DATA_DIR = path.join(os.homedir(), '.krait');
let mainWindow = null;

function createWindow() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'icon.png'));

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon,
    title: 'krait',
    titleBarStyle: 'hiddenInset',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Set overlay icon for taskbar
  if (process.platform === 'win32') {
    app.setAppUserModelId('krait');
  }
}

// IPC handlers for engine operations
ipcMain.handle('krait:has-key', (event, provider) => {
  const kc = new Keychain(DATA_DIR);
  return kc.has(provider);
});

ipcMain.handle('krait:save-key', (event, { provider, key }) => {
  const kc = new Keychain(DATA_DIR);
  kc.save(provider, key);
  return true;
});

ipcMain.handle('krait:delete-key', (event, provider) => {
  const kc = new Keychain(DATA_DIR);
  kc.delete(provider);
  return true;
});

ipcMain.handle('krait:get-masked-keys', () => {
  const kc = new Keychain(DATA_DIR);
  return kc.list();
});

ipcMain.handle('krait:window-minimize', () => mainWindow?.minimize());
ipcMain.handle('krait:window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.handle('krait:window-close', () => mainWindow?.close());

// Run in background — keep app alive
app.on('window-all-closed', () => {});

app.whenReady().then(createWindow);