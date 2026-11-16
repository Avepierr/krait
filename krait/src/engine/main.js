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

// ─── Live model catalogs (all providers, cached) ───
const MODELS_FILE = path.join(DATA_DIR, 'models.json');

function loadModelCache() {
  try { return JSON.parse(fs.readFileSync(MODELS_FILE, 'utf8')); }
  catch { return { ts: 0, data: {} }; }
}
function saveModelCache(c) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(MODELS_FILE, JSON.stringify(c)); } catch {}
}

const VISION_RE = /(vl|vision|omni|pixtral|scout|gpt-4o\b|multimodal)/i;
const looksVision = id => VISION_RE.test(id);

async function getJson(url, key) {
  const headers = { Accept: 'application/json' };
  if (key) headers.Authorization = 'Bearer ' + key;
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

/** Fetch live model lists for every provider that has a key (+ OpenRouter/NVIDIA public). */
async function refreshModelCatalog() {
  const kc = new Keychain(DATA_DIR);
  const key = p => { try { return kc.get(p); } catch { return null; } };
  const out = {};

  const jobs = {
    // OpenRouter: public list — keep the FREE ones only (that's what the user wants)
    openrouter: async () => {
      const j = await getJson('https://openrouter.ai/api/v1/models');
      return (j.data || [])
        .filter(m => m.id.endsWith(':free'))
        .map(m => ({
          id: m.id,
          name: (m.name || m.id).replace(/\s*\(free\)\s*$/i, '') + ' (free)',
          vision: !!(m.architecture && (m.architecture.input_modalities || []).includes('image')),
        }));
    },
    // NVIDIA: public list, all models
    nvidia: async () => {
      const j = await getJson('https://integrate.api.nvidia.com/v1/models', key('nvidia'));
      return (j.data || []).map(m => ({ id: m.id, name: m.id, vision: looksVision(m.id) }));
    },
    groq: async () => {
      const j = await getJson('https://api.groq.com/openai/v1/models', key('groq'));
      return (j.data || []).map(m => ({ id: m.id, name: m.id, vision: looksVision(m.id) }));
    },
    cerebras: async () => {
      const j = await getJson('https://api.cerebras.ai/v1/models', key('cerebras'));
      return (j.data || []).map(m => ({ id: m.id, name: m.id, vision: looksVision(m.id) }));
    },
    mistral: async () => {
      const j = await getJson('https://api.mistral.ai/v1/models', key('mistral'));
      return (j.data || []).filter(m => !/embed/i.test(m.id)).map(m => ({ id: m.id, name: m.id, vision: looksVision(m.id) }));
    },
    huggingface: async () => {
      const j = await getJson('https://router.huggingface.co/v1/models', key('huggingface'));
      return (j.data || []).map(m => ({ id: m.id, name: m.id, vision: looksVision(m.id) }));
    },
    github: async () => {
      const j = await getJson('https://models.github.ai/catalog/models', key('github'));
      const list = Array.isArray(j) ? j : (j.data || j.models || []);
      return list.map(m => ({ id: m.id || m.name, name: m.name || m.id, vision: looksVision(m.id || m.name) }))
        .filter(m => m.id);
    },
    opencode: async () => {
      const k = key('opencode');
      if (!k) return [];
      const j = await getJson('https://opencode.ai/inference/v1/models', k);
      const list = Array.isArray(j) ? j : (j.data || j.models || []);
      return list.map(m => {
        const id = m.id || m.name;
        return { id, name: (m.name || id) + (/free/i.test(id) ? ' (free)' : ''), vision: looksVision(id) };
      }).filter(m => m.id);
    },
    ollama: async () => {
      const j = await getJson('http://localhost:11434/api/tags');
      return (j.models || []).map(m => ({ id: m.name, name: m.name + ' (local)', vision: looksVision(m.name) }));
    },
  };

  const entries = Object.entries(jobs);
  const results = await Promise.allSettled(entries.map(([, fn]) => fn()));
  entries.forEach(([ns], i) => {
    const r = results[i];
    if (r.status === 'fulfilled' && r.value && r.value.length) out[ns] = r.value;
  });

  const cache = { ts: Date.now(), data: out };
  saveModelCache(cache);
  return cache;
}

ipcMain.handle('krait:models-get', () => loadModelCache());
ipcMain.handle('krait:models-refresh', async () => {
  try { return await refreshModelCatalog(); }
  catch (e) { return { ts: 0, data: {}, error: String(e && e.message || e) }; }
});

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
  let icon = nativeImage.createFromPath(path.join(PROJECT_DIR, 'assets', 'krait.ico'));
  if (icon.isEmpty()) icon = nativeImage.createFromPath(path.join(PROJECT_DIR, 'assets', 'logo-trim.png'));
  if (icon.isEmpty()) icon = nativeImage.createFromPath(path.join(PROJECT_DIR, 'assets', 'icon.png'));

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
  o.onThinking = d => {
    if (!event.sender.isDestroyed()) event.sender.send('krait:thinking', d);
  };
  let final = { text: '', usage: null };

  const attempt = async mid => {
    const ans = String(mid).split('/')[0];
    let f = { text: '', usage: null };
    if (o.enabledTools && o.enabledTools.length) {
      f = await runAgent({
        modelId: mid,
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
        askUser: q => askViaChat(event.sender, q.question, q.options),
        streamChat,
      });
    } else {
      const r = await streamChat(mid, messages || [], delta => {
        if (!event.sender.isDestroyed()) event.sender.send('krait:delta', delta);
      }, currentAbort.signal, o);
      f = { text: r.text, usage: r.usage };
    }
    return { f, ans };
  };

  try {
    let r;
    try {
      r = await attempt(modelId);
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      const emsg0 = String((err && err.message) || err);
      if (ns === 'ollama' && /402|payment required/i.test(emsg0)) {
        throw new Error('Ollama cloud needs a paid plan. Use a local model instead (ollama pull), or pick another provider in the model menu.');
      }
      if (ns === 'ollama' && /ECONNREFUSED|ENOTFOUND|fetch failed|connect/i.test(emsg0)) {
        throw new Error('Ollama is not running on this PC. Start the Ollama app first, or pick another provider in the model menu.');
      }
      // IMAGE FALLBACK: text-only models reject images outright - switch to a vision model
      const emsg = emsg0;
      if (/image/i.test(emsg) && (messages || []).some(m => m.images && m.images.length)) {
        const vm = pickVisionModel(ns);
        if (vm) {
          if (!event.sender.isDestroyed()) event.sender.send('krait:fallback', { from: ns, to: vm.split('/')[0], error: 'switched to a vision model' });
          r = await attempt(vm);
        } else {
          throw new Error(emsg + ' - no vision-capable model is available. Pick a vision model (e.g. Nemotron 3.5 VL free) and send the image again.');
        }
      }
      // AUTO-FALLBACK: the provider failed (rate limit, dead model...) → retry once
      // on another configured provider so the chat keeps working.
      const fb = pickFallbackModel(ns);
      if (!fb) throw err;
      if (!event.sender.isDestroyed()) event.sender.send('krait:fallback', { from: ns, to: fb.split('/')[0], error: String(err.message || err).slice(0, 160) });
      r = await attempt(fb);
    }

    if (r.f.usage) recordUsage(r.ans, r.f.usage);
    return { text: r.f.text, usage: r.f.usage };
  } catch (err) {
    if (err && err.name === 'AbortError') return { text: final.text, aborted: true };
    return { error: String((err && err.message) || err) };
  } finally {
    currentAbort = null;
  }
});

