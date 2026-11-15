'use strict';
/**
 * Provider adapters for Gemini, OpenRouter, NVIDIA, and Anthropic APIs.
 * All are OpenAI-compatible or have simple native formats.
 */

const https = require('https');
const http = require('http');

class ProviderRouter {
  constructor() {
    this.providers = {};
  }

  getProvider(modelId) {
    if (this.providers[modelId]) return this.providers[modelId];

    const [namespace, ...rest] = modelId.split('/');
    const providerId = namespace;

    // Check keys based on namespace
    const keysDir = require('path').join(require('os').homedir(), '.krait', 'keys');
    const fs = require('fs');

    if (providerId === 'gemini') {
      const keyData = this._readKey(keysDir, 'gemini');
      if (keyData) this.providers[modelId] = new GeminiProvider(keyData);
    } else if (providerId === 'openrouter') {
      const keyData = this._readKey(keysDir, 'openrouter');
      if (keyData) this.providers[modelId] = new OpenRouterProvider(keyData);
    } else if (providerId === 'nvidia') {
      const keyData = this._readKey(keysDir, 'nvidia');
      if (keyData) this.providers[modelId] = new NvidiaProvider(keyData);
    } else if (providerId === 'anthropic') {
      const keyData = this._readKey(keysDir, 'anthropic');
      if (keyData) this.providers[modelId] = new AnthropicProvider(keyData);
    }

    return this.providers[modelId] || null;
  }

  _readKey(keysDir, name) {
    try {
      const raw = require('fs').readFileSync(require('path').join(keysDir, `${name}.key`), 'utf8').trim();
      return raw;
    } catch { return null; }
  }
}

class BaseProvider {
  constructor(apiKey, baseUrl) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async chat(messages, opts) {
    throw new Error('Not implemented');
  }

  _fetch(url, body) {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const mod = u.protocol === 'https:' ? https : http;
      const data = JSON.stringify(body);
      const req = mod.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: 120000,
      }, (res) => {
        let responseData = '';
        res.on('data', chunk => responseData += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(responseData)); }
          catch { resolve({ text: responseData }); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      req.write(data);
      req.end();
    });
  }
}

class OpenRouterProvider extends BaseProvider {
  constructor(apiKey) {
    super(apiKey, 'https://openrouter.ai/api/v1/chat/completions');
  }

  async chat(messages, opts = {}) {
    return this._fetch(this.baseUrl, {
      model: opts.model || 'meta-llama/llama-3.1-8b-instruct',
      messages,
      tools: opts.tools?.length > 0 ? opts.tools : undefined,
      max_tokens: 4096,
    });
  }
}

class GeminiProvider extends BaseProvider {
  constructor(apiKey) {
    super(apiKey, 'https://generativelanguage.googleapis.com/v1beta/models');
  }

  async chat(messages, opts = {}) {
    const modelName = opts.model ? opts.model.split('/').pop() : 'gemini-2.0-flash-lite';
    const url = `${this.baseUrl}/${modelName}:generateContent?key=${this.apiKey}`;
    const contents = messages.map(m => {
      const parts = [{ text: m.content || '' }];
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          parts.push({
            functionCall: {
              name: tc.name || tc.type,
              args: tc.input || {},
            },
          });
        }
      }
      if (m.role === 'tool') {
        parts.push({
          functionResponse: {
            name: m.name,
            response: { content: m.content },
          },
        });
      }
      return { role: m.role === 'assistant' ? 'model' : m.role === 'tool' ? 'function' : 'user', parts };
    });

    return this._fetch(url, { contents });
  }
}

class NvidiaProvider extends BaseProvider {
  constructor(apiKey) {
    super(apiKey, 'https://integrate.api.nvidia.com/v1/chat/completions');
  }

  async chat(messages, opts = {}) {
    return this._fetch(this.baseUrl, {
      model: opts.model || 'meta/llama-3.1-8b-instruct',
      messages,
      max_tokens: 4096,
    });
  }
}

class AnthropicProvider {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.anthropic.com/v1/messages';
  }

  async chat(messages, opts = {}) {
    const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
    const msgs = messages.filter(m => m.role !== 'system');

    return new Promise((resolve, reject) => {
      const u = new URL(this.baseUrl);
      const data = JSON.stringify({
        model: opts.model || 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: system || undefined,
        messages: msgs.map(m => {
          if (m.role === 'tool') {
            return {
              role: 'user',
              content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: String(m.content) }],
            };
          }
          if (m.toolCalls) {
            const content = [{ type: 'text', text: m.content || '' }];
            for (const tc of m.toolCalls) {
              content.push({ type: 'tool_use', id: tc.id, name: tc.name || tc.type, input: tc.input || {} });
            }
            return { role: 'assistant', content };
          }
          return { role: m.role || 'user', content: m.content || '' };
        }),
        tools: opts.tools?.length > 0 ? opts.tools.map(t => ({
          name: t.name || t.type,
          description: t.description || '',
          input_schema: t.input_schema || {},
        })) : undefined,
      });

      const mod = u.protocol === 'https:' ? require('https') : require('http');
      const req = mod.request(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: 120000,
      }, (res) => {
        let d = '';
        res.on('data', chunk => d += chunk);
        res.on('end', () => {
          try { const parsed = JSON.parse(d); resolve(this._normalize(parsed)); }
          catch { resolve({ text: d }); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.write(data);
      req.end();
    });
  }

  _normalize(parsed) {
    return {
      choices: [{
        message: {
          content: parsed.content?.filter(c => c.type === 'text').map(c => c.text).join('') || '',
          tool_calls: parsed.content?.filter(c => c.type === 'tool_use').map(c => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.input) },
          })) || [],
        },
        finish_reason: parsed.stop_reason === 'end_turn' ? 'stop' : parsed.stop_reason,
      }],
    };
  }
}

module.exports = { ProviderRouter, OpenRouterProvider, GeminiProvider, NvidiaProvider, AnthropicProvider };