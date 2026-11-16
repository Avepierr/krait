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
const MAX_ROUNDS = 8;

const KNOWN_TOOLS = new Set(['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebFetch', 'Ask']);
const READ_ONLY = new Set(['Read', 'Glob', 'Grep', 'WebFetch', 'Ask']);
// XML-style tool calls some models emit instead of the fenced block
const __PRE = String.fromCharCode(97, 110, 116, 109, 108, 58);
const __LT = String.fromCharCode(60);
const __GT = String.fromCharCode(62);
const XML_OPEN_RE = new RegExp(__LT + __PRE + 'invoke' + '(?:\\s+name\\s*=\\s*"([^"]+)"|\\s+([A-Za-z_][\\w.-]*))?\\s*>', 'g');
const XML_PARAM_RE = new RegExp(__LT + __PRE + 'parameter' + '(?:\\s+name\\s*=\\s*"([^"]+)"|\\s+([\\w.]+))?\\s*>', 'g');
const XML_CLOSE = __LT + String.fromCharCode(47) + __PRE + 'invoke' + __GT;

/** Parse XML-style tool calls; returns [] when none present. */
function parseXmlToolBlocks(text) {
  if (!new RegExp(XML_OPEN_RE.source).test(text)) return [];
  const calls = [];
  XML_OPEN_RE.lastIndex = 0;
  let m;
  while ((m = XML_OPEN_RE.exec(text)) !== null) {
    const rawName = m[1] || m[2] || '';
    const rest = text.slice(m.index + m[0].length);
    let end = rest.indexOf(XML_CLOSE);
    if (end === -1) {
      const nextOpen = new RegExp(XML_OPEN_RE.source).exec(rest);
      end = nextOpen ? nextOpen.index : rest.length;
    }
    const body = rest.slice(0, end);
    const args = {};
    {
      const pre = new RegExp(XML_PARAM_RE.source, 'g');
      const tags = [];
      let a;
      while ((a = pre.exec(body)) !== null) tags.push(a);
      for (let i = 0; i < tags.length; i++) {
        const key = tags[i][1] || tags[i][2] || '';
        const valStart = tags[i].index + tags[i][0].length;
        const valEnd = i + 1 < tags.length ? tags[i + 1].index : body.length;
        let v = body.slice(valStart, valEnd);
        // the tag ends and the value starts on the next line - drop one newline
        if (v.startsWith('\r\n')) v = v.slice(2);
        else if (v.startsWith('\n')) v = v.slice(1);
        if (key) args[key] = v;
      }
    }
    // some models put the args as a plain JSON object inside the tag body
    {
      const bare = body.replace(new RegExp(XML_PARAM_RE.source, 'g'), '').trim();
      let j = null;
      try { j = JSON.parse(bare); } catch {}
      if (!j && bare.includes('{')) {
        const s0 = bare.indexOf('{'), s1 = bare.lastIndexOf('}');
        if (s0 >= 0 && s1 > s0) { try { j = JSON.parse(bare.slice(s0, s1 + 1)); } catch {} }
      }
      if (j && typeof j === 'object' && !Array.isArray(j)) {
        // either {"name": "...", "input": {...}} or a raw args object {"path": "..."}
        const flat = (j.name && j.input && typeof j.input === 'object') ? j.input : j;
        for (const [k, v] of Object.entries(flat)) {
          const kk = (k === 'file_path' || k === 'file' || k === 'filename') ? 'path'
            : (k === 'file_text' || k === 'new_content') ? 'content' : k;
          if (args[kk] === undefined && typeof v === 'string') args[kk] = v;
        }
      }
    }
    const keys = Object.keys(args);
    let name = KNOWN_TOOLS.has(rawName) ? rawName : null;
    if (!name) {
      if (keys.includes('question')) name = 'Ask';
      else if (keys.includes('command')) name = 'Bash';
      else if (keys.includes('old_string') || keys.includes('new_string')) name = 'Edit';
      else if (keys.includes('url')) name = 'WebFetch';
      else if (keys.includes('pattern')) name = keys.includes('path') ? 'Grep' : 'Glob';
      else if (keys.includes('content') || keys.includes('file_text')) name = 'Write';
      else if (keys.includes('path') || keys.includes('file_path')) name = 'Read';
    }
    if (!name) continue;
    const input = {};
    for (const [k, v] of Object.entries(args)) {
      const kk = (k === 'file_path' || k === 'file' || k === 'filename') ? 'path'
        : (k === 'file_text' || k === 'new_content') ? 'content' : k;
      input[kk] = (kk === 'content') ? String(v).replace(/[\s ]+$/, '') : String(v).replace(/\s+$/, '');
    }
    if (input.path || input.command || input.url || input.pattern || input.question) calls.push({ name, input });
  }
  return calls;
}

