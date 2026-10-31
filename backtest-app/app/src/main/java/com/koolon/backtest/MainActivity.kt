package com.koolon.backtest

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.webkit.JavascriptInterface
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/** WebView에 index.html을 띄우고, /api/prices 요청을 가로채 Yahoo Finance에서 직접 가져온다. */
class MainActivity : Activity() {
    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true // localStorage: 설정 유지
        // 스윕 중 백그라운드 유지: JS에서 AndroidApp.keepAlive(true/false)
        web.addJavascriptInterface(object {
            @JavascriptInterface
            fun keepAlive(on: Boolean) {
                val i = Intent(this@MainActivity, KeepAliveService::class.java)
                try { if (on) startForegroundService(i) else stopService(i) } catch (e: Exception) { }
            }
        }, "AndroidApp")
        if (android.os.Build.VERSION.SDK_INT >= 33)
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1)
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(v: WebView, r: WebResourceRequest): WebResourceResponse? {
                val u = r.url
                if (u.host != HOST) return null
                if (u.path == "/api/prices") {
                    val sym = u.getQueryParameter("symbol")?.trim()?.uppercase() ?: ""
                    val (code, body, kind) = try {
                        require(sym.isNotEmpty()) { "종목이 비었습니다" }
                        val (b, k) = prices(sym, u.getQueryParameter("start")!!, u.getQueryParameter("end")!!)
                        Triple(200, b, k)
                    } catch (e: Exception) {
                        Triple(502, JSONObject().put("error", "$sym: ${e.message}").toString(), "")
                    }
                    return json(code, body, kind)
                }
                if (u.path == "/favicon.ico") return json(404, "")
                val name = if (u.path == "/" || u.path.isNullOrEmpty()) "index_20261030.html" else u.path!!.trimStart('/')
                return try {
                    val mime = if (name.endsWith(".js")) "application/javascript" else if (name.endsWith(".json")) "application/json" else "text/html"
                    WebResourceResponse(mime, "utf-8", assets.open(name))
                } catch (e: Exception) { json(404, "") }
            }
        }
        setContentView(web)
        web.loadUrl("https://$HOST/")
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { if (web.canGoBack()) web.goBack() else super.onBackPressed() }

    private fun json(code: Int, body: String, kind: String = "") =
        WebResourceResponse("application/json", "utf-8", code, if (code == 200) "OK" else "Error",
            mapOf("Access-Control-Allow-Origin" to "*", "X-Price-Type" to kind), body.byteInputStream())

    /** 반환: (JSON 시세, 종류) — 종류 adj=배당 재투자 반영 수정종가(총수익), close=가격만 */
    private fun prices(symbol: String, start: String, end: String): Pair<String, String> {
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

    companion object { const val HOST = "app.local" }
}
