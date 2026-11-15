'use strict';
/* krait renderer — real streaming chat, markdown, tokens, sessions, profile menu. */

const $ = id => document.getElementById(id);
const K = { model: '', modelLabel: '', messages: [], streaming: false, sessionId: null, tokens: 0 };
let currentAssistant = null;

const SNAKE =
  '<svg viewBox="0 0 4 4" width="26" height="26" shape-rendering="crispEdges">' +
  '<rect x="0" y="0" width="1" height="1" fill="#00D68F"/><rect x="1" y="0" width="1" height="1" fill="#111"/>' +
  '<rect x="2" y="0" width="1" height="1" fill="#00D68F"/><rect x="3" y="0" width="1" height="1" fill="#111"/>' +
  '<rect x="0" y="1" width="1" height="1" fill="#111"/><rect x="1" y="1" width="1" height="1" fill="#00D68F"/>' +
  '<rect x="2" y="1" width="1" height="1" fill="#111"/><rect x="3" y="1" width="1" height="1" fill="#00D68F"/>' +
  '<rect x="0" y="2" width="1" height="1" fill="#00D68F"/><rect x="1" y="2" width="1" height="1" fill="#111"/>' +
  '<rect x="2" y="2" width="1" height="1" fill="#00D68F"/><rect x="3" y="2" width="1" height="1" fill="#111"/>' +
  '<rect x="1" y="3" width="1" height="1" fill="#00D68F"/></svg>';

const PLUGINS = [
  { id: 'read', name: 'Read', desc: 'Read any file in the project' },
  { id: 'write', name: 'Write', desc: 'Create new files' },
  { id: 'edit', name: 'Edit', desc: 'Make exact edits to existing files' },
  { id: 'bash', name: 'Bash', desc: 'Run shell commands' },
  { id: 'glob', name: 'Glob', desc: 'Find files by pattern' },
  { id: 'grep', name: 'Grep', desc: 'Search inside files' },
  { id: 'webfetch', name: 'WebFetch', desc: 'Read a web page' },
];

const CONNECTORS = [
  { id: 'github', name: 'GitHub', desc: 'Repos, issues and pull requests' },
  { id: 'browser', name: 'Browser preview', desc: 'Preview your app while coding' },
  { id: 'drive', name: 'Google Drive', desc: 'Attach files from Drive' },
];

document.addEventListener('DOMContentLoaded', init);

async function init() {
  // window controls
  $('btn-min').onclick = () => window.krait && window.krait.minimize();
  $('btn-max').onclick = () => window.krait && window.krait.maximize();
  $('btn-close').onclick = () => window.krait && window.krait.close();
  $('btn-settings').onclick = openKeys;
  $('key-close').onclick = closeKeys;
  $('btn-terminal').onclick = () => { $('terminal').classList.toggle('hidden'); $('changes').classList.add('hidden'); };
  $('btn-changes').onclick = openChanges;
  $('changes-close').onclick = () => $('changes').classList.add('hidden');
  $('btn-new').onclick = newChat;

  // profile menu
  $('p-avatar').innerHTML = SNAKE;
  $('profile').onclick = e => { e.stopPropagation(); $('profile-menu').classList.toggle('hidden'); };
  document.addEventListener('click', e => {
    if (!$('profile-menu').classList.contains('hidden') &&
        !$('profile-menu').contains(e.target)) $('profile-menu').classList.add('hidden');
  });
  $('pm-settings').onclick = () => { $('profile-menu').classList.add('hidden'); showSettings('keys'); };
  $('pm-plugins').onclick = () => { $('profile-menu').classList.add('hidden'); showSettings('plugins'); };
  $('pm-connectors').onclick = () => { $('profile-menu').classList.add('hidden'); showSettings('connectors'); };

  // settings tabs
  document.querySelectorAll('.set-tab').forEach(t => {
    t.onclick = () => showSettings(t.dataset.tab);
  });
  $('usage-reset').onclick = async () => {
    if (window.krait) { await window.krait.resetUsage(); showUsage(); }
  };
  $('key-close').onclick = closeKeys;

  // composer
  const prompt = $('prompt');
  prompt.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  prompt.addEventListener('input', () => {
    prompt.style.height = 'auto';
    prompt.style.height = Math.min(prompt.scrollHeight, 200) + 'px';
  });
  $('btn-send').onclick = send;
  $('btn-stop').onclick = () => window.krait && window.krait.abortChat();

  // effort warning for Max / Ultracode
  $('effort-select').addEventListener('change', () => {
    const v = $('effort-select').value;
    if (v === 'ultra') toast('Ultracode: the model thinks much longer and uses a lot more tokens.');
    else if (v === 'max') toast('Max effort: noticeably more tokens per reply.');
  });

  // terminal
  $('term-in').addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return;
    const cmd = $('term-in').value.trim();
    if (!cmd) return;
    $('term-in').value = '';
    termPrint('$ ' + cmd);
    if (!window.krait) { termPrint('(only works inside the app)'); return; }
    const r = await window.krait.runTerminal(cmd);
    termPrint(r.stdout || r.stderr || '(no output)');
  });

  // keys
  $('key-form').onsubmit = saveKeys;
  const keys = window.krait ? await window.krait.getMaskedKeys() : {};
  if (Object.keys(keys).length === 0) openKeys(); else closeKeys();
  fillModelSelect(keys);

  // streaming deltas + tool activity from the main process
  if (window.krait) {
    window.krait.onDelta(appendDelta);
    window.krait.onTool(info => {
      if (!currentAssistant) return;
      const el = document.createElement('div');
      el.className = 'tool-activity' + (info.status === 'blocked' ? ' blocked' : '');
      const icon = info.status === 'done' ? '\u2713' : info.status === 'running' ? '\u2699' : '\u26d4';
      el.textContent = icon + ' ' + info.name + (info.summary ? ' \u2014 ' + info.summary : '');
      currentAssistant.querySelector('.bubble').appendChild(el);
      scrollDown();
    });
  }

  // load project memory (KRAIT.md / AGENTS.md) once
  if (window.krait) K.memory = await window.krait.projectMemory();

  await refreshSessionList();
  renderWelcome();
}

