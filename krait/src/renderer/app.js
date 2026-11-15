'use strict';
/* krait renderer — real streaming chat, key screen, terminal. */

const $ = id => document.getElementById(id);
const K = { model: '', messages: [], streaming: false };
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

document.addEventListener('DOMContentLoaded', init);

async function init() {
  // window controls
  $('btn-min').onclick = () => window.krait && window.krait.minimize();
  $('btn-max').onclick = () => window.krait && window.krait.maximize();
  $('btn-close').onclick = () => window.krait && window.krait.close();
  $('btn-settings').onclick = openKeys;
  $('key-close').onclick = closeKeys;
  $('btn-terminal').onclick = () => $('terminal').classList.toggle('hidden');
  $('btn-new').onclick = () => { K.messages = []; renderWelcome(); };

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

  // streaming deltas from the main process
  if (window.krait) window.krait.onDelta(appendDelta);

  renderWelcome();
}

/* ── Model list (only providers with a saved key) ── */
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
  sel.onchange = () => { K.model = sel.value; };
}

/* ── Key screen ── */
function openKeys() { $('key-screen').classList.add('show'); }
function closeKeys() { $('key-screen').classList.remove('show'); }

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

/* ── Chat ── */
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
    '</div><div class="text"></div></div>';
  el.querySelector('.text').textContent = text || '';
  $('messages').appendChild(el);
  scrollDown();
  return el;
}

function appendDelta(d) {
  if (!currentAssistant) return;
  const t = currentAssistant.querySelector('.text');
  if (t.textContent === '...') t.textContent = '';
  t.textContent += d;
  scrollDown();
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

  K.streaming = true;
  $('btn-send').style.display = 'none';
  $('btn-stop').style.display = '';
  currentAssistant = addMsg('assistant', '...');

  try {
    const res = await window.krait.chat(K.model, K.messages, {
      mode: $('mode-select').value,
      effort: $('effort-select').value,
    });
    const t = currentAssistant.querySelector('.text');
    if (res.error) {
      t.textContent = 'Error: ' + res.error;
    } else {
      t.textContent = res.text || '(empty reply)';
      if (res.aborted) t.textContent += '  (stopped)';
      K.messages.push({ role: 'assistant', content: res.text || '' });
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

/* ── Terminal ── */
function termPrint(t) {
  const o = $('term-out');
  o.textContent += t + '\n';
  o.scrollTop = o.scrollHeight;
}
