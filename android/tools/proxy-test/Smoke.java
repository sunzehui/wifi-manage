import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;

/**
 * 在普通 JVM 上启动 LocalProxy（跳过 Android 的 Log/UI 部分），
 * 用真实 HTTP 请求验证两条路由。修改 MainActivity.kt 后先跑这个，再上真机。
 *
 * 用法见同目录 run.sh。注意：设备路由依赖上游的响应分帧方式，
 * JDK 的 HttpURLConnection 与安卓实现不同（详见 MainActivity.kt 内注释），
 * 因此该段只报告结果，不作为失败判据。
 */
public class Smoke {

    static final int PORT = 18888;
    static int failures = 0;

    public static void main(String[] args) throws Exception {
        Class<?> c = Class.forName("com.sunzehui.wifimanage.LocalProxy");
        final Object inst = c.getField("INSTANCE").get(null);
        final Method handle = c.getDeclaredMethod("handle", Socket.class);
        handle.setAccessible(true);

        final ServerSocket server = new ServerSocket(PORT, 16, InetAddress.getByName("127.0.0.1"));
        Thread acceptor = new Thread(() -> {
            while (true) {
                try {
                    final Socket s = server.accept();
                    new Thread(() -> {
                        try {
                            handle.invoke(inst, s);
                        } catch (Throwable ignored) {
                        }
                    }).start();
                } catch (Exception e) {
                    break;
                }
            }
        });
        acceptor.setDaemon(true);
        acceptor.start();
        System.out.println("LocalProxy 已在 127.0.0.1:" + PORT + " 就绪\n");

        // ---- 1. 发卡平台：登录 ----
        String login = raw("GET /mgx/card/login.do?responseFunction=cb&iccidMark=" + card() + " HTTP/1.0\r\n"
                + "Host: 127.0.0.1\r\n\r\n");
        check("平台登录 code=0", body(login).contains("\"code\":\"0\""), body(login));
        check("代理未把 Set-Cookie 漏给浏览器", !head(login).toLowerCase().contains("set-cookie"), head(login));

        // ---- 2. 发卡平台：不带 cookie 查卡（会话应由代理补上）----
        String info = raw("GET /mgx/card/findCardInfo.do?iccidOrPhone=&responseFunction=cb"
                + "&skipGift=true&rfm=" + Math.random() + " HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n");
        boolean ok = body(info).contains("\"code\":\"0\"") && !body(info).contains("session过期");
        check("查卡成功（会话由代理续上）", ok, body(info));
        System.out.println("     " + clip(body(info), 110) + "\n");

        // ---- 3. 设备路由（结果仅供参考）----
        String dev = raw("GET /login.cgi HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n");
        String first = dev.isEmpty() ? "(空响应)" : dev.substring(0, Math.min(60, dev.indexOf("\r\n") < 0 ? dev.length() : dev.indexOf("\r\n")));
        if (head(dev).toLowerCase().contains("www-authenticate")) {
            System.out.println("[设备路由] 拿到 Digest 质询 ✓");
        } else if (dev.startsWith("HTTP/1.1 502")) {
            System.out.println("[设备路由] 上游不可用，代理回了 502（错误路径正常）: " + clip(body(dev), 80));
        } else {
            System.out.println("[设备路由] 未预期响应: " + first);
        }

        System.out.println("\n" + (failures == 0 ? "全部通过" : failures + " 项失败"));
        server.close();
        System.exit(failures == 0 ? 0 : 1);
    }

    static String card() {
        String v = System.getProperty("mgx.card");
        return v == null ? "SDY001046" : v;
    }

    static void check(String name, boolean ok, String detail) {
        System.out.println((ok ? "  ✓ " : "  ✗ ") + name);
        if (!ok) {
            failures++;
            if (detail != null) System.out.println("      " + clip(detail, 200));
        }
    }

    static String raw(String req) throws Exception {
        try (Socket s = new Socket("127.0.0.1", PORT)) {
            s.setSoTimeout(40000);
            OutputStream out = s.getOutputStream();
            out.write(req.getBytes("ISO-8859-1"));
            out.flush();
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            InputStream in = s.getInputStream();
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return new String(bos.toByteArray(), "UTF-8");
        }
    }

    static String head(String resp) {
        int i = resp.indexOf("\r\n\r\n");
        return i < 0 ? resp : resp.substring(0, i);
    }

    static String body(String resp) {
        int i = resp.indexOf("\r\n\r\n");
        return i < 0 ? "" : resp.substring(i + 4);
    }

    static String clip(String s, int n) {
        String t = s.replaceAll("\\s+", " ").trim();
        return t.length() <= n ? t : t.substring(0, n) + "…";
    }
}
