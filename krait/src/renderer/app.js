'use strict';

// krait Code View — renderer (plain JS)

const KRAIT = { messages: [], sessionId: null, model: '', mode: 'manual', isStreaming: false };

document.addEventListener('DOMContentLoaded', async () => {
  const keys = window.krait ? await window.krait.getMaskedKeys() : {};
  const ks = document.getElementById('keys-screen');
  
  if (Object.keys(keys).length > 0) {
    ks.classList.remove('show'); ks.style.display = 'none';
  }
  
  document.getElementById('keys-form').addEventListener('submit', async e => {
    e.preventDefault();
    for (const p of ['gemini','openrouter','nvidia','anthropic']) {
      const el = document.getElementById('key-' + p);
      if (el && el.value.trim()) await window.krait.saveKey(p, el.value.trim());
    }
    ks.style.display = 'none';
  });
  
  document.getElementById('composer-send').addEventListener('click', sendMessage);
  document.getElementById('composer-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    if (e.key === 'Escape') stopMessage();
  });
  document.getElementById('btn-new-session').addEventListener('click', newSession);
});

function getId(id) { return document.getElementById(id); }

async function sendMessage() {
  if (KRAIT.isStreaming) return;
  const inp = getId('composer-input');
  const text = inp ? inp.value.trim() : '';
  if (!text) return;
  inp.value = '';
  
  addMessage('user', text);
  KRAIT.messages.push({ role: 'user', content: text });
  KRAIT.isStreaming = true;
  
  const mc = getId('messages-container');
  const placeholder = document.createElement('div');
  placeholder.innerHTML = '<div class="msg msg-assistant"><div class="msg-text">...streaming</div></div>';
  mc.appendChild(placeholder);
  mc.scrollTop = mc.scrollHeight;
  
  setTimeout(() => {
    placeholder.innerHTML = '<div class="msg msg-assistant"><svg viewBox="0 0 28 28" width="28" height="28" style="float:left;margin-right:8px"><rect x="0" y="0" width="7" height="7" fill="#222"/><rect x="7" y="0" width="7" height="7" fill="#00D68F"/><rect x="14" y="0" width="7" height="7" fill="#222"/><rect x="0" y="7" width="7" height="7" fill="#00D68F"/><rect x="7" y="7" width="7" height="7" fill="#222"/><rect x="14" y="7" width="7" height="7" fill="#00D68F"/><rect x="0" y="14" width="7" height="7" fill="#222"/><rect x="7" y="14" width="7" height="7" fill="#00D68F"/><rect x="14" y="14" width="7" height="7" fill="#222"/></svg>Connected to ' + KRAIT.model + '. Ready to work.</div>';
    KRAIT.isStreaming = false;
    mc.scrollTop = mc.scrollHeight;
  }, 1500);
}

function stopMessage() { KRAIT.isStreaming = false; }

function addMessage(role, content) {
  const mc = getId('messages-container');
  const el = document.createElement('div');
  el.className = 'msg msg-' + role;
  el.innerHTML = '<div class="msg-text">' + escapeHtml(content) + '</div>';
  mc.appendChild(el);
  mc.scrollTop = mc.scrollHeight;
}

function newSession() {
  KRAIT.messages = []; KRAIT.sessionId = null;
  getId('messages-container').innerHTML = '';
  getId('session-name').textContent = 'untitled';
}

function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}