package com.koolon.backtest

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/** Yahoo Finance 일봉 시세 (앱 화면과 매일 알림이 같이 사용). */
object Yahoo {
    /** 반환: (JSON 시세, 종류) — 종류 adj=배당 재투자 반영 수정종가(총수익), close=가격만 */
    fun prices(symbol: String, start: String, end: String): Pair<String, String> {
        val p1 = LocalDate.parse(start).atStartOfDay().toEpochSecond(ZoneOffset.UTC)
        val p2 = LocalDate.parse(end).plusDays(1).atStartOfDay().toEpochSecond(ZoneOffset.UTC)
        val url = "https://query1.finance.yahoo.com/v8/finance/chart/${URLEncoder.encode(symbol, "utf-8")}" +
            "?period1=$p1&period2=$p2&interval=1d&events=div%2Csplits"
        val c = URL(url).openConnection() as HttpURLConnection
        c.setRequestProperty("User-Agent", "Mozilla/5.0")
        c.connectTimeout = 20000; c.readTimeout = 20000
        val chart = try {
            if (c.responseCode != 200) error("Yahoo 응답 ${c.responseCode}")
            JSONObject(c.inputStream.bufferedReader().use { it.readText() }).getJSONObject("chart")
        } finally { c.disconnect() }
        val result = chart.optJSONArray("result")
        if (result == null || result.length() == 0)
            error(chart.optJSONObject("error")?.optString("description") ?: "데이터 없음")
        val res = result.getJSONObject(0)
        val ts = res.optJSONArray("timestamp") ?: error("해당 기간 데이터 없음")
        val ind = res.getJSONObject("indicators")
        val adjArr = ind.optJSONArray("adjclose")?.getJSONObject(0)?.getJSONArray("adjclose")
        val adj = adjArr ?: ind.getJSONArray("quote").getJSONObject(0).getJSONArray("close")
        val kind = if (adjArr != null) "adj" else "close"
        val out = JSONArray()
        for (i in 0 until ts.length()) {
            if (adj.isNull(i)) continue
            val d = Instant.ofEpochSecond(ts.getLong(i)).atOffset(ZoneOffset.UTC).toLocalDate().toString()
            out.put(JSONArray().put(d).put(adj.getDouble(i)))
        }
        return out.toString() to kind
    }
}
