# 05: README 补「Android 通知」一节

**What to build:** 读 README 的人能知道：APK 现在会在通知栏常驻一条状态；它**只在应用存活期间刷新**，划掉应用后保留最后快照并靠相对时间表明有多旧；以及最容易被再次提起来的一条——**为什么这轮没做真后台刷新**：设备同一时刻只允许一个管理会话，登录握手与计数保存在页面侧，原生想自己后台轮询就得在 Kotlin 重抄一遍摘要认证、XML 解析与字段换算，且会与页面互相把对方的会话踢掉。同时把新增的原生文件、设置里的开关、以及「提 targetSdk 到 33+ 时需补通知权限的运行期申请」记进对应清单。

**Blocked by:** 03: 设置里的通知开关与撤条时机 · 04: 取不到数据时通知就地降级

**Status:** ready-for-agent

- [x] 「Android App (APK)」段补充通知行为：常驻、默认开启、开关位置、只在前台存活期刷新
- [x] 明确写出后台刷新没做的**原因**与被砍掉的两条替代路径（原生承载 WebView / 把网关下沉到本地代理），指名归入后续待办
- [x] 文件清单补入新增的原生通知器与状态图标资源
- [x] 已知限制里写明 targetSdk 与通知权限运行期申请的关系
- [x] 验收：README 里的每条陈述都能在实际代码/构建脚本里找到对应实现，不写未落地的能力

## 验证记录（2026-10-29）

- 新增「通知栏状态条」小节（`README.md` 的「Android App (APK)」段内）：四行内容对照表 + 默认开启与开关位置 + 低重要性/静音/ongoing/点击回 App + 就地降级 + 只在前台存活期刷新
- 后台刷新为什么不做：写成两条被点名的砍掉路径（离屏 WebView 承载页面网关 / 网关下沉进 `LocalProxy` 需在 Kotlin 重抄 Digest+XML+字段换算），根因是设备只允许一个管理会话且会话存在页面侧
- 文件清单补入 `StatusNotifier.kt` 与 `android/res/drawable/ic_stat_mifi.xml`
- 已知限制：写明 targetSdk 28 仍需运行期申请这条实测结论（原文「提 targetSdk 到 33+ 时才需补」已被真机推翻，README 记的是实际实现）
- 逐条对代码核过：`IMPORTANCE_LOW`/`setOnlyAlertOnce`/`setOngoing`/`setShowWhen`/`NOTIF_ID=1`/`tapIntent` 的 `CLEAR_TOP`/`onDestroy` 撤条/`notify_on` 默认开，README 里没有写了但代码没有的能力
