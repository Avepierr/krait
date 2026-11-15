#!/usr/bin/env node
/**
 * krait CLI — entry point for print mode and interactive sessions.
 * Everything runs from this file when invoked as `krait`.
 * 
 * AGENTS.md rules:
 * - Stack: plain JS, no React, no build tools
 * - No dependencies that need compiling
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const { Harness } = require('./harness');
const { SessionStore } = require('./session');
const { Keychain } = require('./keychain');

const DATA_DIR = path.join(require('os').homedir(), '.krait');

async function main() {
  const args = process.argv.slice(2);
  const flags = parseFlags(args);

  // Ensure data directories
  fs.mkdirSync(path.join(DATA_DIR, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'keys'), { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'config'), { recursive: true });

  const keychain = new Keychain(DATA_DIR);
  const sessionStore = new SessionStore(DATA_DIR);

  // Handle print mode (-p / --print)
  if (flags.print) {
    const prompt = flags._.join(' ') || '';
    const harness = new Harness({ keychain, sessionStore, format: flags['output-format'] || 'json' });
    const result = await harness.runOnce(prompt, flags);
    if (flags['output-format'] === 'json' || flags['output-format'] === 'stream-json') {
      process.stdout.write(JSON.stringify(result));
    } else {
      process.stdout.write(result.text || '');
    }
    process.exit(result.isError ? 1 : 0);
  }

  // Interactive mode (default)
  const harness = new Harness({ keychain, sessionStore, format: 'text' });
  await harness.startInteractive(flags);
}

function parseFlags(args) {
  const flags = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-p' || arg === '--print') { flags.print = true; continue; }
    if (arg === '--output-format') { flags['output-format'] = args[++i]; continue; }
    if (arg === '--model') { flags.model = args[++i]; continue; }
    if (arg === '--resume' || arg === '-r') { flags.resume = args[++i] || true; continue; }
    if (arg === '--continue' || arg === '-c') { flags.continue = true; continue; }
    if (arg === '--name' || arg === '-n') { flags.name = args[++i]; continue; }
    if (arg === '--help' || arg === '-h') { printHelp(); process.exit(0); }
    if (arg === '--version' || arg === '-v') { console.log(require('../../package.json').version); process.exit(0); }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq > 0) { flags[arg.slice(2, eq)] = arg.slice(eq + 1); }
      else { flags[arg.slice(2)] = args[++i] || true; }
    } else {
      flags._.push(arg);
    }
  }
  return flags;
}

function printHelp() {
  console.log(`krait — Free, model-agnostic coding agent

Usage: krait [options] [prompt]

Options:
  -p, --print                 Print response and exit
  --output-format <format>    Output format: text, json, stream-json
  --model <model>             Model to use (provider/model-id)
  -r, --resume [id]           Resume a session
  -c, --continue              Continue the most recent session
  -n, --name <name>           Set session name
  --help, -h                  Show help
  --version, -v               Show version

For the desktop app, run: npx electron .
`);
}

if (require.main === module) {
  main().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}