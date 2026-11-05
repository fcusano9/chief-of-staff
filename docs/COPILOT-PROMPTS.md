# Copilot prompts for Teams

Chief of Staff can't read Teams directly yet. Until it can, ask Microsoft 365 Copilot to pull out the useful parts of your Teams chats and meetings, then paste the answer into the Import screen.

The prompts match what the import looks for:

- **Full names.** The app matches people by name and suggests new people from them.
- **Real dates (YYYY-MM-DD).** The app reads relative dates like "Friday" against the import date, not the message date.
- **Exact quotes.** Every suggestion needs a short quote as evidence.
- **Whether the user already handled it.** Things already done shouldn't come back as new tasks.

The sections follow the app's suggestion types: asked of me (needs reply), my commitments (new task), waiting on others, done (mark done), decisions and context (brief update), and people (new person).

If you change the extraction prompt in `src/main/ai/context.ts`, check that these prompts still fit it.

## How to import the results

1. Go to **Import**, pick **Copilot summary** as the type, give it a title like "Teams chats, week of Oct 27", and paste.
2. If the results are long, import them in a few pieces, for example one per meeting or a few chats at a time. You'll get more accurate suggestions, and the local model (Ollama) refuses items that are too long.
3. Copilot can only see the content of meetings that were transcribed or recorded. For others it may only see the invite or the chat, which is why the meeting prompt asks it to say what it used.
4. If Claude is the AI provider, this content goes to Anthropic. Demo and local models keep it on the PC.

## Prompt 1: Teams chats

```text
Review my Microsoft Teams chats from the last 7 days, ending today: 1:1 chats, group chats, and channel conversations where I posted or was @mentioned. I will paste your answer into my task tracker, which uses AI to turn it into tasks, so follow the format below exactly.

Rules:
- Only report what is actually in the chats. Do not guess or fill gaps. If something is unclear, write "unclear".
- Use people's full names as they appear in Teams. Include role, company, or email only if Teams shows it.
- Write every date as YYYY-MM-DD (weekday). Convert relative dates like "Friday", "EOW", or "next week" using the date the message was sent.
- For every item, include a short exact quote from the chat in quotation marks, with who said it and the date.
- Say whether I already replied to or handled each item later in the chat.
- Skip small talk, thank-yous, and FYIs that need nothing from me.
- Plain text and bullets only, no tables.

For each chat that has something relevant, use this format:

## Chat: <chat name or participants> (1:1 / group / channel: <team> > <channel>)
Dates covered: <first message date> to <last message date>
Topic or project: <one line>

Asked of me (questions, requests, approvals, or decisions waiting on me):
- <what they need> — asked by <name> on <date> — deadline: <date or "none stated"> — I already answered: yes/no — "<quote>"

My commitments (things I said I would do):
- <what> — promised to <name> on <date> — by: <date or "none stated"> — "<quote>"

Waiting on others (things I asked for or that someone promised me and hasn't delivered):
- <what> — owed by <name> — asked/promised on <date> — expected by: <date or "none stated"> — "<quote>"

Done or resolved this week:
- <what was finished or answered> — by <name> on <date> — "<quote>"

Decisions and context worth remembering (decisions, scope or timeline changes, who owns what, stakeholder preferences):
- <fact, written so it makes sense on its own months from now> — <date> — "<quote>"

People involved:
- <full name> — <role / company / email if shown> — <one line on their part in this chat>

Leave out any section that has nothing in it, and leave out chats with nothing in any section. At the end, list the names of chats you checked but skipped because nothing was actionable.
```

## Prompt 2: Teams meetings

```text
Review my Microsoft Teams meetings from the last 7 days, ending today. Use the transcripts, recaps, and meeting chats you can access. I will paste your answer into my task tracker, which uses AI to turn it into tasks, so follow the format below exactly.

Rules:
- Only report what was actually said or written. Do not guess or fill gaps. If something is unclear, write "unclear".
- If a meeting has no transcript or recap available, say so and report only what the meeting chat or invite shows. Do not reconstruct the discussion.
- Use people's full names. Include role, company, or email only if it is shown.
- Write every date as YYYY-MM-DD (weekday). Convert relative dates like "by Friday" or "next sprint" using the meeting date.
- For every item, include a short exact quote from the transcript or chat in quotation marks, with who said it.
- Note when an item was already resolved during the meeting itself.
- Skip agenda housekeeping and small talk.
- Plain text and bullets only, no tables.

For each meeting, use this format:

## Meeting: <title> — <date> <start time>
Organizer: <name>
Attendees: <full names>
Source used: transcript / recap / meeting chat only / invite only
Topic or project: <one line>

Summary: <2–4 sentences on what was discussed and concluded>

Action items for me:
- <what I need to do> — asked by <name or "I volunteered"> — due: <date or "none stated"> — "<quote>"

Questions or decisions waiting on me (left unanswered in the meeting):
- <what they need from me> — from <name> — due: <date or "none stated"> — "<quote>"

Waiting on others (things others committed to that I depend on or asked for):
- <what> — owner <name> — due: <date or "none stated"> — "<quote>"

Done or resolved:
- <what was confirmed finished or settled> — "<quote>"

Decisions and context worth remembering (decisions, scope or timeline changes, who owns what, risks, stakeholder preferences):
- <fact, written so it makes sense on its own months from now> — "<quote>"

People involved:
- <full name> — <role / company / email if shown> — <one line on their part in this meeting>

Leave out any section that has nothing in it. At the end, list meetings you found but skipped because nothing was actionable, and meetings where no transcript or recap was available.
```
