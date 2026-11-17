krait - free AI coding agent - by Avepier
==========================================

WHAT IS KRAIT?
  - a desktop app to chat and build with AI models (bring your own FREE api keys)
  - a `krait` command for PowerShell/CMD: chat and a coding agent right in your terminal
  - everything has a free option: OpenRouter free models, Gemini, Groq, Cerebras,
    NVIDIA, or Ollama (runs locally on your own PC, unlimited, no key at all)

WHICH ZIP DO I DOWNLOAD?
  krait-...-win-x64.zip   -> most PCs (64-bit Windows)
  krait-...-win-ia32.zip  -> older 32-bit Windows
  Not sure? Settings > System > About: if it says "64-bit operating system" pick x64.

HOW TO INSTALL (no admin rights needed)
  1. unzip the zip anywhere (e.g. your Downloads folder)
  2. open the krait folder
  3. right-click install.ps1 > Run with PowerShell
     If Windows blocks scripts, open PowerShell in that folder and run:
       powershell -ExecutionPolicy Bypass -File install.ps1
  4. done. Start Menu > krait opens the desktop app,
     and typing `krait` in PowerShell starts a chat right in the terminal.

FIRST RUN - GET A FREE KEY (2 minutes, no credit card)
  1. open krait > Settings > API keys
  2. make a free account at openrouter.ai and copy your key
  3. paste it under OpenRouter - free models are picked automatically

TERMINAL CHEAT SHEET
  krait                 chat right here in the terminal
  krait app             open the desktop app window
  krait --version       print the version
  /agent                terminal agent mode: reads/writes files in this folder, asks first
  /models               list your models        /model <id>  switch model
  /theme <color>        change the terminal accent (green cyan purple pink orange red blue white)
  /effort low|medium|high, /update, /clear, /help, /exit

UNINSTALL
  Windows Settings > Apps > krait > Uninstall
  (or run uninstall.ps1 from the install folder)

PRIVACY
  Your keys are encrypted on YOUR pc. krait has no server of its own -
  your chats go from your pc straight to the model provider you picked.

krait by Avepier - free, model-agnostic, plain HTML/CSS/JS under the hood.
