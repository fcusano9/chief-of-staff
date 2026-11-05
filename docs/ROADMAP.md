# Roadmap

The milestones agreed with Frank, what's done, and what each remaining one includes. Update this file when a milestone lands or the plan changes.

## Background

Frank tracked work in Microsoft To Do and OneNote and used M365 Copilot each week to summarize email, Teams and meeting transcripts, then turned those summaries into action items by hand. Chief of Staff, inspired by Lon.tv's app of the same name, aims to:

- replace To Do as the task system
- pull work items from email, Teams and transcripts
- use a pluggable AI (Claude first, M365 Copilot and others later) to propose tasks, write status updates, rank by urgency, recommend next actions and draft replies
- keep a knowledge archive that can be queried years later

**Hard rule: nothing is sent or decided without Frank.**

## Status

| # | Milestone | Status |
|---|---|---|
| 1 | Foundation: tasks, subtasks, projects, people, briefs, priority score, waiting-on, backup, settings | ✅ Done (built in WinUI, then ported to Electron; PR 1) |
| 2 | AI core: provider interface, Claude and demo providers, encrypted key storage, paste/file import, extraction, review queue | ✅ Built (PR 2). Claude has never run with a real key |
| 2.1 | Local AI: Ollama provider, extraction benchmark (`npm run bench:ai`) | ✅ Built. Local models benchmarked on the Mac; Claude and the Windows PC not yet |
| 2.2 | AI-proposed projects and people, linked tasks, clearer context suggestions | ✅ Built. Benchmarked with gpt-oss:20b only |
| 2.3 | People: company, Company and Open asks filters, one-line AI brief with Regenerate | ✅ Built. Benchmark not rerun yet |
| 2.4 | Data safety: safety copy before upgrades, separate dev/test data, Restore from backup | ✅ Built (`data-safety` e2e suite) |
| 2.5 | Projects: hand-written overview, AI status brief from the history, History window | ✅ Built |
| 2.6 | AI log: the exact requests and responses for each import, plus why suggestions were dropped | ✅ Built (`ai-log` e2e suite). Not yet seen with a real Claude or Ollama run |
| 3 | Priorities and briefings | In progress. Daily briefing built (`briefing` e2e suite); not yet tried with Claude or a local model |
| 4 | Outlook | Mail import built (`mail` e2e suite; checked against real Outlook, AI reading not yet tried on real mail). Calendar and draft replies planned |
| 5 | Knowledge archive and meeting prep | Planned |
| 6 | Graph and Copilot connectors | Blocked on IT approval |

## Milestone 3: priorities and briefings

- ✅ **Daily briefing (AI)** on Today, when Frank clicks: a one-line summary, then Top priorities (overdue first, tagged), Waiting-on nudges, and New since last briefing. Every briefing is saved and browsable in History. A schedule (for example 7:30) can be added later; see DECISIONS.md.
- **Per-task "suggested next action"** in the task editor. A placeholder card exists today.
- **AI-written status updates** for open items. They go through Review like everything else.
- **Weekly review screen:** completed, new, slipping, and a status-report draft (copy, or save to Outlook drafts in milestone 4).
- **An AI adjustment to the deterministic priority score**, with a one-line rationale. Overrides always win.
- **Tray icon, start with Windows, Windows notifications, and a scheduler.**
- **Decided (2026-11-04):** the daily briefing runs only when Frank clicks, for now. A schedule may come later.

## Milestone 4: Outlook

- Classic Outlook on Windows through COM, via a small helper, since Electron can't call COM directly. ✅ A bundled PowerShell script (`src/main/mail/outlook.ps1`); no security prompt on Frank's PC.
- ✅ **Mail import** (Import → Outlook mail): a button, not a schedule. "Check Outlook" reads Inbox, its subfolders and Sent Items since the last import (7 days on the first run, or any date) and shows what it found and skipped; "Read" sends each new conversation to the AI. Review gets "Needs reply" tasks, action items, waiting-on items from sent mail (flagged for follow-up after 3 business days), and "Reply arrived" to clear them.
- A calendar read for meeting prep.
- "Draft reply" saves to Outlook Drafts with `MailItem.Save()` and is **never sent**.
- **Test early:** Outlook's programmatic-access security prompt may appear, depending on Crestron's antivirus and policy.
- **Mac:** the new Outlook for Mac has no scripting (Microsoft cancelled the AppleScript roadmap item RM88537 in August 2026), so Mac mail needs Graph (milestone 6).

## Milestone 5: knowledge archive and meeting prep

- **Search:** SQLite FTS5 keyword search, plus local embeddings (for example ONNX all-MiniLM) for semantic search, so archive text isn't sent out just to be indexed.
- **Ask the archive:** a chat that answers with citations to dated sources.
- **Meeting prep:** for the next calendar meeting, the open items with its attendees, recent decisions, and talking points.

## Milestone 6: Graph and Copilot connectors (needs Crestron IT)

- Microsoft Graph for mail, Teams chats and meeting transcripts.
- M365 Copilot Chat API and Meeting Insights as AI providers or sources.
- **What it needs:** an Entra app registration, a Copilot license, and IT approval.

## Smaller backlog

- An app icon (it still uses the default Electron icon).
- `.docx` import.
- A Mac build and test.
- A signed installer.
- A task event log for the task editor's Activity section: record status changes (including Waiting on and back), due-date changes, marked done and reopened, so Activity shows the full life of a task. Today Activity can only show "Created" and linked imports. Needs a small new table (a migration). See `design/task-editor-simplified.html`.
- Run `npm run bench:ai` on the Windows PC, and try qwen3:30b with thinking on.
- Grow the benchmark cases from real imports that went wrong.
