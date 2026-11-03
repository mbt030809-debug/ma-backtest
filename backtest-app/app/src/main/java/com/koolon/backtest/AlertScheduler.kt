package com.koolon.backtest

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import java.time.DayOfWeek
import java.time.Instant
import java.time.ZonedDateTime

/** 평일 미국 동부시간 16:20(마감 20분 후)에 알림 작업을 깨운다. 휴장일은 오늘 종가가 없어 자동으로 건너뜀. */
object AlertScheduler {
    fun nextTrigger(afterMs: Long): Long {
        var t = ZonedDateTime.ofInstant(Instant.ofEpochMilli(afterMs), AlertJob.ET).withHour(16).withMinute(20).withSecond(0).withNano(0)
        if (t.toInstant().toEpochMilli() <= afterMs + 60_000) t = t.plusDays(1)
        while (t.dayOfWeek == DayOfWeek.SATURDAY || t.dayOfWeek == DayOfWeek.SUNDAY) t = t.plusDays(1)
        return t.toInstant().toEpochMilli()
    }

    private fun pi(ctx: Context) = PendingIntent.getBroadcast(
        ctx, 77, Intent(ctx, AlertReceiver::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    fun schedule(ctx: Context, atMs: Long) {
        val am = ctx.getSystemService(AlarmManager::class.java)
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMs, pi(ctx)) // 정확한 알람 권한 없이 수 분 오차 허용
        ctx.getSharedPreferences(AlertJob.PREF, Context.MODE_PRIVATE).edit().putLong("next", atMs).apply()
    }

    fun cancel(ctx: Context) {
        ctx.getSystemService(AlarmManager::class.java).cancel(pi(ctx))
        ctx.getSharedPreferences(AlertJob.PREF, Context.MODE_PRIVATE).edit().putLong("next", 0).putInt("attempt", 0).apply()
    }
}

class AlertReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val pr = goAsync()
        Thread {
            try {
                val p = ctx.getSharedPreferences(AlertJob.PREF, Context.MODE_PRIVATE)
                val attempt = p.getInt("attempt", 0)
                val r = AlertJob.run(ctx, false)
                val now = System.currentTimeMillis()
                if (r != AlertJob.R.DONE && attempt < 3) { // 데이터 지연·일시 오류: 20분 뒤 다시 (최대 3번)
                    p.edit().putInt("attempt", attempt + 1).apply()
                    AlertScheduler.schedule(ctx, now + 20 * 60_000)
                } else {
                    if (r == AlertJob.R.ERROR) AlertJob.notifyError(ctx)
                    p.edit().putInt("attempt", 0).apply()
                    if (AlertJob.cfg(ctx)?.optBoolean("on") == true) AlertScheduler.schedule(ctx, AlertScheduler.nextTrigger(now))
                }
            } finally { pr.finish() }
        }.start()
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (AlertJob.cfg(ctx)?.optBoolean("on") == true) AlertScheduler.schedule(ctx, AlertScheduler.nextTrigger(System.currentTimeMillis()))
    }
}
