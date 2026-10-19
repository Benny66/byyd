package com.bennywen.beiyun;

import android.content.Context;
import android.content.SharedPreferences;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/** 极简配置存储。日期口径与网页端一致：Asia/Shanghai。 */
final class Prefs {

    private static final String FILE = "beiyun";
    private static final String TZ = "Asia/Shanghai";

    private final SharedPreferences sp;

    Prefs(Context context) {
        this.sp = context.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    int hour() {
        return sp.getInt("hour", 21);
    }

    int minute() {
        return sp.getInt("minute", 30);
    }

    boolean enabled() {
        return sp.getBoolean("enabled", true);
    }

    /** 最近一次在网页端看到的训练归属日，用来判断「今天已经练过了」。 */
    String lastTrainingDay() {
        return sp.getString("last_day", "");
    }

    void setLastTrainingDay(String day) {
        sp.edit().putString("last_day", day).apply();
    }

    /** 通知权限只主动申请一次，被拒之后不再每次启动都弹。 */
    boolean askedNotifications() {
        return sp.getBoolean("asked_notifications", false);
    }

    void setAskedNotifications() {
        sp.edit().putBoolean("asked_notifications", true).apply();
    }

    void save(int hour, int minute, boolean enabled) {
        sp.edit()
                .putInt("hour", hour)
                .putInt("minute", minute)
                .putBoolean("enabled", enabled)
                .apply();
    }

    static String todayKey() {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone(TZ));
        return f.format(new Date());
    }
}
