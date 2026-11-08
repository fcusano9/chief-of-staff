# Roadmap

The agreed milestones, what's done, and what each remaining one includes. Update this file when a milestone lands or the plan changes.

## Background

The app is for people who track work in Microsoft To Do and OneNote and use M365 Copilot to summarize email, Teams and meeting transcripts, then turn those summaries into action items by hand. Chief of Staff, inspired by Lon.tv's app of the same name, aims to:

- replace To Do as the task system
- pull work items from email, Teams and transcripts
- use a pluggable AI (Claude first, M365 Copilot and others later) to propose tasks, write status updates, rank by urgency, recommend next actions and draft replies
- keep a knowledge archive that can be queried years later

**Hard rule: nothing is sent or decided without the user.**

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
| 2.7 | AI spending: estimated Claude costs by month, purpose and model, per run in the AI logs, and per import (with an Outlook mail total) in Recent imports | ✅ Built (`ai-spending` e2e suite, with seeded usage). Not yet checked against a real Claude bill |
| 3 | Priorities and briefings | In progress. Daily briefing, weekly review, "Where this stands" cards with the suggested next action (tasks and projects), the AI priority adjustment and the task Activity log (with pushed-back dates in weekly Slipping) built (`briefing` and `weekly` e2e suites; next actions and priority adjustments have unit tests only). Next actions and priority changes tried on made-up demo data on Nov 5 with Claude Opus, Sonnet and Haiku (good) and gpt-oss:20b (not useful yet); see AI-RULES.md. Briefing and reflection not yet tried on real data |
| 4 | Outlook | Mail import built (`mail` e2e suite; checked against real Outlook, AI reading not yet tried on real mail). Draft replies built (`draft-reply` e2e suite, with a fixture Outlook; not yet tried against real Outlook). Calendar planned. Mac mail through Apple Mail built 2026-11-07 (unit tests; Check, Read, Open in Mail and Save to Mail Drafts tried on real Apple Mail; no e2e suite yet) |
| 5 | Knowledge archive and meeting prep | Planned |
| 6 | Graph and Copilot connectors | Blocked on IT approval |

## Milestone 3: priorities and briefings

- ✅ **Daily briefing (AI)** on Today, when the user clicks: a one-line summary, then Do next (top priorities, one line each led by the next step, overdue first, with status tags), Follow up, and New since last briefing. Every briefing is saved and browsable in History. A schedule (for example 7:30) can be added later; see DECISIONS.md.
- ✅ **Per-task "suggested next action"** on the task editor's card: one sentence (the why was dropped when "Where this stands" was added), written as part of a daily briefing or an import, never on its own. Tried on made-up demo data (AI-RULES.md, "How the AI has done in tests"): specific with all three Claude models, weak with gpt-oss:20b. The extraction benchmark hasn't been rerun since the prompt gained it.
- ✅ **"Where this stands" and next step** (task and project cards): 2–3 shareable bullets plus the next action, always written together, on Write and (tasks only) as part of a briefing or import. Shown on the card, not sent to Review: the user chose a card to copy from over Review suggestions (2026-11-06). Replaces the project status brief. Not yet tried with a real model; the extraction benchmark hasn't been rerun since the import prompt gained the bullets.
- ✅ **Weekly review** (Weekly tab): each Sunday-to-Saturday week's Completed, New, Slipping and Waiting on, live for the current week and saved when a week ends, plus an AI reflection for the user (written on click, with Copy). A status report for others (or saving to Outlook drafts in milestone 4) isn't part of it; the reflection is for the user alone.
- ✅ **An AI adjustment to the deterministic priority score** (±15), with a one-line reason, written as part of a briefing or an import. Overrides always win. Tried on made-up demo data: sensible with all three Claude models; gpt-oss:20b made no changes.
- **Tray icon, start with Windows, Windows notifications, and a scheduler.**
- **Decided (2026-11-04):** the daily briefing runs only when the user clicks, for now. A schedule may come later.

## Milestone 4: Outlook

- Classic Outlook on Windows through COM, via a small helper, since Electron can't call COM directly. ✅ A bundled PowerShell script (`src/main/mail/outlook.ps1`); no security prompt on the Windows PC it was tested on.
- ✅ **Mail import** (Import → Outlook mail): a button, not a schedule. "Check Outlook" reads Inbox, its subfolders and Sent Items since the last import (7 days on the first run, or any date) and shows what it found and skipped; "Read" sends each new conversation to the AI. Review gets "Needs reply" tasks, action items, waiting-on items from sent mail (flagged for follow-up after 3 business days), and "Reply arrived" to clear them.
- A calendar read for meeting prep.
- ✅ **Draft reply** on tasks linked to an email: the AI's own first draft, an editable preview with To and Cc and an AI-picked Reply or Reply all, Try again with a note, then Save to Outlook Drafts (`ReplyAll()`/`Reply()`, then `Save()`); **never sent**. A writing-style note in Settings. Always replies on the newest email in the conversation (asked of Outlook live), so follow-ups stay in the chain; when that's the user's own, the AI writes a follow-up nudge. Built 2026-11-06 and tested with a fixture Outlook only: **to check on the Windows PC** whether saving triggers Outlook's security prompt, whether the Outlook signature appears, whether `-Action latest` finds a follow-up in Sent Items, and who Outlook's Reply / Reply all address when replying to the user's own email.
- **Test early:** Outlook's programmatic-access security prompt may appear, depending on the company's antivirus and policy.
- **Mac:** see "Mac mail" below.

