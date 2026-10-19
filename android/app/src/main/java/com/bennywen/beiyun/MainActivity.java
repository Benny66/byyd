package com.bennywen.beiyun;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.TimePickerDialog;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.CheckBox;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

/**
 * 套壳主界面：全屏 WebView 加载已部署的站点，外加一个每日提醒。
 * 站点地址来自 BuildConfig，第一次打开直接进页面。
 * 页面本身不改造，训练数据仍在网页的 localStorage 里；这里只读它来判断「今天练没练」。
 */
public class MainActivity extends Activity {

    private static final String ACTION_SETTINGS = "com.bennywen.beiyun.SETTINGS";
    private static final int REQ_NOTIFICATIONS = 1001;
    private static final long POLL_MS = 60_000L;
    private static final long PHASE_POLL_MS = 1_000L;

    /** 读取 localStorage 里最近一次训练的归属日，口径与网页端一致（Asia/Shanghai）。 */
    private static final String JS_LAST_DAY =
            "(function(){try{var raw=localStorage.getItem('beiyun30.checkin.v1');if(!raw)return '';"
                    + "var o=JSON.parse(raw);var d=(o&&o.data)||[];var last='';"
                    + "for(var i=0;i<d.length;i++){var k=d[i]&&d[i].day;if(k&&k>last)last=k;}"
                    + "return last;}catch(e){return '';}})()";

    /**
     * 判断训练是否进行中：倒计时数字在变说明在跑；完成屏出现说明结束了。
     * 暂停时数字不变，但我们保持横屏，避免练到一半被转回竖屏。
     */
    private static final String JS_TRAINING_STATE =
            "(function(){try{var cd=document.querySelector('.countdown');"
                    + "var fin=document.querySelector('.finish.show');"
                    + "return (cd?cd.textContent.trim():'')+'|'+(fin?'1':'0');}catch(e){return '|0';}})()";

    private WebView web;
    private ProgressBar progress;
    private View errorView;
    private Prefs prefs;

    /** 网页请求原生全屏时挂上来的视图，必须由宿主接管，否则 requestFullscreen 会被拒绝。 */
    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable poll = new Runnable() {
        @Override
        public void run() {
            readLastTrainingDay();
            handler.postDelayed(this, POLL_MS);
        }
    };

    /** 训练中强制横屏用的状态。 */
    private boolean trainingActive;
    private boolean landscapeNow;
    /** null 表示还没采到第一次样本，第一帧不能算「数字变化」。 */
    private String lastCountdown;

