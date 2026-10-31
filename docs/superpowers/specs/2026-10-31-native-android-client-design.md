# 原生 Android 客户端设计

- 日期：2026-10-31
- 状态：设计已确认，待评审
- 范围：`android/`，从 WebView 壳改为全原生 App
- 不影响：`public/` 网页、`server.php`、`server.js` 与现有测试

## 1. 目标与非目标

**目标**：手机端 App 不再嵌 WebView，用 Kotlin + Compose 原生实现，功能与网页版完全对齐：首页状态与网速曲线、流量、设备、WiFi 管理、SIM 卡槽、频段锁定、重启/关机、通知栏状态条。设备协议（Digest、XML、字段换算）在 Kotlin 重写，并用现有测试向量验收。

**非目标**：
- 不改网页版与 PHP/Node 网关；三端实现并存，靠测试向量约束。
- 不做真后台刷新（前台服务 / WorkManager）。设备同一时刻只允许一个管理会话，且会持续耗电。
- 不保留「填服务器地址走局域网」的回退模式。
- 不做多语言、平板专门布局、instrumented UI 自动化。

## 2. 已定决策

| 决策 | 结论 |
| --- | --- |
| 原生程度 | 全原生 UI + 原生数据层，删除 WebView 与本地代理 |
| 构建 | Gradle wrapper + AGP + Kotlin 2.0.21 + Compose BOM |
| 分层 | 单 Gradle 模块（`:app`），包内分层 |
| 首版范围 | 与网页版完全对齐 |
| 协议一致性 | Kotlin 重写，复用 `tests/core.test.js` 与 `tests/digest_vectors.php` 的固定向量 |
| SDK | `minSdk 26`，`compileSdk/targetSdk 36`，JVM target 17 |
| 通知 | 保持前台语义：可见时刷新，Activity 销毁即撤条 |
| 网络 | 只直连 `192.168.1.1`，不发 `Accept-Encoding` |
| 设置存储 | DataStore + Android Keystore AES-GCM（密码、卡号加密） |
| 包名与签名 | 保持 `com.sunzehui.wifimanage` 与现有 debug keystore，允许覆盖安装 |

## 3. 架构

```
android/                         Gradle 工程（根 + :app）
app/src/main/kotlin/com/sunzehui/wifimanage/
├── protocol/    MD5/Digest、XmlNode 解析、模型映射、构建器、格式化（纯 Kotlin，无 android.*）
├── data/        HttpDeviceClient、MgxClient、Repository、TtlCache、SettingsStore
├── ui/          MainActivity、Compose 页面、ViewModel、主题
├── notify/      StatusNotifier
└── AppContainer 手写单例容器
```

依赖方向：`ui → data → protocol`，`notify → data`，`protocol` 不依赖 Android。所有 Android 相关能力（网络、存储、通知、Keystore）只出现在 `data/`、`ui/`、`notify/`。

### 3.1 数据流

- `StatusRepository` 是应用级单例，持有唯一的状态轮询。它向 UI 与通知暴露 `StateFlow<StatusSample>`。
- `StatusSample` = 成功数据或失败原因 + 采样时刻 `ts`。首页初始渲染、每次刷新、通知都用同一个对象，保证「通知数字与首页同一时刻一致、不新增请求」。
- 首页每 5s 采一次：网速与通知每次更新；设备状态、WiFi、设备信息等重区块沿用 30s 节奏重新渲染（值未变时 Compose 不重组）。
- 流量页、设备页只在进入时拉一次，手动刷新；数字入口卡使用首页已有数据。发卡平台套餐卡单独手动刷新。
- 写操作成功后精准失效相关缓存，并触发一次状态刷新（不等下一个 5s tick）。

### 3.2 网络与会话（`HttpDeviceClient`）

