# Feature update (overlay onto android/ project)
Copy `app/` over your project (same folder layout), then **Sync Gradle** and run. This update contains NEW ANDROID CODE.
Read `APP_BLOCKER.md` for setup and a 5-minute device check.

## New: App blocker
Block any installed app until chosen habits and/or tasks are done for the day (e.g. no YouTube until Gym is checked in).
- Settings → App blocker: turn the service on, add apps, choose habits/tasks and "all" or "any".
- Unlocks the moment you finish, re-locks at midnight (works while the tracker is closed), re-locks if you undo the check-in.
- Full-screen block page (Open tracker / Go to home screen / Back = home), with a go-home fallback if Android refuses to show it.
- Rules are saved with your data (exports, Drive backups, restore).

### Files
New: `BlockerService.java` (accessibility service), `BlockActivity.java` (block page), `AppBlockerPlugin.java` (bridge), `BlockRules.java`,
`res/xml/blocker_service_config.xml`, `res/values/blocker_strings.xml`.
Changed: `AndroidManifest.xml` (service, activity, `<queries>` for listing apps; no new permissions),
`MainActivity.java` (registers the plugin), `js/app.js`, `js/logic.js`, `js/native.js`, `js/storage.js`, `styles.css`.
If you changed your own AndroidManifest.xml, merge just the `<activity BlockActivity>`, `<service BlockerService>` and `<queries>` blocks.

## Everything from earlier rounds is still included
Fixed page frames with one scrolling list, level/coins pill on every page, several timers at once, coins per hour, custom categories,
37 badges, manual Drive backup & restore, recurring tasks, steps, quick add, calendar, pomodoro, undo, and the rest.

## Tests
`node tests/logic.features.test.mjs` (37) · `node tests/storage.test.mjs` (11) · `python3 tests/e2e_ui.py` (playwright; serve app/src/main/assets/public on :8765;
simulates the native blocker) · `sh tests/java_stub_check/check.sh` (compiles the new Java against stand-in Android classes).
