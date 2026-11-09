# Copilot prompts for Teams

Chief of Staff can't read Teams directly yet. Until it can, ask Microsoft 365 Copilot to pull out the useful parts of your Teams chats and meetings, then paste the answer into the Import screen.

## The Copilot Prompt Generator

Import → **Copilot Prompt Generator** (top right) makes the prompt for you:

1. Pick **Teams chats** or **Teams meetings**.
2. The start time defaults to where your last imported answer to that prompt ended (7 days ago the first time); change it if you need to. The end is the moment you copy it.
3. **Copy prompt**, paste it into Microsoft 365 Copilot, then paste Copilot's whole answer into the text box on Import and Extract.

Copilot is asked to start its answer with a line like `Chief of Staff · Teams chats · 2026-11-07 15:14 to 2026-11-08 09:30`. When that answer is imported, the app records the time span, names the import ("Teams chats, Nov 7 – 8") and dates it, so the next prompt starts where this one ended: nothing is pulled twice, and nothing is missed. A prompt you copy but never import records nothing.

**The prompt text lives in `src/main/services/copilot.ts`** (`chatsPrompt`, `meetingsPrompt`); this file describes it. If you change the extraction prompt in `src/main/ai/prompts.ts`, check that these prompts still fit it.

## What the prompts ask for

They match what the import looks for:

- **An exact time span**, with times, instead of "the last 7 days", so imports don't overlap.
- **Full names.** The app matches people by name and suggests new people from them.
- **Real dates (YYYY-MM-DD).** Copilot converts relative dates using the date each message was sent; the app counts any left over from the import's date.
- **Exact quotes.** Every suggestion needs a short quote as evidence.
- **Whether Frank already handled it.** Things already done shouldn't come back as new tasks.

The sections follow the app's suggestion types: asked of me (needs reply), my commitments (new task), waiting on others, done (mark done), decisions and context (brief update), and people (new person).

## Tips

1. If the answer is long, import it in a few pieces, for example one per meeting or a few chats at a time. Keep the marker line at the top of the first piece. You'll get more accurate suggestions, and the local model (Ollama) refuses items that are too long.
2. Copilot can only see the content of meetings that were transcribed or recorded. For others it may only see the invite or the chat, which is why the meeting prompt asks it to say what it used.
3. If Claude is the AI provider, this content goes to Anthropic. Basic and local models keep it on the computer.
