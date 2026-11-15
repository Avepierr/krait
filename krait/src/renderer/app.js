'use strict';
/* krait renderer — chat, markdown, tokens, sessions, projects, settings, MCP, artifacts. */

const $ = id => document.getElementById(id);
const K = { model: '', messages: [], streaming: false, sessionId: null, tokens: 0, memory: null, attachments: [] };
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
  { id: 'write', name: 'Write', desc: 'Create new files (spreadsheets, games, apps...)' },
  { id: 'edit', name: 'Edit', desc: 'Make exact edits to existing files' },
  { id: 'bash', name: 'Bash', desc: 'Run shell commands' },
  { id: 'glob', name: 'Glob', desc: 'Find files by pattern' },
  { id: 'grep', name: 'Grep', desc: 'Search inside files' },
  { id: 'webfetch', name: 'WebFetch', desc: 'Read a web page' },
];

const SKILLS = [
  { id: 'excel', name: 'Excel maker', desc: 'Builds real .xlsx / .csv spreadsheets you can download', hint: 'When asked for spreadsheets or Excel work, create a real file (.csv or .xlsx via a script) with the Write or Bash tool, then tell the user to click Download.' },
  { id: 'games', name: 'Game maker', desc: 'Builds playable HTML5 games you can download', hint: 'When asked for a game or app, write it as ONE self-contained .html file (inline CSS+JS) with the Write tool, then tell the user to click Download and open it in a browser.' },
  { id: 'web', name: 'Web research', desc: 'Reads web pages with WebFetch before answering', hint: 'When a question needs current info, use the WebFetch tool on a relevant URL before answering.' },
];

const CONNECTORS = [
  { id: 'github', name: 'GitHub', desc: 'Repos, issues and pull requests' },
  { id: 'browser', name: 'Browser preview', desc: 'Preview your app while coding' },
  { id: 'drive', name: 'Google Drive', desc: 'Attach files from Drive' },
];

const FEATURES = [
  'Chat with any model you have a key for',
  'Real tools: read, write, edit files, run commands',
  'Permission popups before anything dangerous',
  'Paste screenshots into the chat',
  'Projects with their own folder and memory',
  'Build spreadsheets and games you can download',
  'MCP servers for external tools',
  'Skills: Excel maker, Game maker, Web research',
  'Token usage per API, tracked on disk',
  'Dark or white theme',
];

document.addEventListener('DOMContentLoaded', init);

