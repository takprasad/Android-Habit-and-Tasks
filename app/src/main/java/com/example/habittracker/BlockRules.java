package com.example.habittracker;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The block rules pushed by the web app, kept in SharedPreferences so the accessibility service can use them
 * even when the web app is not running. A rule is "unlocked until <epoch ms>" (0 = blocked) plus what is still to do.
 * The web app sets the unlock time to the next local midnight, so a day's unlock expires by itself.
 */
final class BlockRules {
    private static final String PREFS = "app_blocker";
    private static final String KEY_RULES = "rules";

    static final class Rule {
        final String pkg;
        final String label;
        final String need;
        final long until;
        final boolean any;

        Rule(String pkg, String label, String need, long until, boolean any) {
            this.pkg = pkg;
            this.label = label;
            this.need = need;
            this.until = until;
            this.any = any;
        }

        boolean lockedAt(long nowMs) {
            return until <= nowMs;
        }
    }

    private BlockRules() {}

    static void save(Context context, String json) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_RULES, json).apply();
    }

    /** The rule for this package, or null when the app is not blocked. */
    static Rule find(Context context, String pkg) {
        String raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_RULES, "[]");
        try {
            JSONArray rules = new JSONArray(raw);
            for (int i = 0; i < rules.length(); i++) {
                JSONObject o = rules.optJSONObject(i);
                if (o == null || !pkg.equals(o.optString("pkg"))) continue;
                return new Rule(pkg, o.optString("label", pkg), o.optString("need", ""), o.optLong("until", 0L), o.optBoolean("any", false));
            }
        } catch (Exception ignored) {
            // corrupt data: treat as "nothing blocked" rather than locking the user out of every app
        }
        return null;
    }
}
