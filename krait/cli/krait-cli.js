#!/usr/bin/env node
'use strict';
/**
 * krait CLI chat — type `krait` in your PC terminal and talk right here.
 * Same engine as the desktop app: chat.js streaming, encrypted Keychain keys,
 * and agent mode that reads/writes/edits files (asks before anything risky).
 * Commands: /models /model <id> /agent /clear /help /exit
 * Input uses a line queue so fast/piped input is never dropped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { streamChat } = require('../src/engine/chat');
const { Keychain } = require('../src/engine/keychain');
const { runAgent } = require('../src/engine/agent');

const DATA = path.join(os.homedir(), '.krait');
const VERSION = require('../package.json').version;

const DEFAULTS = {
  openrouter: 'openrouter/meta-llama/llama-3.3-70b-instruct',
  nvidia: 'nvidia/meta/llama-3.1-70b-instruct',
  gemini: 'gemini/gemini-2.0-flash',
  anthropic: 'anthropic/claude-sonnet-4',
  groq: 'groq/llama-3.3-70b-versatile',
  cerebras: 'cerebras/llama-3.3-70b',
  mistral: 'mistral/mistral-large-latest',
  xai: 'xai/grok-3-latest',
  deepseek: 'deepseek/deepseek-chat',
};

const G = '\x1b[32m', Y = '\x1b[33m', DIM = '\x1b[2m', B = '\x1b[1m', R = '\x1b[0m';
function out(s) { process.stdout.write(s); }

let model = null;
let convo = [];
let agentMode = false;
let busy = false;
let closing = false;
let rl = null;

// ── line queue: every input line lands here exactly once ──
const pendingLines = [];
const lineWaiters = [];
function wireInput() {
  rl.on('line', l => {
    if (lineWaiters.length) { const w = lineWaiters.shift(); w(l); }
    else pendingLines.push(l);
  });
  rl.on('close', () => {
    closing = true;
    while (lineWaiters.length) lineWaiters.shift()('');
  });
  rl.on('SIGINT', () => { out('\n'); rl.close(); });
}
/** Resolve with the next typed line. Prints the prompt only while actually waiting. */
function nextLine(promptText) {
  return new Promise(resolve => {
    if (pendingLines.length) return resolve(pendingLines.shift());
    if (closing) return resolve('');
    if (promptText) out(promptText);
    lineWaiters.push(resolve);
  });
}
/** Line without echoing a main prompt (used for y/N and Ask answers). */
function subLine() { return nextLine(null); }

function haveKeys() {
  const kc = new Keychain(DATA);
  return Object.keys(DEFAULTS).filter(p => kc.get(p));
}
function pickDefault() {
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(DATA, 'cli-model.json'), 'utf8')).model;
    if (saved) return saved;
  } catch {}
  const have = haveKeys();
  return have.length ? DEFAULTS[have[0]] : null;
}
function catalogModels() {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, 'models.json'), 'utf8')).data || {}; } catch { return {}; }
}

function banner() {
  out(`\n${G}${B}  krait${R} ${DIM}v${VERSION} \u00b7 by Avepier \u00b7 free AI coding agent${R}\n`);
  out(`${DIM}  model: ${model}${agentMode ? '  (agent mode: tools on)' : ''}${R}\n`);
  out(`${DIM}  /help for commands \u00b7 /exit to quit${R}\n\n`);
}
function help() {
  out(`${DIM}  /models          list your models
  /model <id>      switch model (e.g. /model openrouter/meta-llama/llama-3.3-70b-instruct) and remember it
  /agent           toggle agent mode - I read/write/edit files in this folder, asking before anything risky
  /clear           fresh context
  /exit            quit${R}\n`);
}
function listModels() {
  const have = haveKeys();
  const cat = catalogModels();
  if (!have.length) { out(Y + '  no API keys found - add one in the desktop app (Settings > API keys)' + R + '\n'); return; }
  for (const ns of have) {
    out(G + '  ' + ns + R + '\n');
    const list = (cat[ns] || []).slice(0, 6);
    if (list.length) for (const m of list) out(DIM + '    ' + ns + '/' + m.id + (m.vision ? ' (vision)' : '') + R + '\n');
    else out(DIM + '    ' + DEFAULTS[ns] + R + '\n');
  }
  out(DIM + '  switch with /model <id>' + R + '\n');
}
function switchModel(id) {
  const ns = String(id).split('/')[0];
  if (!DEFAULTS[ns] || !(new Keychain(DATA)).get(ns)) {
    out(Y + '  no key for ' + ns + ' - /models shows what you have' + R + '\n');
    return;
  }
  model = id;
  try { fs.writeFileSync(path.join(DATA, 'cli-model.json'), JSON.stringify({ model: id, ts: Date.now() })); } catch {}
  out(G + '  model switched to ' + id + R + '\n');
}

