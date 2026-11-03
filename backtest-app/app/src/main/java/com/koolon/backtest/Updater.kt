package com.koolon.backtest

import android.app.Activity
import android.app.AlertDialog
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.widget.Toast
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** 앱 실행 시 GitHub 릴리스(latest)의 빌드 번호를 확인하고, 새 버전이면 받아서 설치 화면을 띄운다. */
object Updater {
    private const val API = "https://api.github.com/repos/mbt030809-debug/ma-backtest/releases/tags/latest"
    private val BUILD = Regex("build\\s*[= ]?\\s*(\\d+)")
    data class Info(val build: Long, val url: String)

    fun current(ctx: Context): Long {
        val pi = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        return if (Build.VERSION.SDK_INT >= 28) pi.longVersionCode else @Suppress("DEPRECATION") pi.versionCode.toLong()
    }

    private fun open(url: String, accept: String): HttpURLConnection {
        val c = URL(url).openConnection() as HttpURLConnection
        c.setRequestProperty("User-Agent", "ma-backtest-app"); c.setRequestProperty("Accept", accept)
        c.connectTimeout = 15000; c.readTimeout = 30000; c.instanceFollowRedirects = true
        return c
    }

    fun latest(): Info? = try {
        val c = open(API, "application/vnd.github+json")
        try {
            if (c.responseCode != 200) null else {
                val j = JSONObject(c.inputStream.bufferedReader().use { it.readText() })
                val m = BUILD.find(j.optString("name") + " " + j.optString("body"))
                val assets = j.optJSONArray("assets")
                var url: String? = null
                if (assets != null) for (i in 0 until assets.length()) {
                    val a = assets.getJSONObject(i)
                    if (a.optString("name").endsWith(".apk")) { url = a.optString("browser_download_url"); break }
                }
                if (m != null && url != null) Info(m.groupValues[1].toLong(), url) else null
            }
        } finally { c.disconnect() }
    } catch (e: Exception) { null }

    /** manual=true: 최신이거나 확인 실패여도 안내 메시지를 보여준다. */
    fun check(act: Activity, manual: Boolean) {
        Thread {
            val cur = try { current(act) } catch (e: Exception) { 0L }
            val info = latest()
            act.runOnUiThread {
                when {
                    info == null -> if (manual) Toast.makeText(act, "업데이트 확인 실패 (네트워크 확인)", Toast.LENGTH_LONG).show()
                    info.build > cur -> AlertDialog.Builder(act)
                        .setTitle("새 버전이 있습니다")
                        .setMessage("현재 build $cur → 최신 build ${info.build}\n지금 업데이트할까요? (설정·저장 데이터는 유지됩니다)")
                        .setPositiveButton("업데이트") { _, _ -> install(act, info) }
                        .setNegativeButton("나중에", null).show()
                    manual -> Toast.makeText(act, "최신 버전입니다 (build $cur)", Toast.LENGTH_SHORT).show()
                }
            }
        }.start()
    }

    private fun install(act: Activity, info: Info) {
        if (Build.VERSION.SDK_INT >= 26 && !act.packageManager.canRequestPackageInstalls()) {
            Toast.makeText(act, "‘이 출처 허용’을 켠 뒤 다시 업데이트를 눌러주세요", Toast.LENGTH_LONG).show()
            act.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${act.packageName}")))
            return
        }
        Toast.makeText(act, "업데이트 다운로드 중… (build ${info.build})", Toast.LENGTH_LONG).show()
        Thread {
            try {
                val pi = act.packageManager.packageInstaller
                val id = pi.createSession(PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL))
                pi.openSession(id).use { s ->
                    val c = open(info.url, "application/octet-stream")
                    try {
                        if (c.responseCode != 200) error("다운로드 응답 ${c.responseCode}")
                        s.openWrite("app.apk", 0, -1).use { out -> c.inputStream.use { it.copyTo(out) }; s.fsync(out) }
                    } finally { c.disconnect() }
                    val cb = PendingIntent.getBroadcast(act, id, Intent(act, InstallReceiver::class.java).setPackage(act.packageName),
                        PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
                    s.commit(cb.intentSender)
                }
            } catch (e: Exception) {
                act.runOnUiThread { Toast.makeText(act, "업데이트 실패: ${e.message}", Toast.LENGTH_LONG).show() }
            }
        }.start()
    }
}

class InstallReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -1)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val i = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                        else @Suppress("DEPRECATION") intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                if (i != null) { i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); ctx.startActivity(i) }
            }
            PackageInstaller.STATUS_SUCCESS -> {}
            else -> Toast.makeText(ctx, "설치 실패: ${intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: ""}", Toast.LENGTH_LONG).show()
        }
    }
}
