# krait — Study SPEC.md

> Built from study of Claude Code CLI v2.1.310, Claude Desktop app v5.11492.5,
> official docs (49 pages), and static ASAR inventory.

---

## 1. Full feature inventory

Each item: what the user sees, what happens behind it, and one end-to-end test.

### A. Harness/engine

| # | Feature | Seen? | What user sees | What happens behind it | E2E test |
|---|---------|-------|----------------|------------------------|----------|
| 1 | Interactive REPL session | Confirmed | Shell prompt with readline, streaming replies, tool-call cards, Enter to send | Node.js process reads stdin line by line, composes system prompt (env/git/memory), sends to model API, streams SSE deltas, deserializes tool calls, executes tools, loops | Start `krait`, type "list files", see reply appear word by word |
| 2 | Print mode (`-p` / `--print`) | Confirmed | Single-shot: send prompt, get text or JSON reply, exit | Same loop but stdin closes after first prompt, `--output-format json` returns structured result | `krait -p "hello" --output-format json` |
| 3 | Stream-json output | Confirmed | Line-delimited JSON events for each turn/tool/result | stdout writes `{type:"text",text:"..."}` then `{type:"tool_use",...}` then `{type:"tool_result",...}` | Pipe output to a file, verify JSON lines |
| 4 | Tool: Read | Confirmed | Claude reads a file, shows its contents | Reads file, returns lines up to limit, shows PARTIAL notice for large files | Ask Claude to read a 500-line file |
| 5 | Tool: Write | Confirmed | Claude creates/overwrites a file | Writes content to path, returns path + digest | "Create a hello.txt with Hello" |
| 6 | Tool: Edit | Confirmed | Claude replaces exact text in a file | Finds old_string (exactly once), replaces with new_string, validates uniqueness | "Change 'hello' to 'world' in hello.txt" |
| 7 | Tool: Bash | Confirmed | Claude runs a shell command | Spawns subprocess with timeout, streams output back, handles background | "Run node --version" |
| 8 | Tool: Glob | Confirmed (docs) | Claude finds files by pattern | Uses glob matching, returns sorted by mtime, capped at 100 | "Find all .md files" |
| 9 | Tool: Grep | Confirmed (docs) | Claude searches file contents | Uses ripgrep beneath, supports regex/file-type/multiline | "Search for 'TODO' in src/" |
| 10 | Tool: WebFetch | Confirmed (docs) | Claude fetches a URL | HTTP GET, returns markdown | "Fetch https://example.com" |
| 11 | Tool: Agent (subagent) | Confirmed (docs) | Claude spawns a child agent | New agent loop in own context, runs task, returns summary | "Use a subagent to research this code" |
| 12 | Tool: TodoWrite / Task | Confirmed (docs) | Claude manages a task list | CRUD on JSON checklist in session state | "Create a checklist for this task" |
| 13 | Tool: Skill | Confirmed (docs) | Claude runs a skill | Loads .md skill file, executes prompt | /skill-name |
| 14 | Tool: MCP (ListMcpResourcesTool, ReadMcpResourceTool) | Confirmed (docs) | Claude uses external MCP tools | Stdio or HTTP MCP server, tools/resources exposed to model | Connect an MCP server, use its tools |
| 15 | Tool: AskUserQuestion | Confirmed (docs) | Claude asks a multiple-choice question | Renders choices, user picks one, response fed back to model | "I need to decide: X or Y?" |
| 16 | Tool: LSP | Confirmed (docs) | Claude gets code intelligence | Language server protocol over stdio, type errors after edits | "Show me type errors in this file" |
| 17 | Tool: SendMessage | Confirmed (docs) | Claude messages another session | Cross-session messaging, local or remote | "Message the other session about my change" |
| 18 | Tool: NotebookEdit | Confirmed (docs) | Claude edits Jupyter cells | Reads/writes ipynb cells | "Edit the first cell in notebook.ipynb" |
| 19 | Tool: Monitor | Confirmed (docs) | Claude watches a running command's output | Spawns command, feeds each line back as event | "Watch npm test for failures" |
| 20 | Tool: PowerShell | Confirmed (docs) | Claude runs PowerShell | Same as Bash but with powershell.exe | "Get-ChildItem" |
| 21 | Tool: CronCreate/List/Delete | Confirmed (docs) | Claude schedules recurring prompts | Session-scoped timer, fires prompt at intervals | "Check every 5 mins if the build finished" |
| 22 | Tool: Workflow | Confirmed (docs) | Claude runs a dynamic workflow | Multi-agent orchestration script, runs subagents and cross-checks | "Run a codebase audit workflow" |
| 23 | Tool: ExitPlanMode | Confirmed (docs) | Claude presents a plan for approval | Shows diff/summary, user approves, then executes | "Plan this refactor and present it" |
| 24 | Tool: EnterPlanMode | Confirmed (docs) | Claude switches to plan-only mode | Read-only: Claude reads files, proposes approach, doesn't edit | "Plan mode: how would you refactor this?" |
| 25 | Context management | Confirmed (docs) | Token accounting, auto-compaction, system prompt | Compose system prompt from env/memory/git status. When near limit, compact by summarizing earlier conversation. | Start long conversation, see `/context` stats, `/compact` works |
| 26 | Session persistence | Confirmed (docs) | Transcript saved as JSONL, resume by ID | Every message/tool/result written to session dir, can load on resume | Start session, exit, `krait --resume <id>` |
| 27 | Session list/rename/delete | Confirmed (docs) | `/resume` shows picker, `/rename` names it | Read session dirs, display metadata, rename by editing metadata | Start 3 sessions, list them, rename one |
| 28 | Config hierarchy | Confirmed (docs) | user > project > local settings | Load JSON files from ~/.krait/, .krait/, .krait/local.json, merge with env vars | Set a project-level permission, verify it applies |
| 29 | Project memory (CLAUDE.md) | Confirmed (docs) | Claude reads KRAT.md at session start | Load `KRAT.md` or `AGENTS.md` from project root, inject into system prompt | Create KRAT.md, start session, Claude follows rules |
| 30 | Permission modes | Confirmed (docs) | Manual / Accept edits / Plan / Auto / Bypass | Per-tool allow/ask/deny rules, command-pattern matching, mode switch mid-session | Switch modes, verify Claude asks or not |
| 31 | Permission prompts | Confirmed (docs) | Allow once / Always allow / Deny card | Before tool execution, check rules. If ask mode, prompt user. | Claude tries to write a file in Manual mode |
| 32 | Hooks | Confirmed (docs) | Shell scripts at lifecycle points (SessionStart, PreToolUse, PostToolUse, Stop) | Source shell script, pass JSON on stdin, read result for block/annotate | Create a PostToolUse hook that formats files |
| 33 | Effort levels | Confirmed (docs) | low/medium/high/xhigh/max | Model-specific extended thinking budget | `/effort max` then ask a hard question |
| 34 | Model switching | Confirmed (docs) | Switch model mid-session | New model starts after compaction | Start with small model, switch to larger one |
| 35 | Subagents with tool restrictions | Confirmed (docs) | tools/disallowedTools frontmatter | Agent tool filters the available tools for child | Create a subagent with Bash blocked |
| 36 | Worktrees (git) | Confirmed (docs) | Isolated git checkout | `git worktree add`, session works in separate branch | Start session with --worktree |
| 37 | Checkpointing / rewind | Confirmed (docs) | Rewind conversation and/or code to a point | Save checkpoints at key moments, restore on `/rewind` | Make changes, `/rewind`, verify files revert |

