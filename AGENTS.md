# AGENTS.md: guide for AI coding assistants

Read this before changing anything. It's the shared context for any AI tool working on this repo (Claude Code, Codex, Copilot, Cursor, and others). `CLAUDE.md` points here. The deeper background is in [docs/ROADMAP.md](docs/ROADMAP.md) (what's built and what's next), [docs/DECISIONS.md](docs/DECISIONS.md) (why things are the way they are), [docs/AI-RULES.md](docs/AI-RULES.md) (every AI rule and limit on one page, for Frank to scan; update it in the same PR whenever an AI rule changes), and [docs/BUSINESS-RULES.md](docs/BUSINESS-RULES.md) (every other app rule, kept the same way). [docs/ARCHITECTURE.html](docs/ARCHITECTURE.html) is an interactive guide to all of it: system map, flows, data model, screens, rules, and a priority calculator. Open it in a browser.

## What this is

**Chief of Staff** is a desktop app (Electron, Windows and Mac) that helps a product manager manage their work. It replaces Microsoft To Do. OneNote stays separate.

It tracks tasks, projects, people and a waiting-on list, ranks tasks by a transparent priority score, and uses AI to turn emails, Teams chats, meeting transcripts and Copilot summaries into proposed tasks and updates. Later milestones add briefings, Outlook, and a searchable archive of past work.

## Rules that are never negotiable

