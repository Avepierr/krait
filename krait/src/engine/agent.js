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

const TOOL_BLOCK_RE = /```tool\s*\n?([\s\S]*?)```/g;
const MAX_ROUNDS = 6;
const READ_ONLY = new Set(['Read', 'Glob', 'Grep', 'WebFetch']);

function toolPrompt(enabled) {
  if (!enabled || !enabled.length) return '';
  const set = new ToolSet('.');
  const all = set.list().filter(t => enabled.includes(t.name));
  if (!all.length) return '';
  let s = 'TOOLS - you can use these tools. To call one, output exactly a fenced block like:\n' +
    '```tool\n{"name": "ToolName", "input": {"arg": "value"}}\n```\n' +
    'Wait for TOOL RESULTS before continuing. Never invent results. ' +
    'Available tools:\n';
  for (const t of all) {
    s += '- ' + t.name + ': ' + t.description + '. Args: ' +
      JSON.stringify(t.input_schema.properties || {}) + '\n';
  }
  s += 'Paths are relative to the project root. After using tools, give the user a short, clear answer.';
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
  return calls;
}

function stripToolBlocks(text) {
  return text.replace(TOOL_BLOCK_RE, '').replace(/\n{3,}/g, '\n\n').trim();
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
  const convo = messages.map(m => ({ role: m.role, content: m.content }));

  let finalText = '';
  let usage = null;
  const accUsage = u => {
    if (!u) return;
    if (!usage) usage = { input: 0, output: 0, total: 0 };
    usage.input += u.input || 0;
    usage.output += u.output || 0;
    usage.total += u.total || 0;
  };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await streamChat(modelId, convo, sendDelta, signal,
      { ...opts, tools: tools || undefined });
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
      if (sendTool) sendTool({ name: call.name, input: call.input, status: 'done', summary: summarize(out) });
      results.push('Tool ' + call.name + ' result:\n' + JSON.stringify(out).slice(0, 6000));
    }

    convo.push({
      role: 'user',
      content: 'TOOL RESULTS:\n' + results.join('\n\n') +
        '\n\nContinue using tools if needed. When done, answer the user directly (no tool block).',
    });
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
