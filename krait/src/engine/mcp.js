'use strict';
/**
 * mcp.js — minimal MCP (Model Context Protocol) client over stdio.
 * Speaks newline-delimited JSON-RPC: initialize → tools/list → tools/call.
 * Servers are configured as { id, name, command, args[] } in ~/.krait/mcp.json.
 */

const { spawn } = require('child_process');

class McpClient {
  constructor(config) {
    this.config = config; // { id, name, command, args }
    this.proc = null;
    this.nextId = 1;
    this.pending = new Map(); // id -> {resolve, reject, timer}
    this.buffer = '';
    this.tools = [];
  }

  _send(obj) {
    this.proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  _request(method, params, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(method + ' timed out'));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: v => { clearTimeout(timer); resolve(v); },
        reject: e => { clearTimeout(timer); reject(e); },
      });
      this._send({ jsonrpc: '2.0', id, method, params: params || {} });
    });
  }

  _handleLine(line) {
    const t = line.trim();
    if (!t) return;
    let msg;
    try { msg = JSON.parse(t); } catch { return; }
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    }
  }

  async connect() {
    const { command, args } = this.config;
    if (!command) throw new Error('No command configured for MCP server ' + (this.config.name || '?'));
    this.proc = spawn(command, args || [], {
      cwd: undefined,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', chunk => {
      this.buffer += chunk;
      let nl;
      while ((nl = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, nl);
        this.buffer = this.buffer.slice(nl + 1);
        this._handleLine(line);
      }
    });
    this.proc.stderr.on('data', () => {});
    this.proc.on('exit', code => {
      for (const [, p] of this.pending) p.reject(new Error('MCP server exited (code ' + code + ')'));
      this.pending.clear();
    });

    const init = await this._request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'krait', version: '0.6.0' },
    });
    this._send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    this.serverInfo = init && init.serverInfo;
    return this.serverInfo || { name: 'mcp-server' };
  }

  async listTools() {
    const res = await this._request('tools/list', {});
    this.tools = (res && res.tools) || [];
    return this.tools;
  }

  async callTool(name, args) {
    const res = await this._request('tools/call', { name, arguments: args || {} }, 60000);
    if (res && res.isError) throw new Error('MCP tool error');
    const content = (res && res.content) || [];
    return content.map(c => c.text || JSON.stringify(c)).join('\n');
  }

  disconnect() {
    try { this.proc && this.proc.kill(); } catch {}
    this.proc = null;
    this.tools = [];
  }
}

module.exports = { McpClient };