### Mac mail (Apple Mail built 2026-11-07)

Outlook on the Mac can't be driven the way classic Outlook is on Windows, so on a Mac the app reads mail through another mail app the user signs in to with their work account. Frank chose the order to try them in: **Apple Mail first, then Thunderbird, then Airmail and eM Client.** He's fine with Apple Mail not saving drafts. The mail import, AI reading and Review stay the same; only the part that reads the mailbox changes (today `src/main/mail/outlook.ps1` and `outlook.ts`).

**Why not Outlook or Graph directly**
- **New Outlook for Mac:** no scripting. Microsoft cancelled the AppleScript roadmap item (RM88537) in August 2026. Legacy Outlook for Mac had scripting but is being retired and uses EWS.
- **Graph** (the app signing in to Microsoft itself) lasts and does everything, but needs an Entra app registration, which usually needs IT (milestone 6). Outlook MCP servers, including Microsoft's preview Work IQ Mail server and community ones like `ms-365-mcp-server`, go through Graph too and so need the same approval.

**EWS is going away.** Microsoft began switching off Exchange Web Services in Exchange Online on 2026-10-01, company by company, and plans to shut it off completely on 2027-04-01. Any mail app that reaches Microsoft 365 over EWS stops syncing when the company's turn comes. Apple has said a Graph-based update for Mail is coming in a future macOS 27 release, with no date; the Mac used for testing runs macOS 26.3.

**The options, in the order to try**

| App | Microsoft 365 connection | How the app reads it | Drafts | Cost |
|---|---|---|---|---|
| **1. Apple Mail** | EWS, so it lasts only until the company's EWS switch-off (at the latest 2027-04-01) | AppleScript or JavaScript for Automation, run with `osascript` | `reply` makes the reply, and the dictionary says an outgoing message accepts `save`, but `save` isn't defined as a command, so saving to Drafts is unconfirmed. Opening the reply in a Mail window works | Free |
| **2. Thunderbird 154+** | Graph (since August 2026, mail only); approved apps like Thunderbird can reportedly still ask the user for permission without IT | A small Thunderbird add-on the app installs, talking to the app through native messaging | Add-ons can probably save drafts (to verify) | Free |
| **3. Airmail** | Not confirmed (could be EWS) | Its official MCP server, running locally (127.0.0.1:9876, turned on in Settings → AI). The app calls its tools itself, so the AI never holds them | `save_as_draft`; sending and deleting are blocked unless allowed | Free for one account; Pro about $30–50 a year. Not known whether MCP needs Pro |
| **4. eM Client 11** | Graph in version 11 (one review says beta) | AppleScript, new in version 11 (claimed by eM Client only) | Not stated | Free version is personal use only; Pro about $40 a year or $50–60 one-time |

**Ruled out:** Spark (its CLI and MCP are read-only, and mail passes through Readdle's servers), Superhuman (hosted, Business plan only, and its drafts don't appear in Outlook), MailMate and Mailspring (no way to read mail from a script), Canary (no MCP server, only a roadmap request). Community Apple Mail MCP servers add nothing over scripting Mail directly and are third-party code with access to all mail.

