# Chief of Staff

An AI-assisted work manager for Windows and Mac that replaces Microsoft To Do: tasks, projects, people, and a waiting-on list, ranked by a transparent priority score.

**The AI only proposes; you decide.** Nothing changes without your approval, and nothing is ever sent: replies are saved as drafts for you to finish.

## What it does

- **Turns mail, chats, and meetings into tasks.** Import emails, Teams chats, transcripts, Copilot summaries, or notes; the AI proposes new tasks, status updates, finished work, and new people or projects.
- **Keeps you in control.** Every suggestion waits in Review until you accept, edit, or reject it. The AI log shows exactly what was sent and what came back.
- **Tells you what to do next.** A priority score from due date, who asked, and how long it's waited, plus a daily briefing and a weekly review.
- **Tracks what you're waiting on**, and flags items with no reply after 3 business days.
- **Remembers context.** Tasks, projects, and people keep dated updates, so the AI never needs things re-explained.
- **Works with your mail and calendar.** Classic Outlook on Windows, Apple Mail and Apple Calendar on the Mac. Mail is read only when you click; the app never sends, moves, or flags anything.
- **Keeps data local.** Everything is stored on your computer.

## AI providers

| Provider | Where your data goes |
|---|---|
| Basic (default) | Nowhere. Simple rules on this computer, not actually AI |
| Local model (Ollama) | Nowhere, unless the Ollama address points at another machine |
| Claude (Anthropic API) | The text being processed, plus the related tasks, updates, projects, and people, go to Anthropic. Needs an API key, stored encrypted |

## Install

Download the latest version from [Releases](https://github.com/fcusano9/chief-of-staff/releases). Your data stays put when you install a newer version.

- **Windows:** run `Chief-of-Staff-<version>-Setup.exe`. It isn't signed, so if Windows says "Windows protected your PC", click **More info**, then **Run anyway**.
- **Mac (Apple silicon):** open `Chief-of-Staff-<version>-arm64.dmg` and drag the app to Applications. It isn't signed with an Apple Developer ID, so the first time, go to System Settings → Privacy & Security and click **Open Anyway**.

### Build from source

You need [Node.js](https://nodejs.org) (current LTS) and [Git](https://git-scm.com). Clone the repository once:

```bash
git clone https://github.com/fcusano9/chief-of-staff.git
```

#### Windows

Run these in a normal PowerShell window, not from Claude Desktop: Claude Desktop redirects `%LOCALAPPDATA%` to a private copy, so the app would be installed there instead.

1. Close Chief of Staff if it's running.
2. Get the latest code:

   ```powershell
   cd chief-of-staff
   git switch main
   git pull
   npm install
   ```

3. Build it one of two ways:
   - **Install in place:** `npm run install:win` builds the app into `%LOCALAPPDATA%\Programs\Chief of Staff (build)`. The first time, pin `win-unpacked\Chief of Staff.exe` from that folder to Start. Later builds replace the files, so the shortcut keeps working.
   - **Make an installer:** `npm run package:win` writes `Chief-of-Staff-<version>-Setup.exe` to `release\`. Run it to install, or copy it to another PC. It isn't signed, so Windows may warn before it runs.

#### Mac

1. Quit Chief of Staff if it's running.
2. Get the latest code and build the disk image:

   ```bash
   cd chief-of-staff
   git switch main
   git pull
   npm install
   npm run package:mac
   ```

3. Open the `.dmg` in `release/` and drag Chief of Staff to Applications, replacing the old copy.

## Development

```bash
npm run dev           # run with hot reload, using a separate "Chief of Staff (dev)" data folder
npm run demo:data     # fill the dev folder with made-up data (existing dev data is moved aside)
npm test              # unit and data tests
npm run typecheck
npm run docs          # rebuild the generated part of docs/ARCHITECTURE.html after changing a rule, table, or IPC call
npm run build         # build into out/; npm start runs it
npm run e2e           # build, then click through the real app (slow; see e2e/README.md)
npm run bench:ai      # compare AI models on sample imports (see bench/README.md)
```

- Dev and test runs never touch real data, and the status bar shows "Test data".
- npm holds back install scripts, so Electron downloads its binary on first run (or run `node node_modules/electron/install.js`).
- Every pull request runs the typecheck and tests on Windows and Linux (`.github/workflows/ci.yml`).

**Stack:** Electron 45 (Node 24), React 19 and TypeScript built with electron-vite, SQLite through Node's built-in `node:sqlite`, the Anthropic SDK, Ollama's HTTP API, and Vitest.

| Path | What |
|---|---|
| `src/shared` | Types, priority engine, Claude prices, and the main/renderer API contract |
| `src/main` | Electron main process: database, services, AI providers, mail and calendar readers |
| `src/preload` | Exposes the API to the UI as `window.cos` |
| `src/renderer` | The UI |
| `tests` | Unit and data tests against a real temporary database |
| `e2e` | Drives the built app against a throwaway data folder ([README](e2e/README.md)) |
| `bench` | Scores AI models on made-up imports ([README](bench/README.md)) |
| `scripts` | `demo-data.mjs`, the made-up dev data |
| `design` | Clickable mockups approved before each feature was built ([index](design/README.md)) |
| `docs` | Roadmap, decisions, AI and business rules, Copilot prompts, and the interactive guide ([index](docs/README.md)) |

### Making a release

1. In a PR, set the new version in `package.json` (`npm version 0.3.0 --no-git-tag-version`) and merge it.
2. Tag that version on `main` and push the tag:

   ```bash
   git switch main && git pull
   git tag v0.3.0 && git push origin v0.3.0
   ```

3. The Release workflow (`.github/workflows/release.yml`) runs the tests, builds the Windows installer and Mac disk image, and saves them to a **draft** release with notes from the merged PRs. Check it, then click **Publish release**.

The tag must match `package.json`, or the workflow stops. To build without releasing, run the workflow by hand (Actions → Release → Run workflow). It also runs on PRs that change packaging.

## Your data

- **Where:** `%APPDATA%\Chief of Staff` on Windows, `~/Library/Application Support/Chief of Staff` on Mac. Only the installed app uses it; `COS_DATA_DIR` points a run at another folder.
- **Backups:** a daily snapshot to `OneDrive\Chief of Staff Backups` (configurable), keeping 30, plus a safety copy before every database upgrade and every restore.
- **Restore:** Settings → Restore from backup. Current data is saved first, then the app restarts.
- **API keys** are encrypted by the operating system and never written to files or logs.

## Contributing

Start with [AGENTS.md](AGENTS.md) (rules, architecture, and how to make common changes), then [docs/README.md](docs/README.md), which says what each doc is for and how to keep them current. For a visual tour, open [docs/ARCHITECTURE.html](docs/ARCHITECTURE.html) in a browser.

## License

[MIT](LICENSE). To report a security problem, see [SECURITY.md](SECURITY.md).
