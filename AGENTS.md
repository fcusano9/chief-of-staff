# AGENTS.md: guide for AI coding assistants

Read this before changing anything. It's the shared context for any AI tool working on this repo (Claude Code, Codex, Copilot, Cursor and others). `CLAUDE.md` points here. The deeper background is in [docs/ROADMAP.md](docs/ROADMAP.md) (what's built and what's next), [docs/DECISIONS.md](docs/DECISIONS.md) (why things are the way they are) and [docs/AI-RULES.md](docs/AI-RULES.md) (every AI rule and limit on one page, for Frank to scan; update it in the same PR whenever an AI rule changes).

## What this is

**Chief of Staff** is a desktop app (Electron, Windows and Mac) that helps a product manager (built first for one at Crestron) manage their work. It replaces Microsoft To Do. OneNote stays separate.

It tracks tasks, projects, people and a waiting-on list, ranks tasks by a transparent priority score, and uses AI to turn emails, Teams chats, meeting transcripts and Copilot summaries into proposed tasks and updates. Later milestones add briefings, Outlook, and a searchable archive of past work.

## Rules that are never negotiable

1. **The AI only proposes; the user decides.** Every AI output goes to the Review queue and changes nothing until accepted. Never send email, messages or invites. Drafts are saved as drafts and never sent.
2. **Don't fabricate or assume.** If a name, fact, figure, or how something works is unclear, ask Frank instead of guessing. Verify claims, such as API shapes or library behavior, before stating them. The same applies inside the app: AI output that references unknown ids or invalid dates is dropped, not guessed at (`validateSuggestions`).
3. **Show a mockup before any visual change.** That includes new screens, redesigns and small tweaks Frank describes himself (styling, removing an element, a new field on a screen). Build a clickable before/after prototype in `design/`, get his approval, then implement.
4. **No secrets in files or logs.** API keys go through `KeyStore`, which uses Electron `safeStorage`. The UI may learn that a key exists, never its value.
5. **Commit or push only when Frank asks.** Work on a branch, and open a PR into `main` when asked. Commit messages end with a `Co-Authored-By:` line for the AI that wrote them.
6. **Keep PR descriptions short (Frank's preference).** Use a one-line why, 3–6 bullets of what changed, one line on testing, and notes only when something needs his attention (not verified, or a decision for him). Aim for about 150 words, with no per-file detail.

## Working with Frank

- He's a product manager, not a full-time developer. Explain in plain language, lead with the outcome, and say clearly what was and wasn't verified.
- He likes being asked questions up front for big features, approves designs before the build, and reviews PRs.
- Things that are his call: company-data policy (sending work content to Anthropic needs Crestron's OK), which AI provider and model to use, and spending money.
- **Write docs as if the app is for anyone.** Text that describes what the app does says "the user", never Frank's name: "Runs only when the user acts", not "when Frank acts". His name stays only where it's about him, such as who made a decision in DECISIONS.md or how to work with him here. `docs/COPILOT-PROMPTS.md` also keeps his name (his choice).

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
src/shared/      Types, priority engine, Claude prices (pricing.ts), and the main/renderer API contract (api.ts)
src/main/        Electron main process
  index.ts       Window, IPC handler table, startup, timers (recompute, save ended weeks, daily backup)
  db.ts          openDatabase, migrations (PRAGMA user_version), transaction()
  services/      tasks, directory (projects/people/briefs), sources (import), suggestions
                 (review queue), briefings (daily briefing), weekly (weekly review), settings (JSON), backup, secrets (KeyStore),
                 ollama-setup (find, install, start Ollama; download and delete models), usage (AI spending)
  ai/            provider.ts (interface), claude.ts, ollama.ts, demo.ts, context.ts (prompt), schema.ts (Zod + validation),
                 brief.ts (person briefs), status.ts ("Where this stands" cards on Write), briefing.ts (daily briefing prompt and checks),
                 weekly.ts (weekly reflection prompt and checks), reply.ts (draft reply prompt and checks)
  mail/          outlook.ps1 (reads classic Outlook over COM, saves reply drafts), outlook.ts (runs it), plan.ts (skips, conversations, AI text)
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

Before telling Frank something is done, run `npm test` and `npm run typecheck`. Ask Frank before running `npm run e2e`, because it takes a long time. When asking, say which suites cover the change. Never run `npm run bench:ai` without Frank's approval, not even for local models only: it ties up the computer for a long time and can spend money on Claude. After changing the extraction prompt or a provider, ask him whether to run it and say which models. If the packaged app is running, close it before `install:win`.

## How to do common changes

- **New IPC call:**
  1. Add it to the `Api` interface **and** `API_CHANNELS` in `src/shared/api.ts`.
  2. Add a handler in the `handlers` table in `src/main/index.ts`. TypeScript enforces that it exists.
  3. Call it from the UI as `cos['name'](...)`.

  The preload exposes exactly the listed channels.
- **Schema change:** append a new SQL string to `MIGRATIONS` in `src/main/db.ts`. Never edit a shipped migration. `transaction()` calls nest by joining the outer transaction.
- **New suggestion kind:** update `SuggestionKind` and its labels in `types.ts`, the Zod enum and the validation in `ai/schema.ts`, the prompt and `ALL_KINDS` in `ai/context.ts`, the split passes in `ai/ollama.ts`, `SuggestionService.accept`, and `ReviewScreen`.
- **New AI provider** (for example M365 Copilot): implement `AiProvider` in `src/main/ai/`, add it to `AiProviderId`, `providerFor()` and `aiChoices()` in `index.ts` (so its models show in the picker), and give it a section under AI providers in `AiSettings.tsx` and an icon in `ProviderIcon`. It must return `RawSuggestion[]` from `extract` (validation is shared), a sentence from `writePersonBrief`, a `RawStatus` from `writeStatus` (`cleanStatusCard` checks it), a `RawReply` from `writeReply` (`cleanReply` tidies it), a `RawBriefing` from `writeBriefing` (`assembleBriefing` checks it), and a `RawReflection` from `writeWeeklyReflection` (`assembleReflection` tidies it). Wrap every request in `logged()` with the `log` that `extract` receives, so the AI log shows it exactly as sent and received. Never put the API key in the logged request.
- **Claude API changes:** use the official SDK only. Check current model ids and parameters against Anthropic's docs; don't rely on memory, because the API changes often. The default model is `claude-opus-5-5` (the user can choose Sonnet or Haiku 5.5 in Settings).

## Product and UI conventions

- **Design "direction B":** sharp and keyboard-first. Top tabs, a Ctrl+K command palette, mono numbers, and colors from the CSS variables in `styles.css`, which cover light and dark. Fonts are bundled (Inter, JetBrains Mono).
- **Density** (Settings → Appearance, also in the palette): Compact (the original look), Comfortable (default) and Spacious. It sets `data-density` on the root, and `styles.css` defines the spacing and text-size variables for each level (`--fs`, `--fs-sm`, `--fs-xs`, `--row-py`, `--gap` and so on). Use those variables instead of fixed px for text sizes and spacing, including inline `fontSize`. In Spacious, task rows show the priority reason under the title. The tab bar and status bar keep a fixed size.
- **Lists with details** (Tasks, Waiting, Projects, People) use `SplitView`: a draggable divider, a 360px minimum per pane, double-click for 50/50, and the position saved in settings. Each list has a search box (`SearchBox`, / to focus). Waiting is `TasksScreen` with `list="waiting"`; Tasks and Waiting have an Open / Done switch, and Reopen returns an item to the list it came from (`waited_on`).
- **Editors save pending edits automatically** when you move away: the task editor when you switch tasks, and Projects and People (`useAutosave`) when you pick another item, start a new one, or change tabs. An empty name isn't saved, and says so. Mark-done through the editor saves edits too. Delete is a two-click `ConfirmButton`.
- **Keyboard shortcuts:**
  - Global: Ctrl+K palette, N new task, G-then-letter to go to a screen (G then V is Weekly), "/" to search the list. No tab-number or theme keys (the theme is in the palette).
  - Lists (Tasks, Waiting, Projects, People, Review): Up/Down move, Enter opens or edits the item. No J/K.
  - Tasks: E marks done, Esc closes, Ctrl+Enter saves.
  - Review: A, R, Enter to edit. While editing, Ctrl+Enter accepts and Esc cancels.
  - Settings lists every shortcut (`SHORTCUTS` in `SettingsScreen.tsx`); keep it in step.
  - Buttons don't show keys. The bottom bar shows the keys for the current page: each screen calls `useShortcutHints` (`components/hints.ts`), and an open editor registers its own keys at a higher level, which win while it's open.
  - Global shortcuts run in the capture phase and consume their keys.
- **Project colors:** tasks are themed with their project's color. Tasks with no project get no label and a neutral stripe.
- **Copy:** sentence case and plain language, no exclamation marks. Say "Saved", not "Successfully saved!".
- **Model picker** (`components/ModelMenu.tsx`): one menu, used by Settings → AI and by the AI button at the bottom right. It lists Basic, the Claude models once a key is saved, and every model in Ollama ("Ollama gpt-oss:20b", no "(local)": the group header says where it runs). Up/Down, Enter, Esc. If the chosen model can't be used (no key, Ollama stopped, model not downloaded), the choice is kept and shown as unavailable in red, never switched silently (`AiStatus.available`, `problem`).
- **Daily briefing** (Today, `components/Briefing.tsx`, `services/briefings.ts`): written only when the user clicks Write briefing / Refresh or uses "Write briefing" in Ctrl+K; no keyboard shortcut. Full width under the number cards: a one-line summary, then **Do next** (the top priorities, numbered, overdue first; one line each: the suggested next step, then the task, its project color dot and a status tag), and **Follow up** (waiting-on nudges) and **New** (since the last briefing) side by side, each a tag and a name. Tags (Overdue, Due today, Due Mon, Waiting 8 days, New task, Review) come from the task as it was when the briefing was written (`due`, `waitingDays`, `projectColor` on `BriefingItem`), never from the AI; the AI's notes show on hover. Without a next step (Basic), a Do next line shows the task's name and tag. The AI is asked for short wording: a summary under 20 words, notes and next steps under 10. Empty sections stay with a short line. Nothing goes to Review and no task changes; the one thing it saves besides itself is each top priority's status card (where it stands and the next step; the step shows on the line, and both on the task's card). Items always come from real tasks; the AI only picks ids and writes notes. Every briefing is kept (History); the AI requests behind the newest 5 are kept for History's AI log. `write(trigger)` takes `'manual'` or `'scheduled'`, so a scheduler can be added without changing the card or storage.
- **Context briefs:** every project, task and person has a context brief. Its summary is their **Updates**: dated notes, one per line, from what the user accepts in Review (status updates and context, with the import they came from) plus any they add by hand. Projects and people also have standing instructions; tasks don't. Shared helpers for reading updates are in `src/shared/notes.ts`.
- **Weekly review** (Weekly tab, next to Today; `screens/WeeklyScreen.tsx`, `services/weekly.ts`): weeks run Sunday to Saturday, local time, named by their Sunday (`shared/week.ts`). The list on the left has every week from the first task to now; Up/Down and ‹ › step between them. Each week has Completed, New (added by you, or the import it came from), Slipping (overdue tasks, plus tasks whose due date was pushed later that week, net of every move, from the event log; dates moved earlier, set or removed don't count, nor tasks finished by the week's end) and Waiting on, plus "Your week", the AI reflection (a summary, Went well, Slipped, Focus next) with Copy and an AI log. The current week is **live**: its lists are rebuilt every time it's shown. The reflection is written only when the user clicks (or "Write weekly reflection" in Ctrl+K), only for the current week, and says when tasks have changed since. Ended weeks are **saved** once (`saveEndedWeeks`, at startup, on the 30-minute timer, and before listing) as they stood at Saturday midnight, and never change. A week the app wasn't opened the week after, and every week before the weekly review started (`weekly_meta.started_week`), is **partly recorded**: Completed and New only, from task dates. It only reads: nothing changes and nothing goes to Review.
- **Updates on screen** (Tasks, Projects, People): an **Updates** button with the count opens `UpdatesWindow` (newest first, Add, Edit), and a **Latest** card under it shows the newest one (`LatestUpdate`). "History" is only the daily briefing's list of past briefings.
- **What the AI is sent from updates:** whole updates only, newest first, up to 300 characters (`recentNotes`, `UPDATES_FOR_AI`), never cut mid-sentence (except a single newest update longer than the limit). Imports send each open task's latest updates, a project's latest updates (400 characters), and a person's when they have no one-line brief. The daily briefing sends each task's Notes (up to 300 characters) and latest updates, and the latest updates of waiting items.
- **Task editor:** Notes are the user's own; the AI never writes them. Below them are Updates (above) and **Activity** (`components/ActivityLog.tsx`), a read-only log, newest first (8, then Show all): every recorded change from `task_events` (`services/task-events.ts`) plus linked imports. `TaskService.save` records one line per changed field (status, due date, project, asked by, title, priority set by hand, follow-ups; not notes, subtasks or the score), and AI priority changes are recorded by `PriorityAdjustmentService`. Every line says who: pass a `ChangeBy` (`user`, `review` with the import's title, or `ai` with where it came from) when saving; `SuggestionService.accept` passes `review`. Wording is in `shared/events.ts`. Tasks older than the log say "Changes before … weren't recorded" (`task_events_meta`). Statuses are Open, Waiting on and Done ("In progress" was removed: nothing used it). The priority card shows the score and reason; **Adjust** opens Set by hand and Follow-ups. Notes are about 6 lines tall at every density (`textarea.notes-inp`; a plain `.notes-inp` rule loses to `textarea.inp`).
- **Where this stands and next step** (top of the task editor and the project editor, `components/StatusCard.tsx`, `services/next-actions.ts`, tables `next_actions` and `project_cards`, `ai/status.ts`): 2–3 short bullets written so the user could paste them to a manager, plus one next-action sentence (no "why"). The two are always written together. Tasks: by ✦ Write / Refresh on the card (`tasks.writeStatus`, not for done tasks), and as part of a daily briefing (its top priorities) or an import (open tasks the item is about, not ones it proposes to mark done). Projects: only by Write (`projects.writeStatus`), one step for the project as a whole. Never on its own and never by Basic: with Basic selected, Write is greyed out and the empty card says "Select an AI model in Settings to use this feature" (the link opens Settings → AI providers). Shown on the card only: Copy on each part; it never goes to Review, isn't saved to Updates and changes nothing. One per task or project; a newer one replaces the whole card. Dismiss folds it to one line with Show. If the item has an update dated a later day than the card, it says it's out of date in amber; no date, model or source line otherwise. Imports return `{ suggestions, next_actions }` from `extract`, each `{ task_id, status, action }` (Ollama asks for them in pass 1 only); ids and bullets are checked by `cleanNextActions` / `cleanStatus`, and Write's answer by `cleanStatusCard`. Requests count in AI spending as `status`.
- **AI priority adjustment** (priority card in the task editor, `services/priority-adjustments.ts`, table `priority_adjustments`): a change of at most ±15 (`MAX_AI_ADJUSTMENT`) to the computed score, with a one-line reason. Written only as part of a daily briefing (any task it was sent) or an import (open tasks the item is about; not ones proposed as done); never by Basic. Applied at once: `effectivePriority` adds `task.aiAdjustment.delta` (0 to 100), so every list sorts by it; a score set by hand still wins and the change is shown greyed. The card shows "54 + 10", the reason, where it came from and Remove (`tasks.removeAiAdjustment`); rows show ✦ next to an adjusted score. The AI is sent the computed score and its current change separately. A later change replaces it and 0 clears it; skipping a task keeps it. `cleanAdjustments` checks ids and holds the range.
- **People** also have a one-line brief (`people.brief`), shown under their name. The AI writes it only when the user clicks Regenerate, as a suggestion they keep or discard, and they can edit it by hand. Their Updates keep every dated note (see Updates on screen). New people start at 1 star. Imports send the one-line brief, or their latest updates when there's none.
- **Projects** have a one-line overview (`projects.overview`) that the user writes by hand (pencil icon, no AI), and the status card above (Write only). The old AI status brief was removed: the upgrade saved each project's brief as a dated update and cleared `projects.brief*` (the columns stay, unused). Imports send the overview and the latest updates. Archived projects are left out of `projects.list` (so filters, editors and the AI skip them) and shown only on the Projects tab's Archived list, which has Unarchive.

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
- **Basic** (provider id `demo`, formerly "Demo AI"): the default. Simple rules, not actually AI; Settings says so. It runs locally and sends nothing anywhere.
- **Local model (Ollama):** runs on this computer, so nothing is sent anywhere. If the Ollama address points at another machine, the app says data is sent there.
- **Ollama setup** (`services/ollama-setup.ts`, Settings → AI providers): everything runs only when the user clicks. Install downloads the official installer from ollama.com, runs it only if its signature is valid (Windows `Get-AuthenticodeSignature`; Mac `codesign` and `spctl`), and never for a remote address. Download offers only `TESTED_LOCAL_MODELS` (today gpt-oss:20b and qwen3.8:27b-q4_K_M; use GGUF tags like `-q4_K_M`, because on a Mac the plain tags of newer models are MLX builds that can't give fixed-format answers); models installed outside the app still appear, marked Not tested. Tests and e2e use fake Ollama servers; never delete or pull on the real one from a test.
- **Claude:** when selected, each import's text plus open-task titles and their latest updates, briefs and names are sent to Anthropic. The Import screen names where text is sent next to the Extract button; Settings no longer carries a separate warning (Frank removed it).
- **Outlook mail** (`services/mail.ts`): only read when the user clicks, never on a schedule. "Check Outlook" sends nothing anywhere; "Read" sends each new conversation to the selected AI like any other import. The script never sends, moves or flags mail. Messages read are recorded in `mail_messages` so none is read twice. Tests and e2e use `COS_OUTLOOK_FIXTURE` (honored only for test data folders), never the real mailbox.
- **Draft replies** (Reply card in the task editor, `components/ReplyCard.tsx`, `services/replies.ts`, `ai/reply.ts`): on tasks linked to an Outlook email (any task whose linked import is mail, such as "Reply to …" tasks), under the status card; hidden otherwise. It answers the newest message from someone else in that conversation (`mail_messages`). ✦ Draft reply asks the selected AI for the first draft with no input from the user: the thread, the task's title, Notes and latest updates (1,500 characters), and the **Writing style for draft replies** note (Settings → AI, `settings.replyStyle`). The preview shows To, Cc and Subject from Outlook (`-Action recipients`, nothing saved) for Reply all and Reply; the AI picks one ("AI pick") and the user can switch. The body is editable. Try again opens an optional "What should change?" note and Rewrite sends it with the draft being replaced. Discard drops it. **Save to Outlook Drafts** runs `-Action reply` (`ReplyAll()` or `Reply()`, the text put above the quoted thread, then `Save()`): it is **never sent**. Then Open in Outlook shows the draft. The task stays open; Activity gets "Draft reply saved to Outlook Drafts" (`reply_draft`). Basic greys it out with the Settings link; without classic Outlook (Mac) the card says "Draft replies only work with Classic Outlook on Windows." Requests count in AI spending as `reply`. The fixture Outlook writes saved drafts to `<fixture>.drafts.json` for e2e.
- **Prompt injection:** imported content is fenced as data in the prompt, and the system prompt tells the model to ignore instructions inside it.
- **AI log** (Import or Review → "AI log"):
  - Each extraction run is stored in `extraction_runs`, and each request in `ai_calls` (`services/ai-log.ts`). That covers the exact request, the raw response, timing, tokens, everything proposed, what reached Review, and what was dropped and why (`validateSuggestions`' `dropped` list).
  - The last 5 runs per import are kept, and they're deleted with the import. Everything stays in the local database.
  - The prompts themselves live in `ai/context.ts` (`buildSystemPrompt`, `buildUserPrompt`) and `ai/schema.ts` (the answer form).
- **AI spending** (Settings → AI providers → Claude → "AI spending", `screens/AiSpendingScreen.tsx`, `services/usage.ts`):
  - Every successful Claude request (imports, daily briefings, weekly reflections, person briefs, status cards; older rows may say project briefs) adds a row to `ai_usage`: time, purpose, the model that answered (`r.model`, reported as `paidModel` on the `AiCallRecord`), and tokens. It is never pruned, unlike the AI logs. Basic and Ollama are free and never recorded.
  - Costs are estimates from the list prices in `src/shared/pricing.ts` (`CLAUDE_PRICES`, with Haiku 5.5's higher price above 100K-token prompts). The screen lists the prices used, says they may have changed, and links to Anthropic's pricing page. The Anthropic Console is the real figure.
  - **When Anthropic changes prices or a model is added**, update `CLAUDE_PRICES`, `PRICES_CHECKED` and `PRICES_CHECKED_LABEL` after checking the pricing page. The model picker's price text comes from the same table. A model with no price is counted but shown as "price not known".
  - The Import and briefing AI logs show each request's model and estimated cost, and the run or briefing total.
  - Recent imports on the Import screen show each import's estimated cost (its latest run, the one its AI log opens on; `SourceItem.estimatedCost`), and each Outlook mail import's total across its conversations. The Outlook card shows the total when a Read finishes or is stopped (`MailJobStatus.estimatedCost`). Nothing shows for free models.

## Environment notes (Frank's Windows PC)

- **Node.js:** Node 26 LTS, installed with winget. In shells started before that install, refresh PATH; in Git Bash, add `/c/Program Files/nodejs`.
- **npm install scripts:** npm holds these back. Electron downloads its binary on first run, or run `node node_modules/electron/install.js`.
- **Repo location:** the working copy is `C:\GitHub\chief-of-staff`, outside OneDrive, so it isn't backed up automatically. GitHub is the backup: push branches regularly. Only the app's daily backups go to OneDrive.
- **Claude Desktop sandbox:** Claude Desktop is a packaged Windows app, so anything run from a Claude session sees a private, redirected copy of `%APPDATA%` and `%LOCALAPPDATA%`, not the real folders. Reading `%APPDATA%\Chief of Staff` from a session shows that copy, not Frank's data. The installed app refuses to start in the sandbox (see DECISIONS.md, "Real data is never opened from inside Claude Desktop's sandbox"). The OneDrive backup folder is real.
- **Mac:** Mac packaging (`npm run package:mac`) must run on a Mac and hasn't been tested.
