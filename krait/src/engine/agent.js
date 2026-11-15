'use strict';
/**
 * agent.js — the Part-3 core: a tool loop that works with ANY model
 * (model-agnostic prompt protocol). The model asks for tools with a
 * fenced block:
 *
 *   ```tool
 *   {"name": "Read", "input": {"path": "src/app.js"}}
 *   ```
 *
 * The main process parses it, asks permission when needed (Electron
 * dialog), executes it with ToolSet, feeds the result back and loops
 * until the model gives a plain answer.
 */

const { ToolSet } = require('./tools');
const fs = require('fs');
const path = require('path');

const TOOL_BLOCK_RE = /```tool\s*\n?([\s\S]*?)```/g;
const MAX_ROUNDS = 6;
const READ_ONLY = new Set(['Read', 'Glob', 'Grep', 'WebFetch']);

// User asked to create/build something?
const CREATE_RE = /\b(build|create|make|generate|write|code)\b/i;
const LANG_EXT = {
  html: 'html', js: 'js', javascript: 'js', jsx: 'jsx', ts: 'ts', css: 'css',
  python: 'py', py: 'py', csv: 'csv', json: 'json', md: 'markdown', txt: 'text',
  bash: 'sh', sh: 'sh',
};
const DEFAULT_NAME = {
  html: 'app.html', js: 'app.js', css: 'style.css', py: 'script.py',
  csv: 'data.csv', json: 'data.json', markdown: 'doc.md', text: 'notes.txt', sh: 'run.sh',
};

/**
 * The model sometimes ignores Write and dumps the whole file as a ``` code block.
 * If the user asked to create something, save the dump as a REAL file so the
 * artifact card appears, and replace the dump in the chat with a short note.
 * Returns { text, saved: [paths] } or null if there was nothing to save.
 */
async function autoSaveCodeDumps({ text, toolset, sendTool, askPermission, baseDir }) {
  const re = /```([A-Za-z0-9+#]*)\s*\n([\s\S]*?)```/g;
  let m;
  const blocks = [];
  while ((m = re.exec(text)) !== null) {
    const lang = (m[1] || '').toLowerCase();
    const code = m[2];
    if (lang === 'tool' || lang === '') continue; // tool blocks / plain fences: skip
    if (code.trim().split('\n').length < 4) continue; // tiny snippets stay in chat
    blocks.push({ lang, code, index: m.index, end: re.lastIndex, pre: text.slice(Math.max(0, m.index - 220), m.index) });
  }
  if (!blocks.length) return null;

  const saved = [];
  let out = text;
  for (let n = blocks.length - 1; n >= 0; n--) {
    const b = blocks[n];
    // filename: prefer one the model mentioned near the block (e.g. "save as game.html")
    const fm = /([\w.-]+\.(?:html?|js|jsx|ts|css|py|csv|json|md|txt|sh))\b/i.exec(b.pre);
    let name = fm ? fm[1] : (DEFAULT_NAME[LANG_EXT[b.lang] || b.lang] || null);
    if (!name) continue;
    let pathOut = name;
    try { pathOut = path.isAbsolute(name) ? name : path.join(baseDir || '.', name); } catch {}
    if (askPermission) {
      const ok = await askPermission({ tool: 'Write', detail: 'create/overwrite ' + name + ' (from pasted code block)' });
      if (!ok) continue;
    }
    if (sendTool) sendTool({ name: 'Write', input: { path: name }, status: 'running' });
    try {
      fs.mkdirSync(path.dirname(pathOut), { recursive: true });
      fs.writeFileSync(pathOut, b.code);
      if (sendTool) sendTool({ name: 'Write', input: { path: name }, status: 'done', summary: 'written ' + name });
      saved.push(name);
      // replace the raw dump with a clean note
      const note = 'Created **' + name + '** — download or open it from the card below.\n';
      out = out.slice(0, b.index) + note + out.slice(b.end);
    } catch {}
  }
  return saved.length ? { text: out.replace(/\n{3,}/g, '\n\n'), saved } : null;
}

