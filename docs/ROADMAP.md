# Roadmap

What's built, what's next, and what still needs checking. Update this file when a milestone lands or the plan changes. The reasons behind each choice are in [DECISIONS.md](DECISIONS.md).

## Background

The app is for people who track work in Microsoft To Do and OneNote and use M365 Copilot to summarize email, Teams, and meeting transcripts, then turn those summaries into action items by hand. Chief of Staff, inspired by Lon.tv's app of the same name, aims to:

- replace To Do as the task system
- pull work items from email, Teams, and transcripts
- use a pluggable AI (Claude, local models, and later M365 Copilot) to propose tasks, write status updates, rank by urgency, recommend next actions, and draft replies
- keep a knowledge archive that can be queried years later

**Hard rule: nothing is sent or decided without the user.**

## Status

| # | Milestone | Status |
|---|---|---|
| 1 | Foundation: tasks, subtasks, projects, people, priority score, waiting-on, backup, settings | ✅ Done (first built in WinUI, then ported to Electron) |
| 2 | AI core: provider interface, Claude and Basic providers, encrypted key, import, review queue | ✅ Done |
| 2.1 | Local AI: Ollama provider, setup from Settings, extraction benchmark (`npm run bench:ai`) | ✅ Done. Benchmarked on the Mac only |
| 2.2 | AI-proposed projects and people, with tasks linked to them | ✅ Done |
| 2.3 | People: company, Company and Open asks filters, one-line AI brief on Regenerate | ✅ Done |
| 2.4 | Data safety: safety copy before upgrades, separate dev and test data, Restore from backup | ✅ Done |
| 2.5 | Projects: hand-written overview and Updates (the AI status brief was later replaced by the status card) | ✅ Done |
| 2.6 | AI log: the exact requests and answers for each import, and why suggestions were dropped | ✅ Done |
| 2.7 | AI spending: estimated Claude costs by month, purpose, and model, and per import | ✅ Done. Not yet checked against a real Claude bill |
| 3 | Priorities and briefings | In progress: tray icon, start with Windows, notifications, and a scheduler remain |
| 4 | Outlook, Apple Mail, and calendar | In progress: the briefing using meetings, and meeting prep, remain |
| 5 | Knowledge archive | Planned |
| 6 | Graph and Copilot connectors | Blocked on IT approval |

