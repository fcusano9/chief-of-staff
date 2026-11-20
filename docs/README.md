# Docs

## What's here

| Doc | What it's for | Update it when |
|---|---|---|
| [ROADMAP.md](ROADMAP.md) | What's built, what's next, and what still needs checking for real | A milestone lands, the plan changes, or something gets tried for real |
| [DECISIONS.md](DECISIONS.md) | Why things are the way they are, newest first | A choice would surprise someone reading the code later |
| [AI-RULES.md](AI-RULES.md) | Every AI rule and limit on one page: what it's sent, when it runs, what it may change | An AI rule, limit, or prompt behavior changes (same PR) |
| [BUSINESS-RULES.md](BUSINESS-RULES.md) | Every other app rule: scoring, lists, Review, mail, meetings, backups, settings | Any other rule changes (same PR) |
| [COPILOT-PROMPTS.md](COPILOT-PROMPTS.md) | How the Copilot Prompt Generator's Teams prompts work | The prompts in `src/main/services/copilot.ts` or the import they feed change |
| [ARCHITECTURE.html](ARCHITECTURE.html) | Interactive guide: system map, flows, data model, screens, rules, and a priority calculator. Open it in a browser | A table, IPC call, screen, or rule changes; then run `npm run docs` |

Other docs live next to what they describe: [README.md](../README.md) and [AGENTS.md](../AGENTS.md) at the top, plus [design/README.md](../design/README.md), [e2e/README.md](../e2e/README.md), and [bench/README.md](../bench/README.md).

## Keeping them current

Each PR updates the docs it affects (see AGENTS.md). Some drift slips through anyway, so every so often (after a milestone, or about monthly) audit them all. In Claude Code, run **`/docs-audit`**, which follows this checklist; with any other tool, follow it directly.

**Automatic checks.** `tests/docs.test.ts` runs with `npm test` and in CI. It fails when the guide's generated part is stale, a table or IPC call is missing from the guide, a file or function the guide names doesn't exist, a relative link in a Markdown doc is broken, or a list falls out of step: docs in this table, mockups in `design/README.md`, e2e suites in `e2e/README.md`, and services in AGENTS.md's layout.

**The audit checklist**

1. **Check every claim against the code.** Look up each file, function, setting, number, and behavior a doc mentions. If the doc is wrong, fix the doc. If the code looks wrong, don't change it: add a row to BUSINESS-RULES.md's Open questions.
2. **Go doc by doc:**
   - **README.md:** install and build steps and commands match `package.json` and `electron-builder.yml`. Keep it short.
   - **AGENTS.md:** the layout matches the folders, and the "how to" steps still work. Feature notes point to code and gotchas; they don't repeat the rules docs.
   - **ROADMAP.md:** the status table is current, items tried for real leave "Not yet verified", and finished backlog items are removed.
   - **DECISIONS.md:** never delete or rewrite an entry. When a later decision replaces part of one, add a **Later:** note and trim the replaced detail.
   - **AI-RULES.md and BUSINESS-RULES.md:** every row matches the code, and settled Open questions are removed. Don't rename section headings: the guide links to them.
   - **ARCHITECTURE.html:** the hand-written `model` block (node descriptions, table purposes, flows) still matches.
   - **COPILOT-PROMPTS.md:** matches `src/main/services/copilot.ts`.
   - **design/README.md:** new mockups are listed and each status (Current, Partly, Replaced) is right. Don't delete mockups; DECISIONS.md links to them.
   - **e2e/README.md and bench/README.md:** suites, commands, and cases match the code.
3. **Remove what no longer applies**, unless it records why something changed. Merge repeated content into one place and link to it.
4. **Write for readers:** short bullets and tables over long paragraphs, the Oxford comma, and "the user" rather than Frank's name, except where it's about him. Keep important details even when they take space.
5. **Run `npm run docs`, `npm test`, and `npm run typecheck`.** Don't run `npm run e2e` or `npm run bench:ai` without asking.
6. **Open a PR** with a short description that lists anything not verified.
