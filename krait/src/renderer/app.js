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

  // model dropdown
  $('model-dd-btn').onclick = e => {
    e.stopPropagation();
    const pop = $('model-dd-pop');
    pop.classList.toggle('hidden');
    if (!pop.classList.contains('hidden')) { renderModelDropdown(); $('model-dd-search').focus(); }
  };
  document.addEventListener('click', e => {
    const pop = $('model-dd-pop');
    if (pop && !pop.classList.contains('hidden') && !$('model-dd').contains(e.target)) pop.classList.add('hidden');
  });
  $('model-dd-search').addEventListener('input', renderModelDropdown);
  document.querySelectorAll('.dd-profiles button').forEach(b => {
    b.onclick = () => { pickProfile(b.dataset.prof); $('model-dd-pop').classList.add('hidden'); };
  });

  // preview modal
  $('pv-close').onclick = closePreview;
  $('pv-tab-render').onclick = () => setPvTab(true);
  $('pv-tab-code').onclick = () => setPvTab(false);

  // retry / regenerate
  $('btn-retry').onclick = regenerate;

  // export chat
  const doExport = exportChat;
  $('btn-export').onclick = doExport;
  $('pm-export').onclick = () => { $('profile-menu').classList.add('hidden'); exportChat(); };

  // prompt library (slash menu)
  prompt.addEventListener('input', () => {
    const v = prompt.value;
    if (v === '/') showPromptMenu();
    else $('prompt-menu').classList.add('hidden');
  });
  $('prompt-menu').addEventListener('click', e => {
    const it = e.target.closest('.pm-prompt');
    if (it) {
      prompt.value = it.dataset.text;
      $('prompt-menu').classList.add('hidden');
      prompt.focus();
    } else if (e.target.id === 'pm-save-prompt' && prompt.value.trim().length > 1) {
      const saved = JSON.parse(localStorage.getItem('krait-prompts') || '[]');
      saved.unshift(prompt.value.trim());
      localStorage.setItem('krait-prompts', JSON.stringify(saved.slice(0, 30)));
      prompt.value = '';
      $('prompt-menu').classList.add('hidden');
      toast('Prompt saved');
    }
  });

  // keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      $('model-dd-pop').classList.remove('hidden');
      renderModelDropdown();
      $('model-dd-search').focus();
    } else if (e.ctrlKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      newChat();
    } else if (e.key === 'Escape') {
      closePreview();
      $('prompt-menu').classList.add('hidden');
    }
  });

  // ollama downloader
  renderOllamaPulls();

  // restore last picked model once the list is filled
  const lastModel = localStorage.getItem('krait-model');
  if (lastModel && window.krait) {
    setTimeout(() => {
      const sel = $('model-select');
      for (const o of sel.options) {
        if (o.value === lastModel) { sel.value = lastModel; K.model = lastModel; break; }
      }
      syncModelDD();
    }, 300);
  }

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
  const refreshBtn = $('models-refresh');
  if (refreshBtn) refreshBtn.onclick = refreshModels;
  const keys = window.krait ? await window.krait.getMaskedKeys() : {};
  if (Object.keys(keys).length === 0) showSettings('keys'); else closeKeys();
  await fillModelSelect(keys);

  // keep the model catalog fresh in the background (once every 12 hours)
  if (window.krait) {
    window.krait.modelsGet().then(c => {
      if (!c.ts || Date.now() - c.ts > 12 * 3600 * 1000) {
        window.krait.modelsRefresh()
          .then(() => window.krait.getMaskedKeys())
          .then(k => fillModelSelect(k))
          .catch(() => {});
      }
    }).catch(() => {});
  }

  // memory + tool activity
  if (window.krait) {
    K.memory = await window.krait.projectMemory();
    window.krait.onDelta(appendDelta);
    window.krait.onThinking(onThinkingDelta);
    window.krait.onAskPermission(onAskPermission);
    window.krait.onTool(info => {
      if (currentAssistant) {
        // Write gets its own collapsible block (like the thoughts bar)
        if (info.name === 'Write' && info.input && info.input.path && info.status === 'running') {
          addWriteBlock(info.input.path);
        } else if (info.name === 'Edit' && info.status === 'done' && info.input && info.input.old_string !== undefined) {
          addDiffBlock(info.input.path, info.input.old_string, info.input.new_string);
        } else {
          const el = document.createElement('div');
          el.className = 'tool-activity' + (info.status === 'blocked' ? ' blocked' : '');
          const icon = info.status === 'done' ? '\u2713' : info.status === 'running' ? '\u2699' : '\u26d4';
          el.textContent = icon + ' ' + info.name + (info.summary ? ' \u2014 ' + info.summary : '');
          currentAssistant.querySelector('.bubble').appendChild(el);
        }
      }
      // artifact card for created/edited files
      if (info.name === 'Write' && info.status === 'done' && info.input && info.input.path) {
        finishWriteBlock(info.input.path);
        addArtifact(currentAssistant, info.input.path);
      }
      scrollDown();
    });
    window.krait.onFallback(info => {
      toast('Provider failed (' + info.from + ') \u2014 retried with ' + info.to);
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

/** Find a Write call in the raw stream (any of the 3 formats) and return {path, content}. */
function extractLiveWrite(raw) {
  const s = String(raw);
  let m;
  // fenced tool block format
  const fence = /```tool\s*\n?([\s\S]*?)```/g;
  while ((m = fence.exec(s)) !== null) {
    try {
      const j = JSON.parse(m[1].trim());
      if (j && j.name === 'Write' && j.input && j.input.path) return { path: j.input.path, content: j.input.content || '' };
    } catch {}
  }
  // tag-wrapped format (with JSON or parameter tags inside)
  const re = new RegExp(XML_RE_OPEN.source, 'g');
  let last = null;
  while ((m = re.exec(s)) !== null) last = m;
  if (last) {
    const rest = s.slice(last.index + last[0].length);
    const end = rest.indexOf(XML_CLOSE_STR);
    const body = rest.slice(0, end === -1 ? rest.length : end);
    const name = (last[1] || last[2] || '').trim();
    const pre = new RegExp(XML_RE_PARAM.source, 'g');
    const tags = [];
    let a;
    while ((a = pre.exec(body)) !== null) tags.push(a);
    if (tags.length) {
      let path = '', content = '';
      for (let i = 0; i < tags.length; i++) {
        const key = tags[i][1] || tags[i][2] || '';
        const vs = tags[i].index + tags[i][0].length;
        const ve = i + 1 < tags.length ? tags[i + 1].index : body.length;
        let v = body.slice(vs, ve);
        if (v.startsWith('\n')) v = v.slice(1);
        if (key === 'path' || key === 'file_path') path = v;
        else if (key === 'content' || key === 'file_text') content = v;
      }
      if (path && (name === 'Write' || content)) return { path, content };
      return null;
    }
    // JSON body (may be mid-stream: content string unterminated)
    const bare = body.trim();
    let j = null;
    try { j = JSON.parse(bare); } catch {}
    if (!j) {
      const i0 = bare.indexOf('{'), i1 = bare.lastIndexOf('}');
      if (i0 >= 0 && i1 > i0) { try { j = JSON.parse(bare.slice(i0, i1 + 1)); } catch {} }
    }
    if (j) {
      const inp = (j.name && j.input) ? j.input : j;
      const nm = j.name || name;
      if (inp.path && (nm === 'Write' || /\.html?\b/i.test(inp.path))) return { path: inp.path, content: inp.content || '' };
    } else {
      // partial JSON while streaming: pull path + content with tolerant regexes
      const pm = /"path"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(bare);
      const cm = /"content"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(bare);
      if (pm) {
        let path = pm[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
        let content = cm ? cm[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\t/g, '\t') : '';
        return { path, content };
      }
    }
  }
  return null;
}

/** Feed streamed Write content into the collapsible live block (click to view codes). */
function liveWriteFeed(raw) {
  const w = extractLiveWrite(raw);
  if (!w || !w.path) return;
  const b = addWriteBlock(w.path);
  if (!b || b.done) return;
  const pre = b.el.querySelector('.w-code');
  const lines = String(w.content || '').split('\n');
  pre.textContent = lines.length > 40 ? '...\n' + lines.slice(-40).join('\n') : w.content;
  pre.scrollTop = pre.scrollHeight;
}
function appendDelta(d) {
  if (!currentAssistant) return;
  if (thoughtEl) finishThought(); // answer started → collapse the thought block
  const t = currentAssistant.querySelector('.text');
  if (!t.dataset.raw) t.dataset.raw = '';
  t.dataset.raw += d;
  liveWriteFeed(t.dataset.raw);
  setMsgMarkdown(currentAssistant, cleanStream(t.dataset.raw));
}

/** Hide raw tool-call JSON from the live view: show a small named chip instead. */
// XML tool-call tags some models emit (prefix built from char codes)
const XML_PRE = String.fromCharCode(97, 110, 116, 109, 108, 58);
const XML_LT = String.fromCharCode(60);
const XML_RE_OPEN = new RegExp(XML_LT + XML_PRE + 'invoke' + '(?:\\s+name\\s*=\\s*"([^"]+)"|\\s+([A-Za-z_][\\w.-]*))?\\s*>', 'g');
const XML_RE_PARAM = new RegExp(XML_LT + XML_PRE + 'parameter' + '(?:\\s+name\\s*=\\s*"([^"]+)"|\\s+([\\w.]+))?\\s*>', 'g');
const XML_CLOSE_STR = XML_LT + String.fromCharCode(47) + XML_PRE + 'invoke' + String.fromCharCode(62);

/** Build a short chip label from an XML-style tool call body. */
function xmlToolChip(body) {
  const tags = [];
  XML_RE_PARAM.lastIndex = 0;
  let a;
  while ((a = XML_RE_PARAM.exec(body)) !== null) tags.push({ key: a[1] || a[2] || '', i: a.index + a[0].length });
  let path = '', cmd = '';
  for (let i = 0; i < tags.length; i++) {
    const end = i + 1 < tags.length ? tags[i + 1].i : Math.min(body.length, tags[i].i + 400);
    let v = body.slice(tags[i].i, end).trim();
    if (v.length > 60) v = v.slice(0, 60);
    if (['path', 'file_path', 'file', 'filename'].includes(tags[i].key)) path = v;
    else if (['command', 'cmd'].includes(tags[i].key)) cmd = v;
  }
  const arg = path || cmd;
  if (!arg) return '\u2699 writing code...';
  const w = path ? (/\.(html?|css|js|py|csv|json|md|txt)$/i.test(path) ? 'Writing ' : 'Working on ') : 'Running ';
  return '\u2699 ' + w + arg + '...';
}
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
  // XML-style tool calls (complete, and a trailing partial while streaming)
  {
    const re = new RegExp(XML_RE_OPEN.source, 'g');
    const cuts = [];
    let mm;
    while ((mm = re.exec(s)) !== null) {
      const rest = s.slice(mm.index + mm[0].length);
      const end = rest.indexOf(XML_CLOSE_STR);
      const stop = end === -1 ? rest.length : end + XML_CLOSE_STR.length;
      const chip = xmlToolChip(rest.slice(0, end === -1 ? rest.length : end));
      cuts.push([mm.index, mm.index + mm[0].length + stop, chip]);
    }
    for (let i = cuts.length - 1; i >= 0; i--) s = s.slice(0, cuts[i][0]) + '\n' + cuts[i][2] + '\n' + s.slice(cuts[i][1]);
  }
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
  {
    const re = new RegExp(XML_RE_OPEN.source, 'g');
    const cuts = [];
    let mm;
    while ((mm = re.exec(s)) !== null) {
      const rest = s.slice(mm.index + mm[0].length);
      const end = rest.indexOf(XML_CLOSE_STR);
      const stop = end === -1 ? rest.length : end + XML_CLOSE_STR.length;
      cuts.push([mm.index, mm.index + mm[0].length + stop]);
    }
    for (let i = cuts.length - 1; i >= 0; i--) s = s.slice(0, cuts[i][0]) + s.slice(cuts[i][1]);
  }
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
  // in-app preview for web files (and code view for anything else)
  if (/\.(html?|css|js|py|json|csv|md|txt)$/i.test(name)) {
    const pv = document.createElement('button');
    pv.className = 'a-btn';
    pv.textContent = /\.(html?)$/i.test(name) ? 'Preview' : 'View';
    pv.onclick = () => openPreview(path);
    card.insertBefore(pv, dlBtn);
  }
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

/* ═══════════ Live write blocks + preview viewer + diffs ═══════════ */
const writeBlocks = {}; // path -> {el, timer, done}

/** Collapsible "Writing file.html" block, styled like the thoughts bar. */
function addWriteBlock(p) {
  if (!currentAssistant) return null;
  if (writeBlocks[p] && writeBlocks[p].el && document.body.contains(writeBlocks[p].el)) return writeBlocks[p];
  const el = document.createElement('div');
  el.className = 'wblk open';
  el.innerHTML =
    '<button class="th-head"><span class="th-ic">&#9998;</span><span class="th-label">Writing ' + escHtml(String(p).split(/[\\/]/).pop()) + '</span>' +
    '<span class="th-time"></span><span class="th-caret">&#9662;</span></button>' +
    '<div class="th-body"><pre class="w-code"></pre></div>' +
    '<div class="w-actions"><button class="w-preview">&#9654; Live preview</button></div>';
  el.querySelector('.th-head').onclick = e => e.currentTarget.closest('.wblk').classList.toggle('open');
  el.querySelector('.w-preview').onclick = () => openPreview(p);
  currentAssistant.querySelector('.bubble').appendChild(el);
  const b = { el, done: false };
  writeBlocks[p] = b;
  // poll the real file so you watch it appear
  b.timer = setInterval(async () => {
    if (!window.krait || b.done || !document.body.contains(el)) { clearInterval(b.timer); return; }
    const r = await window.krait.readFile(p);
    if (r.ok) {
      const pre = el.querySelector('.w-code');
      const lines = String(r.content).split('\n');
      pre.textContent = lines.length > 40 ? '...\n' + lines.slice(-40).join('\n') : r.content;
      pre.scrollTop = pre.scrollHeight;
    }
  }, 600);
  scrollDown();
  return b;
}

/** Mark the block finished (tool done). */
function finishWriteBlock(p) {
  const b = writeBlocks[p];
  if (!b || b.done) return;
  b.done = true;
  clearInterval(b.timer);
  const label = b.el.querySelector('.th-label');
  if (label) label.textContent = 'Created ' + String(p).split(/[\\/]/).pop();
  // one last content pull
  if (window.krait) {
    window.krait.readFile(p).then(r => {
      if (!r.ok || !document.body.contains(b.el)) return;
      const pre = b.el.querySelector('.w-code');
      const lines = String(r.content).split('\n');
      pre.textContent = lines.length > 40 ? '...\n' + lines.slice(-40).join('\n') : r.content;
    }).catch(() => {});
  }
}

/** Line diff block for Edit tool calls (red/green like a code review). */
function addDiffBlock(p, oldStr, newStr) {
  if (!currentAssistant) return;
  const el = document.createElement('div');
  el.className = 'wblk';
  const name = String(p).split(/[\\/]/).pop();
  const o = String(oldStr || '').split('\n');
  const n = String(newStr || '').split('\n');
  // common prefix / suffix, then mark the middle as -/+ (simple, fast diff)
  let pre = 0;
  while (pre < o.length && pre < n.length && o[pre] === n[pre]) pre++;
  let suf = 0;
  while (suf < o.length - pre && suf < n.length - pre && o[o.length - 1 - suf] === n[n.length - 1 - suf]) suf++;
  const rows = [];
  for (let i = pre; i < o.length - suf; i++) rows.push('<div class="d-rem">- ' + escHtml(o[i] || '') + '</div>');
  for (let i = pre; i < n.length - suf; i++) rows.push('<div class="d-add">+ ' + escHtml(n[i] || '') + '</div>');
  const ctx = pre ? '<div class="d-ctx">&#8942;</div>' : '';
  el.innerHTML =
    '<button class="th-head"><span class="th-ic">&#128394;</span><span class="th-label">Edited ' + escHtml(name) + '</span>' +
    '<span class="th-time"></span><span class="th-caret">&#9662;</span></button>' +
    '<div class="th-body">' + ctx + rows.join('') + '</div>';
  el.querySelector('.th-head').onclick = e => e.currentTarget.closest('.wblk').classList.toggle('open');
  currentAssistant.querySelector('.bubble').appendChild(el);
  scrollDown();
}

/* ── Preview modal (Rendered / Code, live-refreshing) ── */
let pvPoll = null;
let pvPath = null;

function openPreview(p) {
  const modal = $('preview-modal');
  pvPath = p;
  $('pv-title').textContent = String(p).split(/[\\/]/).pop();
  modal.classList.remove('hidden');
  setPvTab(true);
  clearInterval(pvPoll);
  refreshPreview();
  pvPoll = setInterval(refreshPreview, 1200); // live: refreshes while the AI writes
}

function refreshPreview() {
  if (!pvPath || !window.krait) return;
  window.krait.readFile(pvPath).then(r => {
    if (!r.ok) { $('pv-code').textContent = 'Cannot read file: ' + r.error; return; }
    if ($('pv-tab-code').classList.contains('active')) $('pv-code').textContent = r.content;
    if (/\.html?$/i.test(pvPath)) {
      $('pv-frame').style.display = '';
      $('pv-frame').srcdoc = r.content;
    } else {
      $('pv-frame').style.display = 'none';
      $('pv-tab-render').style.display = 'none';
    }
  }).catch(() => {});
}

function setPvTab(rendered) {
  $('pv-tab-render').classList.toggle('active', rendered);
  $('pv-tab-code').classList.toggle('active', !rendered);
  $('pv-frame').style.display = rendered ? '' : 'none';
  $('pv-code').style.display = rendered ? 'none' : '';
  if (!rendered && pvPath && window.krait) {
    window.krait.readFile(pvPath).then(r => { if (r.ok) $('pv-code').textContent = r.content; }).catch(() => {});
  }
}

function closePreview() {
  $('preview-modal').classList.add('hidden');
  clearInterval(pvPoll);
  pvPoll = null;
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
  await runTurn();
}

function updateTokenInfo() {
  if (K.tokens > 0) $('token-info').textContent = K.tokens.toLocaleString() + ' tok';
}

/* ═══════════ Regenerate (retry the last message) ═══════════ */
async function regenerate() {
  if (K.streaming || !K.messages.length) return;
  // drop trailing assistant message(s) from the stored convo + UI
  while (K.messages.length && K.messages[K.messages.length - 1].role === 'assistant') {
    K.messages.pop();
  }
  const box = $('messages');
  const bots = box.querySelectorAll('.msg.assistant');
  if (bots.length) bots[bots.length - 1].remove();
  await runTurn();
}

/** Shared turn runner used by send() and regenerate(). */
async function runTurn() {
  K.streaming = true;
  $('btn-send').style.display = 'none';
  $('btn-stop').style.display = '';
  $('btn-retry').style.display = 'none';
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
        let n = '+' + res.usage.total + ' tok' + (res.usage.estimated ? ' (est.)' : '');
        const est = estimateCost(K.model, res.usage);
        if (est !== null) n += ' \u00b7 ~$' + est.toFixed(4);
        note.textContent = n;
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
  $('btn-retry').style.display = '';
  currentAssistant = null;
  scrollDown();
}

/* ═══════════ Rough cost estimate (paid providers only) ═══════════ */
const COST_PER_M = {
  // rough USD per million tokens (in/out) — only paid providers, estimates only
  anthropic: { in: 3, out: 15 },
  opencode: { in: 1, out: 3 },
};
function estimateCost(modelId, usage) {
  if (!usage || !modelId) return null;
  const ns = String(modelId).split('/')[0];
  const r = COST_PER_M[ns];
  if (!r) return null; // free / unknown providers cost nothing
  return ((usage.input || 0) * r.in + (usage.output || 0) * r.out) / 1e6;
}

/* ═══════════ Prompt library (slash menu) ═══════════ */
function showPromptMenu() {
  const menu = $('prompt-menu');
  const saved = JSON.parse(localStorage.getItem('krait-prompts') || '[]');
  menu.innerHTML = '';
  const save = document.createElement('button');
  save.className = 'pm-save'; save.id = 'pm-save-prompt';
  save.textContent = '\u2795 Save current prompt';
  menu.appendChild(save);
  for (const t of saved.slice(0, 12)) {
    const it = document.createElement('button');
    it.className = 'pm-prompt';
    it.dataset.text = t;
    it.textContent = t.length > 60 ? t.slice(0, 59) + '\u2026' : t;
    menu.appendChild(it);
  }
  menu.classList.remove('hidden');
}

/* ═══════════ Export chat as Markdown ═══════════ */
async function exportChat() {
  if (!K.messages.length) { toast('Nothing to export yet'); return; }
  let md = '# krait chat \u2014 ' + new Date().toLocaleString() + '\n\n';
  md += '_Model: ' + (K.model || 'none') + '_\n\n';
  for (const m of K.messages) {
    md += m.role === 'user' ? '## You\n\n' : '## krait\n\n';
    md += (m.content || '') + '\n\n';
  }
  if (!window.krait) { toast('Export only works in the app'); return; }
  const r = await window.krait.saveText('krait-chat', md);
  if (r.ok) toast('Chat exported: ' + r.savedTo);
  else if (r.error !== 'cancelled') toast('Export failed: ' + r.error);
}

/* ═══════════ Ollama model downloader ═══════════ */
const OLLAMA_POPULAR = ['qwen3:4b', 'llama3.2:3b', 'gemma3:4b', 'deepseek-r1:8b', 'qwen2.5-coder:7b', 'phi4-mini'];
async function renderOllamaPulls() {
  const box = $('ollama-pulls');
  const hint = $('ollama-hint');
  if (!box || !window.krait) return;
  const st = await window.krait.ollamaStatus();
  if (!st.installed) {
    hint.innerHTML = 'Ollama is not running. Install it from <a href="https://ollama.com/download" target="_blank">ollama.com/download</a>, then models pulled here run 100% locally in krait (free, private, no key).';
    box.innerHTML = '';
    return;
  }
  const have = st.models || [];
  hint.innerHTML = 'Ollama is running with <b>' + have.length + '</b> local model(s). Pull more below \u2014 they appear in the model menu under <b>Ollama (local, free)</b>.';
  box.innerHTML = '';
  for (const m of OLLAMA_POPULAR) {
    const installed = have.some(x => x === m || x.startsWith(m + ':'));
    const row = document.createElement('div');
    row.className = 'oll-row';
    row.innerHTML = '<span class="oll-name">' + m + '</span>';
    const btn = document.createElement('button');
    btn.className = 'conn-btn' + (installed ? '' : ' on');
    btn.textContent = installed ? '\u2713 have it' : 'Pull';
    if (installed) btn.disabled = true;
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = 'pulling... (can take minutes)';
      const r = await window.krait.ollamaPull(m);
      if (r.ok) {
        btn.textContent = '\u2713 have it';
        toast('Pulled ' + m + ' \u2014 refresh model lists to see it');
        const rb = $('models-refresh');
        if (rb) rb.click();
      } else {
        btn.textContent = 'failed, retry';
        btn.disabled = false;
      }
    };
    row.appendChild(btn);
    box.appendChild(row);
  }
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
  for (const p of ['gemini', 'openrouter', 'nvidia', 'anthropic', 'groq', 'cerebras', 'mistral', 'huggingface', 'github', 'opencode']) {
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
async function refreshModels() {
  const btn = $('models-refresh');
  const st = $('models-status');
  if (!window.krait || !btn) return;
  btn.disabled = true; btn.textContent = '\u21bb Refreshing...'; st.textContent = '';
  const r = await window.krait.modelsRefresh();
  btn.disabled = false; btn.textContent = '\u21bb Refresh model lists';
  if (r.error) { st.textContent = 'Failed: ' + r.error; return; }
  const counts = Object.entries(r.data || {}).map(([k, v]) => k + ' ' + v.length).join(' \u00b7 ');
  st.textContent = counts ? 'Updated: ' + counts : 'Nothing found \u2014 check your keys / Ollama';
  const keys = await window.krait.getMaskedKeys();
  fillModelSelect(keys);
  toast('Model lists updated');
}
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

  const PROVIDER_LABEL = {
    openrouter: 'OpenRouter (free)', nvidia: 'NVIDIA', gemini: 'Gemini', groq: 'Groq',
    cerebras: 'Cerebras', mistral: 'Mistral', huggingface: 'HuggingFace', github: 'GitHub Models',
    opencode: 'OpenCode Zen', anthropic: 'Anthropic', ollama: 'Ollama (local, free)',
  };

  // static fallbacks (used only when a live catalog isn't available for that provider)
  const cat = new Map();
  for (const [ns, list] of Object.entries(groups)) {
    cat.set(ns, list.map(([id, name, vision]) => ({ id, name, vision })));
  }

  // live catalog wins: every free model, always up to date
  let live = { data: {} };
  if (window.krait) { try { live = await window.krait.modelsGet(); } catch {} }
  const liveData = (live && live.data) || {};
  for (const [ns, list] of Object.entries(liveData)) {
    if (Array.isArray(list) && list.length) cat.set(ns, list);
  }

  let any = false;
  for (const [ns, models] of cat) {
    const needsKey = ns !== 'ollama';
    // ollama shows up only when it's installed/has models (live catalog), no key needed
    if (needsKey && !keys[ns]) continue;
    if (!needsKey && !(liveData.ollama && liveData.ollama.length)) continue;
    any = true;
    const og = document.createElement('optgroup');
    og.label = (PROVIDER_LABEL[ns] || ns) + (liveData[ns] ? '' : ' — built-in list');
    for (const m of models) {
      const o = document.createElement('option');
      o.value = ns + '/' + m.id;
      o.textContent = m.name + (m.vision && !/vision/i.test(m.name) ? ' (vision)' : '');
      o.dataset.vision = m.vision ? '1' : '0';
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
    K.modelList = [];
    renderModelDropdown();
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
    syncModelDD();
  };

  // build the flat list the custom dropdown reads
  K.modelList = [];
  for (const [ns, models] of cat) {
    if (ns !== 'ollama' && !keys[ns]) continue;
    if (ns === 'ollama' && !(liveData.ollama && liveData.ollama.length)) continue;
    for (const m of models) K.modelList.push({ ns, id: m.id, name: m.name, vision: !!m.vision, live: !!liveData[ns] });
  }
  for (const [id, cfg] of customs) {
    if (!keys[id]) continue;
    for (const m of ((cfg.models && cfg.models.length) ? cfg.models : [])) {
      K.modelList.push({ ns: id, id: m, name: m, vision: false, live: false, customName: cfg.name });
    }
  }
  renderModelDropdown();
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
    syncModelDD();
  }
}

/* ═══════════ Model dropdown (favorites + search + profiles) ═══════════ */
function favList() { try { return JSON.parse(localStorage.getItem('krait-favs') || '[]'); } catch { return []; } }
function toggleFav(full) {
  const f = favList();
  const i = f.indexOf(full);
  if (i >= 0) f.splice(i, 1); else f.push(full);
  localStorage.setItem('krait-favs', JSON.stringify(f));
  renderModelDropdown();
}
function shortModel(full) {
  const parts = full.split('/');
  let n = parts.slice(1).join('/');
  n = n.replace(/^(meta-llama|deepseek-ai|mistralai|openai|nvidia|google|qwen|inclusionai|baidu|cohere|openrouter)\//, '');
  return n.length > 34 ? n.slice(0, 33) + '…' : n;
}
function renderModelDropdown() {
  const list = $('model-dd-list');
  if (!list) return;
  const q = ($('model-dd-search').value || '').toLowerCase();
  const PROVIDER_LABEL = {
    openrouter: 'OpenRouter (free)', nvidia: 'NVIDIA', gemini: 'Gemini', groq: 'Groq',
    cerebras: 'Cerebras', mistral: 'Mistral', huggingface: 'HuggingFace', github: 'GitHub Models',
    opencode: 'OpenCode Zen', anthropic: 'Anthropic', ollama: 'Ollama (local, free)',
  };
  const favs = favList();
  const items = (K.modelList || []).filter(m => {
    if (!q) return true;
    return (m.ns + ' ' + m.id + ' ' + m.name).toLowerCase().includes(q);
  });
  const favItems = items.filter(m => favs.includes(m.ns + '/' + m.id));
  const rest = items.filter(m => !favs.includes(m.ns + '/' + m.id));
  list.innerHTML = '';
  const addRow = m => {
    const full = m.ns + '/' + m.id;
    const row = document.createElement('div');
    row.className = 'dd-row' + (full === K.model ? ' active' : '');
    const star = document.createElement('span');
    star.className = 'dd-star' + (favs.includes(full) ? ' on' : '');
    star.textContent = favs.includes(full) ? '★' : '☆';
    star.title = 'Favorite';
    star.onclick = e => { e.stopPropagation(); toggleFav(full); };
    const name = document.createElement('span');
    name.className = 'dd-name';
    name.textContent = shortModel(full) + (m.vision && !/vision/i.test(m.name) ? ' (vision)' : '');
    const prov = document.createElement('span');
    prov.className = 'dd-prov';
    prov.textContent = (m.customName || PROVIDER_LABEL[m.ns] || m.ns);
    row.appendChild(star); row.appendChild(name); row.appendChild(prov);
    row.onclick = () => pickModel(full, m.vision);
    list.appendChild(row);
  };
  if (favItems.length) {
    const h = document.createElement('div');
    h.className = 'dd-group'; h.textContent = '★ Favorites';
    list.appendChild(h);
    favItems.forEach(addRow);
  }
  if (favItems.length && rest.length) {
    const h = document.createElement('div');
    h.className = 'dd-group'; h.textContent = 'All models';
    list.appendChild(h);
  }
  rest.forEach(addRow);
  if (!items.length) list.innerHTML = '<div class="dd-empty">No models match.</div>';
}

function pickModel(full, vision) {
  const sel = $('model-select');
  const notice = K.model && K.model !== full;
  K.model = full;
  K.vision = !!vision;
  // keep the hidden native select in sync (it is the source of truth for values)
  for (const o of sel.options) { if (o.value === full) { sel.value = full; break; } }
  localStorage.setItem('krait-model', full);
  $('model-dd-pop').classList.add('hidden');
  $('model-dd-btn').innerHTML = '&#9679; ' + escHtml(shortModel(full));
  if (notice) addNotice('Switched model: <b>' + escHtml(shortModel(full)) + '</b>');
}

function syncModelDD() {
  if (K.model) $('model-dd-btn').innerHTML = '&#9679; ' + escHtml(shortModel(K.model));
  renderModelDropdown();
}

/** One-click profiles: pick the best available model for the job. */
function pickProfile(kind) {
  const L = K.modelList || [];
  const have = ns => L.filter(m => m.ns === ns);
  let pick = null;
  if (kind === 'fast') {
    pick = have('cerebras')[0] || have('groq')[0] ||
      L.find(m => /flash|8b|mini|nano|small/i.test(m.id) && m.ns !== 'ollama') || have('ollama')[0];
  } else if (kind === 'smart') {
    pick = L.find(m => /nemotron-3-ultra|deepseek-v4|qwen3-32b|gpt-oss-120b|70b|sonnet|opus/i.test(m.id) && m.ns !== 'ollama') ||
      L.find(m => /ultra|72b|120b|large/i.test(m.id)) || L.find(m => m.ns !== 'ollama');
  } else if (kind === 'vision') {
    pick = L.find(m => m.vision && m.ns === 'openrouter') || L.find(m => m.vision && m.ns !== 'ollama') || L.find(m => m.vision);
  } else if (kind === 'local') {
    pick = have('ollama')[0];
  }
  if (!pick) { toast('No model available for that profile — add a key or install Ollama'); return; }
  pickModel(pick.ns + '/' + pick.id, pick.vision);
  toast('Profile: ' + kind + ' → ' + shortModel(pick.ns + '/' + pick.id));
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