- 基址固定 `http://192.168.1.1`，用户名固定 `admin`，密码来自设置。
- 请求头绝不带 `Accept-Encoding`；保留 `Connection: close`（该固件对「200 + 无 Content-Length + keep-alive」的处理在 Android/JDK 上不一致）。
- 超时：连接 12s、读取 20s。
- Digest 会话只存在内存：realm / nonce / qop / nc；每个请求递增 nc。进程重启后重新登录。
- 401 只重登一次；登录失败按现有退避策略（30s 起，逐次翻倍，上限 600s），期间不发登录请求，避免把设备锁死。
- 会话类失败按 `login_status` 分类：`UNAUTHORIZED` / `NOTLOGIN` → 密码错，`KICKOFF` → 会话被踢，`LOCK` → 登录锁定；其余为响应异常。
- 同一文件的请求单飞；写操作串行；不做自动重试风暴。
- `MgxClient` 自己保管发卡平台 Cookie，直连 `http://xmgxx.maigaoxun.com/kyhl-weixin-1.0`，不再需要本地代理。

### 3.3 错误与整机动作窗口

错误五类，文案沿用网页版：

| 类别 | 触发 | 首页横幅 / 通知 |
| --- | --- | --- |
| 设备不可达 | 连接/读取超时、DNS 失败 | 「无法获取设备数据：…」+ 通知就地降级 |
| 密码错 | `UNAUTHORIZED` / `NOTLOGIN` | 提示确认设备后台密码 |
| 会话被踢 | `KICKOFF` | 提示另一客户端占用唯一管理会话 |
| 登录锁定 | `LOCK` | 提示稍后重试或重启设备 |
| 响应异常 | 其他 | 通用失败原因 |

重启/关机后进入 hold 窗口：期间请求失败不显示「设备不可达」，首页显示「重启中 / 已关机」；重启在首次成功采样后自动结束，若全程没观察到掉线，结束提示「该指令在这版固件上可能不生效」；关机保持到用户点「我已开机」。通知在 hold 期间显示对应状态，不新增第二条通知。

## 4. 协议层移植清单

`protocol/` 逐项对应 `public/core.js` 的导出面：

| core.js | Kotlin | 验收 |
| --- | --- | --- |
| `md5` | `Md5` | 与 PHP/JS 固定向量一致 |
| `parseChallenge` | `Digest.parseChallenge` | realm/nonce/qop 解析 |
| `loginRequest` | `Digest.loginRequest` | 查询串 HA2=`/cgi/protected.cgi`，头 HA2=`/cgi/xml_action.cgi`，共用 cnonce/nc |
| `authHeader` | `Digest.authHeader` | nc 递增、uri 正确 |
| `parseXml` / `txt` | `XmlNode.parse` + mapper | 真实 XML 夹具 |
| `uniDecode` / `uniEncode` / `xmlEsc` | 同名工具 | 中文与转义 |
| `buildStatus` | `StatusMapper` | 信号档位、电量、续航、设备信息 |
| `buildTraffic` | `TrafficMapper` | 本月/累计/连接时长/套餐 |
| `buildDevices` | `DevicesMapper` | 在线/离线、单设备流量 |
| `buildSimInfo` | `SimMapper` | 卡槽、切换密码要求 |
| `buildBandInfo` / `bandCurrentFromXml` | `BandMapper` | 频段位掩码 |
| `buildWlanBasic` | `WlanMapper` | SSID、加密、信道、自动关闭 |
| `buildSetXml` / `buildDeviceAction` | `SettingsXml` / `DeviceAction` | 每种写的 XML 形状与校验 |
| `buildRemoteTraffic` | `MgxTrafficMapper` | 发卡平台套餐 |
| `sec2hms` / `signalBars` / `NET_MODES` / `SIM_SLOTS` / `DEVICE_ACTIONS` | 常量与格式化 | 与 JS 输出一致 |

XML 解析用 `XmlPullParser` 先建通用节点树，再由 mapper 转类型化模型；解析保持宽松，未知节点忽略。

