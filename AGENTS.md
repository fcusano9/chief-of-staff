# AGENTS.md: guide for AI coding assistants

Read this before changing anything. It's the shared context for any AI tool working on this repo (Claude Code, Codex, Copilot, Cursor and others). `CLAUDE.md` points here. The deeper background is in [docs/ROADMAP.md](docs/ROADMAP.md) (what's built and what's next) and [docs/DECISIONS.md](docs/DECISIONS.md) (why things are the way they are).

## What this is

**Chief of Staff** is a desktop app (Electron, Windows and Mac) that helps Frank Cusano, a Technology Product Manager at Crestron, manage his work. It replaces Microsoft To Do. OneNote stays separate.

It tracks tasks, projects, people and a waiting-on list, ranks tasks by a transparent priority score, and uses AI to turn emails, Teams chats, meeting transcripts and Copilot summaries into proposed tasks and updates. Later milestones add briefings, Outlook, and a searchable archive of past work.

## Rules that are never negotiable

1. **The AI only proposes; Frank decides.** Every AI output goes to the Review queue and changes nothing until accepted. Never send email, messages or invites. Drafts are saved as drafts and never sent.
2. **Don't fabricate or assume.** If a name, fact, figure, or how something works is unclear, ask Frank instead of guessing. Verify claims, such as API shapes or library behavior, before stating them. The same applies inside the app: AI output that references unknown ids or invalid dates is dropped, not guessed at (`validateSuggestions`).
3. **Show a mockup before any visual change.** That includes new screens, redesigns and small tweaks Frank describes himself (styling, removing an element, a new field on a screen). Build a clickable before/after prototype in `design/`, get his approval, then implement.
4. **No secrets in files or logs.** API keys go through `KeyStore`, which uses Electron `safeStorage`. The UI may learn that a key exists, never its value.
5. **Commit or push only when Frank asks.** Work on a branch, and open a PR into `main` when asked. Commit messages end with a `Co-Authored-By:` line for the AI that wrote them.
6. **Keep PR descriptions short (Frank's preference).** Use a one-line why, 3–6 bullets of what changed, one line on testing, and notes only when something needs his attention (not verified, or a decision for him). Aim for about 150 words, with no per-file detail.

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
  mail/          outlook.ps1 (reads classic Outlook over COM), outlook.ts (runs it), plan.ts (skips, conversations, AI text)
src/preload/     Exposes the API as window.cos (CommonJS, sandboxed)
src/renderer/    React UI: App.tsx (shell, shortcuts), screens/, components/
tests/           Vitest: priority, data services, AI and review queue
e2e/             Drives the real app over CDP against a throwaway data folder
design/          Approved clickable prototype (direction B)
docs/            ROADMAP.md, DECISIONS.md, COPILOT-PROMPTS.md (Teams chat and meeting prompts for import)
```

## Commands

```bash
npm install
npm run dev          # hot-reload dev app (uses its own "Chief of Staff (dev)" data folder)
npm run demo:data    # fill that dev folder with made-up people, projects, tasks and Review suggestions; existing dev data is moved aside
npm test             # vitest
npm run typecheck    # both TS projects
npm run build        # electron-vite build into out/
npm run e2e          # build, then click through the real app (see e2e/README.md)
npm run bench:ai     # score demo, local and Claude models on sample imports (see bench/README.md)
npm run install:win  # package to %LOCALAPPDATA%\Programs\Chief of Staff (build) (Start-menu shortcut points here)
```

Before telling Frank something is done, run `npm test` and `npm run typecheck`. Ask Frank before running `npm run e2e`, because it takes a long time. When asking, say which suites cover the change. After changing the extraction prompt or a provider, also run `npm run bench:ai`. If the packaged app is running, close it before `install:win`.

## How to do common changes

- **New IPC call:**
  1. Add it to the `Api` interface **and** `API_CHANNELS` in `src/shared/api.ts`.
  2. Add a handler in the `handlers` table in `src/main/index.ts`. TypeScript enforces that it exists.
  3. Call it from the UI as `cos['name'](...)`.

  The preload exposes exactly the listed channels.
- **Schema change:** append a new SQL string to `MIGRATIONS` in `src/main/db.ts`. Never edit a shipped migration. `transaction()` calls nest by joining the outer transaction.
- **New suggestion kind:** update `SuggestionKind` and its labels in `types.ts`, the Zod enum and the validation in `ai/schema.ts`, the prompt and `ALL_KINDS` in `ai/context.ts`, the split passes in `ai/ollama.ts`, `SuggestionService.accept`, and `ReviewScreen`.
- **New AI provider** (for example M365 Copilot): implement `AiProvider` in `src/main/ai/`, add it to `AiProviderId`, `currentProvider()` and `AiSettings.tsx`. It must return `RawSuggestion[]` from `extract` (validation is shared) and a sentence from `writePersonBrief`. Wrap every request in `logged()` with the `log` that `extract` receives, so the AI log shows it exactly as sent and received. Never put the API key in the logged request.
- **Claude API changes:** use the official SDK only. Check current model ids and parameters against Anthropic's docs; don't rely on memory, because the API changes often. The default model is `claude-opus-5-5` (Frank can choose Sonnet or Haiku 5.5 in Settings).

## Product and UI conventions

- **Design "direction B":** sharp and keyboard-first. Top tabs, a Ctrl+K command palette, mono numbers, and colors from the CSS variables in `styles.css`, which cover light and dark. Fonts are bundled (Inter, JetBrains Mono).
- **Lists with details** (Tasks, Waiting, Projects, People) use `SplitView`: a draggable divider, a 360px minimum per pane, double-click for 50/50, and the position saved in settings. Each list has a search box (`SearchBox`, / to focus). Waiting is `TasksScreen` with `list="waiting"`; Tasks and Waiting have an Open / Done switch, and Reopen returns an item to the list it came from (`waited_on`).
- **Editors save pending edits automatically** when you move away: the task editor when you switch tasks, and Projects and People (`useAutosave`) when you pick another item, start a new one, or change tabs. An empty name isn't saved, and says so. Mark-done through the editor saves edits too. Delete is a two-click `ConfirmButton`.
- **Keyboard shortcuts:**
  - Global: Ctrl+K palette, N new task, G-then-letter to go to a screen, "/" to search the list. No tab-number or theme keys (the theme is in the palette).
  - Lists (Tasks, Waiting, Projects, People, Review): Up/Down move, Enter opens or edits the item. No J/K.
  - Tasks: E marks done, Esc closes, Ctrl+Enter saves.
  - Review: A, R, Enter to edit. While editing, Ctrl+Enter accepts and Esc cancels.
  - Settings lists every shortcut (`SHORTCUTS` in `SettingsScreen.tsx`); keep it in step.
  - Buttons don't show keys. The bottom bar shows the keys for the current page: each screen calls `useShortcutHints` (`components/hints.ts`), and an open editor registers its own keys at a higher level, which win while it's open.
  - Global shortcuts run in the capture phase and consume their keys.
- **Project colors:** tasks are themed with their project's color. Tasks with no project get no label and a neutral stripe.
- **Copy:** sentence case and plain language, no exclamation marks. Say "Saved", not "Successfully saved!".
- **Context briefs:** every project, task and person has a summary and standing instructions, so the AI never needs things re-explained. The AI request includes these briefs.
- **People** also have a one-line brief (`people.brief`), shown under their name. The AI writes it only when Frank clicks Regenerate, as a suggestion he keeps or discards, and he can edit it by hand. Their context summary is labeled "Context history", keeps every dated note, and opens from a History button in the same window as Projects (`HistoryWindow`). New people start at 1 star. Imports send the one-line brief, or the newest notes when there's none.
- **Projects** have a one-line overview (`projects.overview`) that Frank writes by hand (pencil icon, no AI), and a short status brief (`projects.brief`: status, "Next:", "Open:") that the AI writes from the history only when he clicks Regenerate, kept or discarded like the People brief. The project's context summary is its history of dated notes; it isn't on the page but opens from the History button. Imports send the overview and status brief, or the newest history when there's no brief. Archived projects are left out of `projects.list` (so filters, editors and the AI skip them) and shown only on the Projects tab's Archived list, which has Unarchive.

## Data and privacy

- **Where data lives:** only the **installed** app uses the real folder (`%APPDATA%\Chief of Staff`) and the real OneDrive backups. Running from source (`npm run dev`, `electron .`) uses `Chief of Staff (dev)`, and `COS_DATA_DIR` (tests) uses the folder it names. Both keep their backups inside that folder, and the status bar shows "Test data". See `src/main/paths.ts`. Never point a dev or test run at the real folder.
- **Backups:**
  - A daily snapshot (SQLite online backup API, saved as a single file) goes to `OneDrive\Chief of Staff Backups` by default, keeping the last 30.
  - **Before any schema upgrade**, `openDatabase`'s `beforeUpgrade` hook writes a `-before-upgrade-vN` copy with `VACUUM INTO`. It falls back to `<data folder>\backups` if OneDrive isn't available, and **if no copy can be made, the upgrade doesn't run** and the app shows an error.
  - Safety copies keep the last 10 of each kind, separate from the daily ones.
- **Restore** (Settings → Restore from backup):
  - It only accepts backups the app listed and judged compatible (`inspectBackup`). That excludes the old WinUI app's backups, newer schema versions, and unreadable files.
  - It saves a `-before-restore` copy first, writes `restore-pending.json`, and restarts. `applyPendingRestore` swaps the file before the database opens.
  - Listing backups reads temporary copies, so nothing is ever written into the backup folder.
- **Single instance:** a second copy quits before it opens the database.
- **Adding a migration:** the safety copy is automatic. Still never edit a shipped migration, and test the upgrade from the previous version's data.
- **Demo AI:** the default provider. It runs locally and sends nothing anywhere.
- **Local model (Ollama):** runs on this computer, so nothing is sent anywhere. If the Ollama address points at another machine, the app says data is sent there.
- **Claude:** when selected, each import's text plus open-task titles, briefs and names are sent to Anthropic. The Import screen names where text is sent next to the Extract button; Settings no longer carries a separate warning (Frank removed it).
- **Outlook mail** (`services/mail.ts`): only read when Frank clicks, never on a schedule. "Check Outlook" sends nothing anywhere; "Read" sends each new conversation to the selected AI like any other import. The script never sends, moves or flags mail. Messages read are recorded in `mail_messages` so none is read twice. Tests and e2e use `COS_OUTLOOK_FIXTURE` (honored only for test data folders), never the real mailbox.
- **Prompt injection:** imported content is fenced as data in the prompt, and the system prompt tells the model to ignore instructions inside it.
- **AI log** (Import or Review → "AI log"):
  - Each extraction run is stored in `extraction_runs`, and each request in `ai_calls` (`services/ai-log.ts`). That covers the exact request, the raw response, timing, tokens, everything proposed, what reached Review, and what was dropped and why (`validateSuggestions`' `dropped` list).
  - The last 5 runs per import are kept, and they're deleted with the import. Everything stays in the local database.
  - The prompts themselves live in `ai/context.ts` (`buildSystemPrompt`, `buildUserPrompt`) and `ai/schema.ts` (the answer form).

## Environment notes (Frank's Windows PC)

- **Node.js:** Node 26 LTS, installed with winget. In shells started before that install, refresh PATH; in Git Bash, add `/c/Program Files/nodejs`.
- **npm install scripts:** npm holds these back. Electron downloads its binary on first run, or run `node node_modules/electron/install.js`.
- **OneDrive:** the repo lives inside OneDrive, so `node_modules` syncs there. Moving the repo out of OneDrive is a known nice-to-have.
- **Claude Desktop sandbox:** Claude Desktop is a packaged Windows app, so anything run from a Claude session sees a private, redirected copy of `%APPDATA%` and `%LOCALAPPDATA%`, not the real folders. Reading `%APPDATA%\Chief of Staff` from a session shows that copy, not Frank's data. The installed app refuses to start in the sandbox (see DECISIONS.md, "Real data is never opened from inside Claude Desktop's sandbox"). The OneDrive backup folder is real.
- **Mac:** Mac packaging (`npm run package:mac`) must run on a Mac and hasn't been tested.
