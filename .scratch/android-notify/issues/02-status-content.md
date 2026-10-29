# 02: 通知栏显示真实状态与呈现质量

**What to build:** 通知栏那条不再占位，而是肉眼可读的当前状态：标题给网络制式与连接状态，正文给实时上下行速率，第三行给在线设备数、信号档位、电量与充放电状态；通知自带相对时间（「x 秒前」），常驻不响、用户滑不掉、点它回到应用且不会新开一个任务实例。手机用户不进 App 就能瞟到这几个数，这正是这轮功能的目的。

关键契约：显示文案**全部在页面侧算好**再递给原生——速率换算、信号分档、电量文案在共享核心里已有实现且受测，原生侧只负责渲染，不再实现第二套换算。载荷即下面这五个键（此形状来自设计评审，用于锁定两侧唯一耦合点）：

```
{ title, line1, line2, ts, bad }
```

**Blocked by:** 01: 打通通知链路（端到端最小内容）

**Status:** ready-for-agent

- [x] 五个键的载荷契约在页面侧与原生侧一致，且网页版（桥缺失）走同一份拼串代码不报错
- [x] 通知显示的速率/在线设备数/电量/信号档位与首页同一时刻的数字一致（同一次轮询结果，不允许出现两个来源）
- [x] 常驻呈现：低重要性、不发声不振动、`ongoing`，同一 id 就地更新而不是每条新建
- [x] 相对时间显示开启，用于表达「这条快照有多旧」，无需额外失效标记
- [ ] 点击通知回到应用首页，复用既有任务栈，不产生第二个 Activity 实例（`tapIntent` 已按 `NEW_TASK|CLEAR_TOP` + `FLAG_IMMUTABLE` 实现，待手机接回后真机确认）
- [x] 自动化证据：脚本语法检查通过；dex 与 assets 里都含改动后的脚本（构建合包环节曾出现过旧 assets 不被覆盖的坑，需确认产物为新版）
- [ ] 真机肉眼：数值与页面逐一比对；划掉 App 后时间戳继续走到「x 分钟前」；通知全程静音

## 验证记录（2026-10-29）

- 契约五键：vm 断言 `Object.keys(payload).sort()` === `bad,line1,line2,title,ts`；`StatusNotifier.build` 只读这五个键
- 同源：`index.html:852-860` 里 `renderSpeed(d)` 与 `Native.push(buildNotifyPayload(d))` 用的是同一次轮询的同一个 `d`，页面与通知没有第二个数据源；速率/信号/电量文案都调页面既有 `fmtRate`/`signalLabel`，原生侧不做换算
- 文案断言（vm，桩桥记录）：`title "4G LTE · 已连接"`、`line1 "↓ 2.29 MB/s ↑ 439.5 KB/s"`、`line2 "3 台在线 · 信号极好 · 78% 充电中"`；未联网变体 `4G LTE · 未联网`；无电池变体以「无电池」结尾
- 真机取到的实推内容：`update: LTE · 已连接 | ↓ 31.4 KB/s ↑ 657.9 KB/s | 3 台在线 · 信号极好 · 93% 未充电` —— 由此发现设备回的 `network.mode` 是短名 `LTE`，工单要求与页面徽标一致（页面显示「4G LTE」），已在 `buildNotifyPayload` 里补上 `netTypeName` 同一条映射
- 呈现：`IMPORTANCE_LOW` + `setOnlyAlertOnce` + 固定 `NOTIF_ID = 1`，`dumpsys` 显示 `flags=ONGOING_EVENT|ONLY_ALERT_ONCE`、`importance=2`、同一 id 就地更新（`numUpdatedByApp=56` 而 `numPostedByApp=2`）
- **仍欠手机**：数值与页面逐条同时刻比对、划掉 App 后时间戳继续走到「x 分钟前」、全程静音——手机已摘下 USB，接回后补
