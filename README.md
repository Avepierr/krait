# krait

**free AI coding agent — desktop app + terminal chat — by Avepier**

krait is a free, model-agnostic coding agent. Chat with any AI model from a clean
desktop app, or type `krait` in your terminal and work right there — like ollama,
but with an agent that can read and edit files.

No subscriptions. Everything has a free option: OpenRouter free models, Gemini,
Groq, Cerebras, NVIDIA, or fully local with Ollama.

---

## Why krait

- **Terminal chat that's actually a chat.** `krait` in PowerShell/CMD opens a
  streaming chat with a status line, model picker, themes, and an opencode-style
  logo. `/agent` turns on file tools with `y/N` permission prompts.
- **Free-first.** Free models sort to the top of every list, and when a free
  tier hits its daily limit krait auto-switches you to another free provider
  instead of showing an error.
- **Model-agnostic.** Bring any provider: OpenRouter, Gemini, Anthropic, Groq,
  Cerebras, Mistral, NVIDIA, xAI, DeepSeek, GitHub Models, HuggingFace, custom
  OpenAI-compatible endpoints, or local Ollama.
- **Real desktop app.** Plain HTML/CSS/JS + Electron — no build tools, no
  tracking, no server of its own.
- **Private.** Keys are encrypted on your PC (`~/.krait/keys`). Chats go
  straight from your PC to the provider you picked.

## Install

**Easy way (Windows, no admin needed):** grab a zip from
[Releases](../../releases), unzip, open the `krait` folder, and run
`install.ps1`. You get the desktop app (Start Menu + Desktop) and the `krait`
terminal command in one go. Uninstall any time from Windows Settings > Apps.

- `krait-x.y.z-win-x64.zip` — most PCs (64-bit)
- `krait-x.y.z-win-ia32.zip` — 32-bit Windows (built on Electron 43, the last 32-bit line)

**From source:**

```bat
git clone https://github.com/Avepier/krait
cd krait
npm install
npm start
```

The terminal CLI needs no Node.js installed — it runs on the bundled Electron.

## Terminal cheat sheet

```
krait                  chat right here in the terminal (streaming)
krait app              open the desktop app window
/agent                 agent mode: reads/writes/edits files in this folder, asks first
/models                list models      /model <id>   switch model
/theme <color>         accent color (green cyan purple pink orange red blue white)
/effort low|medium|high                 reasoning effort
/update                check for a new krait version
/clear  /help  /exit
```

## First run — free key in 2 minutes

1. Open krait > Settings > API keys
2. Create a free account at [openrouter.ai](https://openrouter.ai) (no card needed)
3. Paste your key under OpenRouter — free models are picked automatically

Prefer fully local? Install [Ollama](https://ollama.com), pull any model, and
krait finds it — no key, no limits.

## Building a release zip

```powershell
powershell -File krait\package.ps1 -Arch x64    # or -Arch ia32
```

Output lands in `dist/`. `publish.ps1` pushes the repo and uploads both zips
as a GitHub release.

## License

MIT — see [LICENSE](LICENSE). Built by Avepier.
