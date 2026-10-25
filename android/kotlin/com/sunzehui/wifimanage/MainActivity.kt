package com.sunzehui.wifimanage

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.util.Log
import android.view.KeyEvent
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URL
import kotlin.concurrent.thread

/**
 * 单 Activity：全屏 WebView 加载 assets 里的仪表盘页面，
 * 同时起一个本地 HTTP 代理（见 [LocalProxy]）解决设备与发卡平台的跨域/请求头问题。
 */
class MainActivity : Activity() {

    private var webView: WebView? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val wv = WebView(this)
        webView = wv
        setContentView(wv)

        with(wv.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true            // localStorage: 保存连接设置
            allowFileAccess = true
            // file:// 页面跨源访问本地代理与设备（网关在页面内实现）
            // 这两个开关自 API 30 起被标记弃用，但 targetSdk 28 上仍是 file:// 跨源的唯一开关，
            // 编译期的 DEPRECATION 警告没有意义，直接压掉。
            @Suppress("DEPRECATION")
            run {
                allowFileAccessFromFileURLs = true
                allowUniversalAccessFromFileURLs = true
            }
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        }

        wv.webViewClient = WebViewClient()
        wv.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                Log.d("WebViewConsole", "${m.lineNumber()}: ${m.message()} [${m.sourceId()}]")
                return true
            }
        }
        // 允许 chrome://inspect / adb forward 远程调试
        WebView.setWebContentsDebuggingEnabled(true)

        LocalProxy.start()
        wv.loadUrl("file:///android_asset/www/index.html")
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        val wv = webView
        if (keyCode == KeyEvent.KEYCODE_BACK && wv != null && wv.canGoBack()) {
            wv.goBack()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onDestroy() {
        webView?.destroy()
        webView = null
        super.onDestroy()
    }
}

/**
 * 本地 HTTP 代理（127.0.0.1:8787）。
 *
 * 设备的 httpd 见到 `Accept-Encoding: gzip` 会话即被 KICKOFF，而 WebView 的 fetch
 * 强制携带且不可覆盖；因此由本代理用 HttpURLConnection 转发（不带该头）。
 * 路由：`/mgx/...` → 发卡平台；其余 → 设备 192.168.1.1。
 */
object LocalProxy {

    private const val PORT = 8787
    private const val DEV = "http://192.168.1.1"
    private const val MGX = "http://xmgxx.maigaoxun.com/kyhl-weixin-1.0"

    /**
     * 发卡平台的会话（JSESSIONID）由代理自己保管。
     *
     * WebView 里 fetch 读不到 `Set-Cookie`（浏览器禁止读取该响应头），也发不出手工设置的
     * `Cookie`（禁止的请求头）；而平台下发的 `Path=/kyhl-weixin-1.0` 与代理路径 `/mgx/...`
     * 不匹配，浏览器永远不会回传。于是第二个请求必定「session过期」。
     * 因此登录拿到的会话存在这里，后续请求由代理补上。
     */
    @Volatile
    private var mgxSession: String? = null

    fun start() {
        thread(name = "local-proxy") {
            try {
                ServerSocket(PORT, 8, InetAddress.getByName("127.0.0.1")).use { server ->
                    Log.i("LocalProxy", "listening on 127.0.0.1:$PORT")
                    while (!Thread.currentThread().isInterrupted) {
                        val client = server.accept()
                        thread(name = "proxy-conn") { handle(client) }
                    }
                }
            } catch (e: Exception) {
                Log.e("LocalProxy", "stopped: ${e.message}")
            }
        }
    }

