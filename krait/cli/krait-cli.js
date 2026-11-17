#!/usr/bin/env node
'use strict';
/**
 * krait CLI chat — opencode-style terminal chat. Type `krait` in your PC terminal.
 * Same engine as the desktop app: chat.js streaming, encrypted Keychain keys.
 * TTY mode: krait logo, input box with status line, ctrl+p command menu,
 * model picker with search, UI color themes, /update version check.
 * Pipe mode (scripts): plain prompts, same commands.
 * Commands: /models /model <id> /agent /effort <l> /theme /update /clear /help /exit
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { streamChat } = require('../src/engine/chat');
const { Keychain } = require('../src/engine/keychain');
const { runAgent } = require('../src/engine/agent');

const DATA = path.join(os.homedir(), '.krait');
const VERSION = require('../package.json').version;
const UPDATE_URL = 'https://raw.githubusercontent.com/Avepierr/krait/main/version.json';

const DEFAULTS = {
  openrouter: 'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free',
  nvidia: 'nvidia/meta/llama-3.1-70b-instruct',
  gemini: 'gemini/gemini-2.0-flash',
  anthropic: 'anthropic/claude-sonnet-4',
  groq: 'groq/llama-3.3-70b-versatile',
  cerebras: 'cerebras/llama-3.3-70b',
  mistral: 'mistral/mistral-large-latest',
  xai: 'xai/grok-3-latest',
  deepseek: 'deepseek/deepseek-chat',
};

const G = '\x1b[32m', Y = '\x1b[33m', DIM = '\x1b[2m', B = '\x1b[1m', R = '\x1b[0m';
const THEMES = {
  green: '\x1b[32m', cyan: '\x1b[36m', purple: '\x1b[35m', pink: '\x1b[95m',
  orange: '\x1b[33m', red: '\x1b[31m', blue: '\x1b[34m', white: '\x1b[37m',
};
let A = THEMES.green; // accent - user changeable
function out(s) { process.stdout.write(s); }

const TTY = !!process.stdin.isTTY;
// KRAIT_PUMP=1: the Windows shim's pump.ps1 feeds us console lines through stdin
// (electron run-as-node cannot read console stdin on Windows - readline EOFs instantly).
const PUMP = process.env.KRAIT_PUMP === '1';
let model = null;
let convo = [];
let agentMode = false;
let effort = 'medium';
let busy = false;
let closing = false;
let rl = null;

// menu state (TTY only)
let mode = 'input'; // input | menu
let menu = null;    // { title, items, idx, filter, lines, searchable }

// ── line queue: every input line lands here exactly once ──
const pendingLines = [];
const lineWaiters = [];
function wireInput() {
  rl.on('line', l => {
    if (mode === 'menu') { menuEnter(); return; }
    if (lineWaiters.length) { const w = lineWaiters.shift(); w(l); }
    else pendingLines.push(l);
  });
  rl.on('close', () => {
    closing = true;
    while (lineWaiters.length) lineWaiters.shift()('');
  });
  rl.on('SIGINT', () => { out('\n'); rl.close(); });
  rl.on('keypress', (str, key) => {
    if (!key || mode !== 'menu' || !menu) return;
    if (key.name === 'up') { menu.idx = (menu.idx - 1 + menu.items().length) % menu.items().length; drawMenu(); }
    else if (key.name === 'down') { menu.idx = (menu.idx + 1) % menu.items().length; drawMenu(); }
    else if (key.name === 'escape') { closeMenu(); }
    else if (key.name === 'backspace' && menu.searchable) { menu.filter = (menu.filter || '').slice(0, -1); menu.idx = 0; drawMenu(); }
    else if (str && menu.searchable && !key.ctrl && !key.meta) {
      menu.filter = (menu.filter || '') + str;
      rl.write(null, { ctrl: true, name: 'h' }); // keep the readline buffer clean
      menu.idx = 0; drawMenu();
    } else if (str && !menu.searchable && !key.ctrl && !key.meta) {
      rl.write(null, { ctrl: true, name: 'h' }); // swallow stray typing
    }
  });
}
/** Resolve with the next typed line. Prints the prompt only while actually waiting. */
function nextLine(promptText) {
  return new Promise(resolve => {
    if (pendingLines.length) return resolve(pendingLines.shift());
    if (closing) return resolve('');
    if (promptText) out(promptText);
    lineWaiters.push(resolve);
  });
}
function subLine() { return nextLine(null); }

