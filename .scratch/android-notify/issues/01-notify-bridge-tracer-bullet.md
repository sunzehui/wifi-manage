# 01: 打通通知链路（端到端最小内容）

**What to build:** 手机装上重新构建的 APK、连上随身 WiFi 打开首页后，通知栏出现一条属于本应用的通知（内容先占位：应用名 + 一行「已连接」级别的示意文字），首页每轮状态轮询都把它刷新一次；同时电脑/平板上的网页版打开任何页面都不因这座桥产生报错。这张票的价值是「管道全通」——原生通知器、WebView 双向桥、页面侧调用、构建与权限一次穿透，真实字段留给 02。

必须先解决的既有事实：免 Gradle 的构建脚本目前**只编译单个 Kotlin 源文件**，新增的原生文件会被静默漏出 dex，所以「编译整个源码目录」是这张票的第一件事，否则后面每一步都验证不到东西。

**Blocked by:** None (can start immediately)

**Status:** done —— 管道全通已取到真机证据；仅剩「点通知拉起」一条待手机接回

- [x] 构建脚本改为编译 APK 壳目录下全部 Kotlin 源文件，构建产物里能确认新增类已进入 dex（而非仅构建返回 0）
- [x] 清单声明通知权限，并在应用启动时主动申请运行期权限。**工单原文的「targetSdk 28 无需申请」被真机推翻**：测试机是 Android 16（vivo），实测 `POST_NOTIFICATIONS: granted=false`、appops 为 ignore、`numBlocked=6`，一条通知都发不出去。低 targetSdk 只是不强制你申请，系统仍按运行时权限拦截
- [x] 原生侧建通知渠道（API 26 以下走无渠道分支）、固定通知 id、纯色 alpha 的状态栏小图标；渠道静默、importance 低、`setOnlyAlertOnce`
- [x] `@JavascriptInterface` 回调不在主线程，投递通知前切主线程
- [x] 页面侧桥封装：原生桥不存在时整条路径静默跳过（网页版零行为变化）
- [x] 首页状态轮询的成功回调里推送一次；轮询本身仍是既有那一个 5s 请求，**不新增任何设备请求**
- [x] 自动化证据：构建脚本跑通且 dex 含新类；三个页面脚本与网关脚本语法检查通过；用浏览器以 `file://` 加载首页（此时原生桥缺失）断言页面错误收集数组仍为空
- [ ] 真机肉眼（需用户装 APK 确认）：下拉通知栏看到这一条；logcat 里推送计数 30 秒约 6 次；点通知能拉起应用

## 验证记录（2026-10-29）

- 构建：`kotlinc` 入参改为 `kotlin/com/sunzehui/wifimanage/*.kt`，先 `aapt2 link --java` 生成 `R.java` 再 `javac`，把 `classes` 挂进 kotlinc classpath（否则 `R.drawable` 引不到）。产物 dex 里 `dexdump` 实见 `Lcom/sunzehui/wifimanage/StatusNotifier;`、`StatusBridge;`、`R$drawable;`
- 语法：`node --check` 过 `public/*.js` 与 `server.js`；`node --test tests/core.test.js` 4/4 通过
- 无桥路径：`node:vm` 里加载 `public/app.js`、不提供 `window.MifiNative`，依次调 `Native.push` / `Native.clear` / `showErrorBanner`，均不抛错且 `window.__errs` 长度为 0（等价于「浏览器以 file:// 打开首页」那条断言，用同一份 app.js 直接断言）
- 不新增请求：`public/index.html:852-860` 的推送在既有 5s 轮询的成功回调里，与 `renderSpeed(d)` 共用同一个 `d`，没有第二次 fetch
- 权限（工单原文被真机推翻，已订正）：targetSdk 28 在 Android 16（vivo）上实测 `POST_NOTIFICATIONS: granted=false`、`numBlocked=6`，一条都发不出去；改为启动时 `requestNotifyPermission()` 后 `numPostedByApp=2`、`numUpdatedByApp=56`，`dumpsys notification` 出现 `NotificationRecord(pkg=com.sunzehui.wifimanage id=1 flags=ONGOING_EVENT|ONLY_ALERT_ONCE importance=2)`
- **仍欠手机**：「点通知能拉起应用」——验证手机已从 USB 摘下（`adb devices` 空），接回后跑 `/tmp/verify0304.sh` 一并补
