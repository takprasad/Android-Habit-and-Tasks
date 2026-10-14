package com.example.habittracker;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

public class HabitWidgetProvider extends AppWidgetProvider {

    private static final String ACTION_AUTO_UPDATE = "com.example.habittracker.ACTION_AUTO_UPDATE";

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (ACTION_AUTO_UPDATE.equals(intent.getAction()) || AppWidgetManager.ACTION_APPWIDGET_UPDATE.equals(intent.getAction())) {
            updateAllWidgets(context);
            scheduleNextAlarm(context);
        }
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
        scheduleNextAlarm(context);
    }

    @Override
    public void onEnabled(Context context) {
        super.onEnabled(context);
        scheduleNextAlarm(context);
    }

    @Override
    public void onDisabled(Context context) {
        super.onDisabled(context);
        cancelAlarm(context);
    }

    public static void scheduleNextAlarm(Context context) {
        try {
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            Intent intent = new Intent(context, HabitWidgetProvider.class);
            intent.setAction(ACTION_AUTO_UPDATE);
            PendingIntent pi = PendingIntent.getBroadcast(
                    context, 1001, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            long triggerAt = System.currentTimeMillis() + 60000;
            if (am != null) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            }
        } catch (Exception e) {
            // ignore
        }
    }

    public static void cancelAlarm(Context context) {
        try {
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            Intent intent = new Intent(context, HabitWidgetProvider.class);
            intent.setAction(ACTION_AUTO_UPDATE);
            PendingIntent pi = PendingIntent.getBroadcast(
                    context, 1001, intent,
                    PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE
            );
            if (am != null && pi != null) {
                am.cancel(pi);
            }
        } catch (Exception e) {
            // ignore
        }
    }

    public static void updateAllWidgets(Context context) {
        try {
            AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(context);
            ComponentName componentName = new ComponentName(context, HabitWidgetProvider.class);
            int[] appWidgetIds = appWidgetManager.getAppWidgetIds(componentName);
            for (int appWidgetId : appWidgetIds) {
                updateAppWidget(context, appWidgetManager, appWidgetId);
            }
        } catch (Exception e) {
            // ignore
        }
    }

    private static String extractJson(String raw) {
        if (raw == null || raw.isEmpty()) return null;
        int firstPipe = raw.indexOf('|');
        int secondPipe = raw.indexOf('|', firstPipe + 1);
        if (firstPipe > 0 && secondPipe > firstPipe) {
            return raw.substring(secondPipe + 1);
        }
        return raw;
    }

    static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_daily_habits);

        Intent intent = new Intent(context, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                context, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_root, pendingIntent);

        int doneCount = -1;
        int totalCount = -1;
        String todayDate = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());

        try {
            SharedPreferences prefs = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);

            // 1. Try precalculated widget summary
            String wData = prefs.getString("ht_kv_widget_data", prefs.getString("widget_data", ""));
            if (!wData.isEmpty()) {
                JSONObject wJson = new JSONObject(wData);
                if (todayDate.equals(wJson.optString("date"))) {
                    doneCount = wJson.optInt("done", 0);
                    totalCount = wJson.optInt("total", 0);
                }
            }

            // 2. Fallback to parsing packed ht2_a / ht2_b slots if widget_data is missing/stale
            if (doneCount < 0) {
                String rawA = prefs.getString("ht2_a", "");
                String rawB = prefs.getString("ht2_b", "");
                String jsonStr = extractJson(!rawA.isEmpty() ? rawA : rawB);

                if (jsonStr != null && !jsonStr.isEmpty()) {
                    JSONObject state = new JSONObject(jsonStr);
                    JSONArray habits = state.optJSONArray("habits");
                    JSONArray checkins = state.optJSONArray("checkins");

                    Set<String> doneHabitIds = new HashSet<>();
                    if (checkins != null) {
                        for (int i = 0; i < checkins.length(); i++) {
                            JSONObject c = checkins.getJSONObject(i);
                            if (todayDate.equals(c.optString("d"))) {
                                doneHabitIds.add(c.optString("h"));
                            }
                        }
                    }

                    if (habits != null) {
                        doneCount = 0;
                        totalCount = 0;
                        for (int i = 0; i < habits.length(); i++) {
                            JSONObject h = habits.getJSONObject(i);
                            if (!h.optBoolean("archived", false) && !h.optBoolean("paused", false)) {
                                totalCount++;
                                if (doneHabitIds.contains(h.optString("id"))) {
                                    doneCount++;
                                }
                            }
                        }
                    }
                }
            }
        } catch (Exception e) {
            // fallback
        }

        if (doneCount < 0) doneCount = 0;
        if (totalCount < 0) totalCount = 0;

        String ratioText = doneCount + "/" + totalCount;
        String statusText;

        double ratio = totalCount > 0 ? (double) doneCount / totalCount : 0;
        if (totalCount == 0) {
            statusText = "No habits today";
        } else if (ratio == 1.0) {
            statusText = "🎉 All Done!";
        } else if (ratio >= 0.5) {
            statusText = "🔥 Over Halfway!";
        } else if (ratio > 0) {
            statusText = "⚡ On Your Way!";
        } else {
            statusText = "😴 Time to Start!";
        }

        StringBuilder emojiBar = new StringBuilder();
        int maxShow = Math.min(totalCount, 8);
        for (int i = 0; i < maxShow; i++) {
            if (i < doneCount) {
                emojiBar.append("✅ ");
            } else {
                emojiBar.append("🟢 ");
            }
        }

        views.setTextViewText(R.id.widget_fraction, ratioText);
        views.setTextViewText(R.id.widget_status, statusText);
        views.setTextViewText(R.id.widget_emojis, emojiBar.length() > 0 ? emojiBar.toString().trim() : "⚪ ⚪ ⚪");

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }
}
