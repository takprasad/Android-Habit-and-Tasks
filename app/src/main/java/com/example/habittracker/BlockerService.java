package com.example.habittracker;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityEvent;
import android.widget.Toast;

/**
 * Notices when another app comes to the front. If that app has a block rule that is still locked, it shows
 * {@link BlockActivity}; should that screen fail to appear it sends the user to the home screen instead.
 * It only looks at the package name of the window that opened. It never reads the screen content.
 */
public class BlockerService extends AccessibilityService {
    static volatile boolean running = false;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private long lastBlockAt = 0L;

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        running = true;
    }

    @Override
    public boolean onUnbind(Intent intent) {
        running = false;
        return super.onUnbind(intent);
    }

    @Override
    public void onDestroy() {
        running = false;
        super.onDestroy();
    }

    @Override
    public void onInterrupt() {
        // nothing to interrupt
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null || event.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
        CharSequence name = event.getPackageName();
        if (name == null) return;
        String pkg = name.toString();
        if (pkg.equals(getPackageName())) return; // never block ourselves (or the block screen)

        BlockRules.Rule rule = BlockRules.find(this, pkg);
        if (rule == null || !rule.lockedAt(System.currentTimeMillis())) return;

        long now = SystemClock.elapsedRealtime();
        if (now - lastBlockAt < 700L) return; // one app opening fires several window events
        lastBlockAt = now;
        block(rule);
    }

    private void block(final BlockRules.Rule rule) {
        Intent intent = new Intent(this, BlockActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NO_ANIMATION)
                .putExtra(BlockActivity.EXTRA_LABEL, rule.label)
                .putExtra(BlockActivity.EXTRA_NEED, rule.need)
                .putExtra(BlockActivity.EXTRA_ANY, rule.any);
        try {
            startActivity(intent);
        } catch (RuntimeException e) {
            goHome(rule);
            return;
        }
        // Some Android versions refuse to start an activity from the background without saying so.
        // If the block screen is not showing shortly after, fall back to sending the user home.
        handler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (!BlockActivity.visible) goHome(rule);
            }
        }, 900L);
    }

    private void goHome(BlockRules.Rule rule) {
        performGlobalAction(GLOBAL_ACTION_HOME);
        Toast.makeText(this, rule.label + " is blocked. Finish your habits and tasks first.", Toast.LENGTH_LONG).show();
    }
}