/* ═══════════ Markdown renderer ═══════════ */
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMarkdown(src) {
  const out = [];
  const lines = String(src).split('\n');
  let inCode = false, codeBuf = [], codeLang = '';
  let listType = null; // 'ul' | 'ol'

  const closeList = () => { if (listType) { out.push('</' + listType + '>'); listType = null; } };
  const inline = t => {
    t = escHtml(t);
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    t = t.replace(/\*([^*]+)\*/g, '<i>$1</i>');
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    return t;
  };

  for (const raw of lines) {
    // fenced code block
    if (/^\s*```/.test(raw)) {
      if (inCode) {
        if (codeLang === 'tool') {
          out.push('<div class="toolchip">&#9881; using tool...</div>');
        } else {
          out.push('<pre><code>' + escHtml(codeBuf.join('\n')) + '</code></pre>');
        }
        inCode = false; codeBuf = [];
      } else {
        closeList(); inCode = true; codeLang = raw.replace(/^\s*```/, '').trim();
      }
      continue;
    }
    if (inCode) { codeBuf.push(raw); continue; }

    const t = raw.trim();
    if (!t) { closeList(); continue; }

    const h = t.match(/^(#{1,3})\s+(.*)/);
    if (h) { closeList(); out.push('<div class="md-h">' + inline(h[2]) + '</div>'); continue; }

    const ul = t.match(/^[-*]\s+(.*)/);
    if (ul) {
      if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
      out.push('<li>' + inline(ul[1].replace(/^\[\s*\]\s*/, '').replace(/^\[x\]\s*/, '')) + '</li>');
      continue;
    }
    const ol = t.match(/^\d+[.)]\s+(.*)/);
    if (ol) {
      if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
      out.push('<li>' + inline(ol[1]) + '</li>');
      continue;
    }
    closeList();
    out.push('<p>' + inline(t) + '</p>');
  }
  if (inCode) out.push('<pre><code>' + escHtml(codeBuf.join('\n')) + '</code></pre>');
  closeList();
  return out.join('');
}

/* ═══════════ Chat ═══════════ */
function renderWelcome() {
  $('messages').innerHTML =
    '<div class="welcome"><img class="welcome-icon" src="../../assets/icon.png" alt="">' +
    '<h2>krait</h2><p>Pick a model above, then ask anything.<br>' +
    'Your keys are encrypted and stay on this PC.</p></div>';
}

function scrollDown() {
  const m = $('messages');
  m.scrollTop = m.scrollHeight;
}