async function askPerm(req) {
  const a = await subLine(); // if stdin died, this resolves '' -> deny safely
  return /^y(es)?$/i.test((a || '').trim());
}
async function askUser(q) {
  return (await subLine()).trim();
}

async function chatTurn(input) {
  busy = true;
  convo.push({ role: 'user', content: input });
  out(G + 'krait > ' + R);
  let streamed = '';
  try {
    if (agentMode) {
      const res = await runAgent({
        modelId: model,
        messages: convo.slice(),
        opts: { mode: 'normal', effort: 'medium', enabledTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch'], projectDir: process.cwd() },
        sendDelta: d => { streamed += d; out(d); },
        sendTool: info => { if (info.status === 'done') out(Y + '\n  [' + info.name + '] ' + (info.summary || '') + R + '\n'); },
        askPermission: askPerm,
        askUser,
        streamChat,
      });
      const finalText = (res && res.text) || streamed;
      if (finalText) convo.push({ role: 'assistant', content: finalText });
      if (res && res.usage && res.usage.total) out(DIM + '  (' + res.usage.total + ' tok)' + R + '\n');
    } else {
      const res = await streamChat(model, convo, d => { streamed += d; out(d); }, null, { effort: 'medium' });
      out('\n');
      if (res.usage && res.usage.total) out(DIM + '  (' + res.usage.total + ' tok)' + R + '\n');
      convo.push({ role: 'assistant', content: res.text || streamed });
    }
  } catch (e) {
    out('\n' + Y + '  error: ' + e.message + R + '\n');
  }
  out('\n');
  busy = false;
}

function bye() { out('\n' + DIM + '  bye - krait by Avepier' + R + '\n'); process.exit(0); }

async function repl() {
  while (true) {
    const line = await nextLine(agentMode ? Y + 'task > ' + R : G + 'you > ' + R);
    const input = (line || '').trim();
    if (closing && !input) return bye();
    if (!input) continue;
    if (input === '/exit' || input === '/quit') return bye();
    if (input === '/help') { help(); continue; }
    if (input === '/clear') { convo = []; out(DIM + '  context cleared' + R + '\n'); continue; }
    if (input === '/models') { listModels(); continue; }
    if (input.startsWith('/model ')) { switchModel(input.slice(7).trim()); continue; }
    if (input === '/agent') {
      agentMode = !agentMode;
      out(DIM + '  agent mode ' + (agentMode ? 'ON - I can use file tools (asks first). Works in ' + process.cwd() : 'off') + R + '\n');
      continue;
    }
    await chatTurn(input);
    if (closing) return bye();
  }
}

function main() {
  model = pickDefault();
  if (!model) {
    out('\n' + Y + '  No API keys found.' + R + '\n');
    out('  Open the krait desktop app once and add a key under Settings > API keys.\n');
    out('  Keys are stored encrypted in ' + DATA + '\n\n');
    process.exit(1);
  }
  rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  wireInput();
  banner();
  repl().catch(e => { out('\n' + Y + 'fatal: ' + e.message + R + '\n'); process.exit(1); });
}
main();
