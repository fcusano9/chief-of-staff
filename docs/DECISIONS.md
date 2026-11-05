# Decision log

Newest first. Each entry records what was decided, why, and who decided. Add an entry whenever a choice would surprise someone reading the code later.

### 2026-11-05 · Task Activity log, and pushed-back dates in weekly Slipping (Frank)
Frank's choices, asked up front (mockup `design/task-activity.html`, approved):
- **Recorded:** created; status (Open, Waiting on whom, Done, Reopened); due date set, moved or removed; project; asked by; title; priority set or cleared by hand; follow-ups; AI priority changes added, replaced or removed. Not recorded: notes, subtasks, updates (they have their own window) and the score's daily recalculation.
- **Every line says who:** "by you", 'from “Import”, accepted in Review', or "by the AI, daily briefing" / 'import “X”'.
- **Weekly Slipping now includes pushed-back tasks** (Frank chose to add it now rather than wait for history): amber "Pushed back N days" with the moves and who; an overdue task that was also pushed says so. The reflection is sent them too.
- **Proposed in the mockup, approved:** one line per field when a save changes several; the newest 8 lines, then Show all; dates moved earlier or removed don't count as slipping; weeks before the log show overdue only.
- **Decided while building:** pushed back is net over the week (Nov 6 → Nov 11 → Nov 8 counts as 2 days); a task finished by the week's end isn't slipping; values are stored as they read then (names, not ids), so renaming a project doesn't rewrite history. History starts when this ships; older tasks say "Changes before … weren't recorded."

