'use strict';
const https = require('https');
const http = require('http');
const path = require('path');
const os = require('os');
const { Keychain } = require('./keychain');

class ProviderRouter {
  constructor() { this.providers = {}; }

  getProvider(modelId) {
    if (this.providers[modelId]) return this.providers[modelId];
    const ns = modelId.split('/')[0];
    if (!ns) return null;
    const kc = new Keychain(path.join(os.homedir(), '.krait'));
    const key = kc.get(ns);
    if (ns === 'gemini' && key) this.providers[modelId] = new GeminiProvider(key);
    else if (ns === 'openrouter' && key) this.providers[modelId] = new OpenRouterProvider(key);
    else if (ns === 'nvidia' && key) this.providers[modelId] = new NvidiaProvider(key);
    else if (ns === 'anthropic' && key) this.providers[modelId] = new AnthropicProvider(key);
    return this.providers[modelId] || null;
  }
}

class BaseProvider {
  constructor(apiKey, baseUrl) { this.apiKey = apiKey; this.baseUrl = baseUrl; }
  _fetch(url, body) {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const mod = u.protocol === 'https:' ? https : http;
      const data = JSON.stringify(body);
      const req = mod.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + this.apiKey,
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: 120000,
      }, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try { resolve(JSON.parse(d)); } catch { resolve({ text: d }); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.write(data);
      req.end();
    });
  }
}

class OpenRouterProvider extends BaseProvider {
  constructor(k) { super(k, 'https://openrouter.ai/api/v1/chat/completions'); }
  async chat(messages, opts) {
    return this._fetch(this.baseUrl, {
      model: opts.model || 'meta-llama/llama-3.1-8b-instruct',
      messages, max_tokens: 4096,
    });
  }
}

class GeminiProvider extends BaseProvider {
  constructor(k) { super(k, ''); }
  async chat(messages, opts) {
    const modelName = opts.model ? opts.model.split('/').pop() : 'gemini-2.0-flash';
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + modelName + ':generateContent?key=' + this.apiKey;
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : m.role === 'tool' ? 'function' : 'user',
      parts: [{ text: m.content || '' }],
    }));
    return this._fetch(url, { contents });
  }
}

class NvidiaProvider extends BaseProvider {
  constructor(k) { super(k, 'https://integrate.api.nvidia.com/v1/chat/completions'); }
  async chat(messages, opts) {
    return this._fetch(this.baseUrl, {
      model: opts.model || 'meta/llama-3.1-8b-instruct',
      messages, max_tokens: 4096,
    });
  }
}

class AnthropicProvider {
  constructor(apiKey) { this.apiKey = apiKey; this.baseUrl = 'https://api.anthropic.com/v1/messages'; }
  async chat(messages, opts) {
    const body = JSON.stringify({
      model: opts.model || 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: messages.map(m => {
        if (m.role === 'tool') {
          return { role: 'user', content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: String(m.content) }] };
        }
        return { role: m.role || 'user', content: m.content || '' };
      }),
    });
    return new Promise((resolve, reject) => {
      const mod = this.baseUrl.startsWith('https') ? https : http;
      const req = mod.request(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 120000,
      }, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try {
            const j = JSON.parse(d);
            const texts = (j.content || []).filter(c => c.type === 'text').map(c => c.text);
            const result = {
              choices: [{
                message: { content: texts.join(''), tool_calls: [] },
                finish_reason: j.stop_reason,
              }],
            };
            resolve(result);
          } catch {
            resolve({ text: d });
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.write(body);
      req.end();
    });
  }
}

module.exports = { ProviderRouter, OpenRouterProvider, GeminiProvider, NvidiaProvider, AnthropicProvider };