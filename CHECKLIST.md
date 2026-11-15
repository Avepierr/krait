# krait — CHECKLIST

Status legend: [x] done & verified · [~] works, some limits · [ ] not yet

## Harness engine
- [x] Model-agnostic chat: Gemini, OpenRouter, NVIDIA, Anthropic
- [x] Streaming replies word-by-word (real SSE)
- [x] Real token usage per reply + all-time per API (from providers)
- [x] Tools: Read, Write, Edit, Bash, Glob, Grep, WebFetch (Windows-safe)
- [x] Agent loop: model calls tools, results fed back, up to 6 rounds
- [x] Tolerant tool-call parsing (fenced + bare JSON fallback)
- [x] Permission popups before Write/Edit/Bash (native dialog)
- [x] Modes: Normal / Plan (blocks changes) / Auto / Bypass
- [x] Effort levels incl. Max + Ultracode with token warning
- [x] Project memory: KRAIT.md / AGENTS.md injected into system prompt
- [x] Sessions saved to disk, resumable from sidebar, deletable
- [x] CLI: `node src\engine\cli.js` (print mode, model, resume)
- [~] MCP client: stdio JSON-RPC connect/list/call — verified vs test server; UI lets you add + test servers; MCP tools not yet exposed to the model automatically

## Code view (desktop)
- [x] Custom frameless window, krait branding, snake mascot (inline SVG)
- [x] Markdown rendering: bold, lists, code blocks, links, headers
- [x] Tool-call JSON hidden during streaming (shows "⚙ using tool...")
- [x] Your own messages visible (fixed)
- [x] Paste screenshots (Ctrl+V) + attach button, thumbnails in chat
- [x] Vision auto-switch: picks a vision model when images attached
- [x] Artifact cards: files the AI creates show Open + Download buttons
- [x] Real E2E: "make a spreadsheet" → real CSV created → downloadable
- [x] Real E2E: "make a game" → real HTML game created → downloadable
- [x] Skills: Excel maker, Game maker, Web research (toggleable)
- [x] Projects: add folders, switch active project, own memory per project
- [x] Terminal panel (hidden by default, >_ button), runs in active project
- [x] Keys screen (gear + first run), keys encrypted at ~/.krait/keys, never shown in full
- [x] Settings: Account / Appearance / API keys / Usage / Capabilities / Plugins / Skills / Connectors / MCP
- [x] Appearance: dark (default) + white theme, instant switch
- [x] Plugins: Yours + Discover tabs, search, community plugins installable
- [x] Profile block bottom-left with menu
- [x] Model switch notice in chat
- [~] 90% visual parity with Claude Code: structure/layout done; pixel-level screenshot diff vs real Claude Code not run (needs side-by-side captures)

## Desktop install
- [x] Valid .ico built from KraitLogo (00 00 01 00 header verified)
- [x] Start Menu shortcut verified on disk
- [x] Desktop shortcut verified on disk (OneDrive-aware path)
- [x] Hidden-console launcher (krait-launch.vbs)
- [~] Taskbar icon shows generic Electron while app runs (AUMID icon registration needs a real .exe)

## Known limits (honest)
- [ ] Free OpenRouter models come and go; picker list may need refresh over time
- [ ] MCP tools not auto-offered to the model yet (config + test UI done)
- [ ] Connectors (GitHub/Drive) are placeholders
- [ ] Pixel-perfect Claude Code screenshot diff not performed
