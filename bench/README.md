# Extraction benchmark

Scores AI providers on eight made-up imports shaped like Frank's real work: a Copilot summary, an email from his manager, a Teams chat, a long meeting transcript, a vendor email with a prompt injection, a newsletter with nothing to do, a recap showing finished work, and a kickoff that introduces a new project and person. Each case lists the suggestions a careful assistant should make, extras that are fine, and things it must not do.

```bash
npm run bench:ai                                          # demo, every installed Ollama model, and Claude if ANTHROPIC_API_KEY is set
BENCH_MODELS=gpt-oss:20b,claude-sonnet-5-5 npm run bench:ai
```

- **Claude** runs only with `ANTHROPIC_API_KEY` in the environment, and only these made-up cases are sent.
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