async function init() {
  // theme
  if (localStorage.getItem('krait-theme') === 'light') document.body.classList.add('light');
  document.querySelectorAll('.theme-card').forEach(t => {
    t.onclick = () => {
      document.querySelectorAll('.theme-card').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      if (t.dataset.theme === 'light') { document.body.classList.add('light'); localStorage.setItem('krait-theme', 'light'); }
      else { document.body.classList.remove('light'); localStorage.setItem('krait-theme', 'dark'); }
      toast('Theme changed');
    };
  });

  // window controls
  $('btn-min').onclick = () => window.krait && window.krait.minimize();
  $('btn-max').onclick = () => window.krait && window.krait.maximize();
  $('btn-close').onclick = () => window.krait && window.krait.close();
  $('btn-settings').onclick = () => showSettings('account');
  // clicking the krait logo opens Settings (Account)
  $('brand-icon').onclick = () => showSettings('account');
  document.querySelector('.tb-name').onclick = () => showSettings('account');
  $('key-close').onclick = closeKeys;
  $('btn-mcp').onclick = () => showSettings('mcp');
  $('btn-terminal').onclick = () => $('terminal').classList.toggle('hidden');

  // new menu
  $('btn-new').onclick = e => { e.stopPropagation(); $('new-menu').classList.toggle('hidden'); };
  document.addEventListener('click', e => {
    if (!$('new-menu').classList.contains('hidden') && !$('new-menu').contains(e.target) && e.target !== $('btn-new')) {
      $('new-menu').classList.add('hidden');
    }
  });
  $('nm-chat').onclick = () => { $('new-menu').classList.add('hidden'); newChat(); };
  $('nm-projects').onclick = () => { $('new-menu').classList.add('hidden'); showProjects(); };

  // profile menu
  $('p-avatar').innerHTML = SNAKE;
  $('profile').onclick = e => { e.stopPropagation(); $('profile-menu').classList.toggle('hidden'); };
  document.addEventListener('click', e => {
    if (!$('profile-menu').classList.contains('hidden') && !$('profile-menu').contains(e.target)) {
      $('profile-menu').classList.add('hidden');
    }
  });
  $('pm-settings').onclick = () => { $('profile-menu').classList.add('hidden'); showSettings('account'); };
  $('pm-projects').onclick = () => { $('profile-menu').classList.add('hidden'); showProjects(); };
  $('pm-plugins').onclick = () => { $('profile-menu').classList.add('hidden'); showSettings('plugins'); };
  $('pm-skills').onclick = () => { $('profile-menu').classList.add('hidden'); showSettings('skills'); };
  $('pm-connectors').onclick = () => { $('profile-menu').classList.add('hidden'); showSettings('connectors'); };
  $('pm-mcp').onclick = () => { $('profile-menu').classList.add('hidden'); showSettings('mcp'); };

  // settings nav
  document.querySelectorAll('.set-nav').forEach(n => {
    n.onclick = () => showSettingsPage(n.dataset.page);
  });

  // usage
  $('usage-reset').onclick = async () => {
    if (window.krait) { await window.krait.resetUsage(); showUsage(); }
  };

  // capabilities
  const caps = JSON.parse(localStorage.getItem('krait-caps') || '{}');
  $('cap-mode').value = caps.mode || 'normal';
  $('cap-effort').value = caps.effort || 'medium';
  $('cap-mode').onchange = saveCaps;
  $('cap-effort').onchange = saveCaps;

  // projects modal
  $('projects-close').onclick = () => $('projects-screen').classList.remove('show');
  $('proj-pick').onclick = async () => {
    if (!window.krait) return;
    const dir = await window.krait.pickFolder();
    if (dir) $('proj-dir').textContent = dir;
  };
  $('proj-add').onclick = addProject;

  // mcp
  $('mcp-add').onclick = addMcpServer;

  // composer
  const prompt = $('prompt');
  prompt.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  prompt.addEventListener('input', () => {
    prompt.style.height = 'auto';
    prompt.style.height = Math.min(prompt.scrollHeight, 200) + 'px';
  });
  prompt.addEventListener('paste', e => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.type.startsWith('image/')) {
        e.preventDefault();
        const file = it.getAsFile();
        if (file) addImageAttachment(file);
      }
    }
  });
  $('btn-attach').onclick = () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
    inp.onchange = () => { for (const f of inp.files) addImageAttachment(f); };
    inp.click();
  };
  $('btn-send').onclick = send;
  $('btn-stop').onclick = () => window.krait && window.krait.abortChat();

  // effort warning
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

  // keys + model list
  $('key-form').onsubmit = saveKeys;
  const cpAdd = $('cp-add');
  if (cpAdd) cpAdd.onclick = addCustomProvider;
  const keys = window.krait ? await window.krait.getMaskedKeys() : {};
  if (Object.keys(keys).length === 0) showSettings('keys'); else closeKeys();
  fillModelSelect(keys);

  // memory + tool activity
  if (window.krait) {
    K.memory = await window.krait.projectMemory();
    window.krait.onDelta(appendDelta);
    window.krait.onThinking(onThinkingDelta);
    window.krait.onAskPermission(onAskPermission);
    window.krait.onTool(info => {
      if (currentAssistant) {
        const el = document.createElement('div');
        el.className = 'tool-activity' + (info.status === 'blocked' ? ' blocked' : '');
        const icon = info.status === 'done' ? '\u2713' : info.status === 'running' ? '\u2699' : '\u26d4';
        el.textContent = icon + ' ' + info.name + (info.summary ? ' \u2014 ' + info.summary : '');
        currentAssistant.querySelector('.bubble').appendChild(el);
      }
      // artifact card for created/edited files
      if (info.name === 'Write' && info.status === 'done' && info.input && info.input.path) {
        addArtifact(currentAssistant, info.input.path);
      }
      scrollDown();
    });
  }

  await refreshSessionList();
  renderWelcome();
}

function saveCaps() {
  localStorage.setItem('krait-caps', JSON.stringify({ mode: $('cap-mode').value, effort: $('cap-effort').value }));
  $('mode-select').value = $('cap-mode').value;
  $('effort-select').value = $('cap-effort').value;
}