// GLM/Qwen-style tool-call tags some models emit (assembled via concat)
const QWEN_OPEN_RE = new RegExp('<' + 'tool_call' + '(?:\\s+name\\s*=\\s*"([^"]+)"|\\s+([A-Za-z_][\\w.-]*))?\\s*>', 'g');
const QWEN_PARAM_RE = new RegExp('<' + 'parameter' + '(?:\\s+name\\s*=\\s*"([^"]+)"|\\s+([\\w.]+))?\\s*>', 'g');
const QWEN_CLOSE = '</' + 'tool_call' + '>';

/** Parse tool_call-style tool calls (same two shapes: parameter tags, or a JSON body). */
function parseQwenToolBlocks(text) {
  if (!new RegExp(QWEN_OPEN_RE.source).test(text)) return [];
  const calls = [];
  QWEN_OPEN_RE.lastIndex = 0;
  let m;
  while ((m = QWEN_OPEN_RE.exec(text)) !== null) {
    const rawName = m[1] || m[2] || '';
    const rest = text.slice(m.index + m[0].length);
    let end = rest.indexOf(QWEN_CLOSE);
    if (end === -1) {
      const nextOpen = new RegExp(QWEN_OPEN_RE.source).exec(rest);
      end = nextOpen ? nextOpen.index : rest.length;
    }
    const body = rest.slice(0, end);
    const args = {};
    {
      const pre = new RegExp(QWEN_PARAM_RE.source, 'g');
      const tags = [];
      let a;
      while ((a = pre.exec(body)) !== null) tags.push(a);
      for (let i = 0; i < tags.length; i++) {
        const key = tags[i][1] || tags[i][2] || '';
        const valStart = tags[i].index + tags[i][0].length;
        const valEnd = i + 1 < tags.length ? tags[i + 1].index : body.length;
        let v = body.slice(valStart, valEnd);
        if (v.startsWith('\r\n')) v = v.slice(2);
        else if (v.startsWith('\n')) v = v.slice(1);
        if (key && key !== 'value') args[key] = v;
      }
    }
    // some models put the args as a plain JSON object inside the tag body
    {
      const bare = body.replace(new RegExp(QWEN_PARAM_RE.source, 'g'), '').trim();
      let j = null;
      try { j = JSON.parse(bare); } catch {}
      if (!j && bare.includes('{')) {
        const s0 = bare.indexOf('{'), s1 = bare.lastIndexOf('}');
        if (s0 >= 0 && s1 > s0) { try { j = JSON.parse(bare.slice(s0, s1 + 1)); } catch {} }
      }
      if (j && typeof j === 'object' && !Array.isArray(j)) {
        const inp = (j.input && typeof j.input === 'object') ? j.input : (j.arguments && typeof j.arguments === 'object') ? j.arguments : j;
        for (const [k, v] of Object.entries(inp)) {
          const kk = (k === 'file_path' || k === 'file' || k === 'filename') ? 'path'
            : (k === 'file_text' || k === 'new_content') ? 'content' : k;
          if (args[kk] === undefined && typeof v === 'string') args[kk] = v;
        }
      }
    }
    const keys = Object.keys(args);
    let name = KNOWN_TOOLS.has(rawName) ? rawName : null;
    if (!name) {
      // the tool name may come from a JSON {"name": ...} body
      try {
        const bare2 = body.trim();
        const s0 = bare2.indexOf('{'), s1 = bare2.lastIndexOf('}');
        if (s0 >= 0 && s1 > s0) {
          const j2 = JSON.parse(bare2.slice(s0, s1 + 1));
          if (j2 && typeof j2.name === 'string' && KNOWN_TOOLS.has(j2.name)) name = j2.name;
        }
      } catch {}
    }
    if (!name) {
      if (keys.includes('question')) name = 'Ask';
      else if (keys.includes('command')) name = 'Bash';
      else if (keys.includes('old_string') || keys.includes('new_string')) name = 'Edit';
      else if (keys.includes('url')) name = 'WebFetch';
      else if (keys.includes('pattern')) name = keys.includes('path') ? 'Grep' : 'Glob';
      else if (keys.includes('content') || keys.includes('file_text')) name = 'Write';
      else if (keys.includes('path') || keys.includes('file_path')) name = 'Read';
    }
    if (!name) continue;
    const input = {};
    for (const [k, v] of Object.entries(args)) {
      const kk = (k === 'file_path' || k === 'file' || k === 'filename') ? 'path'
        : (k === 'file_text' || k === 'new_content') ? 'content' : k;
      input[kk] = (kk === 'content') ? String(v).replace(/[\s ]+$/, '') : String(v).replace(/\s+$/, '');
    }
    if (input.path || input.command || input.url || input.pattern || input.question) calls.push({ name, input });
  }
  return calls;
}
// User asked to create/build something?
const CREATE_RE = /\b(build|create|make|generate|write|code)\b/i;
const LANG_EXT = {
  html: 'html', js: 'js', javascript: 'js', jsx: 'jsx', ts: 'ts', css: 'css',
  python: 'py', py: 'py', csv: 'csv', json: 'json', md: 'markdown', txt: 'text',
  bash: 'sh', sh: 'sh', rust: 'rs', rs: 'rs', cpp: 'cpp', 'c++': 'cpp', cxx: 'cpp', cc: 'cpp',
  c: 'c', go: 'go', golang: 'go', java: 'java', csharp: 'cs', cs: 'cs', php: 'php',
  ruby: 'rb', rb: 'rb', kotlin: 'kt', kt: 'kt', swift: 'swift', zig: 'zig', lua: 'lua', sql: 'sql',
};
const DEFAULT_NAME = {
  html: 'app.html', js: 'app.js', css: 'style.css', py: 'script.py',
  csv: 'data.csv', json: 'data.json', markdown: 'doc.md', text: 'notes.txt', sh: 'run.sh',
  rs: 'app.rs', cpp: 'app.cpp', c: 'app.c', go: 'main.go', java: 'App.java', cs: 'Program.cs',
  php: 'index.php', rb: 'app.rb', kt: 'App.kt', swift: 'App.swift', zig: 'app.zig', lua: 'app.lua', sql: 'query.sql',
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
    const fm = /([\w.-]+\.(?:html?|js|jsx|ts|css|py|csv|json|md|txt|sh|rs|cpp|cxx|cc|c|h|hpp|go|java|cs|php|rb|kt|swift|zig|lua|sql))\b/i.exec(b.pre);
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
    'If a Write call failed or the file ended up incomplete or empty, call Write AGAIN with the complete content. Never finish without the file being written.\n' +
    'Available tools:\n';
  for (const t of all) {
    s += '- ' + t.name + ': ' + t.description + '. Args: ' +
      JSON.stringify(t.input_schema.properties || {}) + '\n';
  }
  s += '- Ask: show the user a question in the chat and WAIT for their typed answer. Args: {"question": "your question"}\n';
  s += 'RULES for Ask: if you are missing information you genuinely need (a choice between options, a name, a path, a preference), use Ask instead of guessing. Keep the question short. Do not overuse it.';
  s += 'LANGUAGES: krait writes code in ANY language the user asks for - HTML/CSS/JS, Python, Rust, C++, C, Go, Java, C#, PHP, Ruby, Kotlin, Lua, SQL and more. Use the correct file extension for the language. To compile or run what you built, use the Bash tool (for example: python file.py, cargo run, g++ file.cpp -o app and run it, go run main.go).';
  s += 'GIT: if the project folder is a git repository and you created or changed files, at the END of your answer offer a one-line commit message (in backticks) and ask if the user wants you to run the commit with the Bash tool. Only commit when the user says yes.';
  s += '\nPaths are relative to the project root. After using tools, give the user a short, clear answer and mention they can download created files from the card in the chat.';
  return s;
}

