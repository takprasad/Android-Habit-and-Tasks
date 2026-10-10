# Feature update (overlay onto android/ project)
Copy `app/` over your project (same folder layout). New file: js/drive.js. Changed: js/app.js, js/logic.js, js/native.js,
js/storage.js, styles.css. No new plugins or permissions (INTERNET is already declared). Old data and exports keep working.

## What's new
1. **Coins = 2 per hour of logged time** (timer or manual). Part-hours carry over, so 30 min = 1 coin and three 10-minute
   logs add up to 1 coin. Adjustable in Settings ("Supercoins per hour"), 0 turns it off. Replaces the old per-session coins.
2. **Google Drive backup**: weekly automatic backup (runs the first time the app is opened after 7 days), **Back up now**,
   **Restore…** (pick any backup; Undo is offered), Disconnect. Uses the narrow drive.file scope: the app only sees its own files.
   One-time free setup: see GOOGLE_DRIVE_SETUP.md. 8 newest backups kept.
3. **Create your own categories** for habits and tasks (type a new name in either form, or manage them in Settings > Categories).
   Names are de-duplicated ignoring case; a category still in use cannot be deleted.
4. **Level progress bar moved to the Today screen** (tap it for "How levels work").
5. **37 badges** (was 12), every one with a progress counter (e.g. 7 / 25) and earned ones listed first.
6. **Settings > Level info card**: how levels are decided (lifetime coins earned, level N starts at 5 x N x (N-1)), a table of levels,
   and how coins are earned.
7. **Improvements:** Settings regrouped into clear cards; backup status ("Last backup", errors, nudge colour when over 8 days old);
   category usage counts; first Drive backup runs right after connecting; empty apps never push good backups out of rotation;
   wiping data also forgets the Drive sign-in; home header no longer wraps on long weekday names.

## Tests (all included)
`node tests/logic.features.test.mjs` (27) · `node tests/storage.test.mjs` (10) · `node tests/drive.test.mjs` (12, fake Google server)
`python3 tests/e2e_ui.py` (playwright; serve app/src/main/assets/public on :8765; simulates the Google endpoints).