function addMsg(role, text) {
  const w = document.querySelector('.welcome');
  if (w) w.remove();
  const el = document.createElement('div');
  el.className = 'msg ' + role;
  const who = role === 'user' ? 'You' : 'krait';
  const avatar = role === 'user'
    ? '<div class="avatar user">U</div>'
    : '<div class="avatar bot">' + SNAKE + '</div>';
  el.innerHTML = avatar + '<div class="bubble"><div class="who">' + who +
    '</div><div class="text"></div><div class="tok-note"></div></div>';
  $('messages').appendChild(el);
  scrollDown();
  return el;
}

function setMsgMarkdown(el, md) {
  el.querySelector('.text').innerHTML = renderMarkdown(md);
  scrollDown();
}

function addNotice(html) {
  const w = document.querySelector('.welcome');
  if (w) w.remove();
  const el = document.createElement('div');
  el.className = 'notice';
  el.innerHTML = html;
  $('messages').appendChild(el);
  scrollDown();
}

function appendDelta(d) {
  if (!currentAssistant) return;
  const t = currentAssistant.querySelector('.text');
  if (t.dataset.raw === undefined || t.dataset.raw === '...') t.dataset.raw = '';
  t.dataset.raw += d;
  setMsgMarkdown(currentAssistant, t.dataset.raw);
}

async function send() {
  if (K.streaming) return;
  const prompt = $('prompt');
  const text = prompt.value.trim();
  if (!text) return;

  if (!K.model) {
    addMsg('assistant', 'No model yet. Click the gear in the title bar, add an API key, then pick a model.');
    return;
  }

  prompt.value = '';
  prompt.style.height = 'auto';
  addMsg('user', text);
  K.messages.push({ role: 'user', content: text });
  await ensureSession(text.slice(0, 40));

  K.streaming = true;
  $('btn-send').style.display = 'none';
  $('btn-stop').style.display = '';
  currentAssistant = addMsg('assistant', '');
  currentAssistant.querySelector('.text').innerHTML = '<span class="typing">...</span>';

  try {
    const res = await window.krait.chat(K.model, K.messages, {
      mode: $('mode-select').value,
      effort: $('effort-select').value,
      memory: K.memory || null,
      enabledTools: enabledTools(),
    });
    const note = currentAssistant.querySelector('.tok-note');
    if (res.error) {
      currentAssistant.querySelector('.text').textContent = 'Error: ' + res.error;
    } else {
      setMsgMarkdown(currentAssistant, res.text || '(empty reply)');
      K.messages.push({ role: 'assistant', content: res.text || '' });
      if (note && res.usage) {
        note.textContent = '+' + res.usage.total + ' tok' + (res.usage.estimated ? ' (est.)' : '');
      }
      if (res.usage) {
        K.tokens += res.usage.total;
        updateTokenInfo();
      }
      if (window.krait && K.sessionId) {
        await window.krait.appendSession(K.sessionId, { role: 'assistant', content: res.text || '' });
      }
    }
  } catch (err) {
    currentAssistant.querySelector('.text').textContent = 'Error: ' + err.message;
  }

  K.streaming = false;
  $('btn-send').style.display = '';
  $('btn-stop').style.display = 'none';
  currentAssistant = null;
  scrollDown();
}

function updateTokenInfo() {
  const el = $('token-info');
  if (K.tokens > 0) el.textContent = K.tokens.toLocaleString() + ' tok';
}

/* ═══════════ Sessions (save / resume) ═══════════ */
async function ensureSession(title) {
  if (!window.krait) return;
  if (!K.sessionId) {
    const meta = await window.krait.createSession(title || 'chat');
    K.sessionId = meta.id;
    await refreshSessionList();
  }
  await window.krait.appendSession(K.sessionId, { role: 'user', content: K.messages[K.messages.length - 1].content });
}

async function refreshSessionList() {
  if (!window.krait) return;
  const list = await window.krait.listSessions();
  const box = $('sessions');
  box.innerHTML = '';
  for (const s of list.slice(0, 20)) {
    const el = document.createElement('div');
    el.className = 'session-item' + (s.id === K.sessionId ? ' active' : '');
    const name = document.createElement('span');
    name.textContent = (s.name || 'chat').slice(0, 22);
    name.onclick = () => resumeSession(s.id);
    const del = document.createElement('span');
    del.className = 's-del';
    del.textContent = '\u00d7';
    del.title = 'Delete';
    del.onclick = async e => {
      e.stopPropagation();
      await window.krait.deleteSession(s.id);
      if (s.id === K.sessionId) newChat();
      refreshSessionList();
    };
    el.appendChild(name);
    el.appendChild(del);
    box.appendChild(el);
  }
}