### 2026-11-05 · AI priority adjustment: ±15, applied at once, undoable; an AI rules page (Frank)
Frank's choices, asked up front (mockup `design/priority-adjustment.html`, approved):
- **Written as part of a daily briefing or an import**, like next actions. Never on its own; Basic makes none.
- **Applied right away**, shown on the priority card with its reason and a Remove link, rather than going to Review or only being shown. A score set by hand still wins.
- **At most ±15:** enough to reorder close tasks, not enough to bury an overdue one.
- **Proposed in the mockup, approved:** the card shows the sum ("54 + 10"); a ✦ marks adjusted scores in lists; with a score set by hand the change stays visible, greyed, as "Not used"; a removed change can come back with a later briefing or import.
- **Decided while building:** the AI gets the computed score and its current change separately, so it revises its change instead of stacking a new one. A later change replaces the old one and 0 clears it; a briefing or import that skips a task keeps its change (simpler and safer than clearing everything it was sent but didn't mention). Imports now send each open task's score, so every import prompt is slightly longer.
- **`docs/AI-RULES.md`** (Frank asked): every AI rule and limit on one scannable page, kept current in the same PR as any rule change. DECISIONS.md keeps the reasons.

### 2026-11-05 · Suggested next action: part of briefings and imports, card only (Frank)
Frank's choices, asked up front (mockup `design/next-action.html`, approved):
- **Written as part of a daily briefing or an import**, not on its own and with no Suggest button: the briefing writes one for each top priority, an import for each open task the item is about. Basic writes none (rules can't judge a next step).
- **Shown on the card only**, never in Review. It's advice that changes nothing, like the briefing itself, so it doesn't need accepting. An import writes them when it runs, even if the user later rejects that import's suggestions; tasks the import proposes to mark done get none.
- **One sentence plus why.** One per task; the newest replaces it.
- **Dismiss collapses it** to "Suggestion dismissed · Show" (Frank chose this over hiding it for good). A new suggestion shows again.
- **Out of date** (proposed in the mockup, approved): when the task has an update dated a later day than the suggestion, the card says so in amber instead of hiding it. Updates are dated by day, so a same-day update doesn't count.
- **Notes made taller** in the same change: about 6 lines. The earlier attempt (`.notes-inp`, Nov 4) never applied because `textarea.inp` is more specific.

### 2026-11-05 · Weekly review: live lists, saved weeks, a reflection on click (Frank)
Frank's choices, asked up front (mockup `design/weekly-review.html`, approved):
- **Weeks run Sunday to Saturday.** The current week shows Sunday to today and updates as he works; every week is kept so he can go back to any of them. Its own **Weekly tab** next to Today (G then V; W was taken by Waiting).
- **Four lists:** Completed, New, Slipping, Waiting on. **Slipping is overdue tasks only**; due dates that move aren't tracked (Frank chose not to start recording them).
- **The reflection is for the user alone**, not a report for others: a summary, Went well, Slipped, Focus next. The lists update on their own with no AI; the reflection is written only when the user clicks, and says when tasks changed since. Text only; nothing goes to Review.
- **Ended weeks are saved automatically** the first time the app runs after Saturday midnight, and never change after. The lists are rebuilt as they stood at Saturday midnight from task dates (a task finished on Sunday still counts as overdue that week), so opening the app a few days late doesn't change them much.
- **Weeks before this feature** show Completed and New (from task dates) and mark Slipping and Waiting on as not recorded (Frank: "Yes, partly"). A week the app wasn't opened at all the week after is saved the same way; this was in the mockup notes and Frank approved it.

**How it's built:** `weekly_meta.started_week` is set the first time the app runs with this version. Saved weeks are JSON in `weekly_reviews` with titles as they were. A week's reflection is in `weekly_reflections` (refreshing replaces it), with the ids of the tasks it was written from, to count what changed. Its AI requests are kept for the newest 5 weeks only (`weekly_ai_calls`), and Claude usage counts toward AI spending as "Weekly reflections". A waiting item finished after a saved week shows no day count for that week, because the wait start isn't kept once a task is done.

### 2026-11-05 · Qwen 3.8 27B added to the tested local models (Frank)
Benchmarked on the M5 MacBook Pro (32 GB), 15 cases, standard (GGUF, `-q4_K_M`) builds:

| Model | Found | Dates right | Rule breaks | Failed | Median per item |
|---|---|---|---|---|---|
| gpt-oss:20b | 64% | 50% | 0 | 0 | 29 s |
| qwen3.8:27b-q4_K_M | 75% | 83% | 1 | 2 | 149 s |
| qwen3.6:27b-q4_K_M | 42% | 50% | 0 | 6 | 178 s |
| qwen3.6:35b-a3b-q4_K_M | 44% | 67% | 1 | 3 | 26 s |

**Decided:** Qwen 3.8 27B is offered for download because it's the most accurate local model tested, and it may be practical on a more powerful computer. gpt-oss:20b stays the default because it's about five times faster here. Qwen 3.8's two failures and Qwen 3.6's ran past 5 minutes and were reported as "Couldn't reach Ollama", so they look like a time limit, not a crash; not yet looked into. Qwen 3.6 35B-A3B was fast but proposed many extra projects and ran away on 3 items. **Why the `-q4_K_M` tag:** on a Mac, the plain `qwen3.6:27b`, `qwen3.8:27b` and `qwen3.8:27b-mlx` tags are all MLX builds, and Ollama's MLX engine answers every fixed-format request with error 501 ("structured output is unavailable"). The app now explains that error instead of showing it raw. gpt-oss:20b's found rate varies run to run (64–67% today), and in one of today's runs it followed the vendor-email prompt injection; Review stays the safeguard.

### 2026-11-04 · AI spending: estimated Claude costs on their own screen (Frank)
Frank wants to see what Claude costs as usage grows, so he can trim what's sent (mockup `design/ai-spending.html`, approved after three rounds). **Frank's choices:**
- **Its own screen**, opened from an "AI spending · $X this month" button on the Claude provider in Settings, so Settings stays short. It shows this month, the last 30 days, the average import (with tokens sent per import), and tables by purpose and by model.
- **The prices used are listed** on the screen, with a note that they may have changed and a link to Anthropic's pricing page. Prices are built in, not looked up online.
- **Estimated costs in the AI logs** for imports and briefings. The model and cost sit at the right of each request's header so they're never cut off in the narrower History window.

**Why a separate `ai_usage` table:** the AI logs are pruned (5 runs per import, deleted with the import; briefing requests for the newest 5 only), so monthly totals would shrink. The migration fills `ai_usage` from the Claude requests already in the logs. Person and project briefs weren't logged at all before; they now report usage too.

### 2026-11-04 · Simpler task editor: Notes, Updates and Activity (Frank)
Frank found the task editor confusing (Notes, Task brief and Standing instructions overlapped, and "What the AI knows" claimed more than was sent). Mockup `design/task-editor-simplified.html`, approved after several rounds:
- **Notes are his own**; the AI never writes them. **Updates** replace the task brief and the old status updates: everything learned from imports (status updates and context, each dated with its source) plus anything he adds. Tasks now work like projects and people.
- **"History" is renamed "Updates"** on Projects and People too, because History clashed with the daily briefing's History. Each has a **Latest** card under the button (Frank asked for it everywhere). **Activity** keeps its name (Frank) and is a plain log: created and linked imports. Recording status and due-date changes is on the roadmap backlog, kept out of this change (Frank).
- **Removed:** task standing instructions and "What the AI knows" (no AI read them), and the **In progress** status (nothing used it, and the AI couldn't set it; Frank). The "Suggested next action" placeholder stays (Frank).
- **The AI sees task updates.** Each open task sends its latest updates on imports, to match new items to the right task (Frank's choice; more work text goes to Anthropic when Claude is selected). **Whole updates only, up to 300 characters** (Frank chose 300 over a larger limit for now; 600 could be compared with `bench:ai` later). People and projects switched to whole updates too, so nothing is cut mid-sentence. The daily briefing reads Notes and Updates (Frank), and Updates on waiting items.
- **Migration (schema v11):** status updates become dated lines in each task's Updates, merged in date order with the old task brief; standing instructions become an undated "Standing instructions: …" line; In progress tasks become Open. The usual safety copy is taken first.

### 2026-11-04 · One model picker, AI providers set up in Settings, Basic replaces "Demo AI" (Frank)
Frank asked for a simpler way to choose the AI (mockup `design/ai-models-providers.html`, approved after two rounds). **Frank's choices:**
- **One Model picker** replaces Provider + Model. It lists whatever is set up: Basic, Claude Opus / Sonnet / Haiku 5.5 once a key is saved, and every model in Ollama as "Ollama <name>" (no "(local)"; the group header says where it runs). The same menu opens from the AI button at the bottom right, which used to jump to Settings.
- **AI providers** is where each one is set up. Claude: key, Save, Test connection. Ollama: found automatically; Install Ollama downloads and opens the official installer; Start Ollama starts an installed one; one model list shows each model as Not downloaded, Downloading or Downloaded, with a two-click Delete.
- **Only tested models are offered for download**, a curated list Frank vets (today just gpt-oss:20b). Models installed outside the app still show, marked Not tested.
- **"Demo AI" is now Basic** (it's real, not a demo), and Settings says it's simple rules, not actually AI.
- Icons are the Claude and Ollama marks from Simple Icons (CC0).

**Also decided:** if the chosen model becomes unusable, the app keeps the choice and shows it as unavailable rather than switching AI without asking. The installer only runs if its signature checks out, and nothing installs for a remote Ollama address. Settings fields are unchanged (`aiProvider`, `aiModel`, `localModel`), so nothing migrates. **Not verified:** the install flow end to end on Windows or Mac (Ollama was already installed on the Mac).

### 2026-11-04 · Daily briefing: on click only, ready for a schedule later (Frank)
Frank's choices, asked up front (mockup `design/daily-briefing.html`, approved):
- **Only when the user clicks** (Write briefing, Refresh, or "Write briefing" in Ctrl+K). This settles the roadmap's pending decision for now. A schedule may be added later, so `BriefingService.write(trigger)` takes `'manual'` or `'scheduled'` and each briefing records it (`briefings.started_by`); a scheduler only needs a time setting that calls `write('scheduled')`. No keyboard shortcut (Frank).
- **Three sections:** Top priorities, Waiting-on nudges, New since last briefing, under a one-line summary. Overdue tasks aren't a section of their own: they lead Top priorities with a red "Overdue N days" tag and edge (Frank). Empty sections stay, with a line saying so, so the layout doesn't jump.
- **Full width** between the number cards and Focus (Frank chose this over the side column). No Import button and no "sends data to Anthropic" line on the card (Frank).
- **Text only:** the briefing changes nothing and adds nothing to Review.
- **Items come from the database, not the AI.** The AI picks task ids from lists the app sends and writes the notes; `assembleBriefing` drops ids it made up or put in the wrong section, always lists every overdue task first (with a factual note if the AI skipped it), and lists everything new whether or not the AI wrote about it. The Review line is the app's own count.
- **Every briefing is kept**, with the titles as they were, so History reads the same later. Each is a few KB. The AI requests behind them (`briefing_ai_calls`, tens of KB each) are kept for the newest 5 only, like imports' AI log. History has an "AI log" button.

### 2026-11-03 · Worked examples for the local model: tried and dropped (Frank)
A made-up item with its correct answer was shown before each of the local model's split passes. On 15 benchmark cases (4 new, written before the examples and unlike them), gpt-oss:20b found 69% with and without examples. Examples helped with updates and context for existing tasks, projects and people (9 of 13 on the new cases, against 7), but dates got much worse (25% right, against 58%), extras rose from 5 to 8, and it missed new projects in two kickoffs. Likely cause: the long example pushes the calendar far from the real item. **Decided:** no examples. Repeating the calendar next to the item is an untested idea if this is revisited. Run-to-run differences of a few points are normal at this benchmark's size.

Claude on the same 15 cases, medium effort (rerun 2026-11-03): Opus 5.5 found 100% (dates 100%, about 6.5 s per item); Sonnet 5.5 100% (dates 100%, about 4 s, roughly half Opus's price); Haiku 5.5 97% (dates 92%, about 6 s). No Claude model broke a rule. Which provider to use stays Frank's call.

### 2026-11-03 · Archived projects can be found again; Projects and People save on switch (Frank)
- **Archived projects** were hidden everywhere with no way back. Projects now has an Active / Archived switch (mockup `design/projects-archived.html`, approved). An archived project opens as usual with an "Archived" note and **Unarchive**; changing Status in the form moves it between the lists too. They stay out of `projects.list`, so Tasks filters, the task editor and the AI still leave them out; `projects.listArchived` is only for this tab.
- **Auto-save:** Frank lost edits on Projects and People, which kept changes only until you switched away. They now save pending edits like the task editor (`useAutosave`): on picking another item, starting a new one, or changing tabs. An empty name isn't saved, and says so.

### 2026-11-03 · Waiting apart from Tasks, Done lists, search, People history (Frank)
Frank asked for these after using the app day to day. The mockup `design/lists-waiting-done-search.html` was approved.
- **Waiting is its own list.** Tasks shows open and in-progress items only. Waiting is the same screen showing only waiting-on items, longest waiting first, with the same project filters and editor. "New waiting item" (or N on that tab) starts as Waiting on. Today still shows both, as before.
- **Done items:** an Open / Done switch on Tasks and Waiting, newest first, up to 200. Frank chose this over a separate tab or the Archive. Reopen puts an item back where it came from. To know which finished items were waiting on someone, `work_items.waited_on` (schema v9) records who, from the moment a waiting item is marked done. Items finished before this change count as tasks.
- **"No deadline or urgency signals" isn't shown in lists.** The score is unchanged; the text added nothing (`NO_SIGNALS`).
- **Search** on Tasks, Waiting, Projects and People, in the same toolbar spot, with / to jump to it. Tasks and Waiting search the database (title, notes, who it waits on); Projects (name, overview) and People (name, role, company, brief) filter the loaded list.
- **People history matches Projects:** the text box became a History button and window (shared `HistoryWindow`). Saving a person no longer writes the history, so notes added in the window or from Review can't be overwritten.
- **New people start at 1 star**, both added by hand and proposed by the AI (was 3).

### 2026-11-03 · Quieter Review, and person context updates role and company (Frank)
After his first large mail import, Frank asked for three changes:
- **Titles stand apart from details:** titles are 14px semibold, details are smaller and grey and cut to two lines (hover for the rest), and info lines like "Due Fri · Asked by…" are lighter still.
- **No quotes in Review:** the supporting quote made a long queue too busy. It's still stored and shown in the AI log.
- **Person context fills in Role and Company:** a "Person context" suggestion can carry a role or company when the import states one that differs from People. Review shows it as "Role: old → new", Edit can change or clear it, and accepting saves it. If that's all it has, no empty context note is added.

### 2026-11-03 · Real data is never opened from inside Claude Desktop's sandbox (Frank)
**What happened:** Claude Desktop is a packaged (MSIX) Windows app. Programs started from it inherit its file redirection, so whatever they save under AppData quietly goes to `%LOCALAPPDATA%\Packages\Claude_…\LocalCache\Roaming\…`. The installed app, started from a Claude session, read and wrote that private copy. Frank's morning import (7 tasks, a project, his API key) was saved there, while the Start-menu app kept using the real folder. His data looked lost until the two folders were compared. The OneDrive backup folder isn't redirected, so its backups were real. Every check made from inside Claude also saw only the private copy, which misled the first diagnosis.

**Decided:** on startup, the installed app (real data only) writes a probe file to its data folder and checks whether it landed in any package's private copy (`findRedirectingPackage` in `paths.ts`). If it did, the app shows "Open Chief of Staff from the Start menu" and quits before touching the database. Dev and test runs, which use their own folders, are unaffected.

**For AI assistants:** don't launch the installed app from a Claude session to check real data, and don't read `%APPDATA%\Chief of Staff` from one and treat it as real. The OneDrive backups are the reliable view.

### 2026-11-03 · Outlook mail import (Frank)
Frank wants the app to read his mail since the last import, find action items and emails that need his reply, and track who owes him an answer from his sent mail. **Frank's choices** (asked up front; mockup `design/outlook-mail-import.html` approved):
- **Trigger:** a button only, no schedule.
- **Folders:** Inbox and all its subfolders, plus Sent Items.
- **Start:** the last finished import. The first run goes back 7 days, and he can pick 30 days or any date to go further while proving it out.
- **AI:** whichever provider is selected, as with other imports.
- **Skipped:** newsletters and mailing lists, automated senders, meeting invites and automatic replies. "Read anyway" overrides a skip.
- **Needs reply:** a task "Reply to <name>: <topic>", ranked like any task.
- **Sent mail:** a waiting-on item right away, counted from when he sent it. After 3 business days with no answer it shows "Follow up" on Waiting and climbs in priority. When the answer comes, Review offers "Reply arrived" to clear it.

**How it works:**
- **Reading Outlook:** a PowerShell script talks to classic Outlook over COM (Electron can't), writes JSON to a temp file, and is deleted afterwards. It only reads, apart from showing one message for "Open in Outlook". It never sends, moves or flags anything. It uses the running Outlook and says so if Outlook is closed, rather than starting it.
- **Two steps:** "Check Outlook" sends nothing to the AI. "Read" sends one conversation at a time in the background while the screen polls for progress. Stop finishes the current conversation, and the rest is offered next time. A stopped run doesn't move the start date.
- **One import per conversation:** received and sent messages are read together, oldest first, with quoted history removed (kept only under the first message, for context). On a week of Frank's real mail that cut the text sent from about 1.6 million to 390,000 characters. Each conversation is a normal import with its own AI log and Run again; Recent imports shows one row per mail import.
- **Never read twice:** every message read is recorded by its Internet message id (`mail_messages`), so going back further only adds older mail.
- **App rules over AI guesses:** if the user wrote the newest message, any "needs reply" is dropped (shown in the AI log), and a waiting-on starts at the time the user sent the ask.
- **A new suggestion kind**, `needs_reply`. "Reply arrived" is a "Looks done" on a waiting-on task from an email, relabeled in Review.

**A change from the mockup:** the mockup also skipped conversations where the user replied last. Those are now read, because they're exactly where the user's sent asks are, and only "needs reply" is suppressed.

**Not done yet:** draft replies, calendar, and a benchmark of real models on the new email cases (no Ollama or Claude key on the Windows PC).

### 2026-11-03 · Database versions 5–7 after parallel work
The project overview (PR 9) and the AI log (PR 10) were built in parallel, and both added schema version 5. Frank's Windows database had already applied the AI log as version 5, from an installed development build.
- **Resolution:**
  - The project columns, already on `main`, stay version 5.
  - The AI log becomes version 6, using `CREATE … IF NOT EXISTS`, so re-running it is harmless.
  - Version 7 is a repair step that adds any missing project or AI-log columns. Migrations can now be functions for steps like this.
- **Lesson:** when two branches both add a migration, the second one to merge renumbers and must handle databases that already ran the other branch's build.

### 2026-11-03 · AI log per import (Frank)
Frank wants to see the exact prompts sent to the AI and the exact responses, so he can debug imports.
- **Storage:** every request is recorded as sent, and every response as received. The SDK-added `parsed_output` is stripped, and helper functions drop out as they do on the wire. Records are tied to the import's extraction run, along with the app's keep/drop decisions and reasons.
- **Retention:** the newest 5 runs are kept per import, locally only.
- **Where it's shown:** an "AI log" page, opened from Import and Review, with tabs for Instructions, Message, Answer form, Response and Full request. The design was approved from a mockup.

### 2026-11-03 · Projects: hand-written overview, AI status brief, history in a window (Frank)
Frank asked for a project overview under the name, like the People brief, and for the project brief to be a short, high-level status the AI writes from the full history of imports, with that history out of the way behind a button. **Frank's choices** (from the approved mockup `design/project-overview-brief.html`, after three rounds): the **overview** is one sentence (two at most) that he writes himself, because it rarely changes, so it has no Regenerate; a pencil icon (or clicking the text) edits it; it's in the softer muted color, and the project name is bigger (20px), so the two don't look alike; it also shows under each name in the list. The **project brief** is a status: where it stands with dated decisions, a "Next:" line and an "Open:" line, under 120 words. It works like the People brief: Regenerate shows a suggestion with Keep, Discard and Try again, Edit writes it by hand, nothing changes until Keep, and a "new notes since this brief" hint replaces automatic rewrites. The **History** button opens a window with every dated note, newest first, with new notes marked; Frank can add a note or edit it all as text there. **How it's stored:** `projects.overview`, and `projects.brief` with who wrote it, when, and the history it was written from (to count new notes). The history is the existing project `context_briefs.summary`, unchanged, so nothing was migrated: existing projects start with no overview or brief. Accepted "Project context" suggestions keep adding dated lines to the history. **What the AI reads on imports:** each project's name, overview, status brief (or the newest 400 characters of history when there's no brief) and standing instructions. Before, it read the first 400 characters of the brief box, which were the oldest notes. **Brief input:** the history (only the newest ~24,000 characters if it's very long, so it fits the local model), the open tasks with due dates, the overview, standing instructions and today's date. Claude writes it at low effort with structured output; Ollama and the demo AI implement the same `writeProjectBrief`.

### 2026-11-03 · Data safety before full-time use (Frank)
Frank asked whether updates could lose his data before moving his work into the app. Three safeguards were added:
1. **Automatic safety copy before every schema upgrade.** If no copy can be made, the upgrade is refused.
2. **Dev and test runs use their own data and backup folders.** Previously, `npm run dev` would have opened the real database, and a dev instance could even prune the real OneDrive backups.
3. **Restore from backup in Settings.** It saves current data first, so a restore is always undoable.

Daily backups are now single self-contained files, and listing backups never writes to the backup folder. **Why:** an update bug should cost at most the changes since the safety copy, never everything. And an AI assistant running the app from source must never be able to touch real data.

### 2026-11-02 · People: company, filters, and a one-line brief apart from the context history (Frank)
Frank asked for a Company field, filters on the People list, and a person brief that is just one sentence (two at most) on who someone is and what they do, while keeping the full history. **Frank's choices** (from the approved mockup `design/people-company-brief.html`): the brief is plain text right under the name with **Edit** and **Regenerate**; Regenerate shows the AI's sentence in place with Keep, Discard and Try again, and nothing changes until Keep; the AI writes a brief only when he clicks, with a "new notes since this brief" hint instead of automatic rewrites; filters are **Company** (including "No company") and **Open asks** (tasks they asked for, plus tasks waiting on them, matched by name); Company sits above Role; and the AI fills in Company for a new person only when the import states it. **How it's stored:** `people.brief` (plus who wrote it, when, and the history it was written from, to count new notes); the existing person brief summary is unchanged and is now labeled "Context history", so nothing was migrated or lost. **What the AI reads on imports:** each person's name, role, company and one-line brief, or the newest 300 characters of their history when there's no brief. Before, it read the first 200 characters, which were the oldest notes. Claude writes briefs at low effort with structured output; Ollama and the demo AI implement the same `writePersonBrief`.

### 2026-11-02 · Local model: split passes and a calendar; Claude Opus as the yardstick
Frank asked for better local results even if slower. Benchmarked on the M5 MacBook Pro against Claude Opus 5.5 (8 cases, 19 expected suggestions, same scoring):

| Setup | Found | Dates right | Typical item | Long transcript |
|---|---|---|---|---|
| gpt-oss:20b before | 68% | 29% | 17 s | 42 s |
| + calendar in the prompt | 68% | 57% | 24 s | 37 s |
| + medium reasoning | 84% | 71% | 95 s | 137 s |
| **+ split passes (default)** | **84%** | **86%** | **40 s** | **67 s** |
| + split passes and medium reasoning | 89% | 86% | 124 s | 173 s |
| Claude Opus 5.5 | 100% | 100% | 7 s | 18 s |

**Decided:** every prompt includes a three-week calendar (helps Claude too), and the local provider defaults to split passes at low reasoning: tasks, then projects/people/context, then a short pass that links new tasks to new projects and people. Medium reasoning is still an `OllamaOptions` setting for the benchmark. A "Thorough" choice in Settings was added, then removed at Frank's request (2026-11-03): one more suggestion in 19 wasn't worth three times the wait. No local setup broke a rule. "Must not" benchmark checks now look at titles only, because Opus's details mentioned other people's work and were wrongly flagged.

### 2026-11-02 · AI proposes new projects and people, and links tasks to them (Frank)
Two new suggestion kinds, `new_project` and `new_person`, plus clearer instructions for context (brief) updates, which Review now labels "Project context" and "Person context". **Frank's choices:** projects only for named initiatives with their own goal or several pieces of work; people only if they ask Frank for something, he's waiting on them, or they own work he cares about; new people always start at 3 stars (the AI never guesses weight); and a task linked to a new project or person creates it when accepted, while rejecting the project or person just removes the link. Anything already in Projects or People, and Frank himself, is never proposed. Links are stored as suggestion ids (`projectSuggestionId`, `requesterSuggestionId`, `waitingOnSuggestionId`) and swapped for real ids when decided. **Benchmark (gpt-oss:20b):** finds new projects and people, but rarely links tasks to them on its own; Frank can link them in Edit. Moving the prompt-injection rule to the top was needed to keep it ignoring injected instructions with the longer prompt.

### 2026-11-02 · Local models through Ollama, default gpt-oss:20b
A third provider runs a model on the computer through Ollama's HTTP API, so nothing leaves the machine. It uses plain `fetch` (no new dependency), Ollama's JSON-schema constrained output, a context window sized to each prompt (Ollama's default silently drops the start of long prompts), and the shared validation. **Why gpt-oss:20b:** on Frank's MacBook Pro (M5, 32 GB) it found 85% of expected suggestions with no rule breaks, at about 17 s per item and 12.7 GB of memory. qwen3:8b was as fast but followed a prompt injection and proposed duplicates; qwen3:30b returns empty answers with thinking off. gpt-oss can't turn thinking off and thinks at length if sent `false`, so it gets `think: "low"`. Claude hasn't been benchmarked yet (no key on the Mac). Demo AI stays the default provider.

### 2026-11-02 · Refusal fallback on for Claude extraction
On Opus 5.5 and Sonnet 5.5, extraction requests send `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`). If Claude's safety classifier declines, the API reruns the request on a fallback model instead of failing. This follows Anthropic's guidance. Frank was told; it's easy to remove.

### 2026-11-02 · Demo AI is the default provider
A local, rule-based provider ships so the import and review flow works and can be tested without an API key or any data leaving the PC. Claude is used only when the user selects it and stores a key. **Why:** the key and Crestron's data policy were still pending.

### 2026-11-02 · Claude model default: Opus 5.5
`claude-opus-5-5` is the default, at medium effort, with Zod structured outputs through `client.beta.messages.parse`. Sonnet 5.5 and Haiku 5.5 can be chosen in Settings. Cost tradeoffs are Frank's decision.

### 2026-11-02 · API key in OS-encrypted storage
Electron `safeStorage` (Windows DPAPI, macOS Keychain) in `secrets.json`. The key is never shown in the UI or written in plain text.

### 2026-11-02 · Task detail is a resizable 50/50 split, not a pop-up (Frank)
List on the left, task on the right, with a draggable divider and a 360px minimum per pane, so the list can scroll while a task is open. The same pattern is used for Projects and People. Edits save automatically when switching tasks.

### 2026-11-02 · Design direction B (Frank)
Sharp and keyboard-first (inspired by Linear and Superhuman): top tabs, a Ctrl+K palette, dense rows with scores, and light, dark or follow-system themes. Chosen from three mocked-up directions because the WinUI version "looked too much like a Microsoft app". The prototype is in `design/`.

### 2026-11-02 · Electron + React + TypeScript instead of WinUI 3 / .NET 10 (Frank)
**Why:**
- full control over the look
- Mac support
- one language for the UI and back end
- the official Anthropic TypeScript SDK

Chosen over Tauri with a .NET back end. Milestone 1 was ported, and the .NET code remains in git history at commit `0d92947`.

### 2026-11-02 · SQLite through built-in `node:sqlite`
Electron 45's Node 24 includes `node:sqlite` with the online `backup()` API. That avoids native modules like better-sqlite3, so there's nothing to rebuild per Electron version or OS.

### 2026-11-02 · Local database, OneDrive backups
The live database stays in app data, not a synced folder, to avoid corruption from sync. A daily snapshot goes to OneDrive and the last 30 are kept.

### 2026-11-02 · Priority score is deterministic and explainable
A 0–100 score combines due date, the requester's weight (1–5 stars), and staleness and follow-ups, with weights adjustable in Settings. Every score shows its top reasons, and a manual override always wins. An AI adjustment may be added in milestone 3, but it must stay explainable.

### 2026-11-02 · Context briefs for projects, tasks and people (Frank)
**Why:** Frank doesn't want to re-explain context to the AI. Each brief has a summary and standing instructions, and every AI request includes the relevant briefs. AI-proposed brief updates go through Review.

### 2026-11-02 · Optional projects; no label for one-off tasks (Frank)
Tasks don't need a project. Tasks with no project show no label and a neutral stripe.

### 2026-11-02 · Pluggable connectors; no IT dependency for v1
The M365 Copilot Chat API, Meeting Insights and Graph need an Entra app registration, a Copilot license, and IT approval. So v1 starts with paste and import plus Claude, and the Copilot and Graph connectors come later.
