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
  constructor(baseDir) {
    this.baseDir = baseDir || process.cwd();
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

  /** Resolve a user-supplied path against the project directory. */
  _abs(p) {
    if (!p) return this.baseDir;
    return path.isAbsolute(p) ? p : path.resolve(this.baseDir, p);
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
      return await tool.fn.call(this, input || {});
    } catch (err) {
      return { error: err.message };
    }
  }

  async _read(input) {
    const p = this._abs(input.path);
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
    const p = this._abs(input.path);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, input.content || '', 'utf8');
    return { path: input.path, status: 'written' };
  }

  async _edit(input) {
    const p = this._abs(input.path);
    if (!fs.existsSync(p)) return { error: `File not found: ${input.path}` };
    const content = fs.readFileSync(p, 'utf-8');
    const oldString = input.old_string;
    const newString = input.new_string;
    if (!oldString) return { error: 'old_string is required' };
    const matches = content.split(oldString).length - 1;
    if (matches === 0) return { error: 'old_string not found in the file. Read the file (or the lines around your target) first, then retry with old_string copied EXACTLY from the file (same whitespace).' };
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
    // Own implementation: walk the project dir, match pattern (supports **, *, ?)
    const pattern = input.pattern || '**/*';
    const base = this._abs(input.path);
    if (!fs.existsSync(base)) return { error: `Path not found: ${input.path}` };
    const results = [];
    const walk = dir => {
      if (results.length >= 500) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (results.length >= 500) return;
        const full = path.join(dir, e.name);
        const rel = path.relative(base, full).split(path.sep).join('/');
        if (e.isDirectory()) {
          if (['node_modules', '.git', 'dist', 'out', '.next'].includes(e.name)) continue;
          walk(full);
        } else if (matchPattern(rel, pattern)) {
          results.push(rel);
        }
      }
    };
    walk(base);
    return { files: results, count: results.length, truncated: results.length >= 500 };
  }

  async _grep(input) {
    // Own implementation: recursive scan, works on Windows without external grep
    const pattern = input.pattern;
    if (!pattern) return { error: 'No pattern provided' };
    const base = this._abs(input.path);
    if (!fs.existsSync(base)) return { error: `Path not found: ${input.path}` };
    let rx;
    try { rx = new RegExp(pattern, 'i'); } catch { rx = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
    const globFilter = input.glob ? input.glob.split('/').pop() : null; // e.g. "*.js"
    const matches = [];
    let scanned = 0;
    const walk = dir => {
      if (matches.length >= 200 || scanned > 2000) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (matches.length >= 200 || scanned > 2000) return;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (['node_modules', '.git', 'dist', 'out'].includes(e.name)) continue;
          walk(full);
        } else {
          if (globFilter && !matchPattern(e.name, globFilter)) continue;
          scanned++;
          let content;
          try {
            if (fs.statSync(full).size > 1024 * 1024) continue;
            content = fs.readFileSync(full, 'utf8');
          } catch { continue; }
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (rx.test(lines[i])) {
              matches.push({ file: path.relative(this.baseDir, full), line: i + 1, text: lines[i].trim().slice(0, 200) });
              if (matches.length >= 200) break;
            }
          }
        }
      }
    };
    walk(base);
    return { matches, count: matches.length, truncated: matches.length >= 200 };
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

/** Simple glob matching: ** = any depth, * = within segment, ? = one char. */
function matchPattern(rel, pattern) {
  const rx = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '(?:.*/)?')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');
  try { return new RegExp('^' + rx + '$').test(rel); } catch { return false; }
}