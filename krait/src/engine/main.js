'use strict';
const { app, BrowserWindow, nativeImage, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { Keychain } = require('./keychain');
const { SessionStore } = require('./session');

const DATA_DIR = path.join(os.homedir(), '.krait');
let win = null;

function createWindow() {
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);

  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600,
    icon,
    title: 'krait',
    frame: false,
    backgroundColor: '#0f0f0f',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (process.platform === 'win32') app.setAppUserModelId('krait');
}

// ─── IPC handlers ───
ipcMain.handle('krait:has-key', (_, p) => new Keychain(DATA_DIR).has(p));
ipcMain.handle('krait:save-key', (_, { p, k }) => { new Keychain(DATA_DIR).save(p, k); return true; });
ipcMain.handle('krait:delete-key', (_, p) => { new Keychain(DATA_DIR).delete(p); return true; });
ipcMain.handle('krait:get-masked-keys', () => new Keychain(DATA_DIR).list());
ipcMain.handle('krait:terminal', (_, cmd) => {
  try {
    const out = execSync(cmd, { timeout: 30000, encoding: 'utf8', maxBuffer: 2*1024*1024 });
    return { ok: true, stdout: out, stderr: '' };
  } catch (err) { return { ok: false, stdout: err.stdout || '', stderr: err.stderr || err.message }; }
});
ipcMain.handle('krait:minimize', () => win?.minimize());
ipcMain.handle('krait:maximize', () => { win?.isMaximized() ? win.unmaximize() : win?.maximize(); });
ipcMain.handle('krait:close', () => win?.close());

app.on('window-all-closed', () => {});
app.whenReady().then(createWindow);