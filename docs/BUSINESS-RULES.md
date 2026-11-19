# Business rules at a glance

Every rule the app follows, on one page: how tasks are scored and listed, what Review does, how mail, meetings, the briefing, the weekly review, and backups behave. It says what the code does today. The rules for the AI itself (what it's sent, what it may answer, its limits) are in [AI-RULES.md](AI-RULES.md), and the reasons behind each choice are in [DECISIONS.md](DECISIONS.md).

**Keep this file current.** Any change to a rule below updates this page in the same PR. Then run `npm run docs`, which rebuilds the interactive guide ([architecture.html](architecture.html)); `tests/docs.test.ts` fails until you do.

## Principles

| Rule | Detail | Where |
|---|---|---|
| The AI only proposes | Every suggestion waits in Review and changes nothing until the user accepts it. The only exceptions are small, marked, and undoable: "Where this stands" cards and AI priority changes. | `src/main/services/suggestions.ts` · `accept` |
| Nothing is sent | The app never sends email, messages, or invites. The mail scripts never send, move, delete, or flag mail. Draft replies are saved as drafts or opened in a window, never sent. | `src/main/mail/outlook.ps1`, `src/main/mail/applemail.jxa` |
| Runs when the user acts | No AI request runs on a schedule. The only timer recomputes scores, saves ended weeks, reads the calendar, and makes the daily backup. | `src/main/index.ts` |
| Data stays on this computer | One SQLite database and a settings file in the app's data folder. The API key is encrypted by the operating system. Only the AI provider the user picks sees any data (see AI choice). | `src/main/db.ts`, `src/main/services/secrets.ts` |
| No guessing | AI answers that name tasks, projects, or people that don't exist, or put items in the wrong section, are dropped rather than repaired. | `src/main/ai/schema.ts` · `validateSuggestions` |

## Tasks

| Rule | Detail | Where |
|---|---|---|
| Statuses | Open, Waiting on, and Done. "In progress" was removed (old ones became Open); "proposed" and "dismissed" are old values nothing uses. | `src/shared/types.ts` · `TaskStatus` |
| A title is needed | A task can't be saved without one ("A task needs a title."). | `src/main/services/tasks.ts` · `save` |
| Projects are optional | A task with no project shows no label and a neutral stripe. | `src/shared/types.ts` · `NO_PROJECT_COLOR` |
| Entering Waiting on | Records who it waits on and when the wait started: now, or when the user sent the email for an item from mail. Staying in Waiting on keeps the first start time. Leaving it clears both. | `src/main/services/tasks.ts` · `save` |
| Entering Done | Records when it was finished and, if it was waiting, who it was waiting on, so Done lists and Reopen know where it came from. | `src/main/services/tasks.ts` · `save` |
| Reopen | A finished item goes back where it came from: Waiting (on the same person) if it was waiting, otherwise Tasks. | `src/main/services/tasks.ts` · `reopen` |
| Every save | Updates the task's last activity, recomputes its score, and records each changed field in Activity. | `src/main/services/tasks.ts` · `save` |
| Subtasks | A checklist in order. Empty ones are dropped on save. Subtask changes aren't recorded in Activity. | `src/main/services/tasks.ts` · `syncSubtasks` |
| Delete | Removes the task with its subtasks, Updates, status card, AI change, and Activity. The imports it came from stay. | `src/main/services/tasks.ts` · `delete` |
| Merge | Two open tasks, or two waiting items, become one (never a task with a waiting item, and never a Done item). Starts from the task editor's Merge button, or Ctrl+K "Merge with…" while one is open; pending edits are saved first. The item the editor shows is kept and the other is removed. | `src/shared/merge.ts` · `mergeProblem`; `src/main/services/task-merge.ts` |
| Merge: fields | Where both items have a different title, project, due date, asked by, waiting on, or priority set by hand, the user picks which to keep (the kept item's is picked first). A value always wins over an empty one. | `src/shared/merge.ts` · `mergeFields`, `mergedInput` |
| Merge: combined | Notes (the kept item's, a blank line, then the other's), subtasks (the kept item's first), Updates (in date order, a line in both kept once), Activity, linked imports, and follow-ups (added together). The earlier created date and waiting-since date are kept. Review suggestions still pending about the removed item point at the kept one. | `src/main/services/task-merge.ts` · `merge` |
| Merge: cleared | Both items' status cards and AI priority changes, since each described only half of the work. | `src/main/services/task-merge.ts` · `merge` |

## Priority score

The score runs from 0 to 100 and is worked out by the app from three signals. The AI can only nudge it, and a score set by hand always wins. The Priority score tab of the [interactive guide](architecture.html) is a calculator that uses the same formula.

| Rule | Detail | Where |
|---|---|---|
| Three signals | Due date, who asked, and staleness each score 0 to 1. The score is their weighted average times 100, rounded. | `src/shared/priority.ts` · `scorePriority` |
| Due date | No date: 0.2. Overdue: 1. Due today: 0.95. Otherwise 1 − days left ÷ 14, so a date 14 or more days away adds nothing. | `src/shared/priority.ts` · `scorePriority` |
| Who asked | No one: 0.3. Otherwise by their stars: 1★ 0, 2★ 0.25, 3★ 0.5, 4★ 0.75, 5★ 1. | `src/shared/priority.ts` · `scorePriority` |
| Staleness | Days since the task's last activity ÷ 14, plus 0.25 for each follow-up, at most 1. | `src/shared/priority.ts` · `scorePriority` |
| Waiting with no reply | After 3 business days (Monday to Friday, counted from the day after the wait started) with no answer, staleness is at least 0.6, rising by 0.1 for each further business day, up to 1. | `src/shared/priority.ts` · `needsFollowUp` |
| Weights | Due date 8, Who asked 7, Staleness 5 by default. Each is a whole number from 0 to 10 in Settings. If all three are 0, every score is 0. | `src/shared/types.ts` · `DEFAULT_SETTINGS` |
| Reason line | Up to three reasons, strongest first, such as "Overdue by 2 days, requested by Dana Lee, 2 follow-ups". "Requested by" appears only for 4★ and 5★ people, and "No activity for N days" only after 7 idle days with no follow-ups. With no reasons it says "No deadline or urgency signals", which lists don't show. | `src/shared/priority.ts` · `scorePriority` |
| Effective priority | A score set by hand wins. Otherwise it's the score plus the AI change (at most ±15), kept within 0 to 100. Every list sorts by it. | `src/shared/types.ts` · `effectivePriority` |
| Sort order | Highest effective priority first, then the earliest due date, then the oldest task. Waiting lists sort by longest waiting instead. | `src/main/services/tasks.ts` · `listActive` |
| Urgent | Today's Urgent card counts open and waiting tasks at 80 or more. | `src/main/services/tasks.ts` · `summary` |
| When it's recomputed | On every save; for every open task at startup and every 30 minutes; when the weights change; and when a person is saved or deleted, since their stars may have changed. | `src/main/index.ts` |
| Examples (default weights) | Just created, no date, no requester: 19. Due today, asked by a 5★ person: 73. Overdue, 5★, 2 follow-ups: 88. | `src/shared/priority.ts` · `scorePriority` |
| Worth knowing | A due date 12 or more days away scores lower than no date. A 1★ or 2★ requester scores lower than no requester, and new people start at 1★. See Open questions. | `src/shared/priority.ts` · `scorePriority` |

## Lists

| Rule | Detail | Where |
|---|---|---|
| Tasks and Waiting | Tasks shows open items and Waiting shows waiting-on items. Today shows both. | `src/main/services/tasks.ts` · `listActive` |
| Grouping | Open tasks are grouped into Overdue, This week (due by Saturday), and Later (everything else, undated too). Open waiting items are grouped into Follow up (3 business days or more with no reply) and Waiting. Empty groups are hidden, and the arrow keys follow the grouped order. Done lists aren't grouped. | `src/renderer/src/screens/TasksScreen.tsx` · `sections` |
| Done lists | Newest first, up to 200. Waiting's Done list holds items that were waiting on someone when they were finished. | `src/main/services/tasks.ts` · `listDone` |
| Search | Tasks and Waiting search the title, notes, and who an item waits (or waited) on. Projects search the name and overview. People search the name, role, company, and brief. | `src/main/services/tasks.ts` · `listActive` |
| Project chips | One line above Tasks and Waiting: All, then each project with items in the list (most items first, ties by name), then No project, each with its count. The chips filter on screen, so every count is right. | `src/renderer/src/components/ProjectChips.tsx` |
| Today | Four counts (Urgent, Waiting on, Overdue, Open), the daily briefing, Focus (the 7 highest open tasks), and Waiting (the 5 longest waits). | `src/renderer/src/screens/TodayScreen.tsx` |

## Waiting on and follow-ups

| Rule | Detail | Where |
|---|---|---|
| Who and since | A waiting item names who it waits on (free text) and when the wait started. | `src/main/services/tasks.ts` · `save` |
| Follow up | After 3 business days without an answer, the item moves to Follow up on Waiting and its score climbs (see Priority score). | `src/shared/priority.ts` · `needsFollowUp` |
| Follow-ups | The user counts follow-ups by hand (Adjust → Follow-ups). Each one adds 0.25 to staleness. | `src/shared/priority.ts` · `scorePriority` |
| From sent mail | A waiting item found in sent mail starts at the time the user sent the ask, not when it's accepted in Review. | `src/main/services/sources.ts` · `applyMailRules` |
| Reply arrived | When mail shows the answer came, Review offers "Reply arrived" (a Looks done suggestion on the waiting task). Accepting it marks the task done. | `src/renderer/src/screens/ReviewScreen.tsx` |

## Projects

| Rule | Detail | Where |
|---|---|---|
| A name is needed | A project can't be saved without one. | `src/main/services/directory.ts` · `ProjectService.save` |
| Status | Active, On hold, Completed, or Archived. | `src/shared/types.ts` · `ProjectStatus` |
| Archived | Left out of filters, editors, and everything sent to the AI. Shown only on Projects → Archived, which has Unarchive. | `src/main/services/directory.ts` · `ProjectService.list` |
| Overview | One or two sentences the user writes by hand. Spaces are tidied and it's kept to 600 characters. The AI never writes it. | `src/main/services/directory.ts` · `saveOverview` |
| Colors | Eight colors. A project the AI proposes gets the next color in turn. | `src/shared/types.ts` · `PROJECT_COLORS` |
| Status card | "Where this stands" for the project as a whole, written only when the user clicks Write (see AI-RULES.md). | `src/main/ai/status.ts` |
| Delete | Its tasks stay, with no project. Its Updates and status card are removed. | `src/main/services/directory.ts` · `ProjectService.delete` |

## People

| Rule | Detail | Where |
|---|---|---|
| A name is needed | A person can't be saved without one. | `src/main/services/directory.ts` · `PersonService.save` |
| Stars | 1 to 5, rounded. New people start at 1★, whether added by hand or from Review. Stars feed the priority score of tasks they asked for. | `src/main/services/directory.ts` · `PersonService.save` |
| Order | Most stars first, then by name. | `src/main/services/directory.ts` · `PersonService.list` |
| One-line brief | Plain text under the name, up to 600 characters. The AI writes one only when the user clicks Regenerate, as a suggestion to keep or discard; the user can also edit it. A count shows the updates added since the brief was written. | `src/main/services/directory.ts` · `saveBrief` |
| Company filter | Filters by company, including "No company". | `src/renderer/src/screens/PeopleScreen.tsx` |
| Open asks filter | People with open tasks they asked for, or tasks waiting on them. "Waiting on them" means the waiting-on text matches their name exactly, ignoring case. | `src/main/services/directory.ts` · `PersonService.list` |
| Delete | Their tasks stay, with no requester, and scores are recomputed. Their Updates are removed. | `src/main/services/directory.ts` · `PersonService.delete` |

## Notes, Updates, and Activity

| Rule | Detail | Where |
|---|---|---|
| Notes | The user's own text on a task. When a new task is accepted from Review, the AI's details become its first Notes (see Open questions). | `src/main/services/suggestions.ts` · `createTask` |
| Updates | Dated lines on every task, project, and person, newest first, such as "Nov 2, 2026: Pricing approved (from “Weekly sync”)". They come from status updates and context accepted in Review, plus any the user adds. | `src/shared/notes.ts` |
| Latest | Each editor shows the newest update under its Updates button. | `src/renderer/src/components/UpdatesWindow.tsx` |
| Activity | A read-only log of each task's changes, newest first: created; status; due date set, moved, or removed; project; asked by; title; priority set by hand; follow-ups; AI priority changes; draft replies saved or opened; merges. Not recorded: notes, subtasks, updates, and the score's recalculation. | `src/main/services/task-events.ts` · `taskChanges` |
| Merged Activity | A merge adds "Merged in “…”", then a line per field it changed. The removed item's lines move over and end with "on “its title”". | `src/main/services/task-merge.ts` · `merge`; `src/shared/events.ts` · `eventOn` |
| Who | Every Activity line says who made the change: "by you", "from “Import”, accepted in Review", or "by the AI, daily briefing" (or the import's name). | `src/shared/events.ts` · `eventWho` |
| As it read then | Activity stores names, not ids, so renaming a project doesn't rewrite history. Tasks older than the log say "Changes before … weren't recorded." | `src/main/services/task-events.ts` |

## Import and Review

| Rule | Detail | Where |
|---|---|---|
| Paste, drop, or choose a file | The text is tidied (transcript timings removed). Empty text is refused. | `src/main/services/sources.ts` · `importAndExtract` |
| Duplicates | The same text again, ignoring case and spacing, isn't imported twice, and nothing is sent to the AI. | `src/main/services/sources.ts` · `contentHash` |
| Kind | A first guess: a meeting transcript (WEBVTT, or 3 or more timestamp lines), an email ("From:" plus "Subject:", "Sent:", or "To:"), otherwise a note. The AI may correct it. | `src/main/services/sources.ts` · `detectKind` |
| Name | The first line, up to 60 characters. Claude and Ollama rename a text import the user didn't name (up to 80 characters), but never mail, a file (it keeps its file name), a Copilot answer, or an import the user has renamed. | `src/main/services/sources.ts` · `extract` |
| Date | The date on the Import card (today by default). Relative dates in the text, like "Friday", count from it. | `src/main/services/sources.ts` · `importAndExtract` |
| Copilot answers | An answer that starts with the Copilot Prompt Generator's marker line is named and dated from it, and records the time span it covers. The next prompt starts where the last imported answer ended (7 days back the first time). | `src/main/services/copilot.ts` |
| What happens next | The selected AI reads the item plus the open tasks, projects, and people (see AI-RULES.md). Suggestions go to Review; status cards and AI priority changes are applied right away. An error is saved on the import and shown there. | `src/main/services/sources.ts` · `extract` |
| Run again | Replaces the import's pending suggestions. Ones already accepted or rejected stay. | `src/main/services/sources.ts` · `extract` |
| Review order | New projects and people first, then the rest in the order the AI gave them. | `src/main/ai/schema.ts` · `validateSuggestions` |
| Accept | Applies the suggestion with any edits, links the task to the import, and records "accepted in Review" in Activity. It's one step: if anything fails, nothing changes. | `src/main/services/suggestions.ts` · `accept` |
| Linked new items | Accepting a task that's linked to a proposed project or person creates that project or person first. Rejecting the project or person removes the link from the task's suggestion. | `src/main/services/suggestions.ts` · `createdBy` |
| New task, Needs reply | Creates an open task with the title, due date, project, and who asked; the AI's details become its Notes. | `src/main/services/suggestions.ts` · `createTask` |
| Waiting on | Puts an existing task in Waiting on (on "someone" if no name is given), or creates a waiting task. A task already waiting keeps its start time. | `src/main/services/suggestions.ts` · `accept` |
| Status update | Adds a dated update to the task, and changes the due date if the update gave a new one. | `src/main/services/suggestions.ts` · `accept` |
| Looks done | Adds the update, if there is one, then marks the task done. | `src/main/services/suggestions.ts` · `accept` |
| Context | Adds a dated update to the project, person, or task. For a person it can also fill in their role and company. | `src/main/services/suggestions.ts` · `accept` |
| New project, New person | Creates it, or reuses one with the same name (ignoring case), with the details as its first update. New people start at 1★. | `src/main/services/suggestions.ts` · `accept` |
| Reject | Marks it rejected. Nothing else changes. | `src/main/services/suggestions.ts` · `reject` |
| Delete an import | Deletes it, its AI log, and all its suggestions, pending and decided. Tasks made from it stay. | `src/main/services/sources.ts` · `delete` |

## Mail

| Rule | Detail | Where |
|---|---|---|
| One source per computer | Windows reads classic Outlook, which must be running. The Mac reads Apple Mail, and only the accounts ticked in Settings → Apple Mail (none at first). | `src/main/index.ts`, `src/main/mail/outlook.ts`, `src/main/mail/applemail.ts` |
| Only on click | Check and Read run only when the user clicks, never on a schedule. | `src/renderer/src/components/OutlookImport.tsx` |
| Check | Lists new mail in the Inbox, its subfolders, and Sent since the last finished import (7 days back the first time, or a date the user picks). Nothing is sent to the AI. | `src/main/services/mail.ts` · `check` |
| Skipped | Meeting invites, automatic replies, newsletters and mailing lists, and automated senders (no-reply and similar). Sent mail is skipped only for invites and automatic replies. "Read anyway" overrides a skip. | `src/main/mail/plan.ts` · `skipReason` |
| Conversations | Messages are grouped into conversations: Outlook's own, or for Apple Mail Exchange's Thread-Index, else the subject without "RE:" and "FW:". Each conversation becomes one import, oldest message first, with quoted history kept only under the first message. | `src/main/mail/plan.ts` · `planMailbox` |
| Read | Sends each chosen conversation to the AI, one at a time, in the background. Stop finishes the current one and the rest are offered next time; a stopped run doesn't move the start date. | `src/main/services/mail.ts` · `read` |
| Never read twice | Every message read is recorded by its Internet message id, so going back further only adds older mail. | `src/main/services/mail.ts` · `save` |
| The user wrote last | No "Needs reply" is proposed. The AI log says why it was dropped. | `src/main/services/sources.ts` · `applyMailRules` |

## Meetings

| Rule | Detail | Where |
|---|---|---|
| One source per computer | Windows reads classic Outlook's default calendar; Outlook must be running. The Mac reads only the Apple Calendar calendars ticked in Settings → Apple Calendar (none at first), and macOS asks once for calendar permission. | `src/main/calendar/outlook.ts` · `OutlookCalendar`, `src/main/calendar/applecalendar.ts` · `AppleCalendarReader` |
| When | At startup, every 30 minutes, when the ticked calendars change, and on Try again after a failed read. | `src/main/services/calendar.ts` · `refresh` |
| Read only, kept in memory | The current week, Sunday to Saturday. Nothing is saved or sent anywhere, and no meeting is created, changed, or answered. A read from last week shows nothing until this week is read. | `src/main/services/calendar.ts` · `week` |
| Left out | Declined, cancelled, all-day, Free, and private entries. The Mac can't tell which entries are private. | `src/main/calendar/reader.ts` · `toMeetings` |
| Attendees | The user is left out, and up to 50 are listed (the count still includes everyone). Each is matched to People by email, then by name ("Lee, Dana" matches "Dana Lee"); a name two people share matches neither. Matching is redone each time, so a person just added is linked at once. Anyone unmatched has "+ Add to People". | `src/main/services/calendar.ts` · `matcher` |
| Invite | The invite text without the Teams join block, up to 4,000 characters. | `src/main/calendar/reader.ts` · `tidyInvite` |
| A failed read | The last good read stays on screen, with the problem and Try again. | `src/main/services/calendar.ts` · `read` |
| Open with attendees | Open tasks and waiting items whose Asked by person, or Waiting on name (when exactly one person has it), is in the meeting. Shown as the number on each meeting and listed in its panel. | `src/shared/calendar.ts` · `tasksForMeeting` |
| Where meetings show | The Meetings card on Today (today's meetings, with the rest of the week folded), "Next meeting with …" in the task editor, and "Meetings this week" in the person editor. The editors leave out past meetings. | `src/renderer/src/components/MeetingsCard.tsx`, `src/renderer/src/components/NextMeeting.tsx` |
| Open in Outlook / Calendar | Shows the meeting in Outlook. Apple Calendar opens on the meeting's day. | `src/main/services/calendar.ts` · `open` |
| Not used yet | The daily briefing doesn't use meetings, there's no meeting prep yet, and meetings aren't linked to projects. | `docs/ROADMAP.md` |

## Draft replies

| Rule | Detail | Where |
|---|---|---|
| Where | The Reply card on a task linked to an email; hidden otherwise. Greyed out with Basic. | `src/renderer/src/components/ReplyCard.tsx` |
| Which email | Always the newest email in the conversation, sent or received, asked of the mail app when drafting and when saving. If it's the user's own, the AI writes a short follow-up nudge instead of an answer. | `src/main/services/replies.ts` · `draft` |
| Recipients | The AI picks Reply all or Reply (marked "AI pick") and the user can switch. Who it goes to comes from Outlook, or for Apple Mail is worked out from the email. | `src/main/services/replies.ts` |
| Never sent | Open in Outlook / Mail opens a reply window with the text; Save to Outlook / Mail Drafts saves a draft. Neither sends. Apple Mail drafts don't include the quoted original. | `src/main/services/replies.ts` · `save` |
| Not kept | Drafts aren't stored in the app. Activity records "Draft reply saved to … Drafts" or "Reply opened in …". The task stays open. | `src/main/services/replies.ts` |
| Writing style | One note in Settings → AI, up to 1,000 characters, sent with every draft. | `src/main/services/settings.ts` |

## Daily briefing

| Rule | Detail | Where |
|---|---|---|
| When | Only when the user clicks Write briefing or Refresh, or uses Ctrl+K. A second click while one is being written waits for the same briefing. | `src/main/services/briefings.ts` · `write` |
| New since | Counts from the last briefing, or the last 24 hours the first time. | `src/main/services/briefings.ts` · `buildInput` |
| Do next | Every overdue task first (most overdue first), then the AI's picks, up to 5 in all. | `src/main/ai/briefing.ts` · `assembleBriefing` |
| Follow up | Up to 3 waiting items the AI picks. | `src/main/ai/briefing.ts` · `assembleBriefing` |
| New | Up to 8 items added or newly waiting, whether or not the AI wrote about them, plus a line with the number of new Review suggestions. | `src/main/ai/briefing.ts` · `assembleBriefing` |
| Tags come from the task | Overdue, Due today, Due Mon, Waiting 8 days, New task, and Review are worked out from the task as it was, never by the AI. | `src/renderer/src/components/Briefing.tsx` |
| Items are real | The AI only picks ids from the lists it's sent; any other id is dropped. | `src/main/ai/briefing.ts` · `assembleBriefing` |
| What it changes | Nothing goes to Review and no task changes, except each Do next task's status card and any AI priority changes. | `src/main/services/briefings.ts` · `writeNow` |
| Kept | Every briefing, with titles as they were (History). The AI requests behind the newest 5. | `src/main/services/briefings.ts` |
| With Basic | Overdue tasks, then the top tasks (at least 4 in all), waits of 5 days or more as nudges, and no next steps. | `src/main/ai/briefing.ts` · `demoBriefing` |

## Weekly review

| Rule | Detail | Where |
|---|---|---|
| Weeks | Sunday to Saturday, local time, named by their Sunday. | `src/shared/week.ts` |
| Completed | Tasks finished during the week. | `src/main/services/weekly.ts` · `lists` |
| New | Tasks created during the week, with the import they came from, or "Added by you". | `src/main/services/weekly.ts` · `lists` |
| Slipping | Open tasks overdue at the end of the week (today, for the current week), plus tasks whose due date was pushed later during the week. A push is counted net over the week; moves earlier, dates set or removed, finished tasks, and moves made on an item before it was merged into another don't count. | `src/main/services/weekly.ts` · `lists` |
| Waiting on | Items waiting at the end of the week, with how many days. | `src/main/services/weekly.ts` · `lists` |
| The current week | Live: rebuilt every time it's shown. | `src/main/services/weekly.ts` · `get` |
| Ended weeks | Saved once, the first time the app runs after Saturday midnight, and never changed after. Checked at startup, every 30 minutes, and before listing weeks. | `src/main/services/weekly.ts` · `saveEndedWeeks` |
| Partly recorded | A week the app wasn't opened the week after, and every week before the weekly review started, shows only Completed and New. | `src/main/services/weekly.ts` · `saveEndedWeeks` |
| Reflection | Written only when the user clicks, and only for the current week. It says when tasks have changed since. Text only: nothing goes to Review. | `src/main/services/weekly.ts` · `writeReflection` |

## AI choice

| Rule | Detail | Where |
|---|---|---|
| Basic is the default | Simple rules, not actually AI. It runs on this computer and sends nothing. It never writes status cards, priority changes, import names, or draft replies. | `src/main/ai/demo.ts` |
| Claude | Offered once an API key is saved. Opus 5.5 by default; Sonnet 5.5 or Haiku 5.5 in Settings. What it's sent goes to Anthropic. | `src/main/ai/claude.ts` |
| Ollama | Runs a model on this computer, so nothing leaves it, unless the Ollama address points at another machine, which the app says. | `src/main/ai/ollama.ts` |
| An unavailable model | The choice is kept and shown in red with the reason (no key, Ollama stopped, model not downloaded). The app never switches AI on its own. | `src/main/index.ts` · `aiStatus` |
| Tested local models | Only the tested models can be downloaded from the app. Models installed another way still appear, marked Not tested. | `src/shared/types.ts` · `TESTED_LOCAL_MODELS` |
| Installing Ollama | Downloads the official installer from ollama.com and runs it only if its signature is valid. Never for a remote address. | `src/main/services/ollama-setup.ts` |
| The API key | Encrypted by the operating system, never shown, logged, or written in plain text. The app only tells the screen whether a key exists. | `src/main/services/secrets.ts` |

## AI spending

| Rule | Detail | Where |
|---|---|---|
| What's counted | Successful Claude requests: imports, daily briefings, weekly reflections, person briefs, status cards, and draft replies. Basic and Ollama are free and never recorded. The record is never pruned, unlike the AI logs. | `src/main/services/usage.ts` |
| Estimates only | Costs use the list prices built into the app (the interactive guide's Overview lists them), with a higher Haiku price for prompts over 100,000 tokens. The Anthropic Console has the real figure. | `src/shared/pricing.ts` · `estimateCost` |
| Where it's shown | The AI spending screen (this month, the last 30 days, by purpose, and by model), each AI log, Recent imports, and the mail card's total. | `src/renderer/src/screens/AiSpendingScreen.tsx` |

## Data safety

| Rule | Detail | Where |
|---|---|---|
| Where data lives | Only the installed app uses the real data folder. Running from source uses "Chief of Staff (dev)", and tests use the folder `COS_DATA_DIR` names. Both show "Test data" in the status bar and keep their backups inside their own folder. | `src/main/paths.ts` · `chooseDataLocation` |
| Sandbox guard | On Windows, the installed app checks that its data folder isn't quietly redirected into another app's private copy, as happens when it's started from Claude Desktop. If it is, the app says to open it from the Start menu and quits before touching the database. | `src/main/paths.ts` · `findRedirectingPackage` |
| One copy at a time | A second copy brings the first one forward and quits before opening the database. | `src/main/index.ts` |
| Daily backup | A single-file snapshot to the OneDrive "Chief of Staff Backups" folder (or a folder chosen in Settings), at startup and on the 30-minute timer, skipped if the last one is under 20 hours old. The newest 30 are kept (a setting, at least 1). | `src/main/index.ts` · `backupIfDue` |
| Before an upgrade | A safety copy is written before any database upgrade, to the data folder's backups if OneDrive isn't available. If no copy can be made, the upgrade doesn't run and the app shows an error. | `src/main/db.ts` · `migrate` |
| Safety copies kept | The newest 10 of each kind (before upgrade, before restore), apart from the daily ones. | `src/main/services/backup.ts` · `pruneBackups` |
| Restore | Only backups the app listed and judged usable: not the old Windows-only app's, not a newer version's, not unreadable ones. It saves a before-restore copy first, restarts, and swaps the file before the database opens. | `src/main/services/backup.ts` · `applyPendingRestore` |
| Listing never writes | Backups are checked through temporary copies, so nothing is ever written into the backup folder. | `src/main/services/backup.ts` · `inspectBackup` |
| Crash log | Unexpected errors are added to crash.log in the data folder. | `src/main/index.ts` |

## Settings limits

| Rule | Detail | Where |
|---|---|---|
| Name | Left empty, it falls back to the default. | `src/main/services/settings.ts` · `save` |
| AI | Basic, Claude, or Ollama; anything else becomes Basic. The Claude model must be one of the three offered. | `src/main/services/settings.ts` · `save` |
| Ollama address | Must start with http:// or https://. | `src/main/services/settings.ts` · `save` |
| Priority weights | Whole numbers from 0 to 10. | `src/main/services/settings.ts` · `save` |
| List and details divider | Between 10% and 90%. | `src/main/services/settings.ts` · `save` |
| Backups kept | At least 1. | `src/main/services/settings.ts` · `save` |
| Writing style | Up to 1,000 characters. | `src/main/services/settings.ts` · `save` |
| Apple Mail accounts | Up to 20. | `src/main/services/settings.ts` · `save` |
| Look | Theme: system, light, or dark. Density: Compact, Comfortable (the default), or Spacious. | `src/shared/types.ts` · `DENSITIES` |

## Open questions (found while documenting)

Places where the code and the docs disagree, or where the code does something that may not be intended. Nothing was changed. Each needs a decision: change the code, or change the docs. Remove a row once it's settled.

| Question | What the code does | Where |
|---|---|---|
| Should every AI request be in the AI log? | AI-RULES.md says every request is logged. Person briefs, status cards written with Write, and draft replies are only counted in AI spending; their request and response aren't kept, and with Ollama or Basic nothing is recorded. | `src/main/index.ts` |
| Should a failed briefing still count its cost? | A paid daily briefing or weekly reflection whose answer fails the app's checks (for example an empty summary) isn't counted in AI spending or logged. | `src/main/services/briefings.ts` · `writeNow` |
| Should the AI's details become Notes? | AGENTS.md says the AI never writes Notes, but accepting a new task copies the AI's details into the task's Notes. | `src/main/services/suggestions.ts` · `createTask` |
| Should impossible dates be dropped? | A date like 2026-02-30 is accepted and rolls over to March. Unknown task or project ids and bad dates are cleared without a "dropped" line in the AI log. | `src/main/ai/schema.ts` · `validDate` |
| Should "tasks the item is about" be checked? | Imports may write a status card and priority change for any open task that was sent, not only ones the item is about; only the prompt asks for that. | `src/main/services/sources.ts` · `extract` |
| Should every prompt get the calendar? | AI-RULES.md says every prompt has the three-week calendar. Only import requests do; the briefing, weekly, status card, and reply prompts get only today's date. | `src/main/ai/context.ts` |
| Which projects should imports send? | AI-RULES.md says active projects. Imports send every project that isn't archived, including on hold and completed ones, with their standing instructions. | `src/main/ai/context.ts` · `buildExtractionContext` |
| Should the briefing adjust waiting items? | AI-RULES.md says any task it was sent. Only open tasks can get an AI priority change from a briefing; waiting items can't. | `src/main/ai/briefing.ts` · `assembleBriefing` |
| Should an overdue waiting item count as Slipping? | Slipping's overdue part only counts open tasks, so an overdue waiting item never appears there. | `src/main/services/weekly.ts` · `lists` |
| Should a saved week be an exact snapshot? | An ended week is worked out when it's saved, from task dates as of Saturday midnight, but titles, projects, and due dates changed after Saturday show as they are at saving time. | `src/main/services/weekly.ts` · `saveEndedWeeks` |
| Should deleting an import keep its history? | Deleting an import deletes its accepted suggestions too, so Weekly's New list shows "Added by you" for tasks that came from it. | `src/main/services/sources.ts` · `delete` |
| Should every AI limit be in limits.ts? | Some limits are typed elsewhere: the 40 tasks on a project card, the 600-character person brief, text caps in validation, how many AI logs are kept, the 7-day first mail check, and the 3 business days for a follow-up. | `src/main/ai/limits.ts` |
| Can update dates break on a non-US computer? | Update dates are written in the computer's own date format but read back expecting "Nov 3, 2026", so on another format they might not be read as dated. | `src/shared/notes.ts` · `noteStamp` |
| Should a far-off due date rank below no date? | A task due 12 or more days away scores lower for its date than one with no date (0.14 or less against 0.2). | `src/shared/priority.ts` · `scorePriority` |
| Should a 1★ requester rank below no requester? | 1★ scores 0 and 2★ 0.25, both below the 0.3 for no requester, and new people start at 1★, so linking a new person lowers a task's score. | `src/shared/priority.ts` · `scorePriority` |
| Should a status update rescore the task? | Accepting a status update refreshes the task's activity without recomputing its score; it catches up at the next 30-minute recompute. | `src/main/services/suggestions.ts` · `accept` |
| Small tidy-ups | The theme button's tooltip still mentions Shift+D, which does nothing. The comment on `backupIfDue` says hourly; the timer runs every 30 minutes. | `src/renderer/src/App.tsx`, `src/main/index.ts` |
