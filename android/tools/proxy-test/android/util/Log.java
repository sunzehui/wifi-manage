package android.util;

/**
 * 测试用替身。真机上 android.util.Log 由系统提供；
 * 在 JVM 上跑的 android.jar 里它只是个抛 "Stub!" 的桩，会把代理的错误路径打断。
 * 只要把这个类所在的目录放在 classpath 最前面，就会覆盖掉桩实现。
 */
public final class Log {
    public static int d(String tag, String msg) { return p("D", tag, msg); }
    public static int i(String tag, String msg) { return p("I", tag, msg); }
    public static int w(String tag, String msg) { return p("W", tag, msg); }
    public static int e(String tag, String msg) { return p("E", tag, msg); }

    private static int p(String level, String tag, String msg) {
        System.out.println("[" + level + "/" + tag + "] " + msg);
        return 0;
    }
}
