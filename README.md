# Chief of Staff

An AI-assisted work manager for Windows and Mac. It replaces Microsoft To Do: tasks, projects, people, and a waiting-on list, ranked by a transparent priority score.

**The AI only proposes; you decide.** Nothing is sent or changed without your approval, and drafts are never sent automatically.

## Stack

- Electron 45 (Node 24) app shell: its own window and installer, not a browser tab
- React 19 + TypeScript UI, built with electron-vite
- SQLite through Node's built-in `node:sqlite`, so there's no native module to compile
- Vitest for tests

## Layout

| Path | What |
|---|---|
| `src/shared` | Domain types, priority engine, the main/renderer API contract |
| `src/main` | Electron main process: database and migrations, services, backup, settings, IPC |
| `src/preload` | Exposes the API to the UI as `window.cos` (sandboxed, nothing else) |
| `src/renderer` | The UI (screens, task editor, split view, command palette) |
| `tests` | Priority engine and data-service tests against a real temporary database |
| `design` | The approved clickable prototype |

## Commands

```bash
npm install
npm run dev           # run with hot reload
npm run demo:data     # fill the dev copy with made-up test data (your dev data is moved aside, not deleted)
npm test              # unit and data tests
npm run bench:ai      # compare AI models on sample imports (bench/README.md)
npm run typecheck
npm run install:win   # build the app into %LOCALAPPDATA%\Programs\Chief of Staff (build)
npm run package:win   # Windows installer in release/
npm run package:mac   # Mac .dmg (run on a Mac)
```

## Data

- **Database and settings:** `%APPDATA%\Chief of Staff` on Windows, `~/Library/Application Support/Chief of Staff` on Mac.
- **Backups:** a daily snapshot goes to `OneDrive\Chief of Staff Backups` (configurable), keeping the last 30.
- **Test data folder:** set `COS_DATA_DIR` to run against a separate folder.

## For AI assistants and new contributors

Start with [AGENTS.md](AGENTS.md), which covers the rules, architecture, conventions and how to make common changes. Then read [docs/ROADMAP.md](docs/ROADMAP.md) for what's built and what's next, and [docs/DECISIONS.md](docs/DECISIONS.md) for why. End-to-end tests are described in [e2e/README.md](e2e/README.md).