    private final Runnable phasePoll = new Runnable() {
        @Override
        public void run() {
            syncOrientation();
            handler.postDelayed(this, PHASE_POLL_MS);
        }
    };

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.activity_main);

        prefs = new Prefs(this);
        web = findViewById(R.id.web);
        progress = findViewById(R.id.progress);
        errorView = findViewById(R.id.error);
        findViewById(R.id.retry).setOnClickListener(v -> loadSite());

        getWindow().setFlags(
                WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);
        // 训练全程不熄屏，网页里的 Wake Lock 在 WebView 下不一定生效，这里兜底
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // 打卡记录存 localStorage，必须开
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        web.setVerticalScrollBarEnabled(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                readLastTrainingDay();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    errorView.setVisibility(View.VISIBLE);
                }
            }

            @Override
            @SuppressWarnings("deprecation")
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                errorView.setVisibility(View.VISIBLE);
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progress.setProgress(newProgress);
                progress.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
            }

            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                // 网页点「全屏」走的是 Fullscreen API，宿主不接这个回调就会被浏览器拒绝
                if (customView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                customView = view;
                customCallback = callback;
                FrameLayout root = findViewById(android.R.id.content);
                root.addView(view, new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT));
            }

            @Override
            public void onHideCustomView() {
                exitCustomView();
            }
        });

        loadSite();
        ReminderScheduler.schedule(this);

        if (ACTION_SETTINGS.equals(getIntent().getAction())) {
            web.post(() -> showSettings(false));
        } else if (!prefs.reminderSetup()) {
            // 第一次装完必须让用户看到提醒时间，否则默认 21:30 且无从修改
            web.post(() -> showSettings(true));
        } else {
            maybeAskNotifications();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (ACTION_SETTINGS.equals(intent.getAction())) {
            showSettings(false);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        handler.post(poll);
        handler.post(phasePoll);
    }

    @Override
    protected void onPause() {
        handler.removeCallbacks(poll);
        handler.removeCallbacks(phasePoll);
        super.onPause();
    }

    @Override
    public void onBackPressed() {
        if (customView != null) {
            exitCustomView();
            return;
        }
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            moveTaskToBack(true);
        }
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        exitCustomView();
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    /* ------------------------------------------------------------ 自动横屏 */

    private void syncOrientation() {
        if (web == null) {
            return;
        }
        web.evaluateJavascript(JS_TRAINING_STATE, value -> {
            String payload = unquote(value);
            int separator = payload.lastIndexOf('|');
            if (separator < 0) {
                return;
            }
            String countdown = payload.substring(0, separator);
            boolean finished = "1".equals(payload.substring(separator + 1));

            if (finished) {
                trainingActive = false;
            } else if (lastCountdown == null) {
                // 第一帧只记基线：首屏静止在「00:05」时不能误判成正在训练
                lastCountdown = countdown;
            } else if (!countdown.isEmpty() && !countdown.equals(lastCountdown)) {
                trainingActive = true;
            }
            lastCountdown = countdown;

            applyOrientation(trainingActive && prefs.autoLandscape());
        });
    }

    private void applyOrientation(boolean landscape) {
        if (landscape == landscapeNow) {
            return;
        }
        landscapeNow = landscape;
        // SENSOR_LANDSCAPE 左右两个方向都跟，手机横放哪边都行
        setRequestedOrientation(landscape
                ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
    }

    private void exitCustomView() {
        if (customView == null) {
            return;
        }
        FrameLayout root = findViewById(android.R.id.content);
        root.removeView(customView);
        customView = null;
        if (customCallback != null) {
            customCallback.onCustomViewHidden();
            customCallback = null;
        }
    }

    private void loadSite() {
        errorView.setVisibility(View.GONE);
        progress.setVisibility(View.VISIBLE);
        web.loadUrl(BuildConfig.DEFAULT_SITE_URL);
    }

    private void readLastTrainingDay() {
        if (web == null) {
            return;
        }
        web.evaluateJavascript(JS_LAST_DAY, value -> {
            String day = unquote(value);
            if (!day.isEmpty()) {
                prefs.setLastTrainingDay(day);
            }
        });
    }

    private static String unquote(String raw) {
        if (raw == null) {
            return "";
        }
        String value = raw.trim();
        if (value.length() >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
            value = value.substring(1, value.length() - 1);
        }
        return "null".equals(value) ? "" : value;
    }

    /* ------------------------------------------------------------ 提醒设置 */

    /**
     * @param firstRun true 表示首次安装后的引导，按钮换成「稍后再说」，关掉也算设置过
     */
    private void showSettings(boolean firstRun) {
        float density = getResources().getDisplayMetrics().density;
        int pad = (int) (20 * density);

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(pad, pad, pad, 0);

        final int[] time = {prefs.hour(), prefs.minute()};
        TextView timeLabel = new TextView(this);
        timeLabel.setText(getString(R.string.settings_time, time[0], time[1]));
        timeLabel.setPadding(0, 0, 0, pad);
        timeLabel.setOnClickListener(v -> new TimePickerDialog(
                this,
                (view, h, m) -> {
                    time[0] = h;
                    time[1] = m;
                    timeLabel.setText(getString(R.string.settings_time, h, m));
                },
                time[0], time[1], true).show());
        box.addView(timeLabel);

        CheckBox enabled = new CheckBox(this);
        enabled.setText(R.string.settings_enabled);
        enabled.setChecked(prefs.enabled());
        box.addView(enabled);

        CheckBox landscape = new CheckBox(this);
        landscape.setText(R.string.settings_landscape);
        landscape.setChecked(prefs.autoLandscape());
        box.addView(landscape);

        TextView note = new TextView(this);
        note.setPadding(0, pad, 0, 0);
        note.setText(getString(R.string.settings_note, BuildConfig.DEFAULT_SITE_URL));
        note.setTextSize(12);
        box.addView(note);

        new AlertDialog.Builder(this)
                .setTitle(R.string.settings_title)
                .setView(box)
                .setCancelable(!firstRun)
                .setPositiveButton(R.string.action_save, (d, w) -> {
                    prefs.save(time[0], time[1], enabled.isChecked());
                    prefs.setAutoLandscape(landscape.isChecked());
                    prefs.setReminderSetup();
                    ReminderScheduler.schedule(this);
                    // 改了开关立刻生效，不用等下一次训练
                    applyOrientation(trainingActive && prefs.autoLandscape());
                    ensureNotificationPermission();
                    guideExactAlarm();
                })
                .setNegativeButton(
                        firstRun ? R.string.action_later : R.string.action_cancel,
                        (d, w) -> {
                            if (!firstRun) {
                                return;
                            }
                            // 跳过也要落下默认值并标记已引导，避免每次启动都弹
                            prefs.setReminderSetup();
                            ReminderScheduler.schedule(this);
                            ensureNotificationPermission();
                        })
                .show();
    }

    private void maybeAskNotifications() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return;
        }
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        // 只在第一次问，被拒之后不再骚扰
        if (prefs.askedNotifications()) {
            return;
        }
        prefs.setAskedNotifications();
        requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFICATIONS);
    }

    private void ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return;
        }
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        prefs.setAskedNotifications();
        requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFICATIONS);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != REQ_NOTIFICATIONS) {
            return;
        }
        boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        if (granted) {
            return;
        }
        // 当场解释一次，否则用户会以为「设了提醒但不响」是 Bug
        new AlertDialog.Builder(this)
                .setTitle(R.string.notify_denied_title)
                .setMessage(R.string.notify_denied_message)
                .setPositiveButton(R.string.notify_denied_go, (d, w) -> {
                    // 通知设置页是 API 26 才有的，低版本退到应用详情页
                    Intent intent = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                            ? new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                                    .putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName())
                            : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                    Uri.parse("package:" + getPackageName()));
                    try {
                        startActivity(intent);
                    } catch (Exception ignored) {
                        // 个别 ROM 没有这个页面
                    }
                })
                .setNegativeButton(R.string.exact_alarm_later, null)
                .show();
    }

    private void guideExactAlarm() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            return;
        }
        android.app.AlarmManager am =
                (android.app.AlarmManager) getSystemService(ALARM_SERVICE);
        if (am == null || am.canScheduleExactAlarms()) {
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle(R.string.exact_alarm_title)
                .setMessage(R.string.exact_alarm_message)
                .setPositiveButton(R.string.exact_alarm_go, (d, w) -> {
                    try {
                        startActivity(new Intent(
                                Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                                Uri.parse("package:" + getPackageName())));
                    } catch (Exception ignored) {
                        // 个别 ROM 没有这个页面，忽略
                    }
                })
                .setNegativeButton(R.string.exact_alarm_later, null)
                .show();
    }
}
