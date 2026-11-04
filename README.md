# Chief of Staff

An AI-assisted work manager for Windows and Mac. It replaces Microsoft To Do: tasks, projects, people, and a waiting-on list, ranked by a transparent priority score.

**The AI only proposes; you decide.** Nothing is sent or changed without your approval, and drafts are never sent automatically.

## What it does

- **Tasks, Waiting, Projects, People:** lists with a detail pane, search, and keyboard shortcuts (Ctrl+K opens the command palette).
- **Priority score:** each task gets a 0–100 score from its due date, who asked, and how long it has waited. You set the weights in Settings.
- **Import:** paste or drop emails, Teams chats, meeting transcripts, Copilot summaries or notes, and the AI turns them into proposed tasks and updates. [docs/COPILOT-PROMPTS.md](docs/COPILOT-PROMPTS.md) has prompts for getting Teams content out of Copilot.
- **Outlook mail (Windows, classic Outlook):** reads recent mail only when you click, and never sends, moves or flags anything.
- **Review queue:** every AI suggestion waits here until you accept, edit or reject it.
- **Briefs:** each project, task and person keeps a summary, standing instructions and a dated history, so the AI doesn't need things re-explained.
- **AI log:** shows exactly what was sent to the AI, what came back, and what was dropped and why.

## AI providers

| Provider | Where your data goes |
|---|---|
| Demo AI (default) | Nowhere. Simple rules on this computer, for trying out the flow |
| Local model (Ollama) | Nowhere, unless the Ollama address points at another machine |
| Claude (Anthropic API) | Each import's text, plus open-task titles, briefs and names, is sent to Anthropic. Needs an API key, which is stored encrypted |

## Stack

- Electron 45 (Node 24) app shell: its own window and installer, not a browser tab
- React 19 + TypeScript UI, built with electron-vite
- SQLite through Node's built-in `node:sqlite`, so there's no native module to compile
- `@anthropic-ai/sdk` for Claude; Ollama over its HTTP API for local models
- Vitest for tests, plus an end-to-end driver that clicks through the real app

## Layout

| Path | What |
|---|---|
| `src/shared` | Domain types, priority engine, the main/renderer API contract |
| `src/main` | Electron main process: database and migrations, services, backup, settings, IPC, AI providers, Outlook reader |
| `src/preload` | Exposes the API to the UI as `window.cos` (sandboxed, nothing else) |
| `src/renderer` | The UI (screens, task editor, split view, command palette) |
| `tests` | Priority engine, data-service and AI tests against a real temporary database |
| `e2e` | Drives the built app through Chrome DevTools against a throwaway data folder ([e2e/README.md](e2e/README.md)) |
| `bench` | Scores AI providers on made-up sample imports ([bench/README.md](bench/README.md)) |
| `scripts` | `demo-data.mjs`, which fills the dev copy with made-up data |
| `design` | Clickable mockups, one per feature (see below) |
| `docs` | Roadmap, design decisions, and Copilot prompts |

## Design mockups

Every visual change, from a new screen to removing a line of text, starts as a clickable mockup in `design/`. Frank approves it, and then it's built. Each file is a single HTML page with no build step: open it in a browser. They follow your system's light or dark theme.

| File | What it covers |
|---|---|
| `prototype-direction-b.html` | The original whole-app design ("direction B": top tabs, keyboard-first, Ctrl+K palette) |
| `review-projects-people.html` | Review suggestions for projects and people |
| `lists-waiting-done-search.html` | Waiting list, Open/Done switch, list search |
| `people-company-brief.html` | People: company field, filters, one-line brief |
| `project-overview-brief.html` | Projects: overview, status brief and history |
| `projects-archived.html` | Archived projects list |
| `outlook-mail-import.html` | Outlook mail import |
| `text-cleanup.html` | Removing repeated or out-of-date text |

Mockups are kept after they're built, as a record of what was approved. [docs/DECISIONS.md](docs/DECISIONS.md) links to them where it explains Frank's choices.

## Commands

```bash
npm install
npm run dev           # run with hot reload
npm run demo:data     # fill the dev copy with made-up test data (your dev data is moved aside, not deleted)
npm test              # unit and data tests
npm run typecheck
npm run build         # build into out/
npm start             # run the built app from out/
npm run e2e           # build, then click through the real app (slow; see e2e/README.md)
npm run bench:ai      # compare AI models on sample imports (bench/README.md)
npm run install:win   # build the app into %LOCALAPPDATA%\Programs\Chief of Staff (build)
npm run package:win   # Windows installer in release/
npm run package:mac   # Mac .dmg (run on a Mac; not tested yet)
```

npm holds back install scripts, so Electron downloads its binary the first time it runs. You can also run `node node_modules/electron/install.js`.

## Data

- **Database and settings:** `%APPDATA%\Chief of Staff` on Windows, `~/Library/Application Support/Chief of Staff` on Mac. Only the installed app uses this folder.
- **Running from source:** `npm run dev` uses a separate `Chief of Staff (dev)` folder with its own backups, and the status bar shows "Test data".
- **Test data folder:** set `COS_DATA_DIR` to run against a separate folder.
- **Backups:** a daily snapshot goes to `OneDrive\Chief of Staff Backups` (configurable), keeping the last 30. A safety copy is also made before every database upgrade and every restore.
- **Restore:** Settings → Restore from backup. Your current data is saved first, and the app restarts to finish.
- **API keys** are encrypted with the operating system's secure storage and never written to files or logs.

## For AI assistants and new contributors

Start with [AGENTS.md](AGENTS.md), which covers the rules, architecture, conventions and how to make common changes. Then read [docs/ROADMAP.md](docs/ROADMAP.md) for what's built and what's next, and [docs/DECISIONS.md](docs/DECISIONS.md) for why.
