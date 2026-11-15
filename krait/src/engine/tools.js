'use strict';
/**
 * Tool implementations matching the Claude Code tool subset.
 * Plain JS, child_process for Bash, fs for Read/Write/Edit/Grep/Glob.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { execSync, spawn } = require('child_process');
const https = require('https');
const http = require('http');

class ToolSet {
  constructor() {
    this._registry = {
      Read: { description: 'Read file contents', input_schema: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } } }, fn: this._read },
      Write: { description: 'Create or overwrite a file', input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } } }, fn: this._write },
      Edit: { description: 'Replace exact text in a file', input_schema: { type: 'object', properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' }, replace_all: { type: 'boolean' } } }, fn: this._edit },
      Bash: { description: 'Run a shell command', input_schema: { type: 'object', properties: { command: { type: 'string' }, timeout: { type: 'number' } } }, fn: this._bash },
      Glob: { description: 'Find files by pattern', input_schema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } } }, fn: this._glob },
      Grep: { description: 'Search file contents', input_schema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' }, glob: { type: 'string' } } }, fn: this._grep },
      WebFetch: { description: 'Fetch a URL', input_schema: { type: 'object', properties: { url: { type: 'string' } } }, fn: this._webFetch },
    };
  }

  list() {
    return Object.entries(this._registry).map(([name, def]) => ({
      name,
      type: 'function',
      description: def.description,
      input_schema: def.input_schema,
    }));
  }

  async execute(name, input) {
    const tool = this._registry[name];
    if (!tool) return { error: `Unknown tool: ${name}` };
    try {
      return await tool.fn(input || {});
    } catch (err) {
      return { error: err.message };
    }
  }

  async _read(input) {
    const p = path.resolve(input.path);
    if (!fs.existsSync(p)) return { error: `File not found: ${input.path}` };
    const stat = fs.statSync(p);
    if (stat.size > 10 * 1024 * 1024) return { error: 'File too large (max 10 MB)' };
    const offset = input.offset || 0;
    const limit = input.limit || 0;
    const content = fs.readFileSync(p, 'utf8');
    const lines = content.split('\n');
    const result = limit > 0 ? lines.slice(offset, offset + limit) : lines.slice(offset);
    return { path: input.path, lines: result.length, total: lines.length, content: result.join('\n') };
  }

  async _write(input) {
    const p = path.resolve(input.path);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, input.content || '', 'utf8');
    return { path: input.path, status: 'written' };
  }

  async _edit(input) {
    const p = path.resolve(input.path);
    if (!fs.existsSync(p)) return { error: `File not found: ${input.path}` };
    const content = fs.readFileSync(p, 'utf-8');
    const oldString = input.old_string;
    const newString = input.new_string;
    if (!oldString) return { error: 'old_string is required' };
    const matches = content.split(oldString).length - 1;
    if (!input.replace_all && matches > 1) return { error: `old_string appears ${matches} times; set replace_all=true or add context` };
    const newContent = input.replace_all ? content.split(oldString).join(newString) : content.replace(oldString, newString);
    fs.writeFileSync(p, newContent, 'utf8');
    return { path: input.path, status: 'edited' };
  }

  async _bash(input) {
    const cmd = input.command;
    if (!cmd) return { error: 'No command provided' };
    const timeout = input.timeout || 30000;
    try {
      const output = execSync(cmd, { timeout, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
      return { stdout: output, exit_code: 0 };
    } catch (err) {
      return { stdout: err.stdout || '', stderr: err.stderr || '', exit_code: err.status || 1 };
    }
  }

  async _glob(input) {
    const pattern = input.pattern || '**/*';
    const base = input.path ? path.resolve(input.path) : process.cwd();
    const { globSync } = require('glob').length > 0 ? require('glob') : { globSync: (p) => { return []; } };
    let results;
    try {
      const glob = require('glob');
      results = glob.globSync || glob.sync || glob;
      if (typeof results !== 'function') results = (p) => [];
      const files = results(pattern, { cwd: base, nodir: true });
      return { files: files.slice(0, 100), count: files.length, truncated: files.length > 100 };
    } catch {
      return { files: [], error: 'glob not available' };
    }
  }

  async _grep(input) {
    const pattern = input.pattern;
    if (!pattern) return { error: 'No pattern provided' };
    const base = input.path ? path.resolve(input.path) : process.cwd();
    try {
      const ext = input.glob ? input.glob.replace('**/*', '').replace('*.', '.') : '';
      const extFilter = ext ? `--include=${ext}` : '';
      const output = execSync(`grep -rn ${extFilter} "${pattern}" "${base}"`, { encoding: 'utf8', timeout: 15000, maxBuffer: 5 * 1024 * 1024 });
      const lines = output.split('\n').filter(Boolean);
      return { matches: lines.slice(0, 100), count: lines.length, truncated: lines.length > 100 };
    } catch (err) {
      if (err.status === 1) return { matches: [], count: 0 };
      return { error: err.message };
    }
  }

  async _webFetch(input) {
    const url = input.url;
    if (!url) return { error: 'No URL provided' };
    return new Promise((resolve) => {
      const u = new URL(url);
      const mod = u.protocol === 'https:' ? https : http;
      mod.get(url, { timeout: 15000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ url, content: data.slice(0, 50000), status: res.statusCode }));
      }).on('error', (e) => resolve({ error: e.message }));
    });
  }
}

module.exports = { ToolSet };