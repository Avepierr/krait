'use strict';

/* ═══════════ krait — Full Code View UI ═══════════ */

const K = { messages: [], sessionId: null, model: null, streaming: false, abort: null };

function $(id) { return document.getElementById(id); }
function qs(s, p) { return (p||document).querySelector(s); }
function esc(s) { if (!s) return ''; return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* ═══ Init ═══ */
document.addEventListener('DOMContentLoaded', async () => {
  // Load icon
  $('title-icon').src = ''; $('key-icon').src = '';
  // Try to resolve icon via preload
  try { $('title-icon').src = '../../assets/icon.png'; $('key-icon').src = '../../assets/icon.png'; } catch {}

  // Get keys
  let hasKeys = false;
  if (window.krait) {
    const keys = await window.krait.getMaskedKeys();
    hasKeys = Object.keys(keys).length > 0;
  }
  if (!hasKeys) $('key-overlay').classList.add('active');

  // Key form
  $('key-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!window.krait) return;
    for (const p of ['gemini','openrouter','nvidia','anthropic']) {
      const el = $('k-' + p);
      if (el && el.value.trim()) await window.krait.saveKey(p, el.value.trim());
    }
    $('key-overlay').classList.remove('active');
    populateModelList();
  });

  // Titlebar controls
  ['tb-minimize','tb-maximize','tb-close'].forEach(id => {
    const el = $(id); if (!el) return;
    el.addEventListener('click', () => {
      if (id === 'tb-minimize') window.krait?.minimize();
      else if (id === 'tb-maximize') window.krait?.maximize();
      else window.krait?.close();
    });
  });

  // New session
  $('new-session-btn').addEventListener('click', newSession);

  // Send
  $('send-btn').addEventListener('click', send);
  $('prompt-area').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    if (e.key === 'Escape') stopStream();
  });
  $('stop-btn').addEventListener('click', stopStream);

  // Attach
  $('attach-btn').addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = true;
    inp.onchange = () => { for (const f of inp.files) addAttachment(f.name); };
    inp.click();
  });

  // Mode select
  $('mode-select').addEventListener('change', () => {
    $('mode-chip').textContent = $('mode-select').value;
    K.mode = $('mode-select').value;
  });

  // Effort select
  $('effort-select').addEventListener('change', () => {
    $('effort-chip').textContent = $('effort-select').value;
  });

  // Thinking toggle
  $('thinking-toggle').addEventListener('click', () => {
    $('thinking-toggle').classList.toggle('active');
    $('thinking-toggle').style.borderColor = $('thinking-toggle').classList.contains('active') ? 'var(--accent)' : '';
  });

  // Right panel tabs
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      const tab = $('tab-' + t.dataset.tab);
      if (tab) tab.classList.add('active');
    });
  });

  // Terminal input
  $('term-input').addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return;
    const cmd = $('term-input').value.trim();
    if (!cmd) return;
    $('term-input').value = '';
    appendTerm('$ ' + cmd);
    try {
      if (window.krait) {
        const r = await window.krait.runTerminal(cmd);
        appendTerm(r.stdout || r.stderr || 'Done');
      } else {
        appendTerm('No terminal bridge available');
      }
    } catch (err) {
      appendTerm('Error: ' + err.message);
    }
  });

  // Populate models
  populateModelList();
});

/* ═══ Send ═══ */
function send() {
  if (K.streaming) return;
  const area = $('prompt-area');
  const text = area.innerText.trim();
  if (!text) return;
  area.innerText = '';
  K.messages.push({ role: 'user', content: text });
  addMsg('user', text);
  K.streaming = true;
  $('send-btn').style.display = 'none';
  $('stop-btn').style.display = '';

  // Send to backend (pretend/harness)
  const model = K.model || ($('model-select') ? $('model-select').value : '') || 'openrouter/meta-llama/llama-3.1-8b';
  const msgEl = addMsg('assistant', '⌛');
  // Simulate streaming (replace with real fetch later)
  let i = 0;
  K.abort = new AbortController();
  const fakeReplies = [
    "I'll work on that for you.",
    "\n\nLet me look at the code...",
    "\n\nThe file has some interesting patterns.\n\nHere's what I found..."
  ];
  const interval = setInterval(() => {
    if (K.streaming === false || i >= fakeReplies.length) {
      clearInterval(interval);
      doneStreaming(msgEl, "Done! I've analyzed the project for you. The main structure is in `src/renderer/app.js` and `src/engine/harness.js`. What would you like to do next?");
      return;
    }
    msgEl.querySelector('.msg-text').textContent = fakeReplies.slice(0, i+1).join('');
    i++;
  }, 800);
}

function doneStreaming(el, finalText) {
  K.streaming = false;
  $('send-btn').style.display = '';
  $('stop-btn').style.display = 'none';
  if (!el) return;
  el.querySelector('.msg-text').textContent = finalText;
  K.messages.push({ role: 'assistant', content: finalText });
  $('messages').scrollTop = $('messages').scrollHeight;
}

