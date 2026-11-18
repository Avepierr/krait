# krait v2.0.0 — accounts, Showcase, and your own panel

krait is still free, still runs on your own API keys, and still by Avepier.
v2 adds an **optional** online layer: nothing about it is required to use the app.

## Online accounts + chat sync
- **Settings → Account → Online account**: create an account (email + password + username) or sign in. "Skip for now" still exists — guests lose nothing.
- **Chat sync**: flip one switch and every chat saves to your account as you talk, then reopens from any PC. Turn it off any time; local chats stay local.
- **Saved chats** appear under the switch with an Open button, newest first.

## Showcase
- Browse creations people shared from krait (apps, games, chats).
- Like a post, report something bad, or share the chat you are in with one button.
- Owner takedowns remove a post from the Showcase for everyone.

## Owner panel (Avepier only, enforced by the database)
- Reports queue with one-click close.
- User list with ban / unban and a reason the user sees when banned.
- Post takedowns.
- The first account that signs up with the username `Avepier` becomes the owner. Admin and ban fields can only be changed by an admin — the database rejects everything else, not just the UI.

## Also new
- Models answer as who they really are ("I'm GLM by Z.ai") and mention they are running in krait by Avepier. krait is the app, not the AI.
- Startup update popup: when a newer version is published here, krait offers a Download now / Later choice.
- Footer and `/about` show v2.0.0.

## Your keys
API keys stay on your PC, encrypted in `~/.krait/keys`. The online layer only ever stores chats, posts, likes and reports — never keys.

**Downloads:** win-x64 for most PCs, win-ia32 for 32-bit Windows.
Unzip, run `install.ps1`, no admin needed.