## 5. 端点与缓存

GET：`/xml_action.cgi?method=get&module=duster&file=<file>&_=<ts>`

| file | 用途 | TTL |
| --- | --- | --- |
| `status1` | 首页状态、网速、WiFi 摘要 | 4s |
| `statistics` | 流量 | 20s |
| `device_management` | 连接设备 | 20s |
| `customconfig` | 频段 | 5s |
| `esim` | SIM 卡槽 | 5s |
| `deviceinfo` | 设备型号/SN/IMEI 等 | 600s |
| `uapxb_wlan_basic_settings` | WiFi 基本信息 | 20s |
| `uapxb_wlan_security_settings` | 当前加密模式与 key | 写前回读，不缓存 |

写：`POST /xml_action.cgi?method=set&module=duster&file=<file>`；重启/关机走 `method=get` 触发 `reset` / `power_off`。

保留的写操作与校验：

- WiFi 名称 + 密码一条请求写完；改名前回读加密模式与原 key；名称 1–32 字节；密码 8–63 位可打印字符；模式为 `None` 时拒绝设密码。
- WiFi 开关、空闲自动关闭（0 或 10–60 分钟）。
- SIM 卡槽切换；要求密码时提示输入；响应含 `<cmd_status>pw</cmd_status>` 视为密码错误。
- 频段锁定：至少一个有效频段。
- 流量套餐总量：0–100000 GB。
- 重启 / 关机；关机必须显式确认。

写后失效：`status1`、对应文件；SIM 切换额外失效 `esim/statistics/device_management`；重启/关机清空全部缓存。

## 6. 页面

单 Activity + Compose。Home / Traffic / Devices 用 sealed 状态切换 + `BackHandler`；设置为 `ModalBottomSheet`。

- **首页**：设备状态（制式、运营商、信号格、电量与续航）、网络速度（上下行 + Canvas 曲线）、流量与设备入口卡、WiFi 管理（名称/密码合并入口、自动关闭）、设备信息（可折叠 SN/IMEI/ICCID/WAN/APN/RSRP 等）、SIM 卡槽、频段锁定、重启/关机、hold 状态条。
- **流量页**：本月用量、套餐总量进度与设置、累计与连接时长；发卡平台套餐卡（卡号来自设置，手动刷新）。
- **设备页**：在线/离线数量、搜索、列表、单设备流量详情、手动刷新。
- **设置**：设备密码（必填）、发卡平台卡号（可选）、通知开关（默认开）。无服务器地址、无设备地址、无用户名。
- 视觉沿用现有深色主题色板与信息密度；手机单列；错误横幅、Toast、加载态沿用现有文案。

## 7. 通知与生命周期

- 数据源直接订阅 `StatusSample`，不再经过 JS 桥；文案在 `protocol/` 算好。
- 载荷语义保持 `title / line1 / line2 / ts / bad`。
- 渠道低重要性、静音、不振动；固定通知 id、`setOnlyAlertOnce`、`ongoing`、相对时间。
- 成功时显示制式与连接状态、实时速率、在线设备数/信号/电量；失败时就地降级为 ⚠ + 具体原因，`ts` 冻结。
- 点击回到已有任务：`SINGLE_TOP` + `FLAG_UPDATE_CURRENT`，不新建实例。
- 开关默认开、持久化；关闭立即撤条。
- 轮询随界面可见性启停：退到后台停止请求，通知保留最后快照；Activity 销毁撤条。
- Android 13+ 启动时申请 `POST_NOTIFICATIONS`；被拒绝时设置页给出跳系统设置的提示。

## 8. 设置、安全与迁移

