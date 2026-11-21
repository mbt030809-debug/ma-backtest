package com.ndx.forecast;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class MainActivity extends Activity {
    private WebView web;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0f1217"));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        web.setWebViewClient(new WebViewClient());
        web.addJavascriptInterface(new Bridge(), "Android");
        setContentView(web);
        web.loadUrl("file:///android_asset/index.html");
    }

    @Override public void onBackPressed() { finish(); }

    /** JS -> 네이티브 HTTP (CORS 우회). 허용 호스트만 접근. */
    private class Bridge {
        @JavascriptInterface public void fetchAsync(final String url, final int id) {
            new Thread(() -> {
                boolean ok = false; String out;
                try {
                    URL u = new URL(url);
                    if (!"https".equals(u.getProtocol()) || !"query1.finance.yahoo.com".equals(u.getHost()))
                        throw new Exception("blocked host");
                    HttpURLConnection c = (HttpURLConnection) u.openConnection();
                    c.setConnectTimeout(15000); c.setReadTimeout(20000);
                    c.setRequestProperty("User-Agent", "NdxForecast/1.0");
                    int code = c.getResponseCode();
                    if (code != 200) throw new Exception("HTTP " + code);
                    InputStream in = c.getInputStream();
                    ByteArrayOutputStream bo = new ByteArrayOutputStream();
                    byte[] buf = new byte[8192]; int r;
                    while ((r = in.read(buf)) > 0) bo.write(buf, 0, r);
                    out = bo.toString("UTF-8"); ok = true;
                } catch (Exception e) { out = String.valueOf(e.getMessage()); }
                final String js = "window.__nativeCb(" + id + "," + ok + "," + JSONObject.quote(out) + ")";
                web.post(() -> web.evaluateJavascript(js, null));
            }).start();
        }
    }
}
