# Chief of Staff

An AI-assisted work manager for Windows and Mac. It replaces Microsoft To Do: tasks, projects, people, and a waiting-on list, ranked by a transparent priority score.

**The AI only proposes; you decide.** Nothing is sent or changed without your approval, and drafts are never sent automatically.

## What it does

- **Turns your inbox and meetings into a task list.** Import emails, Teams chats, meeting transcripts, Copilot summaries or notes, and the AI picks out new tasks, status updates, finished work and new people or projects.
- **Keeps you in control.** Every AI suggestion waits in a review queue until you accept, edit or reject it, and you can see exactly what was sent to the AI and what came back.
- **Tells you what to work on next.** Tasks are ranked by a transparent priority score based on due dates, who asked, and how long things have waited.
- **Tracks what you're waiting on.** Items you're waiting on from others stay visible, with how long each has been waiting.
- **Remembers the context.** Every project and person builds up a running history and a short AI-written brief, so the AI never needs things re-explained.
- **Reads Outlook on request.** On Windows with classic Outlook, it can read recent mail when you click, and it never sends, moves or flags anything.
- **Keeps your data local by default.** Everything is stored on your computer, and AI runs locally unless you choose Claude.

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
| `design` | Clickable mockups, one per feature, approved before it was built (open in a browser) |
| `docs` | Roadmap, design decisions, and Copilot prompts |

## Install

**You need:** [Node.js](https://nodejs.org) (the current LTS) and [Git](https://git-scm.com). Clone the repository once:

```bash
git clone https://github.com/fcusano9/chief-of-staff.git
```

### Windows

1. Close Chief of Staff if it's running.
2. In a PowerShell window, get the latest code and build it into `%LOCALAPPDATA%\Programs\Chief of Staff (build)`:

   ```powershell
   cd chief-of-staff
   git switch main
   git pull
   npm install
   npm run install:win
   ```

3. The first time, make a shortcut to `win-unpacked\Chief of Staff.exe` in that folder (for example, pin it to Start). Later updates replace the files in place, so the shortcut keeps working.

Run these from a normal PowerShell or Terminal window, not from inside Claude Desktop: Claude Desktop gives the commands it runs a private copy of `%LOCALAPPDATA%`, so the app would be installed there instead.

To make a regular installer instead, run `npm run package:win`. It writes `Chief of Staff Setup <version>.exe` to `release\`. The installer isn't signed, so Windows SmartScreen may warn before it runs.

### Mac

1. Quit Chief of Staff if it's running.
2. In Terminal, get the latest code and build the disk image:

   ```bash
   cd chief-of-staff
   git switch main
   git pull
   npm install
   npm run package:mac
   ```

3. Open the `.dmg` that appears in `release/` and drag Chief of Staff to Applications, replacing the old copy.

The app isn't signed. If macOS says it can't be opened, go to System Settings → Privacy & Security and click **Open Anyway**.

## Run from source (dev mode)

For working on the app. Dev mode reloads the window as you edit the code, and uses its own `Chief of Staff (dev)` data folder, so your real data is never touched. The status bar shows "Test data".

```bash
npm install
npm run dev
```

To try it with made-up people, projects, tasks and Review suggestions, run `npm run demo:data` first. Any existing dev data is moved aside, not deleted.

The same commands work on Windows and Mac.

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

Every pull request runs the typecheck and unit tests on Windows and Linux (GitHub Actions, `.github/workflows/ci.yml`).

## Data

- **Database and settings:** `%APPDATA%\Chief of Staff` on Windows, `~/Library/Application Support/Chief of Staff` on Mac. Only the installed app uses this folder.
- **Running from source:** `npm run dev` uses a separate `Chief of Staff (dev)` folder with its own backups, and the status bar shows "Test data".
- **Test data folder:** set `COS_DATA_DIR` to run against a separate folder.
- **Backups:** a daily snapshot goes to `OneDrive\Chief of Staff Backups` (configurable), keeping the last 30. A safety copy is also made before every database upgrade and every restore.
- **Restore:** Settings → Restore from backup. Your current data is saved first, and the app restarts to finish.
- **API keys** are encrypted with the operating system's secure storage and never written to files or logs.

## For AI assistants and new contributors

Start with [AGENTS.md](AGENTS.md), which covers the rules, architecture, conventions and how to make common changes. Then read [docs/ROADMAP.md](docs/ROADMAP.md) for what's built and what's next, and [docs/DECISIONS.md](docs/DECISIONS.md) for why.

## License

[MIT](LICENSE). To report a security problem, see [SECURITY.md](SECURITY.md).
