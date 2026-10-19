package com.bennywen.beiyun;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 重启或升级后闹钟会被系统清掉，需要重排。 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        // 只认这两个系统广播，避免别处发一个空 action 的意图就把闹钟重排一遍
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            ReminderScheduler.schedule(context);
        }
    }
}
