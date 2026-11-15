'use strict';
/**
 * Harness — the agent loop.
 * Sends messages to the selected model, parses tool calls, executes tools, feeds results back.
 */

const { ProviderRouter } = require('./providers');
const { ToolSet } = require('./tools');

class Harness {
  constructor(opts = {}) {
    this.keychain = opts.keychain;
    this.sessionStore = opts.sessionStore;
    this.format = opts.format || 'text';
    this.providers = new ProviderRouter();
    this.tools = new ToolSet();
    this.messages = [];
    this.sessionId = null;
    this.maxTurns = 50;
  }

  /**
   * Print mode: one-shot turn
   */
  async runOnce(prompt, flags) {
    const model = flags.model || await this._getDefaultModel();
    const provider = this.providers.getProvider(model);

    if (!provider) {
      return { isError: true, text: 'No API key configured for the selected provider. Use the krait desktop app to set up your keys.' };
    }

    this.messages = [{ role: 'user', content: prompt }];

    for (let turn = 0; turn < this.maxTurns; turn++) {
      const response = await provider.chat(this.messages, { tools: this.tools.list(), model });

      const { content, toolCalls, isFinished } = this._parseResponse(response);

      if (this.format === 'stream-json') {
        this._emitStreamEvent({ type: 'text', text: content });
      }

      if (toolCalls.length === 0 || isFinished) {
        return { text: content, isError: false, turnCount: turn + 1 };
      }

      this.messages.push({ role: 'assistant', content, toolCalls });

      // Execute tools
      for (const tool of toolCalls) {
        const result = await this.tools.execute(tool.name, tool.input);
        this.messages.push({ role: 'tool', toolCallId: tool.id, name: tool.name, content: result });
        if (this.format === 'stream-json') {
          this._emitStreamEvent({ type: 'tool_result', name: tool.name, result });
        }
      }
    }

    return { text: 'Reached maximum turn limit.', isError: true };
  }

  /**
   * Interactive mode (REPL)
   */
  async startInteractive(flags) {
    const model = flags.model || await this._getDefaultModel();
    const provider = this.providers.getProvider(model);

    if (!provider) {
      console.log('\n⚠️  No API keys configured. Run the krait desktop app first to set up keys.\n');
      this._printHelp();
      return;
    }

    const rl = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '\x1b[32mλ \x1b[0m',
    });

    this._printHeader(model);

    rl.prompt();

    for await (const line of rl) {
      const input = line.trim();
      if (!input) { rl.prompt(); continue; }
      if (input === '/exit' || input === '/quit') { break; }
      if (input === '/help') { this._printHelp(); rl.prompt(); continue; }
      if (input === '/clear') { this.messages = []; console.log('Context cleared.'); rl.prompt(); continue; }

      if (input.startsWith('/model ')) {
        const newModel = input.slice(7).trim();
        const newProvider = this.providers.getProvider(newModel);
        if (newProvider) {
          console.log(`Switched to ${newModel}`);
          rl.prompt();
          continue;
        } else {
          console.log(`No keys for ${newModel}`);
          rl.prompt();
          continue;
        }
      }

      this.messages.push({ role: 'user', content: input });

      for (let turn = 0; turn < 30; turn++) {
        const response = await provider.chat(this.messages, { tools: this.tools.list(), model });
        const { content, toolCalls, isFinished } = this._parseResponse(response);

        if (content) process.stdout.write(content);

        if (toolCalls.length === 0 || isFinished) {
          process.stdout.write('\n');
          rl.prompt();
          break;
        }

        this.messages.push({ role: 'assistant', content, toolCalls });

        for (const tool of toolCalls) {
          const result = await this.tools.execute(tool.name, tool.input);
          this.messages.push({ role: 'tool', toolCallId: tool.id, name: tool.name, content: result });
          console.log(`\n  \x1b\x29m ⚡ ${tool.name || tool.type}: ${String(result).slice(0, 60)}...\x1b[0m`);
        }
      }
    }

    rl.close();
  }

  _parseResponse(response) {
    if (!response) return { content: '', toolCalls: [], isFinished: true };

    // Handle OpenAI-compatible format
    if (response.choices && response.choices[0]) {
      const msg = response.choices[0].message || response.choices[0].delta || {};
      const toolCalls = (msg.tool_calls || []).map(tc => ({
        id: tc.id,
        name: tc.function?.name || tc.type,
        type: 'function',
        input: safeJsonParse(tc.function?.arguments || '{}'),
      }));
      return {
        content: msg.content || '',
        toolCalls,
        isFinished: response.choices[0].finish_reason === 'stop' || false,
      };
    }

    // Handle Gemini format
    if (response.candidates && response.candidates[0]) {
      const c = response.candidates[0].content || {};
      return {
        content: c.text || '',
        toolCalls: (c.functionCall || []).map(fc => ({
          id: fc.id,
          name: fc.name || fc.functionName,
          type: 'function',
          input: fc.args || {},
        })),
        isFinished: true,
      };
    }

    return { content: response.text || JSON.stringify(response) || '', toolCalls: [], isFinished: true };
  }

  _emitStreamEvent(event) {
    process.stdout.write(JSON.stringify(event) + '\n');
  }

  async _getDefaultModel() {
    const keys = await this.keychain.list();
    if (keys.openrouter) return 'openrouter/meta-llama/llama-3.1-8b';
    if (keys.gemini) return 'gemini/gemini-2.0-flash-lite';
    if (keys.anthropic) return 'anthropic/claude-sonnet-4';
    if (keys.nvidia) return 'nvidia/meta/llama-3.1-8b-instruct';
    return null;
  }

  _printHeader(model) {
    console.log(`\x1b[32m  ╭──────────────────────────────────────────╮\x1b[0m`);
  }

  _printHelp() {
    console.log(`
Commands:
  /exit, /quit    Exit the session
  /clear          Clear conversation context
  /model <id>     Switch model (e.g. /model gemini/gemini-2.0-flash)
  /help           Show this help
`);
  }
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

module.exports = { Harness };