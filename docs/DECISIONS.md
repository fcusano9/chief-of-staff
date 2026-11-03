# Decision log

Newest first. Each entry records what was decided, why, and who decided. Add an entry whenever a choice would surprise someone reading the code later.

### 2026-11-02 · AI proposes new projects and people, and links tasks to them (Frank)
Two new suggestion kinds, `new_project` and `new_person`, plus clearer instructions for context (brief) updates, which Review now labels "Project context" and "Person context". **Frank's choices:** projects only for named initiatives with their own goal or several pieces of work; people only if they ask Frank for something, he's waiting on them, or they own work he cares about; new people always start at 3 stars (the AI never guesses weight); and a task linked to a new project or person creates it when accepted, while rejecting the project or person just removes the link. Anything already in Projects or People, and Frank himself, is never proposed. Links are stored as suggestion ids (`projectSuggestionId`, `requesterSuggestionId`, `waitingOnSuggestionId`) and swapped for real ids when decided. **Benchmark (gpt-oss:20b):** finds new projects and people, but rarely links tasks to them on its own; Frank can link them in Edit. Moving the prompt-injection rule to the top was needed to keep it ignoring injected instructions with the longer prompt.

### 2026-11-02 · Local models through Ollama, default gpt-oss:20b
A third provider runs a model on the computer through Ollama's HTTP API, so nothing leaves the machine. It uses plain `fetch` (no new dependency), Ollama's JSON-schema constrained output, a context window sized to each prompt (Ollama's default silently drops the start of long prompts), and the shared validation. **Why gpt-oss:20b:** on Frank's MacBook Pro (M5, 32 GB) it found 85% of expected suggestions with no rule breaks, at about 17 s per item and 12.7 GB of memory. qwen3:8b was as fast but followed a prompt injection and proposed duplicates; qwen3:30b returns empty answers with thinking off. gpt-oss can't turn thinking off and thinks at length if sent `false`, so it gets `think: "low"`. Claude hasn't been benchmarked yet (no key on the Mac). Demo AI stays the default provider.

### 2026-11-02 · Refusal fallback on for Claude extraction
On Opus 5.5 and Sonnet 5.5, extraction requests send `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`). If Claude's safety classifier declines, the API reruns the request on a fallback model instead of failing. This follows Anthropic's guidance. Frank was told; it's easy to remove.

### 2026-11-02 · Demo AI is the default provider
A local, rule-based provider ships so the import and review flow works and can be tested without an API key or any data leaving the PC. Claude is used only when Frank selects it and stores a key. **Why:** the key and Crestron's data policy were still pending.

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
