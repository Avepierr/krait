# krait — feature specification

krait is a from-scratch, fully free, model-agnostic alternative to Claude Code:
its own harness engine plus a desktop app whose main screen is a Code view.

Nothing in krait may carry the Claude or Anthropic name or logo. The product name
is **krait**.

---

## 1. The krait harness (engine)

### 1.1 Mission
One engine that drives any capable language model through an agentic coding
loop — free to run, no subscription, no Anthropic account required.

### 1.2 Provider layer (model-agnostic)
- Adapters for **Google Gemini**, **OpenRouter**, and **NVIDIA** (NVIDIA API
  Catalog, OpenAI-compatible), all authorized by user-supplied API keys.
- Any model each provider offers, fetched live from the provider's model list,
  selectable per session, switchable mid-chat without losing context.
- **Real Claude models** also supported (Claude Code models) through the user's
  own Anthropic credentials — krait is the harness; it is not affiliated with
  Anthropic.
- Uniform streaming: text deltas and tool-call deltas stream to the UI as they
  arrive; no buffering until a full reply completes.
- Uniform tool calling across OpenAI-compatible chat APIs, Gemini's native
  format, and Anthropic's Messages format.

### 1.3 Agent loop (same working behavior as Claude Code)
- One turn = model request -> tool calls executed -> results fed back ->
  repeat until the model produces a final answer.
- Independent tool calls run in parallel; dependent ones run in order.
- Context management: token accounting, automatic compaction near the model's
  limit, system-prompt composition (environment, working directory, git status
  snapshot, project memory files).
- Failure handling: bounded retries with backoff, tool errors fed back to the
  model as results, loop guards, user interrupt (Esc) cancels in-flight work.

### 1.4 Tools (complete inventory)
- **Shell**: run commands in the session working directory with timeout,
  background execution, output streaming, output truncation with paging.
- **Files**: read (text, with line ranges), write, edit (exact string
  replacement with uniqueness enforcement), multi-edit, list directory, glob,
  grep (regex search with file filters), diff preview.
- **Planning**: todo list write/read (live checklist in the UI).
- **Subagents**: task tool that spawns a child loop with a scoped tool subset
  and returns its final report.
- **Web**: fetch a URL to markdown; optional provider-native web search.
- **Vision**: read image files for models that accept image input.
- **Notebooks**: read and edit cell contents.
- **MCP**: client for Model Context Protocol servers (stdio + HTTP/SSE),
  exposing server tools/resources to the model.
- **CLI-level behaviors**: slash commands, print mode, structured event
  stream, session resume/fork.

### 1.5 Command-line mode
- Interactive REPL mode and one-shot print mode (`krait -p "..."`).
- Structured output: stream-json events, final JSON, meaningful exit codes.
- Session flags: continue, resume, fork, rename.
- Provider/model selection flags; permission-mode flags; allowed/disallowed
  tool flags; append-system-prompt; max turns; verbose/debug.
- Config hierarchy: user settings, project settings, local project settings,
  environment variables, hooks definitions, MCP config files.

### 1.6 Sessions and memory
- Every session stored as a JSONL transcript (messages, tool calls, tool
  results, metadata) under the user's data directory.
- Session list, rename, delete, resume, fork.
- Project memory: `KRAT.md` files at user/project/local scope, plus
  `@file` imports — krait's own equivalent of CLAUDE.md.

### 1.7 Permissions and modes
- Per-tool policies: allow / deny / ask.
- Command-pattern rules for the shell tool (prefix and wildcard matching).
- Permission prompts: Allow once / Always allow / Deny, with the proposed
  action shown before execution.
- Modes: default (ask), accept-edits, plan (read-only research), and a
  dangerous bypass mode behind an explicit confirmation.
- Project-level allowlists that persist across sessions.

### 1.8 Hooks
- Shell hooks at lifecycle points: session start/end, user prompt submit,
  pre-tool-use, post-tool-use, notification, stop.
- Hooks receive a JSON payload on stdin and can block or annotate actions.

### 1.9 Free requirement
Zero mandatory paid dependencies. Every feature works with free API tiers
(Gemini free tier, OpenRouter free models, NVIDIA trial credits) and does not
require any Anthropic subscription.

---

## 2. The Code view (krait desktop app)

The desktop app's main screen is krait's **Code view** — a working replication
of the layout and flow of the Claude Code desktop experience:

- **Window**: custom frameless titlebar with krait branding; native Windows
  window controls; remembered window size/position; the Krait icon in the
  window and the taskbar.
- **Left sidebar**: project/folder selector at top, session list below
  (grouped by project, with rename/delete/new-chat actions), collapse toggle.
- **Main conversation column**: message stream (user, assistant, tool calls,
  tool results), streaming text while the model replies, tool-call cards with
  status (running/done/failed) and expandable output.
- **Composer** (bottom): multiline input, attach/context chips, mode chip
  (default / accept-edits / plan), model chip, permission chip, send/stop
  buttons, keyboard shortcuts (Enter to send, Shift+Enter newline, Esc stop).
- **Changes panel**: unified diff view of every file change made by tools,
  with per-file accept/revert actions.
- **Terminal panel**: live stream of shell commands and their output.
- **Files panel**: the session's touched files with quick open.
- **Empty state**: project picker and quick-start prompts, matching the real
  app's flow.

---

## 3. Visual parity

- The Code view must look **at least 90% the same** as the real Claude Code
  desktop view: same layout structure, same panel arrangement, same
  proportions and sizes, same interaction flow.
- Parity is measured in the final phase by comparing screenshots of both
  apps with REA and fixing the biggest differences until the target is met.
- All copy, text, and labels are krait's own; no Claude or Anthropic strings
  appear anywhere in the UI.

---

## 4. Keys screen and models

- A dedicated **Keys screen** (first-run and reachable from settings):
  - Paste an API key per provider: Gemini, OpenRouter, NVIDIA, and optional
    Anthropic for real Claude models.
  - Keys are validated against the provider (a cheap model-list call) before
    being accepted.
  - Saved keys are stored **encrypted on this computer, outside the project
    folder** (OS-level encryption), and are never displayed in full again —
    only a masked preview.
  - Delete/replace a key any time; test connection button per provider.
- **Model picker**: provider tabs, live model list per provider with search,
  favorites, and capability labels (context size, tools, vision); switching
  models mid-chat keeps the conversation.

---

## 5. Speed

- Cold start: window is interactive in **under 2 seconds**.
- Streaming: reply words render the moment they arrive; no artificial
  delays or full-response buffering.
- Nothing loads until needed: panels, model lists, and tools initialize
  lazily; independent initialization runs in parallel.

---

## 6. Name and icon

- Product name: **krait** — in the window title, taskbar, installer, menus,
  and files.
- App icon: the saved `KraitLogo.png` from Downloads — used for the window
  icon and the taskbar icon (multi-size ICO derived from it).
- No Claude or Anthropic name, logo, or asset anywhere.

---

## 7. Chat mascot / avatar

- The avatar next to AI messages is **pure inline SVG code** — no image
  files, no external assets.
- Design: a blocky, abstract snake built entirely from solid geometric
  squares and rectangles, in the style of a classic flat tech logo.
- Palette: **Mint Green** and **Black** only.
- Rendered at message-avatar size (~28–40 px), crisp at any scale, with an
  optional subtle idle animation.