**Apple Mail scripting: what it offers** (from Mail's scripting dictionary on macOS 26.3; Script Editor → File → Open Dictionary → Mail)
- **Accounts and mailboxes:** every account (name, email addresses, type; an Exchange account's type is untested), its mailboxes and their subfolders, unread counts, and the Inbox, Sent, Drafts, Junk and Trash folders.
- **Messages:** sender, To, Cc and Bcc (names and addresses), subject, date sent and received, the text, the raw source and every header (`Message-ID`, `In-Reply-To` and `References` give the conversation, since Mail has no conversation object), reply-to address, size, read, flagged and replied status, and attachments (name, type, size, save to disk).
- **Selection:** the messages the user has selected in Mail.
- **Writing:** `reply` (reply or reply all, optionally in a window), `forward`, `redirect`, new outgoing messages with recipients, subject, text and signature, `save` (unconfirmed, see above) and `send`. **The app must never call `send`, `delete`, `move`, or change read or flag status**, the same rule as the Outlook script.
- **Other:** check for new mail, sync IMAP accounts, rules, and running a script from a rule or the Scripts menu.
- **Not available:** search (scripts filter messages instead, which is slow on big mailboxes), conversations, calendar.

**Apple Mail: decided and built 2026-11-07** (mockup `design/apple-mail.html`, approved)
- **One mail source per computer:** Windows shows only "Outlook mail", with the mailbox's email address next to Check Outlook (replacing "Inbox and its subfolders, plus Sent Items"); the Mac shows only **"Apple Mail"** with a **Check Apple Mail** button. It works like Outlook mail: Check only looks, Read sends each new conversation to the AI, suggestions go to Review, and nothing is read twice. The card shows the addresses of the accounts it reads, next to Change (which opens Settings).
- **Accounts are picked in Settings** (a Mac-only Apple Mail section listing Mail's accounts, nothing ticked at first), so personal accounts in Mail are left alone.
- **Two ways to finish a draft reply, on both computers:** **Open in Outlook / Open in Mail** opens a Reply or Reply all window with the text above the quoted email for the user to finish; **Save to Outlook Drafts / Save to Mail Drafts** saves it without opening anything. Neither sends. Frank wants to try both and may keep both or drop one. Save to Mail Drafts is unproven (see below); if it fails, the Mac keeps only Open in Mail. Activity records which was used. Review's "Open in Outlook" becomes "Open in Mail" on the Mac.
- **Read-only test on 2026-11-07:** the work account shows to scripts as an account of type "unknown" with Inbox, Sent Items, Deleted Items, Junk Email and the user's folders, all in one flat list (subfolders of Inbox will need their parent checked). A week of mail (109 received, 21 sent) took under 2 seconds to list with sender, subject and dates. The whole run took 26 seconds, mostly opening Mail and going through about 150 folders.

**Tried on real Apple Mail (2026-11-07, through the built app, test data, Basic):** account list, the work account's address on the card, Check of 3 days (62 received, 5 sent, 43 conversations, 14 skipped) in about 4 seconds, and Read of 3 conversations with their text. The Automation prompt didn't appear (permission was already granted to the app running the test), so the packaged app's first-run prompt is untested.

**Still to check with Apple Mail**
- **Replies on real Mail (tried 2026-11-07 on the work account):** Open in Mail opens a reply window and Save to Mail Drafts saves a threaded draft (`In-Reply-To` set) to the account's Drafts. Setting the text drops Mail's quote of the original; it's left out (decided 2026-11-07), and the reply stays threaded. Mail also autosaves an open reply window to Drafts after a while. Still to check: whether the saved draft shows in Outlook's Drafts (Exchange sync).
- **The packaged app's first run:** macOS should ask once to let Chief of Staff control Mail (`NSAppleEventsUsageDescription` is set in `electron-builder.yml`).
- **Open in Outlook on Windows** (`-Action reply -Open`, `Display()`) and the address on the Outlook card (`-Action me`): built, not yet tried on the Windows PC.
- **An e2e suite** for the Mac wording (the fixture can act as Apple Mail with `COS_MAIL_APP=apple-mail`) isn't written yet.

**Documentation:** Apple has no Mail-specific scripting guide. The references are Mail's dictionary in Script Editor, Apple's *AppleScript Language Guide*, and the *Mac Automation Scripting Guide* (which also covers JavaScript for Automation).

## Milestone 5: knowledge archive and meeting prep

- **Search:** SQLite FTS5 keyword search, plus local embeddings (for example ONNX all-MiniLM) for semantic search, so archive text isn't sent out just to be indexed.
- **Ask the archive:** a chat that answers with citations to dated sources.
- **Meeting prep:** for the next calendar meeting, the open items with its attendees, recent decisions, and talking points.

## Milestone 6: Graph and Copilot connectors (needs company IT)

- Microsoft Graph for mail, Teams chats and meeting transcripts.
- M365 Copilot Chat API and Meeting Insights as AI providers or sources.
- **What it needs:** an Entra app registration, a Copilot license, and IT approval.

## Later: in-app updates (not scheduled)

The app should keep itself up to date (requested 2026-11-05; not to be built yet):

- **Detect new versions** published on GitHub.
- **Prompt** when one is available, with **one-click update**.
- **Release notes:** a place in the app to read what changed in each version.

**To decide before building:**
- **Releases:** the repo has no GitHub Releases yet; today the app is built on each computer from source. Updates need versioned, built installers published as releases.
- **Private repo:** the repo is private, so the app can't read its releases without a GitHub token. Options include a read-only token stored with `KeyStore`, or publishing releases somewhere public.
- **Signing:** unsigned updates may trigger Windows SmartScreen. On Mac, automatic updates generally require a signed, notarized app. Signing certificates cost money, which needs the owner's approval.
- **Data safety:** an update that changes the database already gets the automatic safety copy before upgrading.

## Smaller backlog

- An app icon (it still uses the default Electron icon).
- `.docx` import.
- A Mac build and test.
- A signed installer.
- Run `npm run bench:ai` on the Windows PC, and try qwen3:30b with thinking on.
- Grow the benchmark cases from real imports that went wrong.
