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
| `m1-core.mjs` | Every tab; people, projects and tasks through the UI; priority ordering; J/K selection; autosave on switch; E to mark done (including with unsaved edits); waiting-on; divider minimums and reset; command palette; theme toggle; G-navigation; backup; data surviving a restart |
| `m2-ai.mjs` | Import, then Review; editing then accepting; A and R keys; linked sources; duplicate detection; the Claude-without-key error with retry; encrypted key storage; key removal; re-running an import; the Today prompt |
