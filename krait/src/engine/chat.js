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

// Maps the UI effort level to each provider's thinking knob.
const REASONING_EFFORT = { low: 'low', medium: 'medium', high: 'high', max: 'high', ultra: 'high', normal: 'medium' };
const THINK_BUDGET = { low: 1024, medium: 2048, high: 4096, max: 8192, ultra: 8192, normal: 2048 };

/** Custom providers the user added: ~/.krait/providers.json = { id: { name, baseUrl, models: [] } } */
function customProvidersPath() {
  return path.join(os.homedir(), '.krait', 'providers.json');
}
function loadCustomProviders() {
  try { return JSON.parse(require('fs').readFileSync(customProvidersPath(), 'utf8')) || {}; } catch { return {}; }
}

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
 * Build one user/assistant message in the provider's shape.
 * Message = { role, content, images?: [dataUrl, ...] }
 */
function buildMessage(ns, m) {
  const images = (m.images || []).filter(Boolean).map(parseDataUrl).filter(Boolean);
  if (!images.length) return { role: m.role, content: m.content };

  if (ns === 'gemini') {
    const parts = [{ text: m.content }];
    for (const im of images) {
      parts.push({ inline_data: { mime_type: im.mime, data: im.base64 } });
    }
    return { role: m.role === 'assistant' ? 'model' : 'user', parts };
  }
  if (ns === 'anthropic') {
    const blocks = [];
    for (const im of images) {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.base64 } });
    }
    blocks.push({ type: 'text', text: m.content });
    return { role: m.role === 'assistant' ? 'assistant' : 'user', content: blocks };
  }
  // OpenAI-compatible (openrouter, nvidia)
  const content = [];
  for (const im of images) {
    content.push({ type: 'image_url', image_url: { url: 'data:' + im.mime + ';base64,' + im.base64 } });
  }
  content.push({ type: 'text', text: m.content });
  return { role: m.role, content };
}

function parseDataUrl(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  return { mime: m[1], base64: m[2] };
}

/**
 * Stream a chat completion. Calls onDelta(textChunk) as words arrive.
 * Returns { text, usage } — usage is real token counts from the API
 * ({ input, output, total }), estimated as a fallback.
 * Throws Error with a friendly message on failure.
 */
