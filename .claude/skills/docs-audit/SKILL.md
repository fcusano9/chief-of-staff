---
name: docs-audit
description: Audit every doc in this repo against the code and bring it up to date, following the checklist in docs/README.md. Run after a milestone or about monthly.
disable-model-invocation: true
---

# Docs audit

The checklist lives in `docs/README.md` ("Keeping them current"), so every AI tool follows the same steps. Read it first and follow it in order; this file only adds how to run it in Claude Code.

1. **Start a branch** from the latest `main` (never commit to `main`), and keep the task list current: one step per doc.
2. **Inventory** every tracked doc: `git ls-files '*.md' '*.html' | grep -v node_modules`.
3. **Verify before editing.** For each claim that looks stale, check the code (grep the file, function, setting, or number) before changing the doc. Say what you checked. Don't guess: if it can't be checked from the code (for example, whether something was tried on real data), leave it and list it for Frank.
4. **Edit**, keeping the rules in AGENTS.md: the Oxford comma, concise wording, "the user" in app descriptions, and no changes to code.
5. **Check:** `npm run docs`, then `npm test` and `npm run typecheck`. If a test fails on files you didn't touch, check whether `node_modules` matches `package-lock.json` (`npm install`) before assuming it's your change.
6. **Report** what was wrong, what was cut or merged, and what needs Frank's decision. Commit and open a PR only when he asks.
