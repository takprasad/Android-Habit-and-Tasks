# Feature update (overlay onto android/ project)
Copy `app/` over your project (same folder layout). Changed: js/app.js, js/logic.js, js/native.js, js/storage.js, styles.css.
No new plugins or permissions. Old data and exports keep working (a saved single timer is converted automatically).
If you applied an earlier overlay that contained js/drive.js, you can delete that file; nothing uses it.

## Latest changes
1. **Home: progress ring card removed.** The level bar is now the first card under the date.
2. **Home is static**; only the tasks list scrolls (the date, level bar, Coins earned / Tasks pending cards and habit strip stay put).
3. **Habits page:** title and search stay put, only the habit list scrolls.
4. **Tasks page:** title, quick add, List/Calendar switch, search/sort and filter chips stay put, only the task list
   (or the calendar in Calendar view) scrolls.
5. **Rewards page:** title, streak freezes, earnings line and the Unlocked/Upcoming/Claimed/Badges switch stay put, only the list/badges scroll.
   Scroll position is kept when the list refreshes (e.g. after completing an item).
6. **Timers for several tasks at once.** Start a timer on as many tasks as you like; each has its own clock, pause/resume and
   Stop & save. Tasks with a timer show a live clock in every list. Stopping or completing a task only affects that task's timer.
   Each running timer gets its own "still running" (3 h) and focus-block notification.
7. **Level and coins pill at the top right of every page** (Today, Habits, Tasks incl. calendar, Rewards, Settings, Statistics, task details).
   Tap it to see how levels work. The Rewards page lost its duplicate "Wallet" line.

## Earlier rounds are all still included
Coins per hour of logged time, custom categories, 37 badges, manual Drive backup & restore, localStorage mirror,
recurring tasks, steps, freezes, quick add, calendar, pomodoro, undo, and the rest.

Tests: `node tests/logic.features.test.mjs` (31) · `node tests/storage.test.mjs` (11) · `python3 tests/e2e_ui.py`
(playwright; serve app/src/main/assets/public on :8765; checks the fixed frames, pill on every page, and two simultaneous timers).