1. **The AI only proposes; the user decides.** Every AI output goes to the Review queue and changes nothing until accepted. Never send email, messages or invites. Drafts are saved as drafts and never sent.
2. **Don't fabricate or assume.** If a name, fact, figure, or how something works is unclear, ask Frank instead of guessing. Verify claims, such as API shapes or library behavior, before stating them. The same applies inside the app: AI output that references unknown ids or invalid dates is dropped, not guessed at (`validateSuggestions`).
3. **Show a mockup before any visual change.** That includes new screens, redesigns and small tweaks Frank describes himself (styling, removing an element, a new field on a screen). Build a clickable before/after prototype in `design/`, get his approval, then implement.
4. **No secrets in files or logs.** API keys go through `KeyStore`, which uses Electron `safeStorage`. The UI may learn that a key exists, never its value.
5. **Commit or push only when Frank asks.** Work on a branch, and open a PR into `main` when asked. Commit messages end with a `Co-Authored-By:` line for the AI that wrote them.
6. **Keep PR descriptions short (Frank's preference).** Use a one-line why, 3–6 bullets of what changed, one line on testing, and notes only when something needs his attention (not verified, or a decision for him). Aim for about 150 words, with no per-file detail.

## Working with Frank

- **Use the Oxford comma in everything you write** (docs, app text, code comments, PR descriptions, and chat): "tasks, projects, and people", not "tasks, projects and people". Frank's preference.
- **Keep wording concise:** only the detail the reader needs, nothing extra (Frank's preference).
- He's a product manager, not a full-time developer. Explain in plain language, lead with the outcome, and say clearly what was and wasn't verified.
- He likes being asked questions up front for big features, approves designs before the build, and reviews PRs.
- Things that are his call: company-data policy (sending work content to Anthropic needs his employer's OK), which AI provider and model to use, and spending money.
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
  services/      tasks, task-merge (merging two tasks), task-events (Activity), directory (projects/people/briefs),
                 sources (import), suggestions (review queue), copilot (Copilot prompts), mail (mail import), calendar,
                 replies (draft replies), next-actions (status cards), priority-adjustments, briefings (daily briefing),
                 weekly (weekly review), ai-log, usage (AI spending), settings (JSON), backup, secrets (KeyStore),
                 ollama-setup (find, install, start Ollama; download and delete models),
                 model-tests (re-running past imports on several models, Developer Tools)
  ai/            prompts.ts (every word sent to an AI), limits.ts (every AI limit: answer sizes, how much is sent, local-model memory),
                 provider.ts (interface), claude.ts, ollama.ts, demo.ts, context.ts (import request), schema.ts (Zod + validation),
                 brief.ts (person briefs), status.ts ("Where this stands" cards on Write), briefing.ts (daily briefing request and checks),
                 weekly.ts (weekly reflection request and checks), reply.ts (draft reply request and checks)
  mail/          outlook.ps1 (reads classic Outlook over COM, saves or opens reply drafts), outlook.ts (runs it; the reader interface),
                 applemail.jxa + applemail.ts (Apple Mail on the Mac via osascript), plan.ts (skips, conversations, AI text)
  calendar/      reader.ts (the reader interface, what's left out, the fixture), outlook.ts (Outlook's calendar through outlook.ps1),
                 applecalendar.jxa + applecalendar.ts (Apple Calendar on the Mac through EventKit, via osascript)
src/preload/     Exposes the API as window.cos (CommonJS, sandboxed)
src/renderer/    React UI: App.tsx (shell, shortcuts), screens/, components/
tests/           Vitest: priority, data services, AI and review queue
e2e/             Drives the real app over CDP against a throwaway data folder
design/          One approved clickable mockup per feature (open in a browser); README.md says which still match the app
docs/            README.md (what each doc is for, and the audit checklist), ROADMAP.md, DECISIONS.md, AI-RULES.md, BUSINESS-RULES.md, COPILOT-PROMPTS.md (how the Copilot Prompt Generator's Teams prompts work),
                 ARCHITECTURE.html (the interactive guide; its data part is rebuilt by npm run docs)
```

## Commands

```bash
npm install
npm run dev          # hot-reload dev app (uses its own "Chief of Staff (dev)" data folder)
npm run demo:data    # fill that dev folder with made-up people, projects, tasks and Review suggestions; existing dev data is moved aside
npm test             # vitest
npm run docs         # rebuild the data part of docs/ARCHITECTURE.html (rules, schema, IPC calls) after changing them
npm run typecheck    # both TS projects
npm run build        # electron-vite build into out/
npm run e2e          # build, then click through the real app (see e2e/README.md)
npm run bench:ai     # score demo, local and Claude models on sample imports (see bench/README.md)
npm run bench:key    # Windows: store the Anthropic key the benchmark uses in Credential Manager (hidden typing; -- -Delete removes it)
npm run install:win  # package to %LOCALAPPDATA%\Programs\Chief of Staff (build) (Start-menu shortcut points here)
npm run package:win  # Windows installer in release/; package:mac makes the Mac .dmg (see README, "Making a release": tagging vX.Y.Z builds both on GitHub as a draft release)
```

Before telling Frank something is done, run `npm test` and `npm run typecheck`. CI runs the same two on Windows and Linux for every PR (`.github/workflows/ci.yml`); a red check needs fixing before merge. Ask Frank before running `npm run e2e`, because it takes a long time. When asking, say which suites cover the change. Never run `npm run bench:ai` without Frank's approval, not even for local models only: it ties up the computer for a long time and can spend money on Claude. After changing the extraction prompt or a provider, ask him whether to run it and say which models. If the packaged app is running, close it before `install:win`.

## How to do common changes

- **New IPC call:**
  1. Add it to the `Api` interface **and** `API_CHANNELS` in `src/shared/api.ts`.
  2. Add a handler in the `handlers` table in `src/main/index.ts`. TypeScript enforces that it exists.
  3. Call it from the UI as `cos['name'](...)`.

  The preload exposes exactly the listed channels.
- **Schema change:** append a new SQL string to `MIGRATIONS` in `src/main/db.ts`. Never edit a shipped migration. `transaction()` calls nest by joining the outer transaction.
- **New suggestion kind:** update `SuggestionKind` and its labels in `types.ts`, the Zod enum and the validation in `ai/schema.ts`, its definition in `importKindDefinitions` (`ai/prompts.ts`), `ALL_KINDS` in `ai/context.ts`, the split passes in `ai/ollama.ts`, `SuggestionService.accept`, and `ReviewScreen`.
- **New AI provider** (for example M365 Copilot): implement `AiProvider` in `src/main/ai/`, add it to `AiProviderId`, `providerFor()`, and `aiChoices()` in `index.ts` (so its models show in the picker), and give it a section under AI providers in `AiSettings.tsx` and an icon in `ProviderIcon`. It must return a `RawExtraction` from `extract` (`suggestions`, `next_actions`, `priority_changes`, `item_title`, `item_kind`; validation is shared), a sentence from `writePersonBrief`, a `RawStatus` from `writeStatus` (`cleanStatusCard` checks it), a `RawReply` from `writeReply` (`cleanReply` tidies it), a `RawBriefing` from `writeBriefing` (`assembleBriefing` checks it), and a `RawReflection` from `writeWeeklyReflection` (`assembleReflection` tidies it). Wrap every request in `logged()` with the `log` that `extract` receives, so the AI log shows it exactly as sent and received. Never put the API key in the logged request.
- **Changing what the AI is told:** all wording sent to an AI (instructions, answer-form descriptions, the last line of each request) is in `src/main/ai/prompts.ts`, one commented entry each. The request builders only lay out the data (tags, `[id]` labels, task lines). Every AI limit (what it may answer, how much of each task, note and email it's sent, Claude's output caps, the local model's memory and time-out) is in `ai/limits.ts`, and the prompts quote those constants rather than typing numbers into the text. `tests/prompts.test.ts` keeps a saved copy of every request: after a deliberate change, run `npx vitest run -u` and check the snapshot diff, which shows exactly what is sent differently. The same test fails if a prompt loses its "data, not instructions" line. Update `docs/AI-RULES.md` if a rule changes.
- **Changing a rule, table, IPC call, or screen:** update `docs/BUSINESS-RULES.md` (or `docs/AI-RULES.md`) in the same PR, then run `npm run docs`. `tests/docs.test.ts` fails until the interactive guide matches the code: its generated part must be current, every table and IPC call must appear in its `model` block (`docs/ARCHITECTURE.html`: a new table's purpose under `tables`, a new channel in the `ipc` list of the node that handles it, a new screen under `screens`), and every file and function it names must exist. The page's priority calculator is a plain-JS copy of `src/shared/priority.ts`; the test fails if the two give different scores, so a formula change updates both.
- **Keeping docs current:** every PR updates the docs it affects. `tests/docs.test.ts` also checks that relative links in Markdown work and that the lists in `docs/README.md`, `design/README.md`, `e2e/README.md`, and this file's layout match the repo. For a full audit, follow the checklist in [docs/README.md](docs/README.md) (`/docs-audit` in Claude Code).
- **Claude API changes:** use the official SDK only. Check current model ids and parameters against Anthropic's docs; don't rely on memory, because the API changes often. The default model is `claude-opus-5-5` (the user can choose Sonnet or Haiku 5.5 in Settings).

## Product and UI conventions

- **Design "direction B":** sharp and keyboard-first. Top tabs (Today, Tasks, Waiting, Weekly | Projects, People, then a boxed Import / Review group by the search box; Import tinted, Review shown only while it has items or is open; `MAIN_TABS` and `DAILY_TABS` in `CommandPalette.tsx`), a Ctrl+K command palette, mono numbers, and colors from the CSS variables in `styles.css`, which cover light and dark. Fonts are bundled (Inter, JetBrains Mono).
- **Density** (Settings → Appearance, also in the palette): Compact (the original look), Comfortable (default) and Spacious. It sets `data-density` on the root, and `styles.css` defines the spacing and text-size variables for each level (`--fs`, `--fs-sm`, `--fs-xs`, `--row-py`, `--gap` and so on). Use those variables instead of fixed px for text sizes and spacing, including inline `fontSize`. In Spacious, task rows show the priority reason under the title. The tab bar and status bar keep a fixed size.
- **Lists with details** (Tasks, Waiting, Projects, People) use `SplitView`: a draggable divider, a 360px minimum per pane, double-click for 50/50, and the position saved in settings. Each list has a search box (`SearchBox`, / to focus). Waiting is `TasksScreen` with `list="waiting"`; Tasks and Waiting have an Open / Done switch, and Reopen returns an item to the list it came from (`waited_on`). Above both is the project chip row (`components/ProjectChips.tsx`): one line, All pinned on the left, the other projects scrolling sideways, busiest first, then No project, each with its count; the screen filters by project itself so every count is right. Open lists are always grouped: Tasks into Overdue, This week (due by Saturday) and Later, Waiting into Follow up and Waiting (`sections` in `TasksScreen.tsx`); the keyboard follows the grouped order. Their rows (`TaskRow` with `list`) leave out the project label, which the stripe already shows; the project and priority reason appear on hover (Spacious keeps the reason line), and waiting rows name who they wait on. The project and person editors' task lists drop the label too (`showProject={false}`); Today keeps it. Score marks (✦ AI change, * set by hand) go before the number so scores line up.
- **Editors save pending edits automatically** when you move away: the task editor when you switch tasks, and Projects and People (`useAutosave`) when you pick another item, start a new one, or change tabs. An empty name isn't saved, and says so. Mark-done through the editor saves edits too. Delete is a two-click `ConfirmButton`.
- **Keyboard shortcuts:**
  - Global: Ctrl+K palette, N new task, G-then-letter to go to a screen (G then V is Weekly, G then I is Import), ← → for the previous or next tab (stopping at the ends; not while typing or while the SplitView divider has focus), "/" to search the list. No tab-number or theme keys (the theme is in the palette).
  - Lists (Tasks, Waiting, Projects, People, Review): Up/Down move, Enter opens or edits the item. No J/K.
  - Tasks: E marks done, Esc closes, Ctrl+Enter saves.
  - Review: A, R, Enter to edit. While editing, Ctrl+Enter accepts and Esc cancels.
  - Settings lists every shortcut (`SHORTCUTS` in `SettingsScreen.tsx`); keep it in step.
  - Buttons don't show keys. The bottom bar shows the keys for the current page: each screen calls `useShortcutHints` (`components/hints.ts`), and an open editor registers its own keys at a higher level, which win while it's open.
  - Global shortcuts run in the capture phase and consume their keys.
- **Project colors:** tasks are themed with their project's color. Tasks with no project get no label and a neutral stripe.
- **Import screen:** the mail card (Outlook or Apple Mail), then the text card: "Paste or drop text", the date at the top right (today by default; relative dates in the item count from it), Extract. No type, title or sender fields: the AI returns `item_title` and `item_kind` with an import and they replace the first-line title for text the user didn't name (`source_items.auto_named`; rename in Recent imports clears it). **Copilot Prompt Generator** (button at the top right, `components/CopilotPromptDialog.tsx`, `services/copilot.ts`): Teams chats or meetings prompts for an exact span starting at the end of the last imported answer (`copilot_coverage`, recorded when an answer starting with the marker line is imported). The prompt text lives in `services/copilot.ts`.
- **Copy:** sentence case and plain language, no exclamation marks. Say "Saved", not "Successfully saved!".
- **No explaining sentences in the app (Frank's preference).** Don't add helper text that explains what the app does or reassures the user, such as "Nothing is read until you do" or "Opens in Mail with this text above the quoted email. You save or send it there." It reads like an AI talking to the user. Labels, buttons, statuses and real errors (with how to fix them) are enough. This applies to mockups too: explanations belong in the mockup's notes box, not in the screen.
- **Model picker** (`components/ModelMenu.tsx`): one menu, used by Settings → AI and by the AI button at the bottom right. It lists Basic, the Claude models once a key is saved, and every model in Ollama ("Ollama gpt-oss:20b", no "(local)": the group header says where it runs). Up/Down, Enter, Esc. If the chosen model can't be used (no key, Ollama stopped, model not downloaded), the choice is kept and shown as unavailable in red, never switched silently (`AiStatus.available`, `problem`).

### Features: where the code is

What each feature does, rule by rule, is in [docs/BUSINESS-RULES.md](docs/BUSINESS-RULES.md) and [docs/AI-RULES.md](docs/AI-RULES.md). This list is where to find it and what's easy to get wrong.

- **Daily briefing** (`components/Briefing.tsx`, `services/briefings.ts`, `ai/briefing.ts`): on click or Ctrl+K only, no keyboard shortcut. Items always come from real tasks: the AI only picks ids and writes notes, and `assembleBriefing` drops anything else and puts every overdue task first. Tags (Overdue, Due Mon, Waiting 8 days, and so on) come from task data on `BriefingItem`, never from the AI. `write(trigger)` takes `'manual'` or `'scheduled'`, so a scheduler needs no change to the card or storage.
- **Meetings** (`components/MeetingsCard.tsx`, `MeetingPanel.tsx`, `NextMeeting.tsx`, `services/calendar.ts`, `shared/calendar.ts`): the current week, kept in memory only. `toMeetings` leaves out declined, cancelled, all-day, Free, and private entries (the Mac can't tell private ones). Meetings aren't linked to projects, and the briefing doesn't use them yet.
- **Context briefs and Updates:** every task, project, and person has a context brief whose summary is its **Updates** (dated lines, newest first; helpers in `src/shared/notes.ts`). On screen: an Updates button opens `UpdatesWindow`, and a Latest card shows the newest (`LatestUpdate`). "History" is only the daily briefing's list of past briefings. Projects and people also have standing instructions; tasks don't. What the AI is sent from Updates is in AI-RULES.md (`recentNotes`, `UPDATES_FOR_AI`).
- **Weekly review** (`screens/WeeklyScreen.tsx`, `services/weekly.ts`, `shared/week.ts`): the current week is live; ended weeks are saved once by `saveEndedWeeks` and never change. Weeks before `weekly_meta.started_week` are partly recorded. Pushed-back dates come from `task_events`, leaving out lines with `merged_from` set.
- **Resolution** (`work_items.resolution`, `components/MarkDoneDialog.tsx`): asked for by Mark done and E, optional; Cancel or Esc keeps the task open. `TaskInput.resolution` left out keeps the saved one. A Review "Looks done" suggestion's `details` becomes the resolution, not an Update. Not in Activity.
- **Task editor:** Notes are the user's own; the AI never writes them, except that accepting a new task from Review starts its Notes with the AI's details (an open question in BUSINESS-RULES.md). **Activity** (`components/ActivityLog.tsx`, `services/task-events.ts`, wording in `shared/events.ts`): `TaskService.save` records one line per changed field, and every save passes a `ChangeBy` (`user`, `review` with the import's title, or `ai` with where it came from); `SuggestionService.accept` passes `review`. `task_events_meta` is no longer read. Statuses are Open, Waiting on, and Done. Notes are about 6 lines tall at every density (`textarea.notes-inp`; a plain `.notes-inp` rule loses to `textarea.inp`).
- **Merge** (`components/MergeDialog.tsx`, `services/task-merge.ts`, rules in `shared/merge.ts`): two open tasks or two waiting items, never Done. Moved Activity lines get `task_events.merged_from`; Updates merge with `mergeUpdates`. Both status cards and AI priority changes are cleared.
- **Where this stands and next step** (`components/StatusCard.tsx`, `services/next-actions.ts`, `ai/status.ts`, tables `next_actions` and `project_cards`): always written together, never by Basic (Write is greyed out with a Settings link). Imports return them from `extract` as `next_actions`, each `{ task_id, status, action }` (Ollama asks in pass 1 only), checked by `cleanNextActions` / `cleanStatus`; Write's answer is checked by `cleanStatusCard`. Counted in AI spending as `status`.
- **AI priority adjustment** (`services/priority-adjustments.ts`, table `priority_adjustments`): at most ±`MAX_AI_ADJUSTMENT`. `effectivePriority` adds `task.aiAdjustment.delta`, so every list sorts by it; a score set by hand still wins. `cleanAdjustments` checks ids and holds the range.
- **Developer Tools and model tests** (Settings → Developer Tools, off by default; `screens/ModelTestScreen.tsx`, `services/model-tests.ts`): turning it on shows **Effort** under Model (`effortOf` ignores it while off) and the model test. Each import's input is rebuilt as it was when imported (`buildExtractionContext` with `asOf`), once per test, so every model gets the same input. Nothing goes to Review. Claude requests count in AI spending as `model_test`.
- **People** have a one-line brief (`people.brief`), written by the AI only on Regenerate and kept only if the user keeps it. New people start at 1 star.
- **Projects** have a hand-written overview (`projects.overview`, no AI) and the status card (Write only). The old AI status brief was removed: the upgrade saved each brief as a dated update and cleared `projects.brief*` (the columns stay, unused). Archived projects are left out of `projects.list`, so filters, editors, and the AI skip them; `projects.listArchived` is only for the Archived list.

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
- **Ollama setup** (`services/ollama-setup.ts`, Settings → AI providers): everything runs only when the user clicks. Install downloads the official installer from ollama.com, runs it only if its signature is valid (Windows `Get-AuthenticodeSignature`; Mac `codesign` and `spctl`), and never for a remote address. Download offers only `TESTED_LOCAL_MODELS` (today gpt-oss:20b and qwen3.8:27b-q4_K_M; use GGUF tags like `-q4_K_M`, because on a Mac the plain tags of newer models are MLX builds that can't give fixed-format answers); models installed outside the app still appear, marked Not tested.
- **Claude:** when selected, whatever a feature works on (the import, the related tasks and their updates, projects, people, and email threads for draft replies) is sent to Anthropic. The Import screen names where text is sent next to the Extract button; Settings carries no separate warning (Frank removed it).
- **Prompt injection:** imported content is fenced as data in the prompt, and the system prompt tells the model to ignore instructions inside it.
- **Mail import** (`services/mail.ts`, `mail/plan.ts`): classic Outlook on Windows (`PowerShellOutlook`, `mail/outlook.ps1`), Apple Mail on the Mac (`AppleMailReader`, `mail/applemail.jxa` run with `osascript`; the `.jxa` name keeps Vite and Vitest from loading it). Each computer shows only its own card. Read only on click. The scripts never send, move, delete, or flag mail. Messages read are recorded in `mail_messages`. Apple Mail reads only the accounts in `settings.mailAccounts`, fetches message text only at Read (`fillBodies`, because Mail is slow), and groups conversations by Exchange's Thread-Index, else the subject (`toMailbox`). It reaches Microsoft 365 over EWS, which Microsoft is retiring (ROADMAP.md, "Mac mail").
- **Calendar read** (`services/calendar.ts`): automatic (startup and every 30 minutes), read-only, nothing saved or sent. Windows: `outlook.ps1 -Action calendar` and `-Action openevent` (Outlook must be running). Mac: EventKit through `calendar/applecalendar.jxa`, only the calendars in `settings.calendarIds`; it needs `NSCalendarsFullAccessUsageDescription` in `electron-builder.yml`.
- **Draft replies** (`components/ReplyCard.tsx`, `services/replies.ts`, `ai/reply.ts`): the email answered is chosen by `replyPersonOf` and `replyTarget`, mirrored in `outlook.ps1` by `Test-Automatic` and `Test-Includes`; the mail app is asked live (`-Action latest -Person`, which walks `GetConversation()`, skipping drafts and Deleted Items). Emails the app hasn't read are added to the thread with `withUnread`. Recipients come from Outlook (`-Action recipients`) or, for Apple Mail, `replyRecipients`; never from the AI. Finishing: `replies.open` (`-Action reply -Open`, `Display()`) or `replies.save` (`-Action reply -ReplyAll`, `ReplyAll()` then `Save()`; Apple Mail `reply` then `save`, with no quoted original). Neither sends. Activity events are `reply_opened` and `reply_draft`. Counted in AI spending as `reply`.
- **Test fixtures:** tests and e2e never touch a real mailbox, calendar, or Ollama. `COS_OUTLOOK_FIXTURE` and `COS_CALENDAR_FIXTURE` (a JSON list of `RawMeeting`) are honored only for test data folders; `COS_MAIL_APP=apple-mail` makes them act as the Mac. The fixture Outlook writes saved drafts to `<fixture>.drafts.json`. Ollama tests use fake servers; never delete or pull on the real one.
- **AI log** (`services/ai-log.ts`, tables `extraction_runs` and `ai_calls`): each import run's exact requests and responses, what reached Review, and what was dropped and why (`validateSuggestions`' `dropped` list). The last 5 runs per import are kept and deleted with the import. Briefings and weekly reflections keep their own (`briefing_ai_calls`, `weekly_ai_calls`).
- **AI spending** (`screens/AiSpendingScreen.tsx`, `services/usage.ts`, table `ai_usage`): one row per successful Claude request, with the model that answered (`paidModel` on the `AiCallRecord`); never pruned. Costs are estimates from `CLAUDE_PRICES` in `src/shared/pricing.ts`.
  - **When Anthropic changes prices or adds a model**, update `CLAUDE_PRICES`, `PRICES_CHECKED`, and `PRICES_CHECKED_LABEL` after checking the pricing page. The model picker's price text comes from the same table.
  - **Prompt cache (imports):** `buildExtractionRequest` marks the instructions (`buildInstructions`, without the calendar) and the open tasks, projects, and people (`buildDirectory`) for Claude to cache; the calendar and item (`buildItem`) follow. A mail run builds that context once (`SourceService.extractionContext`). `input_tokens` stays the whole prompt; `cache_write_tokens` and `cache_read_tokens` price the cached part. Keep anything that changes per item out of the cached part, or the cache stops working.

## Environment notes (Frank's Windows PC)

- **Node.js:** Node 26 LTS, installed with winget. In shells started before that install, refresh PATH; in Git Bash, add `/c/Program Files/nodejs`.
- **npm install scripts:** npm holds these back. Electron downloads its binary on first run, or run `node node_modules/electron/install.js`.
- **Repo location:** the working copy is `C:\GitHub\chief-of-staff`, outside OneDrive, so it isn't backed up automatically. GitHub is the backup: push branches regularly. Only the app's daily backups go to OneDrive.
- **Claude Desktop sandbox:** Claude Desktop is a packaged Windows app, so anything run from a Claude session sees a private, redirected copy of `%APPDATA%` and `%LOCALAPPDATA%`, not the real folders. Reading `%APPDATA%\Chief of Staff` from a session shows that copy, not Frank's data. The installed app refuses to start in the sandbox (see DECISIONS.md, "Real data is never opened from inside Claude Desktop's sandbox"). The OneDrive backup folder is real.
- **Mac:** `npm run package:mac` must run on a Mac. It builds for Apple silicon only, ad-hoc signed (no Apple Developer ID; `electron-builder.yml` explains why hardened runtime is off). The built app was checked to launch; installing from the `.dmg` by hand hasn't been tested.
