'use strict';
const { app, BrowserWindow, nativeImage, ipcMain, dialog } = require('electron');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { Keychain } = require('./keychain');
const { streamChat } = require('./chat');
const { runAgent } = require('./agent');

const DATA_DIR = path.join(os.homedir(), '.krait');
const PROJECT_DIR = path.resolve(__dirname, '..', '..');
const USAGE_FILE = path.join(DATA_DIR, 'usage.json');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const MCP_FILE = path.join(DATA_DIR, 'mcp.json');
const fs = require('fs');
let win = null;
let currentAbort = null;

// ─── Token usage store (per API provider) ───
function loadUsage() {
  try { return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')); }
  catch { return {}; }
}
function recordUsage(provider, u) {
  if (!u || !provider) return;
  const all = loadUsage();
  if (!all[provider]) all[provider] = { input: 0, output: 0, total: 0, calls: 0 };
  all[provider].input += u.input || 0;
  all[provider].output += u.output || 0;
  all[provider].total += u.total || 0;
  all[provider].calls += 1;
  try { fs.writeFileSync(USAGE_FILE, JSON.stringify(all, null, 2)); } catch {}
}

// ─── Projects (each project = a folder the AI works in) ───
function loadProjects() {
  try { return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8')); }
  catch { return { active: null, list: [] }; }
}
function saveProjects(p) {
  try { fs.writeFileSync(PROJECTS_FILE, JSON.stringify(p, null, 2)); } catch {}
}
function activeProjectDir() {
  const p = loadProjects();
  const a = p.list.find(x => x.id === p.active);
  return a ? a.dir : PROJECT_DIR;
}

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
  const ns = String(modelId).split('/')[0];
  const o = opts || {};
  let final = { text: '', usage: null };

  try {
    // With tools enabled → agent loop (tool calls + permission popups)
    if (o.enabledTools && o.enabledTools.length) {
      final = await runAgent({
        modelId,
        messages: messages || [],
        opts: { ...o, projectDir: activeProjectDir() },
        signal: currentAbort.signal,
        sendDelta: delta => {
          if (!event.sender.isDestroyed()) event.sender.send('krait:delta', delta);
        },
        sendTool: info => {
          if (!event.sender.isDestroyed()) event.sender.send('krait:tool', info);
        },
        askPermission: req => askViaDialog(req),
        streamChat,
      });
    } else {
      // plain chat, no tools
      const r = await streamChat(modelId, messages || [], delta => {
        if (!event.sender.isDestroyed()) event.sender.send('krait:delta', delta);
      }, currentAbort.signal, o);
      final = { text: r.text, usage: r.usage };
    }

    if (final.usage) recordUsage(ns, final.usage);
    return { text: final.text, usage: final.usage };
  } catch (err) {
    if (err && err.name === 'AbortError') return { text: final.text, aborted: true };
    return { error: String((err && err.message) || err) };
  } finally {
    currentAbort = null;
  }
});

/** Native permission popup for dangerous tools. */
async function askViaDialog(req) {
  if (!win) return false;
  const r = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Allow', 'Deny'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    message: 'krait wants to use ' + req.tool,
    detail: req.detail + '\n\nAllow this?',
  });
  return r.response === 0;
}

ipcMain.handle('krait:get-usage', () => loadUsage());
ipcMain.handle('krait:reset-usage', () => {
  try { require('fs').writeFileSync(USAGE_FILE, JSON.stringify({}, null, 2)); } catch {}
  return true;
});

// ─── Sessions (save / resume) ───
const { SessionStore } = require('./session');
const store = new SessionStore(DATA_DIR);

ipcMain.handle('krait:sessions-create', (_, name) => store.create(name));
ipcMain.handle('krait:sessions-append', (_, id, message) => { store.append(id, message); return true; });
ipcMain.handle('krait:sessions-load', (_, id) => store.load(id));
ipcMain.handle('krait:sessions-list', () => store.list());
ipcMain.handle('krait:sessions-delete', (_, id) => { store.delete(id); return true; });

// ─── Project memory (KRAIT.md / AGENTS.md in the active project) ───
ipcMain.handle('krait:project-memory', () => {
  const dir = activeProjectDir();
  const files = ['KRAIT.md', 'AGENTS.md'];
  let memory = '';
  for (const f of files) {
    try {
      const t = fs.readFileSync(path.join(dir, f), 'utf8').trim();
      if (t) memory += (memory ? '\n\n' : '') + '--- ' + f + ' ---\n' + t;
    } catch {}
  }
  return memory || null;
});

// ─── Projects IPC ───
ipcMain.handle('krait:projects-get', () => loadProjects());
ipcMain.handle('krait:projects-add', (_, name, dir) => {
  const p = loadProjects();
  const id = require('crypto').randomUUID();
  p.list.push({ id, name: name || 'project', dir });
  if (!p.active) p.active = id;
  saveProjects(p);
  return p;
});
ipcMain.handle('krait:projects-set-active', (_, id) => {
  const p = loadProjects();
  p.active = id;
  saveProjects(p);
  return p;
});
ipcMain.handle('krait:projects-delete', (_, id) => {
  const p = loadProjects();
  p.list = p.list.filter(x => x.id !== id);
  if (p.active === id) p.active = p.list.length ? p.list[0].id : null;
  saveProjects(p);
  return p;
});
ipcMain.handle('krait:pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

// ─── MCP servers config + connection test ───
function loadMcp() {
  try { return JSON.parse(fs.readFileSync(MCP_FILE, 'utf8')); }
  catch { return { servers: [] }; }
}
ipcMain.handle('krait:mcp-get', () => loadMcp());
ipcMain.handle('krait:mcp-save', (_, cfg) => {
  fs.writeFileSync(MCP_FILE, JSON.stringify(cfg, null, 2));
  return true;
});
ipcMain.handle('krait:mcp-test', async (_, server) => {
  const { McpClient } = require('./mcp');
  const c = new McpClient(server);
  try {
    const info = await c.connect();
    const tools = await c.listTools();
    c.disconnect();
    return { ok: true, name: (info && info.name) || 'server', tools: tools.length };
  } catch (err) {
    c.disconnect();
    return { ok: false, error: String(err.message || err) };
  }
});

// ─── Artifacts: download / open files the AI creates ───
ipcMain.handle('krait:download-file', async (_, srcPath) => {
  const src = path.isAbsolute(srcPath) ? srcPath : path.join(activeProjectDir(), srcPath);
  if (!fs.existsSync(src)) return { ok: false, error: 'File not found: ' + src };
  const base = path.basename(src);
  const r = await dialog.showSaveDialog(win, { defaultPath: base });
  if (r.canceled || !r.filePath) return { ok: false, error: 'cancelled' };
  try {
    fs.copyFileSync(src, r.filePath);
    return { ok: true, savedTo: r.filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('krait:open-file', async (_, p) => {
  const full = path.isAbsolute(p) ? p : path.join(activeProjectDir(), p);
  if (!fs.existsSync(full)) return { ok: false, error: 'not found' };
  const { shell } = require('electron');
  await shell.openPath(full);
  return { ok: true };
});

// ─── Git changes (for the Changes panel) ───
ipcMain.handle('krait:git-diff', () => {
  const dir = activeProjectDir();
  return new Promise(resolve => {
    exec('git diff --stat HEAD', { cwd: dir, timeout: 15000, windowsHide: true }, (e1, statOut) => {
      exec('git diff HEAD', { cwd: dir, timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true }, (e2, diffOut) => {
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
      cwd: activeProjectDir(),
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
