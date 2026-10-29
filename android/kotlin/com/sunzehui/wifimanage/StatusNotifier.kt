package com.sunzehui.wifimanage

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.text.Spannable
import android.text.SpannableString
import android.text.style.ForegroundColorSpan
import android.util.Log
import android.webkit.JavascriptInterface
import org.json.JSONObject

/**
 * 通知栏常驻状态条。
 *
 * 显示文案全部由页面侧算好再递过来——速率换算、信号分档、电量文案在 core.js 里
 * 已有实现且受测，这里只做渲染，不再实现第二套换算。两侧唯一的耦合就是
 * [KEYS] 这五个键。
 */
object StatusNotifier {

    private const val TAG = "MifiNotify"
    private const val CHANNEL_ID = "status"
    private const val NOTIF_ID = 1

    /**
     * 载荷契约：title=网络状态, line1=实时速率, line2=设备/信号/电量,
     * ts=采样时刻(毫秒), bad=是否取不到数据。页面侧与本文件共同依赖这五个键。
     */
    fun show(ctx: Context, json: String) {
        val o = JSONObject(json)
        val nm = nm(ctx)
        ensureChannel(nm)
        nm.notify(NOTIF_ID, build(ctx, o))
        Log.i(TAG, "update: ${o.optString("title")} | ${o.optString("line1")} | ${o.optString("line2")}")
    }

    fun clear(ctx: Context) {
        nm(ctx).cancel(NOTIF_ID)
        Log.i(TAG, "cleared")
    }

    private fun build(ctx: Context, o: JSONObject): Notification {
        val b = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            Notification.Builder(ctx, CHANNEL_ID)
        else
            @Suppress("DEPRECATION")
            Notification.Builder(ctx).setPriority(Notification.PRIORITY_LOW)
        val title = o.optString("title", "随身WiFi")
        val line1 = o.optString("line1", "--")
        val bad = o.optBoolean("bad", false)
        if (bad) {
            // 降级正文是页面归好类的失败原因整句(被踢/登录锁定)，收起来会被截断，展开才读得全
            b.setStyle(Notification.BigTextStyle().setBigContentTitle(title).bigText(line1))
        }
        return b.setSmallIcon(R.drawable.ic_stat_mifi)
            .setContentTitle(if (bad) markBad(title) else title)
            .setContentText(line1)
            .setSubText(o.optString("line2"))
            .setWhen(o.optLong("ts", System.currentTimeMillis()))
            .setShowWhen(true)          // 「x 秒前」即快照新鲜度，划掉 App 后靠它判断
            .setOngoing(true)
            .setContentIntent(tapIntent(ctx))
            .setOnlyAlertOnce(true)
            .build()
    }

    /**
     * 降级标题染色。通知栏底色不由我们控制，所以不套用页面 CSS 那个浅红 --bad(#f87171)，
     * 取一个明暗背景都读得清的中间红。
     */
    private fun markBad(title: String): CharSequence {
        val s = SpannableString(title)
        s.setSpan(ForegroundColorSpan(Color.rgb(0xE5, 0x39, 0x35)), 0, s.length,
            Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
        return s
    }

    /** 点通知回到仪表盘：复用任务栈，不新开实例 */
    private fun tapIntent(ctx: Context): PendingIntent {
        val intent = Intent(ctx, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
            PendingIntent.FLAG_IMMUTABLE else 0
        return PendingIntent.getActivity(ctx, 0, intent, flags)
    }

    /**
     * 低重要性 + 无声 + 只提醒一次：这条通知每 5s 刷新一次，
     * 任何声音或横幅都会变成刷屏。
     */
    private fun ensureChannel(nm: NotificationManager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        val ch = NotificationChannel(CHANNEL_ID, "状态", NotificationManager.IMPORTANCE_LOW)
        ch.setShowBadge(false)
        nm.createNotificationChannel(ch)
    }

    private fun nm(ctx: Context) =
        ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
}

/**
 * 页面 → 原生 的窄桥：只允许写/撤这条状态通知，不暴露其它能力。
 * `@JavascriptInterface` 回调跑在 WebView 的工作线程上，必须切回主线程。
 */
class StatusBridge(private val activity: Activity) {

    @JavascriptInterface
    fun updateStatus(json: String) {
        if (json.isEmpty()) return
        activity.runOnUiThread { StatusNotifier.show(activity, json) }
    }

    @JavascriptInterface
    fun clearStatus() {
        activity.runOnUiThread { StatusNotifier.clear(activity) }
    }
}
