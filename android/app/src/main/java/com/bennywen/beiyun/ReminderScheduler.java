package com.bennywen.beiyun;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import java.util.Calendar;
import java.util.TimeZone;

/**
 * 每天固定时刻的一次性闹钟，响过之后再排下一次。
 * 不用 setRepeating：Android 的重复闹钟不精确，省电策略下会被推迟到几小时后。
 */
final class ReminderScheduler {

    static final String ACTION_REMIND = "com.bennywen.beiyun.REMIND";

    private ReminderScheduler() {
    }

    static void schedule(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) {
            return;
        }
        PendingIntent pending = pending(context);
        am.cancel(pending);

        Prefs prefs = new Prefs(context);
        if (!prefs.enabled()) {
            return;
        }

        long at = nextTrigger(prefs.hour(), prefs.minute());
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) {
                // 没有精确闹钟权限时退化成不精确，至少不会完全不响
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
            } else {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
            }
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
        }
    }

    static PendingIntent pending(Context context) {
        Intent intent = new Intent(context, ReminderReceiver.class).setAction(ACTION_REMIND);
        return PendingIntent.getBroadcast(
                context, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** 下一个「今天或明天的 hh:mm」。 */
    static long nextTrigger(int hour, int minute) {
        Calendar cal = Calendar.getInstance(TimeZone.getTimeZone("Asia/Shanghai"));
        cal.set(Calendar.HOUR_OF_DAY, hour);
        cal.set(Calendar.MINUTE, minute);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        if (cal.getTimeInMillis() <= System.currentTimeMillis()) {
            cal.add(Calendar.DAY_OF_YEAR, 1);
        }
        return cal.getTimeInMillis();
    }
}