function haveKeys() {
  const kc = new Keychain(DATA);
  return Object.keys(DEFAULTS).filter(p => kc.get(p));
}
function pickDefault() {
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(DATA, 'cli-model.json'), 'utf8'));
    if (saved.model) return saved.model;
  } catch {}
  // free first: the newest :free model straight from the live catalog, per provider priority
  const cat = catalogModels();
  const have = haveKeys();
  const want = ['openrouter', 'gemini', 'groq', 'cerebras', 'mistral', 'huggingface', 'github', 'nvidia'];
  for (const ns of want) {
    if (!have.includes(ns)) continue;
    const list = (cat[ns] || []).filter(m => !/preview|beta|exp|\brc\b|dev/i.test(m.id));
    const free = list.filter(m => /:free/i.test(m.id));
    if (free.length) return ns + '/' + free[0].id;
  }
  return have.length ? DEFAULTS[have[0]] : null;
}
function catalogModels() {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, 'models.json'), 'utf8')).data || {}; } catch { return {}; }
}
function recentModels() {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, 'cli-model.json'), 'utf8')).recent || []; } catch { return []; }
}
function rememberRecent(id) {
  try {
    const cur = JSON.parse(fs.readFileSync(path.join(DATA, 'cli-model.json'), 'utf8'));
    cur.recent = [id].concat((cur.recent || []).filter(x => x !== id)).slice(0, 5);
    fs.writeFileSync(path.join(DATA, 'cli-model.json'), JSON.stringify(cur));
  } catch {}
}

// ── theming ──
function loadTheme() {
  try { const t = JSON.parse(fs.readFileSync(path.join(DATA, 'cli-theme.json'), 'utf8')).theme; if (THEMES[t]) A = THEMES[t]; } catch {}
}
function saveTheme(t) {
  try { fs.writeFileSync(path.join(DATA, 'cli-theme.json'), JSON.stringify({ theme: t })); } catch {}
}

// ── status line (opencode style: Mode · model · effort) ──
function statusText() {
  const short = String(model || '').split('/').pop();
  return (agentMode ? 'Agent' : 'Chat') + ' \u00b7 ' + short + ' \u00b7 ' + effort;
}
function renderIdle() {
  if (!TTY) return;
  out(DIM + '  ' + statusText() + R + '\n' + DIM + '  ctrl+p commands' + R + '\n');
}

// ── menus ──
function openMenu(m) {
  mode = 'menu';
  menu = { idx: 0, filter: '', lines: 0, ...m };
  rl.write(null, { ctrl: true, name: 'u' }); // clear the input buffer
  out('\n');
  drawMenu();
}
function menuItems() {
  if (!menu) return [];
  const all = menu.items();
  if (!menu.searchable || !menu.filter) return all;
  const q = menu.filter.toLowerCase();
  return all.filter(it => it.label.toLowerCase().includes(q));
}
function drawMenu() {
  if (!menu) return;
  const items = menuItems();
  const rows = [];
  rows.push(DIM + '  ' + menu.title + R + DIM + '          esc' + R);
  if (menu.searchable) rows.push('  ' + DIM + (menu.filter || 'Search') + '_' + R);
  if (!items.length) rows.push(DIM + '  (no matches)' + R);
  items.forEach((it, i) => {
    const cur = i === menu.idx;
    const label = (cur ? A + '\u25CF ' + B : '  ') + it.label + (cur ? R : '');
    const hint = it.hint ? DIM + it.hint + R : '';
    rows.push('  ' + label + (it.hint ? '  ' + hint : ''));
  });
  rows.push(DIM + '  \u2191\u2193 navigate \u00b7 enter select \u00b7 esc close' + R);
  const txt = rows;
  if (menu.lines) {
    // redraw in place: jump up to the first menu row and repaint every row
    let s = '\x1b[' + (menu.lines - 1) + 'A';
    txt.forEach((t, i) => { s += '\r\x1b[2K' + t + (i < txt.length - 1 ? '\x1b[1B' : ''); });
    out(s);
  } else {
    out(txt.join('\n'));
  }
  menu.lines = txt.length;
}
function clearMenu() {
  if (!menu || !menu.lines) return;
  // cursor is on the line after the menu (Enter moved it down, or at menu end for esc)
  out('\x1b[' + menu.lines + 'A\x1b[J');
  out('\x1b[2A\r\x1b[2K'); // tidy the input line too (prompt reprints below)
  menu = null;
  mode = 'input';
}
function closeMenu() { clearMenu(); if (TTY) { renderIdle(); rl.prompt(); } else if (PUMP) { pumpIdle(); } }
function menuEnter() {
  const items = menuItems();
  const it = items[menu.idx];
  const hadLines = menu.lines;
  clearMenu();
  if (!it) { if (TTY) { renderIdle(); rl.prompt(); } else if (PUMP) { pumpIdle(); } return; }
  out('\x1b[2A\r\x1b[2K'); // remove the input row; actions draw their own
  it.run();
}