async function resumeSession(id) {
  if (!window.krait) return;
  const msgs = await window.krait.loadSession(id);
  if (!msgs) return;
  K.sessionId = id;
  K.messages = msgs.map(m => ({ role: m.role, content: m.content }));
  const box = $('messages');
  box.innerHTML = '';
  for (const m of K.messages) {
    const el = addMsg(m.role, '');
    if (m.role === 'assistant') setMsgMarkdown(el, m.content);
    else el.querySelector('.text').textContent = m.content;
  }
  if (!K.messages.length) renderWelcome();
  refreshSessionList();
}

function newChat() {
  K.messages = [];
  K.sessionId = null;
  K.tokens = 0;
  updateTokenInfo();
  renderWelcome();
  refreshSessionList();
}

/* ═══════════ Model list (only providers with a saved key) ═══════════ */
function fillModelSelect(keys) {
  const sel = $('model-select');
  sel.innerHTML = '';
  const groups = {
    openrouter: [
      ['meta-llama/llama-3.3-70b-instruct', 'Llama 3.3 70B'],
      ['deepseek/deepseek-chat', 'DeepSeek V3'],
      ['qwen/qwen-2.5-72b-instruct', 'Qwen 2.5 72B'],
      ['anthropic/claude-sonnet-4', 'Claude Sonnet 4'],
    ],
    gemini: [
      ['gemini-2.0-flash', 'Gemini 2.0 Flash'],
      ['gemini-2.5-flash', 'Gemini 2.5 Flash'],
    ],
    nvidia: [
      ['meta/llama-3.1-70b-instruct', 'Llama 3.1 70B'],
      ['mistralai/mistral-small-24b-instruct', 'Mistral Small 24B'],
    ],
    anthropic: [
      ['claude-sonnet-4-20250514', 'Claude Sonnet 4'],
      ['claude-opus-4-20250514', 'Claude Opus 4'],
    ],
  };

  let any = false;
  for (const [ns, models] of Object.entries(groups)) {
    if (!keys[ns]) continue;
    any = true;
    const og = document.createElement('optgroup');
    og.label = ns;
    for (const [id, name] of models) {
      const o = document.createElement('option');
      o.value = ns + '/' + id;
      o.textContent = name;
      og.appendChild(o);
    }
    sel.appendChild(og);
  }

  if (!any) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = 'Add a key first (gear icon)';
    sel.appendChild(o);
    sel.disabled = true;
    K.model = '';
    return;
  }

  sel.disabled = false;
  sel.selectedIndex = 0;
  K.model = sel.value;
  K.modelLabel = sel.options[sel.selectedIndex].textContent;
  sel.onchange = () => {
    if (K.model && K.model !== sel.value) {
      addNotice('Switched model: <b>' + sel.options[sel.selectedIndex].textContent + '</b>');
    }
    K.model = sel.value;
    K.modelLabel = sel.options[sel.selectedIndex].textContent;
  };
}

/* ═══════════ Settings screen (Keys / Usage / Plugins / Connectors) ═══════════ */
function showSettings(tab) {
  $('key-screen').classList.add('show');
  showSettingsTab(tab || 'keys');
}

function showSettingsTab(tab) {
  document.querySelectorAll('.set-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  for (const p of ['keys', 'usage', 'plugins', 'connectors']) {
    $('page-' + p).style.display = p === tab ? '' : 'none';
  }
  if (tab === 'usage') showUsage();
  if (tab === 'plugins') showPlugins();
  if (tab === 'connectors') showConnectors();
}

function openKeys() { showSettings('keys'); }
function closeKeys() { $('key-screen').classList.remove('show'); }

