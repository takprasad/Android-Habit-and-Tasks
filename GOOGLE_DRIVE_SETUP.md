# Google Drive backup: one-time setup (about 5 minutes, free)

The app saves backups as plain JSON files in a Drive folder called **HabitTaskTracker Backups**, once a week
(the first time you open the app after 7 days) and whenever you tap **Back up now**. **Restore…** lists the
backups and loads the one you choose. The 8 newest are kept, older ones are removed automatically.

The app asks Google for the **drive.file** permission only: it can see and change files **it created itself**, and
nothing else in your Drive. Sign-in uses Google's "limited-input device" flow, so you type a short code at
google.com/device. No app signing key or redirect set-up is needed.

## 1. Create the Google credentials
1. Go to https://console.cloud.google.com and create a project (any name, e.g. "Habit Tracker").
2. **APIs & Services → Library →** search **Google Drive API → Enable**.
3. **APIs & Services → OAuth consent screen** (also called *Google Auth platform*):
   - User type **External**, fill in an app name and your email.
   - **Data access / Scopes:** add `https://www.googleapis.com/auth/drive.file`.
   - **Publish app** (move it from *Testing* to *In production*). `drive.file` needs no Google review.
     If you leave it in *Testing*, Google expires the sign-in every 7 days and you will have to reconnect weekly.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **TVs and Limited Input devices**.
   - Copy the **Client ID** and **Client secret**.

## 2. Connect in the app
**Settings → Backup & restore · Google Drive**
1. Paste the Client ID and Client secret, tap **Connect Google Drive**.
2. Tap **Open google.com/device**, enter the code shown in the app, choose your Google account and approve.
3. The app finishes connecting and makes the first backup straight away.

## Good to know
- **Weekly backup** needs the app to be opened: Android gives apps no dependable background timer.
  Turn it off with the "Back up automatically once a week" switch.
- **Restore** replaces your current data and shows an Undo right afterwards.
- **Disconnect** revokes the app's access; the backups already in Drive stay there.
- **Delete all data** in Settings also forgets the Drive connection.
- The Client secret and sign-in token are kept in the app's private storage on the phone and are never included
  in exports or in the backup files themselves.
- Not working? A "Google hasn't verified this app" screen means the app was left in *Testing*; either continue
  with your own account or publish it as in step 1.3. "Access expired" means you must tap Connect again.
