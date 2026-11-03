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
| 2.5 | AI log: the exact requests and responses for each import, plus why suggestions were dropped | ✅ Built (`ai-log` e2e suite). Not yet seen with a real Claude or Ollama run |
| 3 | Priorities and briefings | Next |
| 4 | Outlook | Planned |
| 5 | Knowledge archive and meeting prep | Planned |
| 6 | Graph and Copilot connectors | Blocked on IT approval |

## Milestone 3: priorities and briefings

- **Daily briefing (AI)** on Today, on a schedule (default 7:30) and on demand: top priorities, new items, overdue, waiting-on nudges, recommended next actions.
- **Per-task "suggested next action"** in the task editor. A placeholder card exists today.
- **AI-written status updates** for open items. They go through Review like everything else.
- **Weekly review screen:** completed, new, slipping, and a status-report draft (copy, or save to Outlook drafts in milestone 4).
- **An AI adjustment to the deterministic priority score**, with a one-line rationale. Overrides always win.
- **Tray icon, start with Windows, Windows notifications, and a scheduler.**
- **Pending decision:** whether the daily briefing should call Claude automatically, or only on demand, given cost and data policy.

## Milestone 4: Outlook

- Classic Outlook on Windows through COM, via a small helper, since Electron can't call COM directly.
- Mail ingest by date range and folder, and a calendar read for meeting prep.
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
- Moving the repo out of OneDrive.
- A Mac build and test.
- A signed installer.
- Manually added status updates on a task.
- Run `npm run bench:ai` on the Windows PC, and try qwen3:30b with thinking on.
- Grow the benchmark cases from real imports that went wrong.
