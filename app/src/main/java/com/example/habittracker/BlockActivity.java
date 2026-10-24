package com.example.habittracker;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.window.OnBackInvokedDispatcher;

/** Full-screen "this app is blocked" page. Built in code so it needs no layout resources. */
public class BlockActivity extends Activity {
    static final String EXTRA_LABEL = "label";
    static final String EXTRA_NEED = "need";
    static final String EXTRA_ANY = "any";

    /** True while this screen is in front; the service uses it to know the block screen really appeared. */
    static volatile boolean visible = false;

    private TextView title;
    private TextView body;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setBackgroundColor(0xFF0F6B5C);
        int pad = dp(28);
        root.setPadding(pad, dp(72), pad, pad);

        TextView lock = new TextView(this);
        lock.setText("\uD83D\uDD12");
        lock.setTextSize(48);
        lock.setGravity(Gravity.CENTER);
        root.addView(lock, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        title = new TextView(this);
        title.setTextColor(Color.WHITE);
        title.setTextSize(26);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        tp.topMargin = dp(12);
        root.addView(title, tp);

        body = new TextView(this);
        body.setTextColor(0xFFE6F4F1);
        body.setTextSize(17);
        body.setGravity(Gravity.CENTER);
        body.setLineSpacing(0f, 1.2f);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(body, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        sp.topMargin = dp(16);
        root.addView(scroll, sp);

        root.addView(button("Open Habit & Task Tracker", true, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                openTracker();
            }
        }), buttonParams());
        root.addView(button("Go to home screen", false, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                goHome();
            }
        }), buttonParams());

        setContentView(root);
        render(getIntent());

        if (Build.VERSION.SDK_INT >= 33) {
            // Apps targeting Android 16 no longer receive onBackPressed(), so register a back callback as well.
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goHome);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        render(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        visible = true;
    }

    @Override
    protected void onPause() {
        visible = false;
        super.onPause();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        goHome(); // Back must not return to the blocked app
    }

    private void render(Intent intent) {
        String label = intent.getStringExtra(EXTRA_LABEL);
        String need = intent.getStringExtra(EXTRA_NEED);
        boolean any = intent.getBooleanExtra(EXTRA_ANY, false);
        title.setText((label == null || label.isEmpty() ? "This app" : label) + " is blocked");
        if (need == null || need.trim().isEmpty()) {
            body.setText("Open Habit & Task Tracker to refresh, then try again.");
            return;
        }
        StringBuilder sb = new StringBuilder(any ? "To unlock it for today, complete any one of these:\n\n" : "To unlock it for today, complete:\n\n");
        for (String line : need.split("\n")) {
            if (!line.trim().isEmpty()) sb.append("\u2022 ").append(line.trim()).append('\n');
        }
        body.setText(sb.toString().trim());
    }

    private void openTracker() {
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        startActivity(intent);
        finishAndRemoveTask();
    }

    private void goHome() {
        Intent home = new Intent(Intent.ACTION_MAIN);
        home.addCategory(Intent.CATEGORY_HOME);
        home.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(home);
        finishAndRemoveTask();
    }

    private Button button(String text, boolean filled, View.OnClickListener onClick) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextSize(16);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setTextColor(filled ? 0xFF0F6B5C : Color.WHITE);
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(30));
        if (filled) bg.setColor(Color.WHITE); else bg.setStroke(dp(2), Color.WHITE);
        b.setBackground(bg);
        b.setOnClickListener(onClick);
        return b;
    }

    private LinearLayout.LayoutParams buttonParams() {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(54));
        p.topMargin = dp(12);
        return p;
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
    }
}