    private fun handle(client: Socket) {
        try {
            client.use { socket ->
                socket.soTimeout = 20_000
                val input = socket.getInputStream()
                val output = socket.getOutputStream()

                val requestLine = readHttpLine(input) ?: return
                val parts = requestLine.split(" ")
                if (parts.size < 2) return
                val method = parts[0]
                val path = parts[1]

                var contentLength = 0
                val headers = HashMap<String, String>()
                while (true) {
                    val line = readHttpLine(input) ?: break
                    if (line.isEmpty()) break
                    val colon = line.indexOf(':')
                    if (colon > 0) {
                        val key = line.substring(0, colon).trim().lowercase()
                        val value = line.substring(colon + 1).trim()
                        headers[key] = value
                        if (key == "content-length") contentLength = value.toIntOrNull() ?: 0
                    }
                }
                val body = ByteArray(contentLength)
                var read = 0
                while (read < contentLength) {
                    val n = input.read(body, read, contentLength - read)
                    if (n < 0) break
                    read += n
                }

                val isMgx = path.startsWith("/mgx/")
                val target = if (isMgx) MGX + path.substring(4) else DEV + path

                val conn = URL(target).openConnection() as HttpURLConnection
                conn.requestMethod = method
                conn.connectTimeout = 8_000
                conn.readTimeout = 20_000
                // 只透传必要头；绝不带 Accept-Encoding（设备会 KICKOFF）
                headers["authorization"]?.let { conn.setRequestProperty("Authorization", it) }
                val cookie = headers["cookie"]?.takeIf { it.isNotBlank() }
                    ?: (if (isMgx) mgxSession else null)
                if (!cookie.isNullOrBlank()) conn.setRequestProperty("Cookie", cookie)
                headers["content-type"]?.let { conn.setRequestProperty("Content-Type", it) }
                if (method == "POST" && body.isNotEmpty()) {
                    conn.doOutput = true
                    conn.outputStream.use { it.write(body) }
                }

                val status = conn.responseCode
                val stream = if (status >= 400) conn.errorStream else conn.inputStream
                val resp = stream?.let { readAll(it) } ?: ByteArray(0)
                val mime = conn.contentType ?: "text/plain"

                val setCookies = conn.headerFields.entries
                    .firstOrNull { it.key?.equals("Set-Cookie", ignoreCase = true) == true }
                    ?.value

                val head = buildString {
                    append("HTTP/1.1 ").append(status).append(" OK\r\n")
                    append("Content-Type: ").append(mime).append("\r\n")
                    conn.getHeaderField("WWW-Authenticate")?.let {
                        append("WWW-Authenticate: ").append(it).append("\r\n")
                    }
                    if (isMgx) {
                        // 发卡平台：会话留在代理内部，不转发给浏览器
                        setCookies?.firstNotNullOfOrNull { firstCookiePair(it) }?.let { mgxSession = it }
                    } else {
                        setCookies?.forEach { append("Set-Cookie: ").append(it).append("\r\n") }
                    }
                    append("Content-Length: ").append(resp.size).append("\r\n")
                    append("Access-Control-Allow-Origin: *\r\n")
                    append("Access-Control-Allow-Headers: Authorization, Content-Type, Cookie\r\n")
                    append("Connection: close\r\n\r\n")
                }
                output.write(head.toByteArray(Charsets.ISO_8859_1))
                output.write(resp)
                output.flush()
            }
        } catch (_: Exception) {
            runCatching { client.close() }
        }
    }

    /** 取 Set-Cookie 里的第一段 name=value，去掉 Path/HttpOnly 等属性 */
    private fun firstCookiePair(setCookie: String?): String? {
        val first = setCookie?.substringBefore(';')?.trim() ?: return null
        val eq = first.indexOf('=')
        return if (eq <= 0 || eq == first.lastIndex) null else first
    }

    /** 按 CRLF 读一行；连接已关闭且无内容时返回 null */
    private fun readHttpLine(input: InputStream): String? {
        val sb = StringBuilder()
        var c: Int
        while (true) {
            c = input.read()
            if (c == -1 || c == '\n'.code) break
            if (c != '\r'.code) sb.append(c.toChar())
        }
        return if (sb.isEmpty() && c == -1) null else sb.toString()
    }

    private fun readAll(input: InputStream): ByteArray {
        val bos = ByteArrayOutputStream()
        val buf = ByteArray(8192)
        while (true) {
            val n = input.read(buf)
            if (n <= 0) break
            bos.write(buf, 0, n)
        }
        return bos.toByteArray()
    }
}
