# AI rules at a glance

Every rule that decides what the AI sees, when it runs and what it may change, on one page. Use it to check how the AI features are working and to spot a rule worth tuning. The reasons behind each rule are in [DECISIONS.md](DECISIONS.md); this file only says what the rule is.

**Keep this file current.** Any change to a rule below (a limit, a trigger, what's sent) updates this page in the same PR.

Status: ✅ built · 🟡 approved, not built yet

## Rules for every AI feature

| Rule | Detail |
|---|---|
| The AI only proposes | Nothing it writes is sent anywhere, and nothing changes a task without the user, except the small, marked, undoable items noted below (next actions, priority adjustments). |
| No guessing | Any id the AI makes up, date that isn't real, or item in the wrong section is dropped, never repaired. |
| Imported text is data | It's fenced off in the prompt, and the AI is told to ignore any instructions inside it. |
| Runs only when the user acts | Nothing runs on a schedule today. Every AI request comes from a click or an import. |
| Where data goes | **Basic**: nowhere (simple rules, not AI). **Ollama**: stays on this computer, unless its address points at another machine. **Claude**: sent to Anthropic. Sending work content to Anthropic needs Crestron's OK. |
| Every request is logged | The exact request and response are saved (AI log), with tokens and the estimated Claude cost. |
| Default model | Claude: Opus 5.5 (Sonnet or Haiku 5.5 in Settings). Ollama: gpt-oss:20b. App default: Basic. |

## What the AI is sent about each item

| Item | What's sent | Limit |
|---|---|---|
| Task updates (imports and briefings) | Whole updates only, newest first, never cut mid-sentence | **300 characters** (`UPDATES_FOR_AI`). A single newest update longer than that is shortened. |
| Task notes (briefings only) | The user's own notes | **300 characters** |
| Project (imports) | Overview and status brief; without a status brief, its latest updates | Overview 300, status brief 500, updates **400 characters** |
| Person (imports) | One-line brief; without one, their latest updates | **300 characters** |
| Project status brief (Regenerate) | Its updates, newest part only | **24,000 characters** |
| Email conversations | Each message, plus the older messages quoted in the email (for context) | **8,000** per message, **4,000** of quoted older messages, **40,000** per conversation |
| Every prompt | A three-week calendar, so "Friday" resolves correctly | 21 days |

## Imports (Import screen, Outlook mail)

| Rule | Detail |
|---|---|
| ✅ When | When the user imports or re-runs an item, or clicks Read for Outlook mail. Mail is never read on a schedule. |
| ✅ Sent | The item, plus all open tasks (title, status, due date, project, who asked, waiting on, score and any AI change, updates), active projects and all people. |
| ✅ Output | Suggestions go to Review: new task, needs reply, status update, mark done, waiting on, new project, new person, context. |
| ✅ Next actions | One per open task the item is about, shown on the task's card. None for tasks it proposes to mark done. |
| ✅ Priority adjustment | For open tasks the item is about, not ones it proposes to mark done. See Priority adjustment below. |
| ✅ Mail rules | No "needs reply" if the user sent the latest message. A waiting-on item starts when the user sent the ask. Follow-up flag after **3 business days**. First Outlook check looks back **7 days**. |
| ✅ Local model passes | Ollama runs split passes at low reasoning: (1) tasks, updates, done, waiting on and next actions; (2) projects, people and context; (3) linking new tasks to new projects and people. Each request times out after **6 minutes**. |
| ✅ Claude settings | Medium effort, refusal fallback on (Opus and Sonnet). |
| ✅ AI log | The last **5 runs** per import, deleted with the import. |

## Daily briefing (Today)

| Rule | Detail |
|---|---|
| ✅ When | Only when the user clicks Write briefing or Refresh, or uses Ctrl+K. No schedule yet. |
| ✅ Sent | The top **25 open tasks** by priority (every overdue task, even past 25), **20 waiting-on items**, and what's new since the last briefing. |
| ✅ Output | A one-line summary; **3 to 5** top priorities (every overdue task, first, even if the AI skipped it); up to **3** waiting-on nudges; up to **8** new items, plus a Review line. |
| ✅ Next actions | One per top priority, also shown on the task's card. |
| ✅ Priority adjustment | For any of the tasks it was sent, listed or not. See Priority adjustment below. |
| ✅ Kept | Every briefing; the AI log for the newest **5**. |
| ✅ Claude settings | Low effort. |

## Weekly review (Weekly)

| Rule | Detail |
|---|---|
| ✅ When | The reflection is written only when the user clicks, and only for the current week. The lists need no AI. |
| ✅ Sent | The week's Completed, New, Slipping and Waiting on lists, up to **40 items** each. |
| ✅ Output | A summary, then up to **3** points each for Went well, Slipped and Focus next. Text only. |
| ✅ Out of date | Says so when tasks have changed since it was written. |
| ✅ Kept | The AI log for the newest **5** weeks. |

## Suggested next action (task card)

| Rule | Detail |
|---|---|
| ✅ When | Only as part of a daily briefing or an import. Never on its own, and Basic writes none. |
| ✅ Form | One sentence starting with a verb, plus one sentence on why. **200** and **300** characters at most. |
| ✅ Where | The task's card only. It never goes to Review and changes nothing. One per task; the newest replaces it. |
| ✅ Imports | Written when the import runs, even if the user later rejects that import's suggestions. |
| ✅ Dismiss | Folds to "Suggestion dismissed · Show". A new suggestion shows again. |
| ✅ Out of date | Marked in amber when the task has an update dated a later day than the suggestion. |

## Priority adjustment (task card)

| Rule | Detail |
|---|---|
| ✅ Base score | Deterministic 0–100 from due date (counts from **14 days** out), who asked (their stars), and staleness (maxes at **14 days** idle, or follow-ups). A waiting item with no reply after **3 business days** climbs. |
| ✅ When | Only as part of a daily briefing or an import, like next actions. Never on its own, and Basic makes none. |
| ✅ Limit | The AI may move a task's score by at most **±15**; larger answers are held to 15. The result stays within 0 to 100. |
| ✅ What it sees | The computed score and its own current change, kept apart so a change is never counted twice. It's asked to change a score only when the item, notes or updates show something the score misses. |
| ✅ Applied | Right away, so list order changes too. The priority card shows "54 + 10", the reason and where it came from. Tasks with a change show ✦ next to their score. |
| ✅ Replaced | A later briefing or import can give a new change, or 0 to remove it. One that skips the task keeps it. Reason: **200 characters** at most. |
| ✅ Remove | Takes it off at once. A later briefing or import can suggest a new one. |
| ✅ Override | A score the user sets by hand always wins; the AI's change stays on the card, greyed, marked "Not used". |

## People and project briefs

| Rule | Detail |
|---|---|
| ✅ When | Only when the user clicks Regenerate. |
| ✅ Output | A suggestion he keeps or discards. Person: one or two sentences (**600 characters** at most). Project: status, then "Next:" and "Open:" lines. |
| ✅ Project overview | Written by the user only; the AI never writes it. |

## How the AI has done in tests

Dated hand-run checks, newest first. Add a row whenever a model is tried on a feature. The extraction benchmark (`npm run bench:ai`, see `bench/README.md`) is separate and measures imports only.

### 2026-11-05 · Next actions and priority changes, made-up demo data

One daily briefing (19 open tasks) and one made-up email from Dana with three clear signals: the roadmap slides are now top priority with a draft due Monday; the competitor teardown deck is no longer needed; Alex is blocked until the pilot dealers are picked. Each model started from the same state. Run on the MacBook Pro.

| | Opus 5.5 | Sonnet 5.5 | Haiku 5.5 | gpt-oss:20b (Ollama) |
|---|---|---|---|---|
| Time, briefing / import | 9 s / 18 s | 7 s / 7 s | 4 s / 14 s | 56 s / 44 s |
| Estimated cost, both | $0.09 | $0.04 | under $0.01 | free |
| Roadmap slides | +15 | +15 | +12 | no change |
| Pick pilot dealers | +12 | +12 | +10 | no change |
| Competitor deck | proposed mark done | proposed mark done | −15, and an update saying it was dropped | missed |
| Changes from the briefing | course outline +5, wireframes −8 (blocked) | course outline +8 | Munich price list +5 (weak reason) | none |
| Next actions, briefing | 5, specific | 5, specific | 5, specific | 5, mostly restate the title; some reasons made up |
| Next actions, import | 2, specific | 2, specific | 2, specific | none |
| "Monday" resolved right | yes | yes | yes | no (Nov 6, not Nov 9) |

**Takeaway:** all three Claude models use both features well; Sonnet matched Opus at under half the cost. gpt-oss:20b ignored both features on imports and wrote weak next actions; its import suggestions were also poorer (duplicate tasks, a wrong date). Tuning the local prompts, for example a separate short pass for next actions and priority changes, is untried.

