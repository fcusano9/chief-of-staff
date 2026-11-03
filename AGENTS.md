# AGENTS.md: guide for AI coding assistants

Read this before changing anything. It's the shared context for any AI tool working on this repo (Claude Code, Codex, Copilot, Cursor and others). `CLAUDE.md` points here. The deeper background is in [docs/ROADMAP.md](docs/ROADMAP.md) (what's built and what's next) and [docs/DECISIONS.md](docs/DECISIONS.md) (why things are the way they are).

## What this is

**Chief of Staff** is a desktop app (Electron, Windows and Mac) that helps Frank Cusano, a Technology Product Manager at Crestron, manage his work. It replaces Microsoft To Do. OneNote stays separate.

It tracks tasks, projects, people and a waiting-on list, ranks tasks by a transparent priority score, and uses AI to turn emails, Teams chats, meeting transcripts and Copilot summaries into proposed tasks and updates. Later milestones add briefings, Outlook, and a searchable archive of past work.

## Rules that are never negotiable

1. **The AI only proposes; Frank decides.** Every AI output goes to the Review queue and changes nothing until accepted. Never send email, messages or invites. Drafts are saved as drafts and never sent.
2. **Don't fabricate or assume.** If a name, fact, figure, or how something works is unclear, ask Frank instead of guessing. Verify claims, such as API shapes or library behavior, before stating them. The same applies inside the app: AI output that references unknown ids or invalid dates is dropped, not guessed at (`validateSuggestions`).
3. **Show mockups before building new UI.** For a new screen or a visible redesign, build a clickable prototype first (see `design/`) and get approval.
4. **No secrets in files or logs.** API keys go through `KeyStore`, which uses Electron `safeStorage`. The UI may learn that a key exists, never its value.
5. **Commit or push only when Frank asks.** Work on a branch, and open a PR into `main` when asked. Commit messages end with a `Co-Authored-By:` line for the AI that wrote them.

## Working with Frank

