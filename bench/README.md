# Extraction benchmark

Scores AI providers on fifteen made-up imports shaped like Frank's real work: Copilot summaries, emails (from his manager, a vendor with a prompt injection, a dealer, a customer with a question), Teams chats, meeting transcripts (long, a kickoff with a new project and person, a partner call starting an initiative), Outlook conversations, a newsletter with nothing to do, and recaps of finished work and decisions. The last four were added later to check that prompt changes help beyond the original cases. Each case lists the suggestions a careful assistant should make, extras that are fine, and things it must not do.

```bash
npm run bench:ai                                          # demo, every installed Ollama model, and Claude if a key is available
BENCH_MODELS=gpt-oss:20b,claude-sonnet-5-5 npm run bench:ai
BENCH_MODELS=gpt-oss:20b@medium+single npm run bench:ai   # local model with other options, joined with +: low|medium|high, single (one pass)
BENCH_RESCORE=bench/results/a.json,bench/results/b.json npm run bench:ai   # re-score saved answers, no model calls
```

- **Claude** runs only with a key, and only these made-up cases are sent. Set `ANTHROPIC_API_KEY`, or on a Mac store it once in the Keychain with `security add-generic-password -s chief-of-staff-bench -a anthropic -w` (remove it with `security delete-generic-password -s chief-of-staff-bench`). The app's own key can't be read here because it's encrypted for the app.
- **Re-scoring** applies the current cases and scoring to saved runs, so runs from different days compare fairly. Timings stay as measured.
- **Local models** need Ollama running (`ollama serve`, or the Ollama app) and the models pulled first. Each model is loaded once before timing, then unloaded so the next one has the memory.
- **Reports** go to `bench/results/` (git ignores it) as Markdown plus JSON with every raw answer.

| Column | Meaning |
|---|---|
| Found | Expected suggestions the model made, after the app's own validation |
| Dates right | Of the expected suggestions with a deadline, how many got the right date |
| Extra | Suggestions Frank would probably reject |
| Rule breaks | Someone else's task, a duplicate of an open task, a finished task marked done wrongly, or following an injected instruction |
| Failed | Errors or unreadable output |

The cases are small, so treat differences of one or two points as noise. Add a case to `cases.ts` whenever a real import goes wrong.