- `SettingsStore`：DataStore Preferences 存配置。
- 设备密码与发卡平台卡号用 Android Keystore 中的 AES-GCM 密钥加密，DataStore 只存密文与 IV；密钥不出 Keystore。
- 通知开关明文存储。
- 首次启动没有密码时直接打开设置页。
- 保持 `applicationId = com.sunzehui.wifimanage`，继续用现有 `android/debug.keystore` 签名，允许覆盖安装旧 APK。
- WebView 的 `localStorage` 原生读不到：升级后首次打开需重输密码与卡号，通知开关恢复默认开。README 写明。
- 旧 APK 保留作回滚包；新包 `versionCode 2`，回滚需先卸载。

## 9. 构建

- `android/` 改为 Gradle 工程：根 `settings.gradle.kts` / `build.gradle.kts` + `:app` 模块；提交 wrapper。
- `compileSdk/targetSdk 36`、`minSdk 26`、JVM target 17；平台 `android-36` 本机已装，JDK 17 已就绪。
- 移除 `build-apk.sh`、`build/` 产物、WebView 源文件与 `tools/proxy-test/`；图标（含通知小图标 `ic_stat_mifi`）、`debug.keystore`、manifest 迁入 `:app`。
- 保留 `usesCleartextTraffic=true`（设备与发卡平台均为 HTTP）。
- 首次构建需联网拉 Gradle 与依赖，之后离线可重复；版本全部钉死。
- 产物：`android/app/build/outputs/apk/debug/app-debug.apk`。
- 文档：README 的 APK 段整体重写（原生架构、构建方式、升级需重输密码、前台刷新限制）；新增 ADR `docs/adr/0001-native-android-client.md` 记录这次重写的理由与被否掉的替代方案。

## 10. 测试与验收

**自动化**：
- `protocol/` JVM 单测覆盖 `tests/core.test.js` 与 `tests/digest_vectors.php` 的全部断言，Digest 固定向量值必须与 JS/PHP 完全一致。
- XML 夹具测试各 mapper；写操作 XML 形状与参数校验逐个断言。
- 错误归类（401 / KICKOFF / LOCK / 超时）单测。

**真机验收（vivo / Android 16）**，每条都要同时给数字与现象：
- 单测全绿；Digest 向量值与原实现一致。
- 日志 30 秒约 6 次状态采样，通知条数对应；失败期间不产生第二条通知。
- 同一时刻首页数字与网页版一致；曲线肉眼可见地滚动。
- 改 WiFi 名称+密码、自动关闭、SIM 切换、频段锁定、重启、关机逐项可用。
- 密码填错 → 横幅与通知同时降级；改对 → 自动恢复。
- 退到后台日志不再发请求；划掉 App 通知消失。
- 覆盖安装旧 APK 成功，首次打开要求重输密码。

无法自动化的观感项（动画流畅度、深色配色与网页版的一致性）明确留给用户目视确认。

## 11. 落地顺序

1. Gradle 骨架 + `protocol/` 移植 + 单测。
2. 网络会话 + 仓储 + 首页只读 + 通知。
3. 流量页 + 设备页。
4. 全部写操作。
5. 设置加密、迁移、README、真机验收。

## 12. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 首次 Gradle 构建需联网，依赖下载失败 | 提交 wrapper 与版本目录，锁定版本；失败时明确报错与镜像说明 |
| Digest/XML 移植偏差 | 固定向量 + 真实 XML 夹具；同一批断言先于 UI 落地 |
| 固件字段差异 | 解析保持宽松，未知节点忽略；真机逐项比对 |
| 原生与网页版抢唯一管理会话 | 保持 401 只重登一次与登录退避；文档写明同时只用一个客户端 |
| 升级签名不一致 | 继续使用现有 debug keystore；丢失则需卸载重装（README 注明） |
| 双实现漂移 | 现有测试向量作为契约；改动协议时两边同批跑 |

## 13. 明确不做

- 后台常驻刷新、前台服务、WorkManager。
- 服务器地址回退模式。
- 用户名/设备地址可配置（本固件固定 `admin` / `192.168.1.1`）。
- WebView、本地代理、JS 桥。
- 网页版与 PHP/Node 的任何重构。