/* ═══════════ Markdown ═══════════ */
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMarkdown(src) {
  const out = [];
  const lines = String(src).split('\n');
  let inCode = false, codeBuf = [], codeLang = '';
  let listType = null;

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
    if (/^\s*```/.test(raw)) {
      if (inCode) {
        if (codeLang === 'tool') out.push('<div class="toolchip">&#9881; using tool...</div>');
        else out.push('<pre><code>' + escHtml(codeBuf.join('\n')) + '</code></pre>');
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
      out.push('<li>' + inline(ul[1]) + '</li>'); continue;
    }
    const ol = t.match(/^\d+[.)]\s+(.*)/);
    if (ol) {
      if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
      out.push('<li>' + inline(ol[1]) + '</li>'); continue;
    }
    closeList();
    out.push('<p>' + inline(t) + '</p>');
  }
  if (inCode) out.push('<pre><code>' + escHtml(codeBuf.join('\n')) + '</code></pre>');
  closeList();
  return out.join('');
}

/* ═══════════ Chat UI ═══════════ */
function renderWelcome() {
  const day = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  $('messages').innerHTML =
    '<div class="welcome"><img class="welcome-icon" src="../../assets/icon.png" alt="">' +
    '<h2>Happy ' + day + '</h2><p>Ask anything, paste a screenshot, or tell krait to build something.</p></div>';
}

function scrollDown() {
  const m = $('messages');
  m.scrollTop = m.scrollHeight;
}

function addMsg(role, text, images) {
  const w = document.querySelector('.welcome');
  if (w) w.remove();
  const el = document.createElement('div');
  el.className = 'msg ' + role;
  const who = role === 'user' ? 'You' : 'krait';
  const avatar = role === 'user'
    ? '<div class="avatar user">U</div>'
    : '<div class="avatar bot">' + SNAKE + '</div>';
  el.innerHTML = avatar + '<div class="bubble"><div class="who">' + who +
    '</div><div class="thumbs"></div><div class="text"></div><div class="tok-note" style="font-size:11px;color:var(--fg3);margin-top:4px"></div></div>';
  el.querySelector('.text').textContent = text || '';
  if (images && images.length) {
    const th = el.querySelector('.thumbs');
    for (const u of images) {
      const img = document.createElement('img');
      img.src = u; img.style.cssText = 'width:120px;border-radius:8px;margin:4px 4px 0 0;border:1px solid var(--border)';
      th.appendChild(img);
    }
  }
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
  if (thoughtEl) finishThought(); // answer started → collapse the thought block
  const t = currentAssistant.querySelector('.text');
  if (!t.dataset.raw) t.dataset.raw = '';
  t.dataset.raw += d;
  setMsgMarkdown(currentAssistant, cleanStream(t.dataset.raw));
}

/** Hide raw tool-call JSON from the live view: show a small named chip instead. */
function toolChip(raw) {
  const nm = /"name"\s*:\s*"(Read|Write|Edit|Bash|Glob|Grep|WebFetch)"/.exec(raw);
  if (!nm) return '\u2699 using tool...';
  const what = { Read: 'Reading', Write: 'Writing', Edit: 'Editing', Bash: 'Running', Glob: 'Scanning', Grep: 'Searching', WebFetch: 'Fetching' }[nm[1]];
  const p = /"path"\s*:\s*"([^"]{1,60})"/.exec(raw) || /"command"\s*:\s*"([^"]{1,60})"/.exec(raw);
  return '\u2699 ' + what + (p ? ' ' + p[1] : '') + '...';
}

function cleanStream(raw) {
  let s = String(raw);
  // complete fenced tool blocks
  s = s.replace(/```tool\s*\n?([\s\S]*?)```/g, (_, inner) => '\n' + toolChip(inner) + '\n');
  // trailing unclosed tool block (still streaming)
  const idx = s.lastIndexOf('```tool');
  if (idx >= 0) s = s.slice(0, idx) + '\n' + toolChip(s.slice(idx)) + '\n';
  // inline tool JSON the model sometimes prints without a fence
  s = s.replace(/\{\s*"name"\s*:\s*"(Read|Write|Edit|Bash|Glob|Grep|WebFetch)"\s*,[\s\S]*?\}\s*\}(?!\})/g, m => toolChip(m));
  s = s.replace(/^\s*tool\s*$/mg, '');
  // unescape literal \n the model dumps inside code blocks while streaming
  s = s.replace(/```([\w+#]*)\n([\s\S]*?)```/g, (m0, lang, code) => {
    if (!code.includes('\\n')) return m0;
    return '```' + lang + '\n' + code.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\t/g, '\t') + '```';
  });
  return s;
}

/* ═══════════ Permission modal (polished, in-window) ═══════════ */
const PERM_ICONS = { Write: '&#128221;', Edit: '&#128394;', Bash: '&#9889;', WebFetch: '&#127760;' };
const PERM_ACTIONS = { Write: 'create or overwrite a file', Edit: 'edit a file', Bash: 'run a command on your computer', WebFetch: 'fetch a web page' };

function onAskPermission(req) {
  // "always allow" remembered per tool — answer instantly without showing the modal
  const always = JSON.parse(localStorage.getItem('krait-always') || '{}');
  if (always[req.tool]) {
    window.krait.permissionResponse(req.id, 'allow');
    return;
  }
  const modal = $('perm-modal');
  $('perm-ic').innerHTML = PERM_ICONS[req.tool] || '&#128221;';
  $('perm-title').textContent = 'krait wants to ' + (PERM_ACTIONS[req.tool] || 'use ' + req.tool);
  $('perm-detail').textContent = req.detail || '';
  modal.classList.remove('hidden');
  const done = choice => {
    modal.classList.add('hidden');
    if (choice === 'always') {
      always[req.tool] = true;
      localStorage.setItem('krait-always', JSON.stringify(always));
      window.krait.permissionResponse(req.id, 'allow');
    } else {
      window.krait.permissionResponse(req.id, choice);
    }
  };
  $('perm-allow').onclick = () => done('allow');
  $('perm-deny').onclick = () => done('deny');
  $('perm-always').onclick = () => done('always');
}


/* ═══════════ Thoughts (reasoning shown like Claude's "Thought 4s") ═══════════ */
let thoughtEl = null;      // current collapsible block
let thoughtText = '';      // accumulated reasoning for this turn
let thoughtTimer = null;   // live duration updater

/** Called for every reasoning chunk from the model. */
function onThinkingDelta(d) {
  if (!d) return;
  thoughtText += d;
  if (!thoughtEl) {
    // first thinking chunk → create the block inside the krait bubble, above the answer
    thoughtEl = document.createElement('div');
    thoughtEl.className = 'thought open';
    thoughtEl.innerHTML =
      '<button class="th-head"><span class="th-ic">&#9733;</span><span class="th-label">Thinking</span>' +
      '<span class="th-time">0s</span><span class="th-caret">&#9662;</span></button>' +
      '<div class="th-body"></div>';
    thoughtEl.querySelector('.th-head').onclick =
      e => e.currentTarget.closest('.thought').classList.toggle('open');
    const host = currentAssistant && currentAssistant.querySelector('.bubble');
    (host || $('messages')).prepend(thoughtEl);
    thoughtTimer = setInterval(() => {
      const t = thoughtEl && thoughtEl.querySelector('.th-time');
      if (t) t.textContent = Math.round((Date.now() - K.thinkStart) / 1000) + 's';
    }, 500);
    K.thinkStart = Date.now();
    scrollDown();
  }
  const body = thoughtEl.querySelector('.th-body');
  body.textContent = thoughtText.length > 20000
    ? '\u2026' + thoughtText.slice(-20000)
    : thoughtText;
  body.scrollTop = body.scrollHeight;
  scrollDown();
}