/** Pick a vision-capable model (live catalog; verified free vision models preferred). */
function pickVisionModel(failedNs) {
  let cached = {};
  try { cached = loadModelCache().data || {}; } catch {}
  const RE = /(vision|[-.]vl\b|-vl\b|omni|gemma|gemini|pixtral|llava|moondream|minicpm-v|internvl)/i;
  const PREF = [['openrouter', 'nvidia/nemotron-3.5-super-vl:free'], ['openrouter', 'google/gemma-4-31b-it:free']];
  for (const [pfns, pfid] of PREF) {
    if (pfns === failedNs) continue;
    const list = cached[pfns];
    if (Array.isArray(list) && list.some(m => m.id === pfid)) return pfns + '/' + pfid;
  }
  for (const p of ['openrouter', 'nvidia', 'gemini', 'ollama', 'huggingface', 'github']) {
    if (p === failedNs) continue;
    const list = cached[p];
    if (!Array.isArray(list) || !list.length) continue;
    const hit = list.find(m => RE.test(m.id));
    if (hit) return p + '/' + hit.id;
  }
  return null;
}

/** Pick a fallback model from a different configured provider (live catalog first). */
function pickFallbackModel(failedNs) {
  let have = [];
  try { have = Object.keys(new Keychain(DATA_DIR).list()); } catch {}
  const cached = loadModelCache().data || {};
  // NOTE: no ollama here - it is a local server; if it is not running, fallback must not try it
  const want = ['nvidia', 'groq', 'cerebras', 'gemini', 'openrouter', 'mistral', 'huggingface', 'github'];
  for (const p of want) {
    if (p === failedNs) continue;
    const hasKey = have.includes(p);
    const list = cached[p];
    if (!hasKey || !Array.isArray(list) || !list.length) continue;
    // prefer a solid instruct model
    const pick = list.find(m => /coder|instruct|70b|8b|flash|ultra/i.test(m.id)) || list[0];
    return p + '/' + pick.id;
  }
  return null;
}

