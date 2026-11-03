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
import org.json.JSONObject

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
            /** 매일 종가 신호 알림 설정(JSON). 켜져 있으면 다음 평일 미국장 마감 후로 예약. */
            @JavascriptInterface
            fun setAlert(json: String): String = try {
                val o = JSONObject(json)
                val p = getSharedPreferences(AlertJob.PREF, android.content.Context.MODE_PRIVATE)
                val same = p.getString("cfg", null) == json && p.getLong("next", 0) > System.currentTimeMillis()
                p.edit().putString("cfg", json).apply()
                if (o.optBoolean("on")) {
                    if (!same) AlertScheduler.schedule(this@MainActivity, AlertScheduler.nextTrigger(System.currentTimeMillis()))
                    val t = java.time.Instant.ofEpochMilli(p.getLong("next", 0)).atZone(AlertJob.ET)
                    "알림 켜짐 — 다음: 미국 동부 ${t.toLocalDate()} 16:20 (한국시간 ${t.withZoneSameInstant(java.time.ZoneId.of("Asia/Seoul")).toLocalDateTime().toString().replace('T', ' ')})"
                } else { AlertScheduler.cancel(this@MainActivity); "알림 꺼짐" }
            } catch (e: Exception) { "오류: ${e.message}" }

            @JavascriptInterface
            fun checkUpdate() { runOnUiThread { Updater.check(this@MainActivity, true) } }

            @JavascriptInterface
            fun appVersion(): String = try { "build ${Updater.current(this@MainActivity)}" } catch (e: Exception) { "" }

            @JavascriptInterface
            fun testAlert() { Thread { try { AlertJob.run(this@MainActivity, true) } catch (e: Exception) { } }.start() }
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
                        require(SYMBOL_OK.matches(sym)) { "종목 코드가 올바르지 않습니다" }
                        val (b, k) = Yahoo.prices(sym, u.getQueryParameter("start")!!, u.getQueryParameter("end")!!)
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
        Updater.check(this, false) // 실행할 때마다 새 버전 확인
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { if (web.canGoBack()) web.goBack() else super.onBackPressed() }

    private fun json(code: Int, body: String, kind: String = "") =
        WebResourceResponse("application/json", "utf-8", code, if (code == 200) "OK" else "Error",
            mapOf("Access-Control-Allow-Origin" to "*", "X-Price-Type" to kind), body.byteInputStream())

    companion object {
        const val HOST = "app.local"
        private val SYMBOL_OK = Regex("^[A-Z0-9.^=\\-]{1,15}$")
    }
}
