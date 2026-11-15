# AGENTS.md — krait repository rules (every session)

These rules apply to every session in this repository, without exception.

## Work rules

1. **Do everything yourself. Never ask the user anything.** Announce each step
   in one line before doing it.
2. **Never say something is saved or working unless a check shows it.** Run the
   check, show the evidence, then state the fact.
3. **Write your own code.** Never copy code or built-in instructions from
   Claude Code or the Claude app.
4. **Stack: Electron with plain HTML, CSS, and JavaScript.** No React, no build
   tools, no packages that need compiling.
5. **Keep it fast.** Tools that do not depend on each other run at the same
   time. Nothing loads until it is needed. The window opens in under 2 seconds
   and reply words show the moment they arrive.
6. **Never run anything that keeps running in the foreground.** Start the app
   and any servers in the background.
7. **Keys are saved encrypted on this computer, outside this folder, and are
   never shown in full.**
8. **Self-check after every change.** A pretend AI that needs no key drives the
   real app end to end, saves a screenshot, every error, the start time, and
   the memory use in the `checks/` folder, then closes the app. Run it after
   every change and fix every error before moving on.
9. **Save a version each time a feature works** (git commit).

## Study rules

- Never open the user's other Claude chats.
- Never put screenshot data in the chat; screenshots are saved as files in the
  `study/` folder only.
- Never change the installed Claude app; unpack copies into `study/` instead.
- Before using any REA tool or engine, print one line: which one and why.
  If an engine is missing, print its name and official page, install it from
  there, and check that it works. If it needs the user's password, stop and
  tell them.
- Use REA inside the Claude program only for what the official docs, help
  text, shipped tool descriptions, and print-mode test runs do not show.