/** First answer chunk arrived → stop the timer, set the final label. Keep it open so the user can read the thoughts. */
function finishThought() {
  if (!thoughtEl) return;
  clearInterval(thoughtTimer);
  thoughtTimer = null;
  const secs = K.thinkStart ? Math.max(1, Math.round((Date.now() - K.thinkStart) / 1000)) : 0;
  const label = thoughtEl.querySelector('.th-label');
  if (label) label.textContent = 'Thought ' + (secs >= 60
    ? Math.floor(secs / 60) + 'm ' + (secs % 60) + 's'
    : secs + 's');
  const time = thoughtEl.querySelector('.th-time');
  if (time) time.textContent = '';
  thoughtEl = null;
  K.thinkStart = 0;
}

/** Reset per-turn thought state (new send). */
function resetThought() {
  if (thoughtTimer) { clearInterval(thoughtTimer); thoughtTimer = null; }
  thoughtEl = null;
  thoughtText = '';
  K.thinkStart = 0;
}

/** Final answer cleanup: strip tool-call debris and unescape literal \n in code blocks. */
function sanitizeFinal(text) {
  let s = String(text);
  s = s.replace(/```tool\s*\n?[\s\S]*?```/g, '');
  s = s.replace(/\{\s*"name"\s*:\s*"(Read|Write|Edit|Bash|Glob|Grep|WebFetch)"\s*,[\s\S]*?\}\s*\}(?!\})/g, '');
  s = s.replace(/^\s*tool\s*$/mg, '');
  // models dump file content with literal backslash-n — turn it into real lines
  s = s.replace(/```([\w+#]*)\n([\s\S]*?)```/g, (m0, lang, code) => {
    if (!code.includes('\\n')) return m0;
    const fixed = code.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\t/g, '\t');
    return '```' + lang + '\n' + fixed + '```';
  });
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

function addArtifact(bubbleEl, path) {  const name = String(path).split(/[\\/]/).pop();
  const card = document.createElement('div');
  card.className = 'artifact';
  card.innerHTML =
    '<div class="a-icon">' + iconFor(name) + '</div>' +
    '<div class="a-name">' + escHtml(name) + '<span class="a-sub">created by krait \u2014 download or open</span></div>' +
    '<button class="a-btn open">Open</button>' +
    '<button class="a-btn">Download</button>';
  const [openBtn, dlBtn] = card.querySelectorAll('button');
  dlBtn.onclick = async () => {
    if (!window.krait) return;
    const r = await window.krait.downloadFile(path);
    if (r.ok) toast('Saved to ' + r.savedTo);
    else if (r.error !== 'cancelled') toast('Download failed: ' + r.error);
  };
  openBtn.onclick = async () => {
    if (!window.krait) return;
    const r = await window.krait.openFile(path);
    if (!r.ok) toast('Could not open: ' + (r.error || ''));
  };
  const host = bubbleEl || $('messages');
  host.appendChild(card);
  scrollDown();
}

function iconFor(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'html') return '\ud83c\udfae';
  if (ext === 'csv' || ext === 'xlsx') return '\ud83d\udcca';
  if (['js', 'py', 'ts', 'json'].includes(ext)) return '\ud83d\udcc4';
  return '\ud83d\udcc4';
}

/* ═══════════ Attachments (paste screenshots) ═══════════ */
function addImageAttachment(file) {
  const reader = new FileReader();
  reader.onload = () => {
    K.attachments.push({ name: file.name || 'image.png', url: reader.result });
    renderAttachments();
  };
  reader.readAsDataURL(file);
}

function renderAttachments() {
  const box = $('attachments');
  box.innerHTML = '';
  K.attachments.forEach((a, i) => {
    const chip = document.createElement('div');
    chip.className = 'attach-chip';
    const img = document.createElement('img');
    img.src = a.url;
    const label = document.createElement('span');
    label.textContent = a.name;
    const x = document.createElement('span');
    x.className = 'x'; x.textContent = '\u00d7';
    x.onclick = () => { K.attachments.splice(i, 1); renderAttachments(); };
    chip.appendChild(img); chip.appendChild(label); chip.appendChild(x);
    box.appendChild(chip);
  });
}