### B. Desktop Code view

| # | Feature | Seen? | What user sees | Behind it | E2E test |
|---|---------|-------|----------------|-----------|----------|
| 38 | Session list sidebar | Confirmed (docs) | Left panel listing all sessions per project, grouped, sortable | Read session dirs, render list, click to switch | Open 3 sessions, see them listed |
| 39 | Main conversation column | Confirmed (docs) | Scrollable chat with user/assistant/tool messages, streaming text | Render message array, delta-update on stream | Send message, see reply form |
| 40 | Composer (prompt box) | Confirmed (docs) | Multiline input, + button for files/skills, mode/model chips, send/stop | Textarea with Enter to send, Shift+Enter newline, Esc to stop | Type "hello", Enter, see it send |
| 41 | Mode selector | Confirmed (docs) | Permissions chips under prompt box: Manual, Accept edits, Plan, Auto | Dropdown that sets permission mode | Switch from Manual to Accept edits |
| 42 | Model picker | Confirmed (docs) | Dropdown showing available models, favorites, search | Fetch model list from provider API, filter/search | Open model picker, search for a model |
| 43 | Diff/changes panel | Confirmed (docs) | Unified diff view of file changes, per-file accept/revert | Compute git diff or tracked-changes diff, render with syntax | Make a change, open diff panel |
| 44 | Terminal panel | Confirmed (docs) | Integrated terminal in session directory | xterm.js or similar in an HTML element | Click Terminal button, see shell prompt |
| 45 | Browser pane | Confirmed (docs) | Tabbed browser for previewing app and external sites | Embedded iframe or Chromium, dev servers list | "Preview my app" |
| 46 | Session detail panel (rail) | Confirmed (docs) | Cards showing environment, changes, running tasks, context usage | Rendered sidebar cards, toggle with button | Hover over session rail |
| 47 | Side chat | Confirmed (docs) | Separate chat panel that uses session context, doesn't affect main thread | Second message thread, shared context from main, no persistence | Cmd+;, ask a side question |
| 48 | File pane | Confirmed (docs) | Open files inline, auto-save, or manual save | Monaco or CodeMirror editor in pane | Click a file path, see it open |
| 49 | Session title / rename | Confirmed (docs) | Click title to rename | Editable title field in title bar | Click session title, type new name |
| 50 | Notifications on finish | Confirmed (docs) | OS notification when task completes | Electron notification API | Run task, tab away, see notification |
| 51 | Keyboard shortcuts | Confirmed (docs) | Cmd+N new, Cmd+W close, Cmd+\ close pane, Esc stop | Window-level key bindings | Press Cmd+N, see new session created |
| 52 | Archives | Confirmed (docs) | Archived tab, auto-archive on PR merge | Move session to archive dir, clean up worktree | Archive a session, find it in Archived |
| 53 | SSH sessions | Confirmed (docs) | Remote machine project, no browser/auto-verify | SSH connection, remote Claude CLI over SSH | Add SSH environment, start session |
| 54 | WSL session | Confirmed (docs) | Session inside WSL distro | WSL integration paths | Start WSL session from menu |
| 55 | PR monitoring | Confirmed (docs) | PR status in session details, auto-fix/merge | `gh` CLI integration, poll for CI status | Create PR, see CI card |
| 56 | Cowork/Dispatch | Confirmed (docs) | Start a session from phone, pick up on desktop | Remote start via claude.ai | Send a Dispatch task from phone |
| 57 | Side-by-side sessions | Confirmed (docs) | Split view with two sessions next to each other | Two Electron webviews or views | Cmd+click a session in sidebar |