**Also built outside the milestones:** simpler text import with AI-named imports and the Copilot Prompt Generator ([COPILOT-PROMPTS.md](COPILOT-PROMPTS.md), Nov 9), merging two tasks or waiting items (Nov 17), Claude prompt caching for imports (Nov 19), and model tests with the Effort setting behind Developer Tools (Nov 19, issue #67: re-run past imports on up to 6 models and effort levels, and compare what the user accepts, the cost, and the time).

## Milestone 3: priorities and briefings

- ✅ **Daily briefing** on Today, when the user clicks: a summary, Do next, Follow up, and New, with every briefing kept in History.
- ✅ **"Where this stands" and next step** on task and project cards. Tried on made-up demo data on Nov 5: specific with all three Claude models, weak with gpt-oss:20b (see AI-RULES.md, "How the AI has done in tests").
- ✅ **AI priority adjustment** (±15, with a reason), written with a briefing or an import. Same Nov 5 test: sensible with Claude; gpt-oss:20b made no changes.
- ✅ **Weekly review:** each week's Completed, New, Slipping, and Waiting on, plus an AI reflection for the user.
- ✅ **Task Activity log**, which also feeds pushed-back dates into weekly Slipping.
- **To do:** tray icon, start with Windows, Windows notifications, and a scheduler. The briefing runs only on click for now (decided Nov 4); `BriefingService.write('scheduled')` is ready for a scheduler.

## Milestone 4: Outlook, Apple Mail, and calendar

- ✅ **Mail import:** classic Outlook on Windows (a bundled PowerShell script over COM) and Apple Mail on the Mac. Check, then Read; suggestions go to Review.
- ✅ **Draft replies** on tasks linked to an email: always Reply all on the last email that included the person the task is with; opened in a window or saved to Drafts, never sent.
- **Calendar**, in three steps (decided Nov 14):
  1. ✅ **Meetings on Today**, the task editor, and the person editor, read from Outlook or Apple Calendar.
  2. **The daily briefing uses the week's meetings.** With Claude selected, meeting titles, times, attendee names, and the shortened invite may be sent.
  3. **Meeting prep:** ✦ Prep on a meeting writes talking points from the open items with its attendees and recent updates, on a card, never to Review.

### Mac mail: options and risks

Outlook on the Mac can't be scripted, so the Mac reads mail through another app signed in to the work account. Frank chose the order to try: **Apple Mail (built), then Thunderbird, then Airmail and eM Client.**

- **New Outlook for Mac** has no scripting (Microsoft cancelled the AppleScript roadmap item, RM88537, in August 2026). Legacy Outlook for Mac is being retired and uses EWS.
- **Graph** (the app signing in to Microsoft itself) needs an Entra app registration, which usually needs IT (milestone 6). Outlook MCP servers go through Graph too.
- **EWS is going away.** Microsoft began switching off Exchange Web Services in Exchange Online on 2026-10-01, company by company, and plans to finish on 2027-04-01. Apple Mail reaches Microsoft 365 over EWS, so it stops syncing when the company's turn comes. Apple has said a Graph-based Mail update is coming in a future macOS 27 release, with no date.

| Fallback | Microsoft 365 connection | How the app would read it | Drafts | Cost |
|---|---|---|---|---|
| **Thunderbird 154+** | Graph (since August 2026, mail only); approved apps can reportedly ask the user without IT | A small Thunderbird add-on, talking to the app through native messaging | Probably (to verify) | Free |
| **Airmail** | Not confirmed (could be EWS) | Its local MCP server (127.0.0.1:9876), called by the app, never by the AI | `save_as_draft` | Free for one account; Pro about $30–50 a year |
| **eM Client 11** | Graph (one review says beta) | AppleScript, new in version 11 (claimed by eM Client only) | Not stated | Pro about $40 a year |

**Ruled out:** Spark (read-only scripting, and mail passes through Readdle's servers), Superhuman (hosted, and its drafts don't appear in Outlook), MailMate and Mailspring (no scripting), and Canary (no MCP server). Community Apple Mail MCP servers add nothing over scripting Mail directly.

## Milestone 5: knowledge archive

- **Search:** SQLite FTS5 keyword search, plus local embeddings (for example ONNX all-MiniLM) for semantic search, so archive text isn't sent out just to be indexed.
- **Ask the archive:** a chat that answers with citations to dated sources.

## Milestone 6: Graph and Copilot connectors (needs company IT)

- Microsoft Graph for mail, Teams chats, and meeting transcripts.
- M365 Copilot Chat API and Meeting Insights as AI providers or sources.
- **Needs:** an Entra app registration, a Copilot license, and IT approval.

## Not yet verified

Built and covered by tests, but not yet tried for real:

- **AI quality on real data:** the daily briefing, weekly reflection, and status cards. The extraction benchmark hasn't been rerun since the import prompt gained status bullets, import names, and the item-date calendar.
- **Windows PC, Outlook:**
  - AI reading of real mail (Check was tried against real Outlook).
  - Calendar: whether `-Action calendar` lists repeating meetings and attendee emails, whether it triggers Outlook's security prompt, and Open in Outlook on an occurrence.
  - Draft replies: whether saving triggers the security prompt, whether the signature appears, whether `-Action latest` finds a follow-up in Sent Items, who Reply all addresses on the user's own email, Open in Outlook (`-Action reply -Open`), and the address on the Outlook card (`-Action me`).
  - The extraction benchmark.
- **Mac:**
  - The packaged app's first-run prompts to control Mail and read calendars.
  - Whether a draft saved to Apple Mail shows in Outlook's Drafts.
  - Installing from the `.dmg` by hand.
  - An e2e suite for Apple Mail (the fixture can act as Apple Mail with `COS_MAIL_APP=apple-mail`; only `calendar.mjs` uses it so far).
- **Other:** a real Copilot answer keeping the marker line; the Ollama install flow end to end; model tests and Effort with a real Claude key or Ollama (tested only with fakes).

## Later: in-app updates (not scheduled)

Requested 2026-11-05, not to be built yet: detect new versions on GitHub, offer a one-click update, and show release notes in the app.

**To decide before building:**
- **Signing:** unsigned updates may trigger Windows SmartScreen, and automatic updates on a Mac generally need a signed, notarized app. Certificates cost money, which is Frank's call.
- **Releases** now exist (tagging `vX.Y.Z` builds a draft release), and the repo is public, so the app can read them without a token.
- **Data safety:** an update that changes the database already gets the automatic safety copy.

## Smaller backlog

- An app icon (it still uses Electron's default).
- `.docx` import.
- A signed installer.
- Tuning the local model's prompts for next actions and priority changes (for example a separate short pass), and trying qwen3:30b with thinking on.
- Grow the benchmark cases from real imports that went wrong.