/* ═══════════ Send ═══════════ */
async function send() {
  if (K.streaming) return;
  const prompt = $('prompt');
  const text = prompt.value.trim();
  const images = K.attachments.map(a => a.url);
  if (!text && !images.length) return;

  if (!K.model) {
    addMsg('assistant', 'No model yet. Click the gear in the title bar, add an API key, then pick a model.');
    return;
  }
  if (images.length) ensureVisionModel();

  prompt.value = '';
  prompt.style.height = 'auto';
  K.attachments = [];
  renderAttachments();

  addMsg('user', text, images);
  const msg = { role: 'user', content: text || 'Describe this image.' };
  if (images.length) msg.images = images;
  K.messages.push(msg);
  await ensureSession(text.slice(0, 40));

  K.streaming = true;
  $('btn-send').style.display = 'none';
  $('btn-stop').style.display = '';
  resetThought();
  currentAssistant = addMsg('assistant', '');
  currentAssistant.querySelector('.text').innerHTML = '<span class="typing">...</span>';

  try {
    const res = await window.krait.chat(K.model, K.messages, {
      mode: $('mode-select').value,
      effort: $('effort-select').value,
      memory: K.memory || null,
      enabledTools: enabledTools(),
      skills: activeSkillHints(),
    });
    const note = currentAssistant.querySelector('.tok-note');
    if (res.error) {
      currentAssistant.querySelector('.text').textContent = 'Error: ' + res.error;
    } else {
      setMsgMarkdown(currentAssistant, sanitizeFinal(res.text) || '(empty reply)');
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

  finishThought(); // in case the model thought but never streamed an answer
  K.streaming = false;
  $('btn-send').style.display = '';
  $('btn-stop').style.display = 'none';
  currentAssistant = null;
  scrollDown();
}

function updateTokenInfo() {
  if (K.tokens > 0) $('token-info').textContent = K.tokens.toLocaleString() + ' tok';
}

/* ═══════════ Plugins / Skills for the AI ═══════════ */
function enabledTools() {
  const saved = JSON.parse(localStorage.getItem('krait-plugins') || '{}');
  return PLUGINS.filter(p => saved[p.id] !== false).map(p => cap(p.id));
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function activeSkillHints() {
  const saved = JSON.parse(localStorage.getItem('krait-skills') || '{}');
  const own = SKILLS.filter(s => saved[s.id] !== false).map(s => s.hint);
  return own.concat(communityHintText());
}

/* ═══════════ Sessions ═══════════ */
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

/* ═══════════ Projects ═══════════ */
async function showProjects() {
  $('projects-screen').classList.add('show');
  await renderProjects();
}

async function renderProjects() {
  if (!window.krait) return;
  const p = await window.krait.projectsGet();
  const box = $('projects-list');
  box.innerHTML = '';
  if (!p.list.length) {
    box.innerHTML = '<div class="usage-empty">No projects yet. Add one below (or use the default).</div>';
  }
  for (const pr of p.list) {
    const el = document.createElement('div');
    el.className = 'proj-item' + (pr.id === p.active ? ' active' : '');
    el.innerHTML = '<div><div class="mcp-name">' + escHtml(pr.name) + (pr.id === p.active ? '  \u2022 active' : '') +
      '</div><div class="p-dir">' + escHtml(pr.dir) + '</div></div>';
    const del = document.createElement('button');
    del.className = 'conn-btn'; del.textContent = '\u00d7';
    del.onclick = async e => {
      e.stopPropagation();
      await window.krait.projectsDelete(pr.id);
      K.memory = await window.krait.projectMemory();
      renderProjects();
    };
    el.onclick = async () => {
      await window.krait.projectsSetActive(pr.id);
      K.memory = await window.krait.projectMemory();
      toast('Project: ' + pr.name);
      renderProjects();
    };
    el.appendChild(del);
    box.appendChild(el);
  }
}

async function addProject() {
  if (!window.krait) return;
  const name = $('proj-name').value.trim() || 'project';
  const dir = $('proj-dir').textContent.trim();
  if (!dir) { toast('Choose a folder first'); return; }
  await window.krait.projectsAdd(name, dir);
  $('proj-name').value = ''; $('proj-dir').textContent = '';
  K.memory = await window.krait.projectMemory();
  renderProjects();
  toast('Project added: ' + name);
}

/* ═══════════ MCP servers ═══════════ */
async function renderMcp() {
  if (!window.krait) return;
  const cfg = await window.krait.mcpGet();
  const box = $('mcp-list');
  box.innerHTML = '';
  if (!cfg.servers || !cfg.servers.length) {
    box.innerHTML = '<div class="usage-empty">No MCP servers yet. Add one below.</div>';
  }
  for (const s of (cfg.servers || [])) {
    const el = document.createElement('div');
    el.className = 'mcp-item';
    el.innerHTML =
      '<div class="mcp-line1"><div><div class="mcp-name">' + escHtml(s.name) + '</div>' +
      '<div class="mcp-cmd">' + escHtml(s.command + ' ' + (s.args || []).join(' ')) + '</div></div>' +
      '<div style="display:flex;gap:6px;align-items:center">' +
      '<span class="mcp-state" id="mcpstate-' + s.id + '"></span>' +
      '<button class="conn-btn" id="mcptest-' + s.id + '">Test</button>' +
      '<button class="conn-btn" id="mcpdel-' + s.id + '">\u00d7</button></div></div>';
    box.appendChild(el);
    $('mcpdel-' + s.id).onclick = async () => {
      cfg.servers = cfg.servers.filter(x => x.id !== s.id);
      await window.krait.mcpSave(cfg);
      renderMcp();
    };
    $('mcptest-' + s.id).onclick = async () => {
      const st = $('mcpstate-' + s.id);
      st.textContent = 'testing...'; st.className = 'mcp-state';
      const r = await window.krait.mcpTest(s);
      if (r.ok) { st.textContent = r.name + ' \u00b7 ' + r.tools + ' tools'; st.className = 'mcp-state ok'; }
      else { st.textContent = 'failed: ' + r.error.slice(0, 60); st.className = 'mcp-state err'; }
    };
  }
}

async function addMcpServer() {
  if (!window.krait) return;
  const name = $('mcp-name').value.trim();
  const command = $('mcp-cmd').value.trim();
  const args = $('mcp-args').value.trim() ? $('mcp-args').value.trim().split(/\s+/) : [];
  if (!name || !command) { toast('Name and command required'); return; }
  const cfg = await window.krait.mcpGet();
  cfg.servers = cfg.servers || [];
  cfg.servers.push({ id: Math.random().toString(36).slice(2, 10), name, command, args });
  await window.krait.mcpSave(cfg);
  $('mcp-name').value = ''; $('mcp-cmd').value = ''; $('mcp-args').value = '';
  renderMcp();
  toast('MCP server added: ' + name);
}

/* ═══════════ Settings ═══════════ */
function showSettings(page) {
  $('key-screen').classList.add('show');
  showSettingsPage(page || 'account');
}
function showSettingsPage(page) {
  document.querySelectorAll('.set-nav').forEach(n => n.classList.toggle('active', n.dataset.page === page));
  for (const p of ['account', 'appearance', 'keys', 'usage', 'capabilities', 'plugins', 'skills', 'connectors', 'mcp']) {
    $('page-' + p).style.display = p === page ? '' : 'none';
  }
  if (page === 'usage') showUsage();
  if (page === 'plugins') showPlugins();
  if (page === 'skills') showSkills();
  if (page === 'connectors') showConnectors();
  if (page === 'mcp') renderMcp();
}
function closeKeys() { $('key-screen').classList.remove('show'); }

function renderFeatList() {
  $('feat-list').innerHTML = FEATURES.map(f => '<div>' + f + '</div>').join('');
}

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
  for (const p of ['gemini', 'openrouter', 'nvidia', 'anthropic', 'groq', 'cerebras', 'mistral', 'huggingface', 'github']) {
    const el = $('k-' + p);
    if (el && el.value.trim()) {
      await window.krait.saveKey(p, el.value.trim());
      el.value = '';
    }
  }
  const keys = await window.krait.getMaskedKeys();
  $('key-saved').textContent = 'Saved: ' + (Object.keys(keys).join(', ') || 'none');
  renderCustomProviders(keys);
  if (Object.keys(keys).length) {
    fillModelSelect(keys);
    setTimeout(closeKeys, 600);
  }
}

/* ═══════════ Your own providers (custom name + base URL) ═══════════ */
function renderCustomProviders(keys) {
  const box = $('cp-list');
  if (!box || !window.krait) return;
  box.innerHTML = '';
  window.krait.providersGet().then(cps => {
    for (const [id, cfg] of Object.entries(cps)) {
      const row = document.createElement('div');
      row.className = 'plug-item';
      row.innerHTML = '<div><div class="plug-name">' + escHtml(cfg.name || id) +
        ' <span class="tag">' + escHtml(String(cfg.baseUrl || '').slice(0, 40)) + '</span></div>' +
        '<div class="plug-desc">models: ' + escHtml((cfg.models || []).join(', ') || 'none yet') + '</div></div>';
      const del = document.createElement('button');
      del.className = 'conn-btn';
      del.textContent = 'Remove';
      del.onclick = async () => {
        await window.krait.providersDelete(id);
        const k = await window.krait.getMaskedKeys();
        fillModelSelect(k);
        renderCustomProviders(k);
      };
      row.appendChild(del);
      box.appendChild(row);
    }
  });
}

async function addCustomProvider() {
  const name = $('cp-name').value.trim();
  const url = $('cp-url').value.trim();
  const key = $('cp-key').value.trim();
  const model = $('cp-model').value.trim();
  if (!name || !url) { toast('Need a name and a base URL'); return; }
  const id = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  if (!window.krait) return;
  const cfg = { name, baseUrl: url, models: model ? [model] : [] };
  // merge models if the provider already exists
  const cur = await window.krait.providersGet();
  if (cur[id]) {
    if (model && !cur[id].models.includes(model)) cfg.models = (cur[id].models || []).concat(model);
  }
  await window.krait.providersAdd(id, cfg);
  // the key is saved under the provider name so chat finds it
  if (key) await window.krait.saveKey(id, key);
  else await window.krait.saveKey(id, 'custom-' + id);
  $('cp-name').value = ''; $('cp-url').value = ''; $('cp-key').value = ''; $('cp-model').value = '';
  const keys = await window.krait.getMaskedKeys();
  fillModelSelect(keys);
  renderCustomProviders(keys);
  toast('Provider "' + name + '" added — pick it in the model menu');
}

function showPlugins() {
  // tab switching
  document.querySelectorAll('.disc-tab').forEach(t => {
    t.onclick = () => {
      document.querySelectorAll('.disc-tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      $('plugins-list').style.display = t.dataset.ptab === 'yours' ? '' : 'none';
      $('discover-list').style.display = t.dataset.ptab === 'discover' ? '' : 'none';
      if (t.dataset.ptab === 'discover') renderDiscover($('plugin-search').value);
    };
  });
  $('plugin-search').oninput = () => {
    if (!$('discover-list').style.display || $('discover-list').style.display === 'none') return;
    renderDiscover($('plugin-search').value);
  };
  renderYours();
}

const COMMUNITY_PLUGINS = [
  { id: 'comm-data', name: 'Data Cruncher', by: 'krait community', desc: 'Analyze CSV/JSON data, make charts and stats with Bash + scripts' },
  { id: 'comm-web', name: 'Site Grabber', by: 'krait community', desc: 'Deep web scraping recipes: read pages, extract links and tables' },
  { id: 'comm-python', name: 'Python Helper', by: 'krait community', desc: 'Run and fix Python scripts automatically with Bash' },
  { id: 'comm-node', name: 'Node Runner', by: 'krait community', desc: 'Run and debug Node.js scripts, install packages' },
  { id: 'comm-ui', name: 'UI Polisher', by: 'Avepier', desc: 'Reviews HTML/CSS it writes and restyles it to look modern' },
  { id: 'comm-tests', name: 'Test Writer', by: 'Avepier', desc: 'Writes quick test scripts for code it changes' },
  { id: 'comm-md', name: 'Doc Writer', by: 'krait community', desc: 'Turns chats into clean README/markdown docs' },
];

function communityHints() {
  const installed = JSON.parse(localStorage.getItem('krait-community') || '[]');
  return COMMUNITY_PLUGINS.filter(p => installed.includes(p.id)).map(p => p.id);
}

function communityHintText() {
  const hints = {
    'comm-data': 'When analyzing data files, use Bash with python or node scripts and produce charts/summaries.',
    'comm-web': 'When doing web work, use WebFetch aggressively: read pages, follow relevant links, extract structured data.',
    'comm-python': 'Prefer writing and running Python scripts via Bash to verify they work before telling the user.',
    'comm-node': 'Prefer writing and running Node scripts via Bash; you may use npm to install small packages.',
    'comm-ui': 'After writing HTML/CSS, review it and apply modern polish: good spacing, contrast, hover states.',
    'comm-tests': 'After editing code, write a quick test script and run it with Bash to confirm it works.',
    'comm-md': 'When the user asks for docs, write a clean README.md with the Write tool.',
  };
  return communityHints().map(id => hints[id]).filter(Boolean);
}

function renderYours() {
  const saved = JSON.parse(localStorage.getItem('krait-plugins') || '{}');
  const installed = JSON.parse(localStorage.getItem('krait-community') || '[]');
  const box = $('plugins-list');
  box.innerHTML = '<p class="key-sub" style="margin-bottom:10px">Built-in tools. Off = the AI can\'t use it.</p>';
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
  if (installed.length) {
    const h = document.createElement('p');
    h.className = 'key-sub'; h.style.margin = '14px 0 6px';
    h.textContent = 'Installed from Discover';
    box.appendChild(h);
    for (const c of COMMUNITY_PLUGINS.filter(x => installed.includes(x.id))) {
      const row = document.createElement('div');
      row.className = 'plug-item';
      row.innerHTML = '<div><div class="plug-name">' + c.name + ' <span class="tag">community</span></div><div class="plug-desc">' + c.desc + '</div></div>';
      const rm = document.createElement('button');
      rm.className = 'conn-btn'; rm.textContent = 'Remove';
      rm.onclick = () => {
        localStorage.setItem('krait-community', JSON.stringify(installed.filter(i => i !== c.id)));
        renderYours();
      };
      row.appendChild(rm);
      box.appendChild(row);
    }
  }
}

function renderDiscover(q) {
  const installed = JSON.parse(localStorage.getItem('krait-community') || '[]');
  const box = $('discover-list');
  box.innerHTML = '';
  const query = (q || '').toLowerCase();
  const list = COMMUNITY_PLUGINS.filter(p => !query || p.name.toLowerCase().includes(query) || p.desc.toLowerCase().includes(query));
  if (!list.length) {
    box.innerHTML = '<div class="usage-empty">No plugins match "' + escHtml(q) + '".</div>';
    return;
  }
  for (const c of list) {
    const row = document.createElement('div');
    row.className = 'plug-item';
    row.innerHTML = '<div><div class="plug-name">' + c.name + ' <span class="tag">' + escHtml(c.by) + '</span></div><div class="plug-desc">' + c.desc + '</div></div>';
    const b = document.createElement('button');
    b.className = 'conn-btn' + (installed.includes(c.id) ? ' on' : '');
    b.textContent = installed.includes(c.id) ? 'Installed' : 'Install';
    b.onclick = () => {
      const cur = JSON.parse(localStorage.getItem('krait-community') || '[]');
      if (!cur.includes(c.id)) cur.push(c.id);
      localStorage.setItem('krait-community', JSON.stringify(cur));
      renderDiscover($('plugin-search').value);
      toast('Installed: ' + c.name);
    };
    row.appendChild(b);
    box.appendChild(row);
  }
}

function showSkills() {
  const saved = JSON.parse(localStorage.getItem('krait-skills') || '{}');
  const box = $('skills-list');
  box.innerHTML = '';
  for (const s of SKILLS) {
    const row = document.createElement('div');
    row.className = 'plug-item';
    row.innerHTML = '<div><div class="plug-name">' + s.name + '</div><div class="plug-desc">' + s.desc + '</div></div>';
    const t = document.createElement('div');
    t.className = 'plug-toggle' + (saved[s.id] !== false ? ' on' : '');
    t.onclick = () => {
      t.classList.toggle('on');
      saved[s.id] = t.classList.contains('on');
      localStorage.setItem('krait-skills', JSON.stringify(saved));
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

/* ═══════════ Model list ═══════════ */
async function fillModelSelect(keys) {
  const sel = $('model-select');
  sel.innerHTML = '';
  const groups = {
    openrouter: [
      ['nvidia/nemotron-3-ultra-550b-a55b:free', 'Nemotron 3 Ultra 550B (free)', false],
      ['google/gemma-4-31b-it:free', 'Gemma 4 31B (free)', true],
      ['baidu/ernie-5.5-flash-preview:free', 'ERNIE 5.5 Flash (free)', false],
      ['cohere/north-mini-code:free', 'North Mini Code (free)', false],
      ['nvidia/nemotron-3.5-super-vl:free', 'Nemotron 3.5 Vision (free)', true],
    ],
    gemini: [
      ['gemini-2.0-flash', 'Gemini 2.0 Flash', true],
      ['gemini-2.5-flash', 'Gemini 2.5 Flash', true],
    ],
    nvidia: [
      ['nvidia/nemotron-3-ultra-550b-a55b', 'Nemotron 3 Ultra 550B', false],
      ['nvidia/nemotron-3.5-super-vl-120b-a12b', 'Nemotron 3.5 Super VL (vision)', true],
      ['openai/gpt-oss-20b', 'GPT-OSS 20B', false],
      ['deepseek-ai/deepseek-v4.1-flash', 'DeepSeek V4.1 Flash', false],
    ],
    anthropic: [
      ['claude-sonnet-4-20250514', 'Claude Sonnet 4', true],
      ['claude-opus-4-20250514', 'Claude Opus 4', true],
    ],
    groq: [
      ['llama-3.3-70b-versatile', 'Llama 3.3 70B (fast)', false],
      ['openai/gpt-oss-120b', 'GPT-OSS 120B', false],
      ['meta-llama/llama-4-scout-17b-16e-instruct', 'Llama 4 Scout', true],
      ['qwen/qwen3-32b', 'Qwen 3 32B', false],
    ],
    cerebras: [
      ['llama-3.3-70b', 'Llama 3.3 70B (ultra fast)', false],
      ['gpt-oss-120b', 'GPT-OSS 120B', false],
      ['qwen-3-32b', 'Qwen 3 32B', false],
    ],
    mistral: [
      ['mistral-large-latest', 'Mistral Large', false],
      ['pixtral-large-latest', 'Pixtral Large', true],
      ['mistral-small-latest', 'Mistral Small', false],
    ],
    huggingface: [
      ['meta-llama/Llama-3.3-70B-Instruct', 'Llama 3.3 70B', false],
      ['Qwen/Qwen2.5-72B-Instruct', 'Qwen 2.5 72B', false],
      ['mistralai/Pixtral-12B-2409', 'Pixtral 12B', true],
    ],
    github: [
      ['openai/gpt-4o-mini', 'GPT-4o mini', false],
      ['openai/gpt-4o', 'GPT-4o', true],
      ['meta-llama/Llama-3.3-70B-Instruct', 'Llama 3.3 70B', false],
    ],
  };

  let any = false;
  for (const [ns, models] of Object.entries(groups)) {
    if (!keys[ns]) continue;
    any = true;
    const og = document.createElement('optgroup');
    og.label = ns;
    for (const [id, name, vision] of models) {
      const o = document.createElement('option');
      o.value = ns + '/' + id;
      o.textContent = name + (vision ? ' (vision)' : '');
      o.dataset.vision = vision ? '1' : '0';
      og.appendChild(o);
    }
    sel.appendChild(og);
  }

  // your own providers (name + base URL you added in Settings → API keys)
  let customs = [];
  if (window.krait) { try { customs = Object.entries(await window.krait.providersGet()); } catch {} }
  for (const [id, cfg] of customs) {
    if (!keys[id]) continue; // needs a key saved under the provider name
    any = true;
    const og = document.createElement('optgroup');
    og.label = cfg.name + ' (yours)';
    const list = (cfg.models && cfg.models.length) ? cfg.models : ['(pick in settings)'];
    for (const m of list) {
      const o = document.createElement('option');
      o.value = id + '/' + m;
      o.textContent = m;
      o.dataset.vision = '0';
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
  K.vision = sel.options[sel.selectedIndex].dataset.vision === '1';
  sel.onchange = () => {
    if (K.model && K.model !== sel.value) {
      addNotice('Switched model: <b>' + sel.options[sel.selectedIndex].textContent + '</b>');
    }
    K.model = sel.value;
    K.vision = sel.options[sel.selectedIndex].dataset.vision === '1';
  };
}

/** When images are attached, make sure the selected model can see. */
function ensureVisionModel() {
  if (K.vision) return;
  const sel = $('model-select');
  const v = Array.from(sel.options).find(o => o.dataset.vision === '1');
  if (v) {
    sel.value = v.value;
    K.model = v.value;
    K.vision = true;
    addNotice('Switched to <b>' + v.textContent + '</b> so krait can see your image.');
  }
}

/* ═══════════ Terminal / Toast ═══════════ */
function termPrint(t) {
  const o = $('term-out');
  o.textContent += t + '\n';
  o.scrollTop = o.scrollHeight;
}

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4000);
}

renderFeatList();