// command menu
function commandsItems() {
  return [
    { label: 'Switch model', run: () => openModelMenu() },
    { label: 'Agent mode: ' + (agentMode ? 'on' : 'off'), run: () => { agentMode = !agentMode; out(DIM + '  agent mode ' + (agentMode ? 'ON - file tools on, asks first (folder: ' + process.cwd() + ')' : 'off') + R + '\n'); if (TTY) { renderIdle(); rl.prompt(); } else if (PUMP) { pumpIdle(); } } },
    { label: 'Effort: ' + effort, run: () => { effort = effort === 'low' ? 'medium' : effort === 'medium' ? 'high' : 'low'; out(DIM + '  effort set to ' + effort + R + '\n'); if (TTY) { renderIdle(); rl.prompt(); } else if (PUMP) { pumpIdle(); } } },
    { label: 'Change UI color', run: () => openThemeMenu() },
    { label: 'Check for updates', run: () => { checkUpdates(true); } },
    { label: 'Clear context', run: () => { convo = []; out(DIM + '  context cleared' + R + '\n'); if (TTY) { renderIdle(); rl.prompt(); } else if (PUMP) { pumpIdle(); } } },
    { label: 'Exit', run: () => bye() },
  ];
}
function openCommands() { if (busy) return; openMenu({ title: 'Commands', items: commandsItems, searchable: true }); }

// model picker (search + free tags + recent)
function modelMenuItems() {
  const q = (menu && menu.filter || '').toLowerCase();
  const items = [];
  const cat = catalogModels();
  const have = haveKeys();
  const push = (ns, list) => {
    for (const m of list) {
      const full = ns + '/' + m.id;
      if (q && !full.toLowerCase().includes(q)) continue;
      items.push({ label: (full === model ? '\u25CF ' : '') + m.id, hint: /:free\b/.test(m.id) || m.free ? 'Free' : '', run: () => { switchModel(full); if (TTY) { renderIdle(); rl.prompt(); } else if (PUMP) { pumpIdle(); } } });
    }
  };
  // current + recent first
  for (const r of [model].concat(recentModels())) {
    if (!r || r === model && items.some(i => i.label.includes(String(r).split('/').pop()))) continue;
    if (q && !r.toLowerCase().includes(q)) continue;
    items.push({ label: (r === model ? '\u25CF ' : '') + r, hint: '', run: () => { switchModel(r); if (TTY) { renderIdle(); rl.prompt(); } else if (PUMP) { pumpIdle(); } } });
  }
  for (const ns of have) {
    // free models first, then the rest of the catalog
    push(ns, (cat[ns] || []).slice()
      .sort((a, b) => (/:free/i.test(b.id) ? 1 : 0) - (/:free/i.test(a.id) ? 1 : 0))
      .slice(0, 8));
  }
  return items;
}
function openModelMenu() { openMenu({ title: 'Select model', items: modelMenuItems, searchable: true }); }

