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

    /** 바닥 신호(이평 3 대체): MACD(12·26)/가격 < mTh 이고 VIX/100 − 21일 실현변동성(연환산) > gTh 인 마지막 날이면 true. 앱 화면(engine.bottomFlags)과 같은 계산. */
    private fun bottom(px: DoubleArray, vx: DoubleArray, mTh: Double, gTh: Double): Triple<Boolean, Double, Double> {
        val n = px.size; val last = n - 1
        if (n < 22) return Triple(false, Double.NaN, Double.NaN)
        fun ema(k: Int): Double { val al = 2.0 / (k + 1); var p = px[0]; for (i in 1 until n) p = px[i] * al + p * (1 - al); return p }
        val macd = (ema(12) - ema(26)) / px[last]
        val lr = DoubleArray(n) { if (it == 0) 0.0 else Math.log(px[it] / px[it - 1]) }
        var m = 0.0; for (j in last - 20..last) m += lr[j]; m /= 21
        var q = 0.0; for (j in last - 20..last) q += (lr[j] - m) * (lr[j] - m)
        val rv = Math.sqrt(q / 21) * Math.sqrt(252.0)
        val gap = vx[last] / 100 - rv
        return Triple(macd < mTh && gap > gTh, macd, gap)
    }

    /** test=true: 날짜·시간 상관없이 지금 있는 마지막 종가로 계산하고 신호 없어도 알림. */
    fun run(ctx: Context, test: Boolean): R {
        val c = cfg(ctx) ?: return R.DONE
        if (!test && !c.optBoolean("on")) return R.DONE
        try {
            val sig = c.getString("sig"); val trd = c.getString("trd"); val alt = c.optString("alt", "")
            val delay = max(1, c.optInt("delay", 1)); val always = c.optBoolean("always", false) || test
            val rules = c.getJSONArray("rules")
            var maxN = 2
            for (i in 0 until rules.length()) maxN = max(maxN, rules.getJSONObject(i).getInt("n"))
            val today = LocalDate.now(ET)
            val from = today.minusDays((maxN * 1.6).toLong() + 30).toString()
            val (body, _) = Yahoo.prices(sig, from, today.toString())
            val arr = JSONArray(body); val n = arr.length()
            if (n < 3) return R.ERROR
            val dates = Array(n) { arr.getJSONArray(it).getString(0) }
            val px = DoubleArray(n) { arr.getJSONArray(it).getDouble(1) }
            val last = n - 1
            if (!test && dates[last] != today.toString()) return R.RETRY // 아직 오늘 종가 없음(휴장이거나 데이터 지연)
            var act = false
            val lines = ArrayList<String>()
            for (i in 0 until rules.length()) {
                val r = rules.getJSONObject(i); val k = r.getInt("n")
                val rdU = r.optInt("du", 0).let { if (it > 0) it else delay }; val rdD = r.optInt("dd", 0).let { if (it > 0) it else delay }
                val fU = if (r.optString("fu", "c") == "o") "시가" else "종가"; val fD = if (r.optString("fd", "c") == "o") "시가" else "종가"
                if (r.optBoolean("bottom", false)) { // 바닥 신호: 목표 주식 비중(t%)으로 조정
                    val vb = JSONArray(Yahoo.prices("^VIX", from, today.toString()).first)
                    val vm = HashMap<String, Double>(); for (j in 0 until vb.length()) vm[vb.getJSONArray(j).getString(0)] = vb.getJSONArray(j).getDouble(1)
                    var lastV = Double.NaN; val vx = DoubleArray(n) { vm[dates[it]]?.also { v -> lastV = v } ?: lastV }
                    val mTh = r.optDouble("bm", -0.027); val gTh = r.optDouble("bg", 0.043); val t = r.optInt("t", 100)
                    val (hit, macd, gap) = bottom(px, vx, mTh, gTh)
                    val st = "MACD/가격 ${f2(macd * 100)}% (기준 ${f2(mTh * 100)}% 미만) · VIX−실현변동성 ${f2(gap * 100)}%p (기준 ${f2(gTh * 100)}%p 초과)"
                    if (hit) { act = true; lines.add("📈 바닥 신호 충족 → 주식 비중 ${t}%로 조정 · ${rdU}거래일 뒤 ${fU} 체결\n   $st") } else lines.add("바닥 신호 없음\n   $st")
                    continue
                }
                if (k < 2 || last - 1 - k + 1 < 0) { lines.add("${k}일선: 데이터 부족"); continue }
                val m = ma(px, last, k); val pm = ma(px, last - 1, k)
                val up = px[last - 1] <= pm && px[last] > m
                val dn = px[last - 1] >= pm && px[last] < m
                val upT = r.optInt("up", -1); val dnT = r.optInt("dn", -1) // 돌파 때 목표 주식 비중(%), -1 이면 무시
                val st = "종가 ${f2(px[last])} · ${k}일선 ${f2(m)} (${if (px[last] > m) "위 +" else "아래 -"}${f1(abs(px[last] / m - 1) * 100)}%)"
                when {
                    up && upT >= 0 -> { act = true; lines.add("📈 ${k}일선 상향 돌파 → 주식 비중 ${upT}%로 조정 · ${rdU}거래일 뒤 ${fU} 체결\n   $st") }
                    up -> lines.add("${k}일선 상향 돌파 (목표 비율 칸이 비어 무시)\n   $st")
                    dn && dnT >= 0 -> { act = true; lines.add("📉 ${k}일선 하향 돌파 → 주식 비중 ${dnT}%로 조정 · ${rdD}거래일 뒤 ${fD} 체결\n   $st") }
                    dn -> lines.add("${k}일선 하향 돌파 (목표 비율 칸이 비어 무시)\n   $st")
                    else -> lines.add("${k}일선 신호 없음\n   $st")
                }
            }
            if (!act && !always) return R.DONE
            val title = if (act) "🔔 $trd 주식 비중 조정 신호" else "$trd 신호 없음"
            val foot = StringBuilder("신호 종목 $sig · 기준일 ${dates[last]} 종가 · 체결은 위 표기한 거래일 뒤 가격(종가 또는 시가), 총자산 대비 주식 비중을 목표 %로 맞춤(적으면 매수·많으면 매도). 지연 중 새 신호가 나오면 마지막 신호만 따름")
            if (act && alt.isNotEmpty()) foot.append("\n줄어든 주식 비중은 $alt 로 보유")
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
            .setSmallIcon(com.koolon.backtest.R.drawable.ic_stat_signal).setContentIntent(pi).setAutoCancel(true).build()
        nm.notify((System.currentTimeMillis() / 1000).toInt(), n)
    }

    @Suppress("FunctionName")
    private fun Notification_Builder(ctx: Context): android.app.Notification.Builder =
        if (Build.VERSION.SDK_INT >= 26) android.app.Notification.Builder(ctx, "signal") else android.app.Notification.Builder(ctx)
}