async function streamChat(modelId, messages, onDelta, signal, opts) {
  const { ns, model } = splitModel(modelId);
  const key = keychain().get(ns) || (ns === 'ollama' ? 'local' : null);
  const KEYLESS = new Set(['ollama']);
  if (!key && !KEYLESS.has(ns)) throw new Error('No API key saved for ' + ns + '. Click the gear in the title bar to add one.');
  if (!model) throw new Error('No model selected.');

  const sys = buildSystem(opts);
  const clean = messages
    .filter(m => m && m.role !== 'system' && (m.content || (m.images && m.images.length)))
    .map(m => ({ role: m.role, content: m.content ? String(m.content) : '', images: m.images || [] }));

  let url, headers, body;

  if (ns === 'gemini') {
    url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model +
      ':streamGenerateContent?alt=sse&key=' + encodeURIComponent(key);
    headers = { 'Content-Type': 'application/json' };
    body = {
      systemInstruction: { parts: [{ text: sys }] },
      contents: clean.map(m => buildMessage('gemini', m)),
    };
    // Gemini 2.5+ can expose its thoughts; budget scales with effort
    if (/2\.5|3\b/.test(model)) {
      body.generationConfig = {
        thinkingConfig: {
          includeThoughts: true,
          thinkingBudget: THINK_BUDGET[(opts && opts.effort) || 'medium'] || 2048,
        },
      };
    }
  } else if (ns === 'anthropic') {
    // thinking needs budget_tokens >= 1024 and max_tokens > budget
    const budget = THINK_BUDGET[(opts && opts.effort) || 'medium'] || 2048;
    url = 'https://api.anthropic.com/v1/messages';
    headers = {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    };
    body = {
      model,
      max_tokens: budget + 8192,
      stream: true,
      thinking: { type: 'enabled', budget_tokens: budget },
      system: sys,
      messages: clean.map(m => buildMessage('anthropic', m)),
    };
  } else {
    // OpenAI-compatible: openrouter, nvidia + all the new free providers + custom ones
    const BASE_URLS = {
      openrouter: 'https://openrouter.ai/api/v1',
      nvidia: 'https://integrate.api.nvidia.com/v1',
      groq: 'https://api.groq.com/openai/v1',
      cerebras: 'https://api.cerebras.ai/v1',
      mistral: 'https://api.mistral.ai/v1',
      huggingface: 'https://router.huggingface.co/v1',
      github: 'https://models.github.ai/inference',
      opencode: 'https://opencode.ai/inference/openai/v1',
      ollama: 'http://localhost:11434/v1',
    };
    let base = BASE_URLS[ns];
    if (!base) {
      // custom provider added by the user (name + base URL in ~/.krait/providers.json)
      const custom = loadCustomProviders()[ns];
      if (!custom || !custom.baseUrl) throw new Error('Unknown provider "' + ns + '".');
      base = String(custom.baseUrl).replace(/\/+$/, '');
    }
    url = base + '/chat/completions';
    headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key };
    if (ns === 'openrouter') headers['HTTP-Referer'] = 'https://krait.local';
    // high effort → bigger budget so long files don't get cut off mid-Write
    const maxTok = ['high', 'max', 'ultra'].includes((opts && opts.effort) || '') ? 16384 : 8192;
    body = {
      model,
      stream: true,
      max_tokens: maxTok,
      stream_options: { include_usage: true },
      messages: [{ role: 'system', content: sys }, ...clean.map(m => buildMessage(ns, m))],
    };
    // OpenRouter unified reasoning param — models that don't support it just ignore it
    if (ns === 'openrouter' && (!opts || opts.thinking !== false)) {
      body.reasoning = { effort: REASONING_EFFORT[(opts && opts.effort) || 'medium'] || 'medium' };
    }
  }

  const doFetch = () => fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  let res = await doFetch();
  // free pools rate-limit constantly — wait a bit and retry once
  if (res.status === 429) {
    await new Promise(r => setTimeout(r, 6000));
    if (signal && signal.aborted) throw new Error('aborted');
    res = await doFetch();
  }

  if (!res.ok) {
    let msg = 'HTTP ' + res.status;
    try {
      const j = await res.json();
      const e = j.error || j;
      // OpenRouter hides the useful reason (e.g. "rate-limited upstream") in metadata.raw
      msg = (e.metadata && e.metadata.raw) || e.message || e.msg || JSON.stringify(j).slice(0, 300);
      if (res.status === 429) msg = 'rate-limited (' + msg + ')';
    } catch {}
    throw new Error(ns + ': ' + msg);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let full = '';
  let think = '';
  let usage = null;
  let truncated = false;
  const onThinking = (opts && opts.onThinking) || null;

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
      // did the model hit the output limit? (the "cut off" bug)
      if (ns === 'gemini') {
        if (j.candidates && j.candidates[0] && j.candidates[0].finishReason === 'MAX_TOKENS') truncated = true;
      } else if (ns === 'anthropic') {
        if (j.type === 'message_delta' && j.delta && j.delta.stop_reason === 'max_tokens') truncated = true;
      } else {
        const c = j.choices && j.choices[0];
        if (c && c.finish_reason === 'length') truncated = true;
      }
      const td = extractThinking(ns, j);
      if (td) {
        think += td;
        if (onThinking) onThinking(td);
      }
      const delta = extractDelta(ns, j);
      if (delta) {
        full += delta;
        if (onDelta) onDelta(delta);
      }
      const u = extractUsage(ns, j);
      if (u) usage = u;
    }
  }

  if (!full.trim() && !think.trim()) throw new Error(ns + ' returned an empty reply (check your key and model).');
  if (!usage) usage = estimateUsage(sys, clean, full + think);
  return { text: full, usage, thinking: think, truncated };
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
    // p.thought === true marks thinking text — keep it out of the answer
    return parts.filter(p => !p.thought).map(p => p.text || '').join('');
  }
  if (ns === 'anthropic') {
    if (j.type === 'content_block_delta' && j.delta && j.delta.type !== 'thinking_delta') return j.delta.text || '';
    return '';
  }
  const c = j.choices && j.choices[0];
  return (c && c.delta && c.delta.content) || '';
}

/** Reasoning/thinking text deltas, separate from the answer. */
function extractThinking(ns, j) {
  if (ns === 'gemini') {
    const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
    return parts.filter(p => p.thought).map(p => p.text || '').join('');
  }
  if (ns === 'anthropic') {
    if (j.type === 'content_block_delta' && j.delta && j.delta.type === 'thinking_delta') return j.delta.thinking || '';
    return '';
  }
  // OpenAI-compatible: reasoning lives next to content on the delta
  const d = j.choices && j.choices[0] && j.choices[0].delta;
  if (!d) return '';
  return d.reasoning || d.reasoning_content || '';
}

/** One-shot helper (no UI) for tests and the CLI. */
async function chatOnce(modelId, messages, opts) {
  const out = await streamChat(modelId, messages, null, undefined, opts);
  return out.text;
}

module.exports = { streamChat, chatOnce, splitModel };