/** Polished in-window permission popup (falls back to the native dialog). */
async function askViaDialog(req) {
  if (!win) return false;
  try {
    if (!win.webContents.isDestroyed()) {
      const id = 'ask-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
      const choice = await new Promise(resolve => {
        pendingAsk = { id, resolve };
        win.webContents.send('krait:ask-permission', {
          id, tool: req.tool, detail: req.detail || '',
        });
        // if the renderer dies / never answers, don't hang forever
        setTimeout(() => {
          if (pendingAsk && pendingAsk.id === id) {
            pendingAsk = null;
            resolve('timeout');
          }
        }, 120000);
      });
      if (choice !== 'timeout') return choice === 'allow';
    }
  } catch {}
  // fallback: native dialog
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

ipcMain.handle('krait:sessions-create', (_, name, project) => store.create(name, project));
ipcMain.handle('krait:sessions-pin', (_, id, pin) => { store.setPin(id, pin); return true; });

// ─── Checkpoints: snapshot the project before a turn, restore on demand ───
const CHECKPOINTS_DIR = path.join(DATA_DIR, 'checkpoints');
const CP_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'target', '__pycache__', '.venv', 'venv', 'vendor']);
function snapshotProject() {
  try {
    fs.mkdirSync(CHECKPOINTS_DIR, { recursive: true });
    const root = activeProjectDir();
    if (!root || !fs.existsSync(root)) return null;
    const ts = Date.now();
    const id = 'cp-' + ts;
    const list = [];
    let total = 0;
    const walk = d => {
      let entries;
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.') && e.name !== '.env') continue;
        const full = path.join(d, e.name);
        if (e.isDirectory()) {
          if (CP_SKIP_DIRS.has(e.name)) continue;
          walk(full);
        } else if (e.isFile()) {
          try {
            const st = fs.statSync(full);
            if (st.size > 2 * 1024 * 1024 || total + st.size > 40 * 1024 * 1024) continue;
            total += st.size;
            list.push({ path: path.relative(root, full), mtime: st.mtimeMs });
          } catch {}
        }
      }
    };
    walk(root);
    const files = [];
    for (const f of list) {
      try {
        files.push({ path: f.path, mtime: f.mtime, b64: fs.readFileSync(path.join(root, f.path)).toString('base64') });
      } catch {}
    }
    fs.writeFileSync(path.join(CHECKPOINTS_DIR, id + '.json'), JSON.stringify({ id, ts, files }));
    // keep only the newest 30 checkpoints
    const all = fs.readdirSync(CHECKPOINTS_DIR).filter(f => f.endsWith('.json')).sort();
    while (all.length > 30) { try { fs.unlinkSync(path.join(CHECKPOINTS_DIR, all.shift())); } catch { break; } }
    return id;
  } catch { return null; }
}
ipcMain.handle('krait:checkpoint-save', () => snapshotProject());
ipcMain.handle('krait:checkpoint-restore', (_, id) => {
  try {
    const root = activeProjectDir();
    const data = JSON.parse(fs.readFileSync(path.join(CHECKPOINTS_DIR, String(id).replace(/[^w-]/g, '') + '.json'), 'utf8'));
    if (!root || !fs.existsSync(root)) return { ok: false, error: 'project folder missing' };
    let restored = 0;
    for (const f of data.files) {
      try {
        const full = path.join(root, f.path);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, Buffer.from(f.b64, 'base64'));
        restored++;
      } catch {}
    }
    // remove files created AFTER the snapshot that are not part of it (what the turn added)
    let removed = 0;
    const known = new Set(data.files.map(f => f.path));
    const walk = d => {
      let entries;
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.') && e.name !== '.env') continue;
        const full = path.join(d, e.name);
        if (e.isDirectory()) {
          if (CP_SKIP_DIRS.has(e.name)) continue;
          walk(full);
        } else if (e.isFile()) {
          try {
            const rel = path.relative(root, full);
            if (!known.has(rel)) {
              const st = fs.statSync(full);
              if (st.mtimeMs > data.ts) { fs.unlinkSync(full); removed++; }
            }
          } catch {}
        }
      }
    };
    walk(root);
    return { ok: true, restored, removed };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('krait:sessions-append', (_, id, message) => { store.append(id, message); return true; });
ipcMain.handle('krait:sessions-load', (_, id) => store.load(id));
ipcMain.handle('krait:sessions-list', () => store.list());
ipcMain.handle('krait:sessions-delete', (_, id) => { store.delete(id); return true; });
ipcMain.handle('krait:sessions-rename', (_, id, name) => { store.rename(id, name); return true; });

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
ipcMain.handle('krait:projects-rename', (_, id, name) => {
  const p = loadProjects();
  const it = p.list.find(x => x.id === id);
  if (it) it.name = String(name || it.name).slice(0, 60);
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

// ─── File viewer (live preview of what the AI creates) ───
ipcMain.handle('krait:read-file', (_, p) => {
  try {
    const full = path.isAbsolute(p) ? p : path.join(activeProjectDir(), p);
    if (!fs.existsSync(full)) return { ok: false, error: 'not found' };
    const st = fs.statSync(full);
    if (st.size > 3 * 1024 * 1024) return { ok: false, error: 'file too large to preview' };
    return { ok: true, content: fs.readFileSync(full, 'utf8'), mtime: st.mtimeMs };
  } catch (e) { return { ok: false, error: e.message }; }
});

// save arbitrary text (export chat as markdown)
ipcMain.handle('krait:save-text', async (_, { title, content }) => {
  if (!win) return { ok: false, error: 'no window' };
  const { dialog } = require('electron');
  const r = await dialog.showSaveDialog(win, {
    title: title || 'Save file',
    defaultPath: (title || 'krait-export').replace(/[^\w -]/g, '') + '.md',
  });
  if (r.canceled || !r.filePath) return { ok: false, error: 'cancelled' };
  try { fs.writeFileSync(r.filePath, content, 'utf8'); return { ok: true, savedTo: r.filePath }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// ─── Ollama model downloader ───
const OLLAMA_POPULAR = ['qwen3:4b', 'llama3.2:3b', 'gemma3:4b', 'deepseek-r1:8b', 'qwen2.5-coder:7b', 'phi4-mini'];
ipcMain.handle('krait:ollama-status', async () => {
  try {
    const r = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return { installed: false };
    const j = await r.json();
    return { installed: true, models: (j.models || []).map(m => m.name) };
  } catch { return { installed: false }; }
});
ipcMain.handle('krait:ollama-pull', (_, model) => {
  return new Promise(resolve => {
    exec('ollama pull ' + String(model).replace(/[^\w.:/-]/g, ''), {
      timeout: 30 * 60 * 1000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
    }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || stderr || '').slice(-2000) });
    });
  });
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

// ─── Ask-the-user bridge (the AI asks a question in the chat) ───
const pendingAsks = new Map();
let askSeq = 0;
ipcMain.on('krait:answer', (event, payload) => {
  const { id, text } = payload || {};
  const r = pendingAsks.get(id);
  if (r) { pendingAsks.delete(id); r(String(text || '')); }
});
function askViaChat(sender, question, options) {
  return new Promise(resolve => {
    if (!sender || sender.isDestroyed()) { resolve('(user is away)'); return; }
    const id = 'ask-' + (++askSeq);
    const t = setTimeout(() => {
      if (pendingAsks.has(id)) { pendingAsks.delete(id); resolve('(no answer - timed out)'); }
    }, 5 * 60 * 1000);
    pendingAsks.set(id, v => { clearTimeout(t); resolve(v || '(no answer)'); });
    sender.send('krait:ask', { id, question, options: options || null });
  });
}

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

// ─── Custom providers (your own name + base URL) ───
function readCustomProviders() {
  try { return JSON.parse(require('fs').readFileSync(path.join(DATA_DIR, 'providers.json'), 'utf8')) || {}; } catch { return {}; }
}
function writeCustomProviders(p) {
  require('fs').mkdirSync(DATA_DIR, { recursive: true });
  require('fs').writeFileSync(path.join(DATA_DIR, 'providers.json'), JSON.stringify(p, null, 2));
}
ipcMain.handle('krait:providers-get', () => readCustomProviders());
ipcMain.handle('krait:providers-add', (_, id, cfg) => {
  const p = readCustomProviders();
  p[String(id).toLowerCase().trim()] = { name: cfg.name || id, baseUrl: cfg.baseUrl, models: cfg.models || [] };
  writeCustomProviders(p);
  return true;
});
ipcMain.handle('krait:providers-delete', (_, id) => {
  const p = readCustomProviders();
  delete p[id];
  writeCustomProviders(p);
  return true;
});

// ─── Permission asks (polished in-window modal) ───
let pendingAsk = null; // { id, resolve }
ipcMain.handle('krait:permission-response', (_, id, choice) => {
  if (pendingAsk && pendingAsk.id === id) {
    pendingAsk.resolve(choice);
    pendingAsk = null;
  }
  return true;
});
ipcMain.handle('krait:ask-always', () => {
  // ask the renderer which tools are always-allowed (informational only)
  return true;
});

app.on('window-all-closed', () => {
  app.quit();
});

app.whenReady().then(createWindow);