function stopStream() {
  K.streaming = false;
  $('send-btn').style.display = '';
  $('stop-btn').style.display = 'none';
}

/* ═══ Messages ═══ */
function addMsg(role, content) {
  const c = $('messages');
  const el = document.createElement('div');
  el.className = 'msg msg-' + role;
  const isUser = role === 'user';
  const avatar = isUser
    ? '<div class="msg-avatar"><svg viewBox="0 0 28 28"><rect width="28" height="28" rx="6" fill="var(--accent)"/><text x="14" y="19" text-anchor="middle" fill="#000" font-size="16" font-weight="700">U</text></svg></div>'
    : '<div class="msg-avatar"><svg viewBox="0 0 28 28"><rect x="0" y="0" width="7" height="7" fill="#222"/><rect x="7" y="0" width="7" height="7" fill="#00D68F"/><rect x="14" y="0" width="7" height="7" fill="#222"/><rect x="0" y="7" width="7" height="7" fill="#00D68F"/><rect x="7" y="7" width="7" height="7" fill="#222"/><rect x="14" y="7" width="7" height="7" fill="#00D68F"/><rect x="0" y="14" width="7" height="7" fill="#222"/><rect x="7" y="14" width="7" height="7" fill="#00D68F"/><rect x="14" y="14" width="7" height="7" fill="#222"/><rect x="0" y="21" width="7" height="7" fill="#222"/><rect x="7" y="21" width="7" height="7" fill="#00D68F"/><rect x="14" y="21" width="7" height="7" fill="#222"/><rect x="21" y="0" width="7" height="7" fill="#00D68F"/><rect x="21" y="7" width="7" height="7" fill="#222"/><rect x="21" y="14" width="7" height="7" fill="#00D68F"/></svg></div>';
  el.innerHTML = '<div class="msg-head">' + avatar + '<div><div class="msg-name">' + (isUser ? 'You' : 'krait') + '</div></div></div><div class="msg-text">' + esc(content) + '</div>';
  c.appendChild(el);
  c.scrollTop = c.scrollHeight;
  return el;
}

/* ═══ Attachments ═══ */
function addAttachment(name) {
  const chips = $('composer-chips');
  const chip = document.createElement('span');
  chip.className = 'chip';
  chip.style.cssText = 'background:var(--bg4);color:var(--fg);';
  chip.textContent = '📄 ' + name + ' ×';
  chip.onclick = () => chip.remove();
  chips.appendChild(chip);
}

/* ═══ Terminal ═══ */
function appendTerm(text) {
  const out = $('terminal-out');
  out.textContent += text + '\n';
  out.scrollTop = out.scrollHeight;
}

/* ═══ Sessions ═══ */
function newSession() {
  K.messages = []; K.sessionId = null;
  $('messages').innerHTML = '';
  $('session-title').textContent = 'Code';
}

/* ═══ Model picker ═══ */
function populateModelList() {
  const tab = $('tab-model-picker');
  if (!tab) return;
  const providers = [
    {
      name: 'OpenRouter',
      models: [
        { id: 'openrouter/meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B', desc: 'Strong general model' },
        { id: 'openrouter/mistralai/mixtral-8x22b', name: 'Mixtral 8x22B', desc: 'Fast & powerful' },
        { id: 'openrouter/qwen/qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B', desc: 'Strong open model' },
      ]
    },
    {
      name: 'Gemini',
      models: [
        { id: 'gemini/gemini-2.0-flash', name: 'Gemini 2.0 Flash', desc: 'Fast, free tier' },
        { id: 'gemini/gemini-2.0-pro', name: 'Gemini 2.0 Pro', desc: 'Most capable Gemini' },
      ]
    },
    {
      name: 'NVIDIA',
      models: [
        { id: 'nvidia/llama-3.1-nemotron-70b', name: 'Nemotron 70B', desc: 'Reasoning tuned' },
      ]
    },
    {
      name: 'Anthropic',
      models: [
        { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', desc: 'Best for coding' },
        { id: 'anthropic/claude-opus-4', name: 'Claude Opus 4', desc: 'Most capable Claude' },
      ]
    },
  ];
  tab.innerHTML = providers.map(g => `
    <div class="model-group">
      <div class="model-group-name">${g.name}</div>
      ${g.models.map(m => `
        <div class="model-item${K.model === m.id ? ' active' : ''}" data-id="${m.id}">
          <div class="model-name">${m.name}</div>
          <div class="model-desc">${m.desc}</div>
        </div>
      `).join('')}
    </div>
  `).join('');
  tab.querySelectorAll('.model-item').forEach(el => {
    el.addEventListener('click', () => {
      tab.querySelectorAll('.model-item').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
      K.model = el.dataset.id;
      $('model-select').innerHTML = `<option value="${K.model}">${el.querySelector('.model-name').textContent}</option>`;
    });
  });
}