// theme picker
function openThemeMenu() {
  openMenu({
    title: 'UI color', searchable: false,
    items: () => Object.keys(THEMES).map(t => ({
      label: t, run: () => { A = THEMES[t]; saveTheme(t); out(A + '  accent color: ' + t + R + '\n'); if (TTY) { renderIdle(); rl.prompt(); } else if (PUMP) { pumpIdle(); } },
    })),
  });
}

// update check (like opencode's "/update to install vX")
function isNewer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}
function cachedUpdate() {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, 'update.json'), 'utf8')).version || null; } catch { return null; }
}
async function checkUpdates(loud) {
  let latest = null;
  try {
    const r = await fetch(UPDATE_URL, { signal: AbortSignal.timeout(5000) });
    if (r.ok) { const j = await r.json(); latest = j.version || null; }
  } catch {}
  if (latest && isNewer(latest, VERSION)) {
    try { fs.writeFileSync(path.join(DATA, 'update.json'), JSON.stringify({ version: latest, ts: Date.now() })); } catch {}
    out(A + '  /update to install v' + latest + R + DIM + '  (you are on v' + VERSION + ')' + R + '\n');
  } else if (latest) {
    try { fs.unlinkSync(path.join(DATA, 'update.json')); } catch {}
    out(DIM + '  krait v' + VERSION + ' is up to date' + R + '\n');
  } else {
    out(DIM + '  could not reach the update server yet (krait is not published, or you are offline)' + R + '\n');
  }
  if (loud) { if (TTY) { renderIdle(); rl.prompt(); } else if (PUMP) { pumpIdle(); } }
}

function switchModel(id) {
  const ns = String(id).split('/')[0];
  if (!DEFAULTS[ns] || !(new Keychain(DATA)).get(ns)) {
    out(Y + '  no key for ' + ns + ' - /models shows what you have' + R + '\n');
    return;
  }
  model = id;
  rememberRecent(id);
  out(G + '  model switched to ' + id + R + '\n');
}

async function askPerm(req) {
  out(Y + `\n  krait wants to use ${req.tool}${req.detail ? ': ' + req.detail : ''} - allow? [y/N] ` + R);
  const a = await subLine();
  return /^y(es)?$/i.test((a || '').trim());
}
async function askUser(q) {
  out(Y + '  ' + q.question + (q.options ? ' (' + q.options.join('/') + ')' : '') + ' ' + R);
  return (await subLine()).trim();
}

/** Another configured provider, free models first - used when the current one rate-limits. */
function pickCliFallback(failedNs) {
  const have = haveKeys();
  const cat = catalogModels();
  // openrouter first (reliable free tier), nvidia LAST - some catalog ids 404 there
  const want = ['openrouter', 'gemini', 'groq', 'cerebras', 'mistral', 'huggingface', 'github', 'nvidia'];
  for (const p of want) {
    if (p === failedNs || !have.includes(p)) continue;
    const list = (cat[p] || []).filter(m => !/preview|beta|exp|\brc\b|dev/i.test(m.id));
    const free = list.filter(m => /:free/i.test(m.id));
    if (free.length) return p + '/' + free[0].id;
    if (list.length) return p + '/' + list[0].id;
    return p + '/' + DEFAULTS[p];
  }
  return null;
}