- He's a product manager, not a full-time developer. Explain in plain language, lead with the outcome, and say clearly what was and wasn't verified.
- He likes being asked questions up front for big features, approves designs before the build, and reviews PRs.
- Things that are his call: company-data policy (sending work content to Anthropic needs Crestron's OK), which AI provider and model to use, and spending money.

## Stack

| Layer | Choice |
|---|---|
| Shell | Electron 45 (bundles Node 24). Custom title bar, sandboxed renderer, `contextIsolation`, single instance |
| UI | React 19 + TypeScript, built by electron-vite 6 (Vite 8, rolldown) |
| Database | SQLite via Node's **built-in `node:sqlite`**: no native modules, no rebuilds |
| AI | `@anthropic-ai/sdk` with Zod structured outputs; local models through Ollama's HTTP API (plain `fetch`); provider interface for others |
| Tests | Vitest (unit and data), plus a Chrome DevTools end-to-end driver in `e2e/` |
| Types | TypeScript 7 (`tsc` 7.x); two projects: `tsconfig.node.json` and `tsconfig.web.json` |

## Layout

```
src/shared/      Types, priority engine, and the main/renderer API contract (api.ts)
src/main/        Electron main process
  index.ts       Window, IPC handler table, startup, timers (recompute, daily backup)
  db.ts          openDatabase, migrations (PRAGMA user_version), transaction()
  services/      tasks, directory (projects/people/briefs), sources (import), suggestions
                 (review queue), settings (JSON), backup, secrets (KeyStore)
  ai/            provider.ts (interface), claude.ts, ollama.ts, demo.ts, context.ts (prompt), schema.ts (Zod + validation)
src/preload/     Exposes the API as window.cos (CommonJS, sandboxed)
src/renderer/    React UI: App.tsx (shell, shortcuts), screens/, components/
tests/           Vitest: priority, data services, AI and review queue
e2e/             Drives the real app over CDP against a throwaway data folder
design/          Approved clickable prototype (direction B)
docs/            ROADMAP.md, DECISIONS.md
```

## Commands

```bash
npm install
npm run dev          # hot-reload dev app
npm test             # vitest
npm run typecheck    # both TS projects
npm run build        # electron-vite build into out/
npm run e2e          # build, then click through the real app (see e2e/README.md)
npm run bench:ai     # score demo, local and Claude models on sample imports (see bench/README.md)
npm run install:win  # package to %LOCALAPPDATA%\Programs\Chief of Staff (build) (Start-menu shortcut points here)
```

Before telling Frank something is done, run `npm test`, `npm run typecheck` and `npm run e2e`. After changing the extraction prompt or a provider, also run `npm run bench:ai`. If the packaged app is running, close it before `install:win`.

## How to do common changes

- **New IPC call:**
  1. Add it to the `Api` interface **and** `API_CHANNELS` in `src/shared/api.ts`.
  2. Add a handler in the `handlers` table in `src/main/index.ts`. TypeScript enforces that it exists.
  3. Call it from the UI as `cos['name'](...)`.

  The preload exposes exactly the listed channels.
- **Schema change:** append a new SQL string to `MIGRATIONS` in `src/main/db.ts`. Never edit a shipped migration. `transaction()` calls nest by joining the outer transaction.
- **New suggestion kind:** update `SuggestionKind` and its labels in `types.ts`, the Zod enum and the validation in `ai/schema.ts`, the prompt in `ai/context.ts`, `SuggestionService.accept`, and `ReviewScreen`.
- **New AI provider** (for example M365 Copilot): implement `AiProvider` in `src/main/ai/`, add it to `AiProviderId`, `currentProvider()` and `AiSettings.tsx`. It must return `RawSuggestion[]`; validation is shared.
- **Claude API changes:** use the official SDK only. Check current model ids and parameters against Anthropic's docs; don't rely on memory, because the API changes often. The default model is `claude-opus-5-5` (Frank can choose Sonnet or Haiku 5.5 in Settings).

## Product and UI conventions

- **Design "direction B":** sharp and keyboard-first. Top tabs, a Ctrl+K command palette, mono numbers, and colors from the CSS variables in `styles.css`, which cover light and dark. Fonts are bundled (Inter, JetBrains Mono).
- **Lists with details** (Tasks, Projects, People) use `SplitView`: a draggable divider, a 360px minimum per pane, double-click for 50/50, and the position saved in settings.
- **The task editor saves pending edits automatically** when you switch tasks. Mark-done through the editor saves edits too. Delete is a two-click `ConfirmButton`.
- **Keyboard shortcuts:**
  - Global: N new task, G-then-letter to go to a screen, Alt+1–9 for tabs, Shift+D for theme.
  - Tasks: J/K, Enter, E, Esc, Ctrl+Enter.
  - Review: J/K, A, R, Enter.
  - Global shortcuts run in the capture phase and consume their keys.
- **Project colors:** tasks are themed with their project's color. Tasks with no project get no label and a neutral stripe.
- **Copy:** sentence case and plain language, no exclamation marks. Say "Saved", not "Successfully saved!".
- **Context briefs:** every project, task and person has a summary and standing instructions, so the AI never needs things re-explained. The AI request includes these briefs.

## Data and privacy

- **Where data lives:** the live database and settings are in the Electron `userData` folder (`%APPDATA%\Chief of Staff`). Override it with `COS_DATA_DIR` for tests.
- **Backups:** a daily snapshot (SQLite online backup API) goes to `OneDrive\Chief of Staff Backups` by default, keeping the last 30.
- **Demo AI:** the default provider. It runs locally and sends nothing anywhere.
- **Local model (Ollama):** runs on this computer, so nothing is sent anywhere. If the Ollama address points at another machine, the app says data is sent there.
- **Claude:** when selected, each import's text plus open-task titles, briefs and names are sent to Anthropic. The Settings screen says so explicitly.
- **Prompt injection:** imported content is fenced as data in the prompt, and the system prompt tells the model to ignore instructions inside it.

## Environment notes (Frank's Windows PC)

- **Node.js:** Node 26 LTS, installed with winget. In shells started before that install, refresh PATH; in Git Bash, add `/c/Program Files/nodejs`.
- **npm install scripts:** npm holds these back. Electron downloads its binary on first run, or run `node node_modules/electron/install.js`.
- **OneDrive:** the repo lives inside OneDrive, so `node_modules` syncs there. Moving the repo out of OneDrive is a known nice-to-have.
- **Mac:** Mac packaging (`npm run package:mac`) must run on a Mac and hasn't been tested.
