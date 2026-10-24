package com.example.habittracker;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Bridge between the web app and the blocker: service status, installed apps, and the rules to enforce. */
@CapacitorPlugin(name = "AppBlocker")
public class AppBlockerPlugin extends Plugin {

    /** Is the accessibility service switched on in Android settings? */
    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("enabled", isServiceEnabled(getContext()));
        call.resolve(result);
    }

    /** Opens Android's Accessibility settings, where the user switches the service on. */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    /** Apps that have a launcher icon (except this one), sorted by name. */
    @PluginMethod
    @SuppressWarnings("deprecation")
    public void listApps(PluginCall call) {
        Context context = getContext();
        PackageManager pm = context.getPackageManager();
        Intent main = new Intent(Intent.ACTION_MAIN);
        main.addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> found = Build.VERSION.SDK_INT >= 33
                ? pm.queryIntentActivities(main, PackageManager.ResolveInfoFlags.of(0))
                : pm.queryIntentActivities(main, 0);

        Map<String, String> byPackage = new HashMap<>();
        for (ResolveInfo info : found) {
            String pkg = info.activityInfo.packageName;
            if (pkg.equals(context.getPackageName()) || byPackage.containsKey(pkg)) continue;
            byPackage.put(pkg, String.valueOf(info.loadLabel(pm)));
        }
        List<Map.Entry<String, String>> entries = new ArrayList<>(byPackage.entrySet());
        Collections.sort(entries, (a, b) -> a.getValue().compareToIgnoreCase(b.getValue()));

        JSArray apps = new JSArray();
        for (Map.Entry<String, String> e : entries) {
            JSObject app = new JSObject();
            app.put("pkg", e.getKey());
            app.put("label", e.getValue());
            apps.put(app);
        }
        JSObject result = new JSObject();
        result.put("apps", apps);
        call.resolve(result);
    }

    /** Stores the rules: [{ pkg, label, until, any, need }]. */
    @PluginMethod
    public void setRules(PluginCall call) {
        JSArray rules = call.getArray("rules");
        if (rules == null) {
            call.reject("rules is required");
            return;
        }
        BlockRules.save(getContext(), rules.toString());
        call.resolve();
    }

    static boolean isServiceEnabled(Context context) {
        if (BlockerService.running) return true;
        String enabled = Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (enabled == null || enabled.isEmpty()) return false;
        ComponentName me = new ComponentName(context, BlockerService.class);
        for (String part : enabled.split(":")) {
            ComponentName cn = ComponentName.unflattenFromString(part);
            if (cn != null && cn.equals(me)) return true;
        }
        return false;
    }
}