### C. krait-specific features

| # | Feature | What user sees | Behind it |
|---|---------|----------------|-----------|
| 58 | Keys screen | First-run screen: paste API keys per provider, test connection, see masked keys | Encrypted storage outside project, os-level keychain, "Test" button makes model-list API call |
| 59 | Model-agnostic providers | Model picker shows Gemini / OpenRouter / NVIDIA / Anthropic models | Provider adapters: OpenAI-compatible, Gemini API, Anthropic API |
| 60 | Free tiers | Works with Gemini free, OpenRouter free, NVIDIA trial | No mandatory Anthropic subscription; key validation checks free model access |
| 61 | krait snake mascot | Blocky Mint Green + Black SVG avatar by AI messages | Pure inline SVG, no image files, 28-40px |
| 62 | krait icon + branding | KraitLogo.png in window/taskbar, no Claude/Anthropic anywhere | Electron window icon from assets/icon.png |
| 63 | Under-2-second cold start | Window interactive in < 2 seconds | Lazy loading, no framework, minimal preload |
| 64 | Self-check / pretend AI | Automated test: reads no key, drives app end to end, saves screenshot + errors + time + memory | Internal loopback model stub that returns predefined tool calls |
| 65 | Encrypted keys | Keys never shown full after save, stored encrypted outside project folder | OS keychain or encrypted file with AES |

---

## 2. Build plan

### Part 1 — The engine + basic window

**Deliverable:** A working `krait` CLI tool that can:
- Start an interactive REPL session
- Run in print mode with --output-format json
- Connect to any provider (Gemini, OpenRouter, NVIDIA, Anthropic)
- Use system prompt with memory file
- Execute Read, Write, Edit, Bash, Glob, Grep, WebFetch tools
- Save/load sessions
- And a basic Electron window showing: Keys screen + model picker + chat input + streaming output

**Files:**
```
krait/                    # Electron app (krait.cmd)
├── src/
├── package.json
├── main.js                   # Main process (electron
├── assets/
├── icon.png                   # Already done:

```
```
v0.1.0
 + study/inventory/docs/*.md + inventory
```

**Check:** `krait --print "hello world"` returns JSON, Electron window opens under 2s

### Part 2 — Permissions, modes, sessions, panels

**Deliverable:** Full permission system, session management, project memory, diff/terminal panels

**New files:**
```
krait/
├── src/
├── electron/
├── main.js
├── renderer/                 # Code view HTML/ CSS/ JS
├── ...

**Check:** `/permissions`, `/resume`, `/compact`, `/diff` all work. Self-check passes.

### Part 3 — Everything else: desktop parity + checklist

- All remaining features from inventory
- Desktop app with custom icon, taskbar, installer, desktop shortcut
- Screenshot comparison with REA -> fix differences -> 90% visual parity
- Run full CHECKLIST.md: every feature ticked or crossed, zero crosses
- v1.0.0 release commit