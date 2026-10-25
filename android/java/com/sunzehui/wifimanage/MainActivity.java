package com.sunzehui.wifimanage;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.util.Log;
import android.view.KeyEvent;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {

    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                 // localStorage: 保存连接设置
        s.setAllowFileAccess(true);
        // file:// 页面跨源访问本地代理与设备 (网关在页面内实现)
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d("WebViewConsole", m.lineNumber() + ": " + m.message() + " [" + m.sourceId() + "]");
                return true;
            }
        });
        // 允许 chrome://inspect / adb forward 远程调试
        WebView.setWebContentsDebuggingEnabled(true);

        LocalProxy.start();
        webView.loadUrl("file:///android_asset/www/index.html");
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView != null && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    /**
     * 本地 HTTP 代理 (127.0.0.1:8787)。
     * 设备的 httpd 见到 Accept-Encoding: gzip 会话即被 KICKOFF, 而 WebView 的
     * fetch 强制携带且不可覆盖; 因此由本代理用 HttpURLConnection 转发(不携带该头)。
     * 路由: /mgx/... -> 发卡平台; 其余 -> 设备(192.168.1.1)。
     */
    public static final class LocalProxy {

        private static final int PORT = 8787;
        private static final String DEV = "http://192.168.1.1";
        private static final String MGX = "http://xmgxx.maigaoxun.com/kyhl-weixin-1.0";

        public static void start() {
            new Thread(() -> {
                try {
                    ServerSocket server = new ServerSocket(PORT, 8, InetAddress.getByName("127.0.0.1"));
                    Log.i("LocalProxy", "listening on 127.0.0.1:" + PORT);
                    while (!Thread.currentThread().isInterrupted()) {
                        Socket client = server.accept();
                        new Thread(() -> handle(client)).start();
                    }
                } catch (Exception e) {
                    Log.e("LocalProxy", "stopped: " + e.getMessage());
                }
            }, "local-proxy").start();
        }

        private static void handle(Socket client) {
            try {
                client.setSoTimeout(20000);
                InputStream in = client.getInputStream();
                OutputStream out = client.getOutputStream();

                String requestLine = readLine(in);
                if (requestLine == null) { client.close(); return; }
                String[] parts = requestLine.split(" ");
                if (parts.length < 2) { client.close(); return; }
                String method = parts[0];
                String path = parts[1];

                int contentLength = 0;
                Map<String, String> headers = new HashMap<>();
                String line;
                while ((line = readLine(in)) != null && !line.isEmpty()) {
                    int c = line.indexOf(':');
                    if (c > 0) {
                        String k = line.substring(0, c).trim().toLowerCase();
                        String v = line.substring(c + 1).trim();
                        headers.put(k, v);
                        if (k.equals("content-length")) contentLength = Integer.parseInt(v);
                    }
                }
                byte[] body = new byte[contentLength];
                int read = 0;
                while (read < contentLength) {
                    int n = in.read(body, read, contentLength - read);
                    if (n < 0) break;
                    read += n;
                }

                String target = path.startsWith("/mgx/") ? MGX + path.substring(4) : DEV + path;

                HttpURLConnection conn = (HttpURLConnection) new URL(target).openConnection();
                conn.setRequestMethod(method);
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(20000);
                // 只透传必要头; 绝不带 Accept-Encoding (设备会 KICKOFF)
                String auth = headers.get("authorization");
                if (auth != null) conn.setRequestProperty("Authorization", auth);
                String cookie = headers.get("cookie");
                if (cookie != null) conn.setRequestProperty("Cookie", cookie);
                String ctype = headers.get("content-type");
                if (ctype != null) conn.setRequestProperty("Content-Type", ctype);
                if (method.equals("POST") && body.length > 0) {
                    conn.setDoOutput(true);
                    conn.getOutputStream().write(body);
                }

                int status = conn.getResponseCode();
                InputStream ris = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                byte[] resp = ris == null ? new byte[0] : readAll(ris);
                String mime = conn.getContentType();
                if (mime == null) mime = "text/plain";

                StringBuilder head = new StringBuilder();
                head.append("HTTP/1.1 ").append(status).append(" OK\r\n");
                head.append("Content-Type: ").append(mime).append("\r\n");
                String wwwAuth = conn.getHeaderField("WWW-Authenticate");
                if (wwwAuth != null) head.append("WWW-Authenticate: ").append(wwwAuth).append("\r\n");
                java.util.List<String> setCookies = conn.getHeaderFields().get("Set-Cookie");
                if (setCookies != null) for (String c : setCookies) head.append("Set-Cookie: ").append(c).append("\r\n");
                head.append("Content-Length: ").append(resp.length).append("\r\n");
                head.append("Access-Control-Allow-Origin: *\r\n");
                head.append("Access-Control-Allow-Headers: Authorization, Content-Type, Cookie\r\n");
                head.append("Connection: close\r\n\r\n");
                out.write(head.toString().getBytes("ISO-8859-1"));
                out.write(resp);
                out.flush();
                client.close();
            } catch (Exception ignored) {
                try { client.close(); } catch (Exception ignored2) { }
            }
        }

        private static String readLine(InputStream in) throws Exception {
            StringBuilder sb = new StringBuilder();
            int c;
            while ((c = in.read()) != -1) {
                if (c == '\n') break;
                if (c != '\r') sb.append((char) c);
            }
            return sb.length() == 0 && c == -1 ? null : sb.toString();
        }

        private static byte[] readAll(InputStream in) throws Exception {
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return bos.toByteArray();
        }
    }
}
