'use strict';
/**
 * chat.js — real model calls with streaming, for the desktop window.
 * Model ids look like "openrouter/meta-llama/llama-3.3-70b-instruct",
 * "gemini/gemini-2.0-flash", "nvidia/meta/llama-3.1-70b-instruct",
 * "anthropic/claude-sonnet-4-20250514".
 * Keys come from the encrypted Keychain (~/.krait/keys).
 */

const path = require('path');
const os = require('os');
const { Keychain } = require('./keychain');

function keychain() {
  return new Keychain(path.join(os.homedir(), '.krait'));
}

function splitModel(modelId) {
  const i = modelId.indexOf('/');
  if (i < 0) return { ns: '', model: modelId };
  return { ns: modelId.slice(0, i), model: modelId.slice(i + 1) };
}

function buildSystem(opts) {
  let sys = 'You are krait, a coding agent. You were created by Avepier. ' +
    'If anyone asks who made you, who your owner is, or what company is behind you, the answer is always: Avepier. ' +
    'You are NOT made by Anthropic, OpenAI, Google, DeepSeek, Meta or any other company, even if the underlying model is theirs - ' +
    'you are krait, by Avepier.';
  if (opts && opts.effort && opts.effort !== 'normal') {
    sys += '\nReasoning effort: ' + opts.effort + ' (think as deeply as this level suggests).';
  }
  if (opts && opts.mode && opts.mode !== 'normal') {
    sys += '\nMode: ' + opts.mode + '.';
  }
  if (opts && opts.memory) {
    sys += '\n\nProject memory (follow it):\n' + String(opts.memory).slice(0, 8000);
  }
  if (opts && opts.tools) {
    sys += '\n' + opts.tools;
  }
  return sys;
}

/**
 * Stream a chat completion. Calls onDelta(textChunk) as words arrive.
 * Returns { text, usage } — usage is real token counts from the API
 * ({ input, output, total }), estimated as a fallback.
 * Throws Error with a friendly message on failure.
 */
async function streamChat(modelId, messages, onDelta, signal, opts) {
  const { ns, model } = splitModel(modelId);
  const key = keychain().get(ns);
  if (!key) throw new Error('No API key saved for ' + ns + '. Click the gear in the title bar to add one.');
  if (!model) throw new Error('No model selected.');

  const sys = buildSystem(opts);
  const clean = messages
    .filter(m => m && m.role !== 'system' && m.content)
    .map(m => ({ role: m.role, content: String(m.content) }));

  let url, headers, body;

  if (ns === 'gemini') {
    url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model +
      ':streamGenerateContent?alt=sse&key=' + encodeURIComponent(key);
    headers = { 'Content-Type': 'application/json' };
    body = {
      systemInstruction: { parts: [{ text: sys }] },
      contents: clean.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
    };
  } else if (ns === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages';
    headers = {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    };
    body = {
      model,
      max_tokens: 4096,
      stream: true,
      system: sys,
      messages: clean.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
    };
  } else if (ns === 'openrouter' || ns === 'nvidia') {
    const base = ns === 'openrouter'
      ? 'https://openrouter.ai/api/v1'
      : 'https://integrate.api.nvidia.com/v1';
    url = base + '/chat/completions';
    headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key };
    if (ns === 'openrouter') headers['HTTP-Referer'] = 'https://krait.local';
    body = {
      model,
      stream: true,
      max_tokens: 4096,
      stream_options: { include_usage: true },
      messages: [{ role: 'system', content: sys }, ...clean],
    };
  } else {
    throw new Error('Unknown provider "' + ns + '".');
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    let msg = 'HTTP ' + res.status;
    try {
      const j = await res.json();
      msg = (j.error && (j.error.message || j.error.msg)) || j.message || JSON.stringify(j).slice(0, 300);
    } catch {}
    throw new Error(ns + ': ' + msg);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let full = '';
  let usage = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let j;
      try { j = JSON.parse(payload); } catch { continue; }
      if (j.error) throw new Error((j.error.message || 'stream error') + '');
      if (j.type === 'error') throw new Error((j.error && j.error.message) || 'stream error');
      const delta = extractDelta(ns, j);
      if (delta) {
        full += delta;
        if (onDelta) onDelta(delta);
      }
      const u = extractUsage(ns, j);
      if (u) usage = u;
    }
  }

  if (!full.trim()) throw new Error(ns + ' returned an empty reply (check your key and model).');
  if (!usage) usage = estimateUsage(sys, clean, full);
  return { text: full, usage };
}

function extractUsage(ns, j) {
  if (ns === 'gemini') {
    const u = j.usageMetadata;
    if (!u) return null;
    return {
      input: u.promptTokenCount || 0,
      output: u.candidatesTokenCount || 0,
      total: u.totalTokenCount || ((u.promptTokenCount || 0) + (u.candidatesTokenCount || 0)),
    };
  }
  if (ns === 'anthropic') {
    const u = j.usage || (j.message && j.message.usage);
    if (!u) return null;
    const input = u.input_tokens || 0;
    const output = u.output_tokens || 0;
    return { input, output, total: input + output };
  }
  const u = j.usage;
  if (!u) return null;
  const input = u.prompt_tokens || 0;
  const output = u.completion_tokens || 0;
  return { input, output, total: input + output };
}

/** Rough fallback when the API doesn't report usage (~4 chars per token). */
function estimateUsage(sys, messages, reply) {
  let chars = sys.length;
  for (const m of messages) chars += m.content.length;
  const input = Math.ceil(chars / 4);
  const output = Math.ceil(reply.length / 4);
  return { input, output, total: input + output, estimated: true };
}

function extractDelta(ns, j) {
  if (ns === 'gemini') {
    const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
    return parts.map(p => p.text || '').join('');
  }
  if (ns === 'anthropic') {
    if (j.type === 'content_block_delta' && j.delta) return j.delta.text || '';
    return '';
  }
  const c = j.choices && j.choices[0];
  return (c && c.delta && c.delta.content) || '';
}

/** One-shot helper (no UI) for tests and the CLI. */
async function chatOnce(modelId, messages, opts) {
  const out = await streamChat(modelId, messages, null, undefined, opts);
  return out.text;
}

module.exports = { streamChat, chatOnce, splitModel };