async function chatTurn(input) {
  busy = true;
  convo.push({ role: 'user', content: input });
  if (!TTY) out(G + 'krait > ' + R);
  let streamed = '';
  const attempt = async () => {
    streamed = '';
    if (agentMode) {
      const res = await runAgent({
        modelId: model,
        messages: convo.slice(),
        opts: { mode: 'normal', effort, enabledTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch'], projectDir: process.cwd() },
        sendDelta: d => { streamed += d; out(d); },
        sendTool: info => { if (info.status === 'done') out(Y + '\n  [' + info.name + '] ' + (info.summary || '') + R + '\n'); },
        askPermission: askPerm,
        askUser,
        streamChat,
      });
      const finalText = (res && res.text) || streamed;
      if (finalText) convo.push({ role: 'assistant', content: finalText });
      if (res && res.usage && res.usage.total) out(DIM + '  (' + res.usage.total + ' tok)' + R + '\n');
    } else {
      const res = await streamChat(model, convo, d => { streamed += d; out(d); }, null, { effort });
      out('\n');
      if (res.usage && res.usage.total) out(DIM + '  (' + res.usage.total + ' tok)' + R + '\n');
      convo.push({ role: 'assistant', content: res.text || streamed });
    }
  };
  try {
    try {
      await attempt();
    } catch (e) {
      const em = String((e && e.message) || e);
      const fb = /429|rate-limit/i.test(em) ? pickCliFallback(String(model).split('/')[0]) : null;
      if (fb) {
        // free tier ran dry - hop to another free provider instead of showing an error
        out('\n' + Y + '  daily free limit reached on ' + model + ' - switching to ' + fb + ' (resets tomorrow)' + R + '\n');
        model = fb;
        rememberRecent(fb);
        await attempt();
      } else {
        throw e;
      }
    }
  } catch (e) {
    const em = String((e && e.message) || e);
    if (/429|rate-limit/i.test(em)) {
      out('\n' + Y + '  free limit reached on every provider you have a key for - try again after the daily reset, or add another free key in the krait app (Settings > API keys)' + R + '\n');
    } else {
      out('\n' + Y + '  error: ' + em + R + '\n');
    }
  }
  out('\n');
  busy = false;
}

/** Exit without dropping buffered stdout (process.exit discards pending pipe writes). */
function exitSoon(code) {
  let done = false;
  const fin = () => { if (!done) { done = true; process.exit(code); } };
  // non-empty marker: its callback fires only after this (and every earlier) write has flushed
  process.stdout.write(' ', fin);
  setTimeout(fin, 500).unref();
}

function bye() { out('\n' + DIM + '  bye - krait by Avepier' + R + '\n'); exitSoon(0); }

// ── logo ──
// block letters spell K-R-A-I-T, column-verified (each letter 5 wide, 5 tall)
function logoLines() {
  return [
    A + B + '  ' + '\u2588   \u2588 \u2588\u2588\u2588\u2588   \u2588\u2588\u2588  \u2588\u2588\u2588\u2588\u2588 \u2588\u2588\u2588\u2588\u2588' + R,
    A + B + '  ' + '\u2588  \u2588  \u2588   \u2588 \u2588   \u2588   \u2588     \u2588  ' + R,
    A + B + '  ' + '\u2588\u2588\u2588   \u2588\u2588\u2588\u2588  \u2588\u2588\u2588\u2588\u2588   \u2588     \u2588  ' + R,
    A + B + '  ' + '\u2588  \u2588  \u2588  \u2588  \u2588   \u2588   \u2588     \u2588  ' + R,
    A + B + '  ' + '\u2588   \u2588 \u2588   \u2588 \u2588   \u2588 \u2588\u2588\u2588\u2588\u2588   \u2588  ' + R,
  ];
}
function printLogo() {
  const cols = process.stdout.columns || 80;
  for (const l of logoLines()) {
    const pad = ' '.repeat(Math.max(0, Math.floor((cols - 33) / 2)));
    out(pad + l + '\n');
  }
  const ver = DIM + '  v' + VERSION + ' \u00b7 by Avepier \u00b7 free AI coding agent' + R;
  out(ver + '\n');
  const cached = cachedUpdate();
  if (cached && isNewer(cached, VERSION)) out(A + '  /update to install v' + cached + R + '\n');
  else out(DIM + '  /update to check for new versions' + R + '\n');
  out('\n');
}
// pump mode has no live status line - print it as text
function pumpIdle() {
  out(DIM + '  ' + statusText() + R + '\n' + DIM + '  /help for slash commands' + R + '\n\n');
}

// ── main repl ──
async function repl() {
  while (true) {
    const promptText = TTY ? '' : (agentMode ? Y + 'task > ' + R : G + 'you > ' + R);
    const line = await nextLine(promptText);
    const input = (line || '').trim();
    if (closing && !input) return bye();
    if (!input) { if (TTY) { renderIdle(); rl.prompt(); } else if (PUMP) { pumpIdle(); } continue; }
    if (input === '/exit' || input === '/quit') return bye();
    if (input === '/help') {
      out(`${DIM}  /models          list your models
  /model <id>      switch model and remember it
  /agent           toggle agent mode - I read/write/edit files here, asking first
  /effort <l|m|h>  answer effort (low / medium / high)
  /theme <color>   UI accent: green cyan purple pink orange red blue white
  /update          check for a new krait version
  /clear           fresh context
  /exit            quit${R}\n`);
      if (TTY) { renderIdle(); rl.prompt(); } else if (PUMP) { pumpIdle(); } continue;
    }
    if (input === '/clear') { convo = []; out(DIM + '  context cleared' + R + '\n'); if (TTY) { renderIdle(); rl.prompt(); } else if (PUMP) { pumpIdle(); } continue; }
    if (input === '/models') { listModels(); if (TTY) { renderIdle(); rl.prompt(); } else if (PUMP) { pumpIdle(); } continue; }
    if (input === '/update') { await checkUpdates(true); continue; }
    if (input.startsWith('/model ')) { switchModel(input.slice(7).trim()); if (TTY) { renderIdle(); rl.prompt(); } else if (PUMP) { pumpIdle(); } continue; }
    if (input === '/agent') {
      agentMode = !agentMode;
      out(DIM + '  agent mode ' + (agentMode ? 'ON - I can use file tools (asks first). Works in ' + process.cwd() : 'off') + R + '\n');
      if (TTY) { renderIdle(); rl.prompt(); } else if (PUMP) { pumpIdle(); } continue;
    }
    if (input.startsWith('/effort')) {
      const v = input.split(/\s+/)[1] || '';
      const map = { l: 'low', low: 'low', m: 'medium', medium: 'medium', h: 'high', high: 'high' };
      if (map[v]) effort = map[v]; else out(DIM + '  usage: /effort low|medium|high' + R + '\n');
      if (TTY) { renderIdle(); rl.prompt(); } else if (PUMP) { pumpIdle(); } continue;
    }
    if (input.startsWith('/theme')) {
      const t = input.split(/\s+/)[1];
      if (t && THEMES[t]) { A = THEMES[t]; saveTheme(t); out(A + '  accent color: ' + t + R + '\n'); }
      else out(DIM + '  usage: /theme ' + Object.keys(THEMES).join(' | ') + R + '\n');
      if (TTY) { renderIdle(); rl.prompt(); } else if (PUMP) { pumpIdle(); } continue;
    }
    await chatTurn(input);
    if (closing) return bye();
    if (TTY) { renderIdle(); rl.prompt(); } else if (PUMP) { pumpIdle(); }
  }
}

function listModels() {
  const have = haveKeys();
  const cat = catalogModels();
  if (!have.length) { out(Y + '  no API keys found - add one in the desktop app (Settings > API keys)' + R + '\n'); return; }
  for (const ns of have) {
    out(G + '  ' + ns + R + '\n');
    const list = (cat[ns] || []).slice()
      .sort((a, b) => (/:free/i.test(b.id) ? 1 : 0) - (/:free/i.test(a.id) ? 1 : 0))
      .slice(0, 8);
    if (list.length) for (const m of list) out(DIM + '    ' + ns + '/' + m.id + (m.vision ? ' (vision)' : '') + R + '\n');
    else out(DIM + '    ' + DEFAULTS[ns] + R + '\n');
  }
  out(DIM + '  switch with /model <id>' + R + '\n');
}

function main() {
  loadTheme();
  model = pickDefault();
  if (!model) {
    out('\n' + Y + '  No API keys found.' + R + '\n');
    out('  Open the krait desktop app once and add a key under Settings > API keys.\n');
    out('  Keys are stored encrypted in ' + DATA + '\n\n');
    process.exit(1);
  }
  rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: TTY });
  wireInput();
  if (TTY) {
    printLogo();
    renderIdle();
    rl.setPrompt('\u258C ');
    rl.prompt();
  } else if (PUMP) {
    printLogo();
    pumpIdle();
  } else {
    out(DIM + 'krait v' + VERSION + ' - by Avepier - /help for commands' + R + '\n');
  }
  repl().catch(e => { out('\n' + Y + 'fatal: ' + e.message + R + '\n'); exitSoon(1); });
}
module.exports = { pickCliFallback };
if (require.main === module) main();
