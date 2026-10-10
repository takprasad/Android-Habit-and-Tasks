# Feature update (overlay onto android/ project)
Copy `app/` over your project (same folder layout). Changed: js/app.js, js/logic.js, js/native.js, js/storage.js, styles.css.
No new plugins or permissions. Old data and exports keep working.

**If you applied the previous overlay, delete `app/src/main/assets/public/js/drive.js` and `GOOGLE_DRIVE_SETUP.md`**
(the Google sign-in approach was replaced; nothing references them any more).

## Latest changes
- **Settings: "Level info" card removed.** Level info is still one tap away: tap the level bar on the Today screen.
- **Backup & restore to a Google Drive folder you choose, manually, on the phone (no Google account setup):**
  - *Back up now* creates `habit-task-backup-YYYY-MM-DD-HHMM.json` and opens the Android share sheet. Choose **Drive**, pick the
    folder, tap **Save**. (Any other destination works too.)
  - *Restore from a backup file* opens the system file picker. Browse to the folder in **Drive**, choose the file, confirm.
    Undo is offered right afterwards; an unreadable file changes nothing.
  - Shows "Last backup sent" (amber when over a week old or never). The time is kept on the device only, never inside exports.
  - The separate "Export data (JSON)" and "Import data" buttons were folded into this card; "Export data (CSV)" stays under Your data.
  - "Delete all data" also clears the last-backup time.

## Everything from earlier rounds is still included
Coins per hour of logged time, custom categories, level bar on Today, 37 badges with progress, regrouped Settings, localStorage mirror,
dashboard ring + cards, recurring tasks, steps, freezes, quick add, calendar, pomodoro, undo, and the rest.

Tests: `node tests/logic.features.test.mjs` (27) · `node tests/storage.test.mjs` (11) · `python3 tests/e2e_ui.py`
(playwright; serve app/src/main/assets/public on :8765; downloads a backup and restores it).