function toolPrompt(enabled) {
  if (!enabled || !enabled.length) return '';
  const set = new ToolSet('.');
  const all = set.list().filter(t => enabled.includes(t.name));
  if (!all.length) return '';
  let s = 'TOOLS - you can use these tools. To call one, output EXACTLY this fenced format (nothing else in the block):\n' +
    '```tool\n{"name": "ToolName", "input": {"arg": "value"}}\n```\n' +
    'RULES: One tool call per fenced block. NEVER describe a tool call in words - always emit the block. ' +
    'Never invent results. After you receive TOOL RESULTS, continue.\n' +
    'IMPORTANT - CREATING THINGS: when the user asks you to build, create, make, or generate anything ' +
    '(an app, game, page, spreadsheet, file), you MUST create the real file with the Write tool. ' +
    'NEVER dump the full file content as a code block in chat - that is a failure. Write the file, keep your chat answer short.\n' +
    'Available tools:\n';
  for (const t of all) {
    s += '- ' + t.name + ': ' + t.description + '. Args: ' +
      JSON.stringify(t.input_schema.properties || {}) + '\n';
  }
  s += 'Paths are relative to the project root. After using tools, give the user a short, clear answer and mention they can download created files from the card in the chat.';
  return s;
}

function parseToolBlocks(text) {
  const calls = [];
  let m;
  TOOL_BLOCK_RE.lastIndex = 0;
  while ((m = TOOL_BLOCK_RE.exec(text)) !== null) {
    try {
      const j = JSON.parse(m[1].trim());
      if (j && j.name) calls.push({ name: j.name, input: j.input || {} });
    } catch {}
  }
  if (calls.length) return calls;
  // Fallback: models often write the tool call as bare JSON without the fence,
  // e.g. {"name": "Write", "input": {"path": "...", "content": "..."}}
  // Scan with brace matching so nested {} in content don't break it.
  const NAMES = 'Read|Write|Edit|Bash|Glob|Grep|WebFetch';
  const startRe = new RegExp('\\{\\s*"name"\\s*:\\s*"(' + NAMES + ')"', 'g');
  let s;
  while ((s = startRe.exec(text)) !== null) {
    // brace-match the WHOLE outer object starting at the '{' we found
    let depth = 1, inStr = false, esc = false;
    let i = s.index + 1;
    for (; i < text.length && depth > 0; i++) {
      const c = text[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') depth++;
      else if (c === '}') depth--;
    }
    if (depth !== 0) break; // malformed, stop scanning
    try {
      const j = JSON.parse(text.slice(s.index, i));
      calls.push({ name: j.name, input: j.input || {} });
      startRe.lastIndex = i;
    } catch {}
  }
  return calls;
}

function stripToolBlocks(text) {
  let s = text.replace(TOOL_BLOCK_RE, '');
  // also strip bare inline tool JSON from the visible answer
  const NAMES = 'Read|Write|Edit|Bash|Glob|Grep|WebFetch';
  const startRe = new RegExp('\\{\\s*"name"\\s*:\\s*"(' + NAMES + ')"', 'g');
  while (true) {
    const s2 = startRe.exec(s);
    if (!s2) break;
    let depth = 1, inStr = false, esc = false;
    let i = s2.index + 1;
    for (; i < s.length && depth > 0; i++) {
      const c = s[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') depth++;
      else if (c === '}') depth--;
    }
    if (depth !== 0) break;
    s = s.slice(0, s2.index) + s.slice(i);
    startRe.lastIndex = 0;
  }
  return s.replace(/^\s*tool\s*$/mg, '').replace(/\n{3,}/g, '\n\n').trim();
}

function summarize(out) {
  if (!out) return 'done';
  if (out.error) return 'error: ' + out.error;
  if (out.status) return out.status + ' ' + (out.path || '');
  if (out.files) return out.count + ' file(s): ' + out.files.slice(0, 8).join(', ');
  if (out.matches) return out.count + ' match(es)';
  if (out.stdout !== undefined) return 'exit ' + (out.exit_code || 0) + ' - ' + String(out.stdout || '').slice(0, 80).replace(/\n/g, ' ');
  if (out.lines !== undefined) return out.lines + '/' + out.total + ' lines';
  return 'done';
}

/**
 * Run the agent loop.
 *   sendDelta(chunk)   — stream words to the UI
 *   sendTool(info)     — {name, input, status, summary} tool activity
 *   askPermission(req) — async; return true/false. req = {tool, detail}
 * Returns { text, usage } where text is the final clean answer.
 */
async function runAgent(deps) {
  const { modelId, messages, opts, signal, sendDelta, sendTool, askPermission, streamChat } = deps;
  const mode = (opts && opts.mode) || 'normal';
  const enabled = (opts && opts.enabledTools) || [];
  const baseDir = (opts && opts.projectDir) || '.';
  const toolset = new ToolSet(baseDir);

  const tools = toolPrompt(enabled);
  const skills = (opts && opts.skills && opts.skills.length)
    ? '\nSKILLS - extra instructions for this job:\n' + opts.skills.join('\n')
    : '';
  const sysExtra = (tools || '') + skills;
  const convo = messages.map(m => ({ role: m.role, content: m.content }));

  let finalText = '';
  let usage = null;
  let usedWrite = false;
  const accUsage = u => {
    if (!u) return;
    if (!usage) usage = { input: 0, output: 0, total: 0 };
    usage.input += u.input || 0;
    usage.output += u.output || 0;
    usage.total += u.total || 0;
  };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await streamChat(modelId, convo, sendDelta, signal,
      { ...opts, tools: sysExtra || undefined });
    accUsage(res.usage);

    const calls = parseToolBlocks(res.text);
    if (!calls.length) {
      finalText += res.text;
      break;
    }
    // show the cleaned text (without the raw tool JSON)
    const visible = stripToolBlocks(res.text);
    if (visible) finalText += visible + '\n\n';

    convo.push({ role: 'assistant', content: res.text });

    const results = [];
    for (const call of calls) {
      let allowed = true;
      let denyReason = '';

      if (!enabled.includes(call.name)) {
        allowed = false;
        denyReason = 'tool is disabled in Plugins';
      } else if (mode === 'plan' && !READ_ONLY.has(call.name)) {
        allowed = false;
        denyReason = 'plan mode blocks changes (only Read/Glob/Grep/WebFetch allowed)';
      } else if (mode !== 'bypass' && !READ_ONLY.has(call.name)) {
        allowed = await askPermission({
          tool: call.name,
          detail: describeInput(call),
        });
        if (!allowed) denyReason = 'denied by user';
      }

      if (!allowed) {
        if (sendTool) sendTool({ name: call.name, input: call.input, status: 'blocked', summary: denyReason });
        results.push('Tool ' + call.name + ' was blocked (' + denyReason + '). Do not retry it; answer the user another way.');
        continue;
      }

      if (sendTool) sendTool({ name: call.name, input: call.input, status: 'running' });
      const out = await toolset.execute(call.name, call.input);
      if (call.name === 'Write') usedWrite = true;
      if (sendTool) sendTool({ name: call.name, input: call.input, status: 'done', summary: summarize(out) });
      results.push('Tool ' + call.name + ' result:\n' + JSON.stringify(out).slice(0, 6000));
    }

    convo.push({
      role: 'user',
      content: 'TOOL RESULTS:\n' + results.join('\n\n') +
        '\n\nContinue using tools if needed. When done, answer the user directly (no tool block).',
    });
  }

  // Fallback: model dumped the file as a code block instead of using Write.
  // If the user asked to CREATE something, save it as a real file anyway.
  if (!usedWrite && mode !== 'plan' && enabled.includes('Write')) {
    const lastUser = [...convo].reverse().find(m => m.role === 'user');
    const ask = lastUser ? String(lastUser.content) : '';
    if (CREATE_RE.test(ask)) {
      const r = await autoSaveCodeDumps({
        text: finalText, toolset, sendTool, askPermission,
        baseDir,
      });
      if (r) finalText = r.text;
    }
  }

  if (!finalText.trim()) finalText = '(no answer)';
  return { text: finalText, usage };
}

function describeInput(call) {
  const i = call.input || {};
  switch (call.name) {
    case 'Write': return 'create/overwrite ' + (i.path || '?');
    case 'Edit': return 'edit ' + (i.path || '?');
    case 'Bash': return 'run: ' + (i.command || '?');
    default: return JSON.stringify(i).slice(0, 120);
  }
}

module.exports = { runAgent, parseToolBlocks, stripToolBlocks, toolPrompt };
