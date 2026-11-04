# End-to-end tests

These scripts launch the real built app (`out/`) and drive it the way a person would, through the Chrome DevTools Protocol: clicks, typing, keyboard shortcuts, dragging the divider, and screenshots.

```bash
npm run e2e                   # build, then run every suite
node e2e/m2-ai.mjs            # one suite (after npm run build)
E2E_NETWORK=1 npm run e2e     # also run "Test connection" with a fake key against Anthropic
```

- **Your data is safe.** Each suite uses a throwaway data folder in the system temp directory (`COS_DATA_DIR`). Backups are redirected into that folder, so real data and OneDrive backups are never touched.
- **No network by default.** The demo AI is used throughout.
- **Screenshots** go to `e2e/shots/`, which git ignores.
- **Pass and fail:** a suite prints one `PASS` or `FAIL` line per check and exits non-zero on any failure.
- **Driver API:** `cdp.mjs` provides `launch()`, `click`, `clickText`, `type`, `key`, `drag`, `eval`, `waitFor` and `screenshot`. Inside `eval`, the app's API is available as `window.cos` for setup and assertions.

| Suite | Covers |
|---|---|
| `m1-core.mjs` | Every tab; people, projects and tasks through the UI; priority ordering; Up/Down selection on Tasks and People, Enter to edit a name, J/K gone; autosave on switch; E to mark done (including with unsaved edits); waiting-on; divider minimums and reset; command palette; theme toggle from the palette, Shift+D and Alt+1 gone; G-navigation; backup; data surviving a restart |
| `m2-projects-people.mjs` | New project, new person and context suggestions from a fake local model: order in Review, "(new)" links, accepting a task creates its project and person (1 star, briefs), context added to existing briefs |
| `ai-log.mjs` | AI log opened from Review and from Import; each part of what was sent (Instructions, Message, Response, Full request); summary counts and "after the app's checks"; two runs listed newest first and switchable; back navigation |
| `data-safety.mjs` | Starting on an older database makes a safety copy before upgrading and keeps the data; Restore from backup in Settings (confirm, the app restarts itself, the data comes back, a before-restore copy exists); "Test data" marker; running from source uses the separate dev folder. Cleans up only the folders it created |
| `m2-people.mjs` | Company in the list and editor; the Company and Open asks filters (remembered); Write brief with the demo AI, Keep, the "new notes" hint, Edit with Esc and Ctrl+Enter; unsaved edits surviving a kept brief; the History window (add a note, Save keeps it) |
| `m2-project-brief.mjs` | Projects: bigger name and softer overview; the overview's pencil, Esc and Ctrl+Enter; Write brief with the demo AI, Keep, the "new notes" hint, Edit; the History window (newest first, new notes marked, Add, Edit, Esc); Save keeping history added in the window; unsaved name edits surviving |
| `mail.mjs` | Outlook mail from a fixture file instead of Outlook (`COS_OUTLOOK_FIXTURE`): first-run start date, Check Outlook counts, the skipped list, Read and its summary, the mail row in Recent imports, Needs reply and Waiting on in Review with Open in Outlook, the follow-up flag on Waiting, the next check starting at the last import, and mail never being read twice |
| `autosave.mjs` | Projects and People save pending edits when you pick another item, start a new one, or change tabs; a new project is created on switch; an empty name isn't saved and warns; no save without changes; Save then switch saves once |
| `lists.mjs` | Waiting items off Tasks and on Waiting; no "no signals" text; Open / Done on both with Reopen back to the right list; N on Waiting starts a waiting item; search on Tasks, Waiting (by person), Projects and People (by company); new people at 1 star; archived projects on their own Projects list, with Unarchive |
| `m2-ai.mjs` | Import, then Review; editing then accepting; A, R and Enter keys (E no longer edits); Esc and Ctrl+Enter while editing; linked sources; duplicate detection; the Claude-without-key error with retry; encrypted key storage; key removal; local model settings, the unreachable-Ollama error and the privacy wording; re-running an import; the Today prompt |