/** Enabled plugins (default: all on) */
function enabledTools() {
  const saved = JSON.parse(localStorage.getItem('krait-plugins') || '{}');
  return PLUGINS.filter(p => saved[p.id] !== false).map(p => cap(p.id));
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

async function showUsage() {
  if (!window.krait) return;
  const u = await window.krait.getUsage();
  const box = $('usage-table');
  const names = Object.keys(u);
  if (!names.length) {
    box.innerHTML = '<div class="usage-empty">No usage yet. Send a message first.</div>';
    return;
  }
  let html = '<table class="usage-table"><tr><th>API</th><th>calls</th><th>in</th><th>out</th><th>total tok</th></tr>';
  for (const ns of names) {
    const r = u[ns];
    html += '<tr><td>' + ns + '</td><td>' + r.calls + '</td><td>' + r.input.toLocaleString() +
      '</td><td>' + r.output.toLocaleString() + '</td><td><b>' + r.total.toLocaleString() + '</b></td></tr>';
  }
  html += '</table>';
  box.innerHTML = html;
}

async function saveKeys(e) {
  e.preventDefault();
  if (!window.krait) return;
  for (const p of ['gemini', 'openrouter', 'nvidia', 'anthropic']) {
    const el = $('k-' + p);
    if (el && el.value.trim()) {
      await window.krait.saveKey(p, el.value.trim());
      el.value = '';
    }
  }
  const keys = await window.krait.getMaskedKeys();
  $('key-saved').textContent = 'Saved: ' + (Object.keys(keys).join(', ') || 'none');
  if (Object.keys(keys).length) {
    fillModelSelect(keys);
    setTimeout(closeKeys, 600);
  }
}

/* ═══════════ Plugins / Connectors (inside Settings) ═══════════ */
function showPlugins() {
  const saved = JSON.parse(localStorage.getItem('krait-plugins') || '{}');
  const box = $('plugins-list');
  box.innerHTML = '';
  for (const p of PLUGINS) {
    const row = document.createElement('div');
    row.className = 'plug-item';
    row.innerHTML = '<div><div class="plug-name">' + p.name + '</div><div class="plug-desc">' + p.desc + '</div></div>';
    const t = document.createElement('div');
    t.className = 'plug-toggle' + (saved[p.id] === false ? '' : ' on');
    t.onclick = () => {
      t.classList.toggle('on');
      saved[p.id] = t.classList.contains('on');
      localStorage.setItem('krait-plugins', JSON.stringify(saved));
    };
    row.appendChild(t);
    box.appendChild(row);
  }
}

function showConnectors() {
  const saved = JSON.parse(localStorage.getItem('krait-connectors') || '{}');
  const box = $('connectors-list');
  box.innerHTML = '';
  for (const c of CONNECTORS) {
    const row = document.createElement('div');
    row.className = 'conn-item';
    row.innerHTML = '<div><div class="plug-name">' + c.name + '</div><div class="plug-desc">' + c.desc + '</div></div>';
    const b = document.createElement('button');
    b.className = 'conn-btn' + (saved[c.id] ? ' on' : '');
    b.textContent = saved[c.id] ? 'Connected' : 'Connect';
    b.onclick = () => {
      saved[c.id] = !saved[c.id];
      localStorage.setItem('krait-connectors', JSON.stringify(saved));
      showConnectors();
    };
    row.appendChild(b);
    box.appendChild(row);
  }
}

/* ═══════════ Changes drawer (real git diff) ═══════════ */
async function openChanges() {
  $('changes').classList.remove('hidden');
  $('terminal').classList.add('hidden');
  $('changes-stat').textContent = 'Loading...';
  $('changes-diff').textContent = '';
  if (!window.krait) { $('changes-stat').textContent = '(only inside the app)'; return; }
  const r = await window.krait.gitDiff();
  $('changes-stat').textContent = r.stat || '(no uncommitted changes)';
  const lines = (r.diff || '').split('\n');
  const out = [];
  for (const l of lines) {
    if (l.startsWith('+') && !l.startsWith('+++')) out.push('<span class="add">' + escHtml(l) + '</span>');
    else if (l.startsWith('-') && !l.startsWith('---')) out.push('<span class="del">' + escHtml(l) + '</span>');
    else out.push(escHtml(l));
  }
  $('changes-diff').innerHTML = out.join('\n');
}

/* ═══════════ Terminal ═══════════ */
function termPrint(t) {
  const o = $('term-out');
  o.textContent += t + '\n';
  o.scrollTop = o.scrollHeight;
}

/* ═══════════ Toast ═══════════ */
let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4000);
}
