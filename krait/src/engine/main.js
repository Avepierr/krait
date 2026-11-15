'use strict';
const { app, BrowserWindow, nativeImage, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { Keychain } = require('./keychain');
const { streamChat } = require('./chat');

const DATA_DIR = path.join(os.homedir(), '.krait');
const PROJECT_DIR = path.resolve(__dirname, '..', '..');
let win = null;
let currentAbort = null;

function createWindow() {
  const icon = nativeImage.createFromPath(path.join(PROJECT_DIR, 'assets', 'icon.png'));

  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 860,
    minHeight: 560,
    icon,
    title: 'krait',
    frame: false,
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (process.platform === 'win32') app.setAppUserModelId('krait');
}

// ─── Keys ───
ipcMain.handle('krait:has-key', (_, p) => new Keychain(DATA_DIR).has(p));
ipcMain.handle('krait:save-key', (_, provider, key) => {
  new Keychain(DATA_DIR).save(provider, key);
  return true;
});
ipcMain.handle('krait:delete-key', (_, p) => {
  new Keychain(DATA_DIR).delete(p);
  return true;
});
ipcMain.handle('krait:get-masked-keys', () => new Keychain(DATA_DIR).list());

// ─── Chat (real, streaming) ───
ipcMain.handle('krait:chat', async (event, modelId, messages, opts) => {
  currentAbort = new AbortController();
  let full = '';
  try {
    full = await streamChat(modelId, messages || [], delta => {
      if (!event.sender.isDestroyed()) event.sender.send('krait:delta', delta);
    }, currentAbort.signal, opts || {});
    return { text: full.text, usage: full.usage };
  } catch (err) {
    if (err && err.name === 'AbortError') return { text: full, aborted: true };
    return { error: String((err && err.message) || err) };
  } finally {
    currentAbort = null;
  }
});

// ─── Sessions (save / resume) ───
const { SessionStore } = require('./session');
const store = new SessionStore(DATA_DIR);

ipcMain.handle('krait:sessions-create', (_, name) => store.create(name));
ipcMain.handle('krait:sessions-append', (_, id, message) => { store.append(id, message); return true; });
ipcMain.handle('krait:sessions-load', (_, id) => store.load(id));
ipcMain.handle('krait:sessions-list', () => store.list());
ipcMain.handle('krait:sessions-delete', (_, id) => { store.delete(id); return true; });

// ─── Project memory (KRAIT.md / AGENTS.md at the project root) ───
ipcMain.handle('krait:project-memory', () => {
  const files = ['KRAIT.md', 'AGENTS.md'];
  let memory = '';
  for (const f of files) {
    try {
      const t = require('fs').readFileSync(path.join(PROJECT_DIR, f), 'utf8').trim();
      if (t) memory += (memory ? '\n\n' : '') + '--- ' + f + ' ---\n' + t;
    } catch {}
  }
  return memory || null;
});

// ─── Git changes (for the Changes panel) ───
ipcMain.handle('krait:git-diff', () => {
  return new Promise(resolve => {
    exec('git diff --stat HEAD', { cwd: PROJECT_DIR, timeout: 15000, windowsHide: true }, (e1, statOut) => {
      exec('git diff HEAD', { cwd: PROJECT_DIR, timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true }, (e2, diffOut) => {
        resolve({
          stat: (statOut || '').trim() || '(no uncommitted changes)',
          diff: (diffOut || '').slice(0, 100000),
        });
      });
    });
  });
});

ipcMain.handle('krait:abort', () => {
  if (currentAbort) currentAbort.abort();
  return true;
});

// ─── Terminal (async so the window never freezes) ───
ipcMain.handle('krait:terminal', (_, cmd) => {
  return new Promise(resolve => {
    exec(cmd, {
      cwd: PROJECT_DIR,
      timeout: 30000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout || '', stderr: stderr || (err ? String(err.message) : '') });
    });
  });
});

// ─── Window controls ───
ipcMain.handle('krait:minimize', () => win && win.minimize());
ipcMain.handle('krait:maximize', () => {
  if (!win) return;
  if (win.isMaximized()) win.unmaximize(); else win.maximize();
});
ipcMain.handle('krait:close', () => win && win.close());

app.on('window-all-closed', () => {
  app.quit();
});

app.whenReady().then(createWindow);