function parseToolBlocks(text) {
  const calls = [];
  let m;
  for (const x of parseXmlToolBlocks(text)) calls.push(x);
  if (calls.length) return calls;
  for (const x of parseQwenToolBlocks(text)) calls.push(x);
  if (calls.length) return calls;
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
  const NAMES = 'Read|Write|Edit|Bash|Glob|Grep|WebFetch|Ask';
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
  let s = text;
  {
    // remove XML-style tool call regions entirely
    const re = new RegExp(XML_OPEN_RE.source, 'g');
    const closeRe = XML_CLOSE;
    const cuts = [];
    let mm;
    while ((mm = re.exec(s)) !== null) {
      const rest = s.slice(mm.index + mm[0].length);
      const end = rest.indexOf(closeRe);
      const stop = end === -1 ? rest.length : end + closeRe.length;
      cuts.push([mm.index, mm.index + mm[0].length + stop]);
    }
    for (let i = cuts.length - 1; i >= 0; i--) s = s.slice(0, cuts[i][0]) + s.slice(cuts[i][1]);
  }
  {
    // also remove GLM/Qwen-style tool_call regions
    const re2 = new RegExp(QWEN_OPEN_RE.source, 'g');
    const cuts2 = [];
    let mm2;
    while ((mm2 = re2.exec(s)) !== null) {
      const rest2 = s.slice(mm2.index + mm2[0].length);
      const end2 = rest2.indexOf(QWEN_CLOSE);
      const stop2 = end2 === -1 ? rest2.length : end2 + QWEN_CLOSE.length;
      cuts2.push([mm2.index, mm2.index + mm2[0].length + stop2]);
    }
    for (let i = cuts2.length - 1; i >= 0; i--) s = s.slice(0, cuts2[i][0]) + s.slice(cuts2[i][1]);
  }
  s = s.replace(TOOL_BLOCK_RE, '');
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
  const { modelId, messages, opts, signal, sendDelta, sendTool, askPermission, askUser, streamChat } = deps;
  const mode = (opts && opts.mode) || 'normal';
  const enabled = (opts && opts.enabledTools) || [];
  const baseDir = (opts && opts.projectDir) || '.';
  const toolset = new ToolSet(baseDir);

  const tools = toolPrompt(enabled);
  const skills = (opts && opts.skills && opts.skills.length)
    ? '\nSKILLS - extra instructions for this job:\n' + opts.skills.join('\n')
    : '';
  const sysExtra = (tools || '') + skills;
  const convo = messages.map(m => ({ role: m.role, content: m.content, ...(m.images && m.images.length ? { images: m.images } : {}) }));

  let finalText = '';
  let usage = null;
  let usedWrite = false;
  const accUsage = u => {
    if (!u) return;
    if (!usage) usage = { input: 0, output: 0, total: 0 };
    usage.input += u.input || 0;
    usage.output += u.output || 0;
    usage.total += u.total || 0;
    usage.last = u;
  };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await streamChat(modelId, convo, sendDelta, signal,
      { ...opts, tools: sysExtra || undefined });
    accUsage(res.usage);

    const calls = parseToolBlocks(res.text);
    if (!calls.length) {
      finalText += res.text;
      if (res.truncated && round < MAX_ROUNDS - 1) {
        // the reply hit the output limit mid-file — make the model CONTINUE from where it stopped
        convo.push({ role: 'assistant', content: res.text });
        convo.push({
          role: 'user',
          content: 'Your reply was CUT OFF by the output token limit. Continue EXACTLY where you stopped. ' +
            'Do not repeat anything, do not say "continuing" - just output the missing rest. ' +
            'If you were writing a file with the Write tool, emit the complete tool block for it now.',
        });
        continue;
      }
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

      if (!enabled.includes(call.name) && call.name !== 'Ask') {
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

      if (call.name === 'Ask') {
        // ask the user a question in the chat and wait for the answer
        const q = String((call.input && (call.input.question || call.input.text || call.input.q)) || '');
        if (sendTool) sendTool({ name: 'Ask', input: call.input, status: 'running', summary: q.slice(0, 80) });
        let ans = '(no answer)';
        try {
          ans = askUser ? await askUser({ question: q, options: call.input && call.input.options || null }) : '(no answer)';
        } catch { ans = '(no answer)'; }
        if (sendTool) sendTool({ name: 'Ask', input: call.input, status: 'done', summary: 'user answered' });
        results.push('You asked the user: ' + q + '\nThe user answered: ' + ans +
          '\nUse this answer to continue. Ask again only if something is still unclear.');
        continue;
      }
      if (sendTool) sendTool({ name: call.name, input: call.input, status: 'running' });
      const out = await toolset.execute(call.name, call.input);
      if (call.name === 'Write') usedWrite = true;
      if (call.name === 'Edit') {
        const oerr = String((out && (out.error || out.message)) || '');
        if (out && out.error) {
          results.push('Tool Edit FAILED on ' + (call.input && call.input.path || '?') + ': ' + oerr +
            '. HOW TO FIX: Read the file first (or the lines around the target), then call Edit AGAIN with old_string copied EXACTLY from the file ' +
            '(same whitespace and indentation). Use the smallest snippet that is still unique in the file. Do not give up after one failure.');
          if (sendTool) sendTool({ name: 'Edit', input: call.input, status: 'done', summary: 'edit failed - retry advised' });
          continue;
        }
      }
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
