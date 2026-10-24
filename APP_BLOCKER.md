# App blocker: block an app until your habits / tasks for the day are done

Example: block **YouTube** until you have checked in **Gym**. Open YouTube without doing it and you get a
full-screen "YouTube is blocked" page listing what is left; do the habit and YouTube opens again.

## Set up (once)
1. Copy the `app/` folder over your project, **Sync Gradle**, and run the app again (it contains new Android code).
2. In the app: **Settings → App blocker → Turn on**. Android opens *Accessibility*. Find
   **Habit & Task Tracker · App blocker** (under *Installed apps* / *Downloaded apps*) and switch it **On**.
   - Android 13+ may grey it out for apps not installed from a store: open *Settings → Apps → Habit & Task Tracker →
     ⋮ → **Allow restricted settings***, then go back and switch it on.
3. **Settings → App blocker → + Block an app**: pick the app, tick the habits and/or tasks, choose
   **All of them** or **Any one of them**, save.

## What counts as "done today"
- **Habit:** checked in today. A habit that is not due today (e.g. a Mon/Wed/Fri habit on Tuesday), is paused,
  archived or hasn't started never blocks. For "N times a week/month" habits, if this period's goal is already met
  you do not need to check in again today.
- **One-off task:** marked complete. **Recurring task:** an occurrence was completed today, or the next one is not due yet.
- A deleted habit/task stops counting, so a rule can never lock you out forever by accident.
- It unlocks **immediately** when you finish (check-in, completion) and **locks again at midnight**, even if the
  tracker app is closed. Undoing a check-in locks the app again straight away.
- Changing or removing a rule while its app is blocked asks you to confirm first.

## Good to know
- It is a self-discipline tool, not a parental lock: you can still switch the accessibility service off in Android settings.
- Some phones (Xiaomi, Huawei, Oppo, Samsung "sleeping apps") stop background services. Set this app's battery usage to
  **Unrestricted** if blocking stops working after a while.
- Privacy: the service only receives *which app's window opened*. It does not read screen content (`canRetrieveWindowContent=false`),
  and nothing is sent anywhere.
- If Android refuses to show the block page, the service sends you to the home screen with a message instead, so the app is still blocked.
- Rules are part of your data, so they are in exports and Drive backups and come back on restore.
- If you ever publish this app on Google Play, Google requires an Accessibility declaration for this kind of use.

## Check it on your phone (5 minutes)
1. Turn the service on, then block an app (e.g. Chrome) with a habit you have **not** checked in today.
2. Open that app: you should see the block page; **Back** and **Go to home screen** both leave it; **Open Habit & Task Tracker** opens the tracker.
3. Check the habit in: open the app again, it should open normally.
4. Undo the check-in: opening it is blocked again.
5. Turn the service off in Android settings: the app opens freely (and Settings shows "Blocking is off" after you return).
