# Session Modal

Standalone session triage UI for OpenCode.

## Goal

Provide a focused cross-project list of sessions that need user attention, with one-click jump into the main desktop app session view.

## Current scope (v0)

- Connects to OpenCode server (defaults to `http://localhost:4096`)
- Loads all projects, then loads sessions per project directory
- Prioritizes sessions with pending permissions/questions at the top
- Shows running sessions near the top
- Opens desktop app via deep link: `opencode://open-session?directory=<dir>&id=<sessionID>`

## Planned follow-up

1. Reuse app notification index so blue-dot semantics exactly match main UI.
2. Add live updates via server event stream.
3. Add keyboard-first command palette interactions.
4. Package as a desktop companion window and launcher command.

## Run

```bash
bun --cwd packages/session-modal dev
```
