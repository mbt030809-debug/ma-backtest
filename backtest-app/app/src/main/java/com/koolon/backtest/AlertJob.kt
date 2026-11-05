package com.koolon.backtest

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max

/** 미국장 마감 후 종가 기준으로 이평선 돌파/이탈 신호를 계산해 알림을 띄운다 (앱의 돌파/이탈 방식과 같은 규칙). */
object AlertJob {
    const val PREF = "alert"
    val ET: ZoneId = ZoneId.of("America/New_York")
    enum class R { DONE, RETRY, ERROR }

    fun cfg(ctx: Context): JSONObject? =
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).getString("cfg", null)?.let {
            try { JSONObject(it) } catch (e: Exception) { null }
        }

    private fun f2(v: Double) = String.format(Locale.US, "%.2f", v)
    private fun f1(v: Double) = String.format(Locale.US, "%.1f", v)

    private fun ma(px: DoubleArray, end: Int, n: Int): Double {
        var t = 0.0
        for (j in end - n + 1..end) t += px[j]
        return t / n
    }

    /** test=true: 날짜·시간 상관없이 지금 있는 마지막 종가로 계산하고 신호 없어도 알림. */
    fun run(ctx: Context, test: Boolean): R {
        val c = cfg(ctx) ?: return R.DONE
        if (!test && !c.optBoolean("on")) return R.DONE
        try {
            val sig = c.getString("sig"); val trd = c.getString("trd"); val alt = c.optString("alt", "")
            val delay = max(1, c.optInt("delay", 1)); val delayS = c.optInt("delaySell", 0).let { if (it > 0) it else delay }; val always = c.optBoolean("always", false) || test
            val rules = c.getJSONArray("rules")
            var maxN = 2
            for (i in 0 until rules.length()) maxN = max(maxN, rules.getJSONObject(i).getInt("n"))
            val today = LocalDate.now(ET)
            val (body, _) = Yahoo.prices(sig, today.minusDays((maxN * 1.6).toLong() + 30).toString(), today.toString())
            val arr = JSONArray(body); val n = arr.length()
            if (n < 3) return R.ERROR
            val dates = Array(n) { arr.getJSONArray(it).getString(0) }
            val px = DoubleArray(n) { arr.getJSONArray(it).getDouble(1) }
            val last = n - 1
            if (!test && dates[last] != today.toString()) return R.RETRY // 아직 오늘 종가 없음(휴장이거나 데이터 지연)
            var buy = false; var sell = false
            val lines = ArrayList<String>()
            for (i in 0 until rules.length()) {
                val r = rules.getJSONObject(i); val k = r.getInt("n"); val b = r.getInt("b"); val s = r.getInt("s")
                val rdB = r.optInt("db", 0).let { if (it > 0) it else delay }; val rdS = r.optInt("ds", 0).let { if (it > 0) it else delayS }
                if (k < 2 || last - 1 - k + 1 < 0) { lines.add("${k}일선: 데이터 부족"); continue }
                val m = ma(px, last, k); val pm = ma(px, last - 1, k)
                val up = px[last - 1] <= pm && px[last] > m
                val dn = px[last - 1] >= pm && px[last] < m
                val st = "종가 ${f2(px[last])} · ${k}일선 ${f2(m)} (${if (px[last] > m) "위 +" else "아래 -"}${f1(abs(px[last] / m - 1) * 100)}%)"
                when {
                    up && b > 0 -> { buy = true; lines.add("📈 ${k}일선 상향 돌파 → 매수 ${b}% (현금의 ${b}%) · ${rdB}거래일 뒤 체결\n   $st") }
                    up -> lines.add("${k}일선 상향 돌파 (매수 0%라 무시)\n   $st")
                    dn && s > 0 -> { sell = true; lines.add("📉 ${k}일선 하향 이탈 → 매도 ${s}% (보유의 ${s}%) · ${rdS}거래일 뒤 체결\n   $st") }
                    dn -> lines.add("${k}일선 하향 이탈 (매도 0%라 무시)\n   $st")
                    else -> lines.add("${k}일선 신호 없음\n   $st")
                }
            }
            if (!(buy || sell) && !always) return R.DONE
            val title = when {
                buy && sell -> "$trd 신호: 매수·매도 동시 발생"
                buy -> "📈 $trd 매수 신호"
                sell -> "📉 $trd 매도 신호"
                else -> "$trd 신호 없음"
            }
            val foot = StringBuilder("신호 종목 $sig · 기준일 ${dates[last]} 종가 · 체결은 위 표기한 거래일 뒤 종가(보유·현금 상태에 따라 적용)")
            if (sell && alt.isNotEmpty()) foot.append("\n매도 대금은 $alt 매수")
            if (test) foot.append("\n(테스트 알림 — 장중이면 현재가 기준)")
            postNote(ctx, title, lines.joinToString("\n") + "\n" + foot)
            return R.DONE
        } catch (e: Exception) {
            return R.ERROR
        }
    }

    fun notifyError(ctx: Context) = postNote(ctx, "신호 알림: 시세를 가져오지 못했습니다", "미국장 마감 후 시세 조회에 실패했습니다. 네트워크 상태를 확인하고 앱에서 직접 확인하세요.")

    private fun postNote(ctx: Context, title: String, text: String) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("signal", "매일 종가 신호", NotificationManager.IMPORTANCE_HIGH))
        val pi = PendingIntent.getActivity(ctx, 0, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val b = Notification_Builder(ctx)
        val n = b.setContentTitle(title).setContentText(text.lines().firstOrNull() ?: "")
            .setStyle(android.app.Notification.BigTextStyle().bigText(text))
            .setSmallIcon(android.R.drawable.ic_dialog_info).setContentIntent(pi).setAutoCancel(true).build()
        nm.notify((System.currentTimeMillis() / 1000).toInt(), n)
    }

    @Suppress("FunctionName")
    private fun Notification_Builder(ctx: Context): android.app.Notification.Builder =
        if (Build.VERSION.SDK_INT >= 26) android.app.Notification.Builder(ctx, "signal") else android.app.Notification.Builder(ctx)
}
