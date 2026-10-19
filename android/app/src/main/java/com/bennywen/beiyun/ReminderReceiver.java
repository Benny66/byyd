package com.bennywen.beiyun;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

/** 到点检查「今天练没练」，没练才发通知。 */
public class ReminderReceiver extends android.content.BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        Prefs prefs = new Prefs(context);
        boolean trainedToday = Prefs.todayKey().equals(prefs.lastTrainingDay());
        if (prefs.enabled() && !trainedToday) {
            show(context);
        }
        // 无论是否提醒过，都排下一次
        ReminderScheduler.schedule(context);
    }

    private void show(Context context) {
        NotificationManager nm =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) {
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    "reminder",
                    context.getString(R.string.channel_name),
                    NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription(context.getString(R.string.channel_desc));
            nm.createNotificationChannel(channel);
        }

        Intent open = new Intent(context, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent content = PendingIntent.getActivity(
                context, 1, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(context, "reminder")
                : new Notification.Builder(context);
        builder.setSmallIcon(R.drawable.ic_notify)
                .setContentTitle(context.getString(R.string.notify_title))
                .setContentText(context.getString(R.string.notify_text))
                .setAutoCancel(true)
                .setContentIntent(content);

        nm.notify(1, builder.build());
    }
}
