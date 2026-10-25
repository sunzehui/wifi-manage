# 随身 WiFi 仪表盘

一个本地网页面板，实时查看随身 WiFi（LV01 / MF518A03 固件）的联网状态、电量、信号、
网速、流量、连接设备等信息，并支持修改 WiFi 名称 / 密码、SIM 卡槽切换、频段锁定和
流量套餐总量设置。纯 PHP **8.4+**（兼容最新 **8.5**，CI 双版本验证）实现，零第三方依赖，
深色主题，PC / 平板 / 手机自适应，多页面按需加载。

> 要求扩展: curl / SimpleXML / json / mbstring（见 composer.json）

## 配置

设备密码**不入库**，两种方式任选：

```bash
# 方式一: 环境变量
WIFI_HOST=http://192.168.1.1 WIFI_USER=admin WIFI_PASS=你的设备密码 \
  PHP_CLI_SERVER_WORKERS=4 php -S 127.0.0.1:8765 -t public server.php

# 方式二: 本地配置文件（复制模板后填写, config.local.php 已加入 .gitignore 不会被提交）
cp config.local.php.example config.local.php
PHP_CLI_SERVER_WORKERS=4 php -S 127.0.0.1:8765 -t public server.php
```

## 使用

电脑连接到随身 WiFi 的网络后启动（见上方「配置」），浏览器打开 <http://127.0.0.1:8765>。
macOS 可直接双击 `启动仪表盘.command`（需先创建 config.local.php）。

### 手机访问

无需在手机上安装任何东西——服务绑定在 `0.0.0.0`，手机连接**同一个随身 WiFi** 后，
浏览器打开 `http://<电脑的局域网IP>:8765` 即可（启动窗口和首页页脚都会显示这个地址）。
页面本身就是手机自适应布局（320px 起单列、底部弹窗、44px 触控按钮）。

注意：

- 电脑必须保持开机运行服务（合盖休眠会断）
- 首次从局域网访问时，macOS 可能弹窗询问是否允许 php 接受入站连接，点「允许」即可
- 仪表盘本身没有登录保护，同一 WiFi 下的设备都能访问；个人自用场景可接受，介意的话不要在公共 WiFi 环境（咖啡馆等）以局域网模式运行

浏览器打开 <http://127.0.0.1:8765>。

## 页面结构（按需加载，互不拖慢）

| 页面 | 数据接口 | 刷新 | 说明 |
|---|---|---|---|
| `/` 首页 | `/api/status`（status1） | 网速区块 5s · 其他区块 30s | 设备状态、信号、电量、实时速率曲线、WiFi 管理（改名/改密码/开关）、SIM 卡槽切换、频段锁定、设备信息 |
| `/traffic` 流量 | `/api/traffic`（statistics） | 手动（进入时加载一次） | 本月/累计流量、**套餐总量与剩余**（进度条、剩余、占比、超出提示）、连接时长；**套餐流量卡**（发卡平台总流量/已用/剩余，手动刷新）；入口在首页流量卡片 |
| `/devices` 设备 | `/api/devices`（device_management） | 手动（进入时加载一次） | 连接设备表格/卡片、搜索筛选、单设备流量明细；入口在首页设备卡片 |

首页只拉 status1（最快路径）；流量与设备数据收进二级页面，卡片上的数字来自缓存、
不会触发额外设备请求。SIM 卡设置与频段锁定均为按需加载：

- **SIM 卡槽切换**：点击入口时才查询当前卡槽（卡1 / 卡2 / 卡3，与原厂 eSIM 页一致），
  下发 `RGW/esim/simmode`；设备若开启密码校验会要求输入切换密码（cmd_status=pw 时提示密码错误）
- **频段锁定**：点击入口时才读取频段配置（与原厂「频段」页一致，位掩码
  ltebandl/ltebandh/ltebandext 对应 FDD B1-32 / TDD B33-64 / FDD B65+，仅显示硬件支持的
  频段），勾选后下发 `RGW/customconfig`，支持全选，当前驻留频段实时显示（如 FDD B8）

## 首屏性能

| 场景 | 耗时 |
|---|---|
| 首页刷新（服务运行中） | **约 90ms**（HTML 注入缓存数据，先渲染再后台刷新） |
| 冷启动（首次/重启后） | 约 3s（登录 + status1 单接口，设备本身较慢） |
| 网速轮询 | 每 5s 一次 status1（约 0.9s，其余区块 30s 才随轮询更新一次） |
| 静态资源响应 | 约 2ms（4 worker，不会被数据请求阻塞） |

优化手段：
1. **页面注入首屏数据**：输出 HTML 时命中缓存就把 JSON 注入 `window.__BOOT__`，前端先渲染缓存再拉新数据（纯读缓存，不阻塞）
2. **接口分级缓存**：status1（4s）/ statistics（20s）/ device_management（20s）各自 TTL，多标签页、多 worker 共享（`.data_cache.json` + 文件锁）
3. **并行拉取**：`/api/summary` 兼容接口用 curl_multi 并行取三源（实测 1.2s vs 串行 5.7s）
4. **会话持久化**：Digest 会话存 `.mifi_session.json`，多 worker 共享 nc 计数、跨重启复用，失效自动重登
5. **多 worker**：`PHP_CLI_SERVER_WORKERS=4`，静态页/操作与慢速数据请求互不阻塞

## 接口

- `GET /api/status` — 首页主数据（状态/信号/电池/速率/WiFi/运行信息）
- `GET /api/traffic` — 流量统计
- `GET /api/devices` — 连接设备列表
- `GET /api/summary` — 全量数据（兼容保留）
- `GET|POST /api/sim` — SIM 卡槽状态 / 切换（`{slot: 0|1|2, pw?}`），复用设备原厂 esim 接口
- `GET|POST /api/band` — 频段配置 / 锁定（`{bands: [1,3,8,...]}`），复用设备原厂 customconfig 接口
- `GET /api/traffic` · `POST /api/traffic/quota` — 流量数据 / 套餐总量设置（`{quotaGb: 150}`，0=清除），
  写入设备原生 `total_available_month` 字段（与设备后台「流量管理」同一设置），剩余 = 总量 − 设备统计已用
- `GET /api/remote-traffic` — 发卡平台套餐流量查询（`?refresh=1` 强制刷新，默认 120s 缓存），
  需在 config.local.php 配置 `mgx_card`；进入流量页加载一次，手动刷新，不轮询
- `POST /api/wifi` — `{action: ssid|password|toggle, ...}` WiFi 设置，复用设备原厂 set 接口

所有 set 命令均带 `<?xml version="1.0" encoding="US-ASCII"?>` 声明头（与原厂
getXMLDocToString 一致，缺它设备会报 `CGI parse error`），并把设备错误响应
（Error/UNAUTHORIZED）作为失败抛出，不会假成功。

## 文件

- `server.php` — 网关服务（登录 / 缓存 / 并行拉取 / 接口与页面路由）
- `public/index.html`、`public/traffic.html`、`public/devices.html` — 三个页面
- `public/app.css`、`public/app.js` — 公共样式与脚本（无 CDN 依赖，离线可用）
- `启动仪表盘.command` — macOS 双击启动
- `.mifi_session.json`、`.data_cache.json` — 运行时自动生成的会话与缓存文件

## 工作原理

1. 登录：`GET /login.cgi` 取 Digest 质询（realm/nonce），按原厂前端算法计算 response
   后访问 `login.cgi?Action=Digest&...` 完成一键登录；会话过期自动重新握手。
2. 读数据：带 `Authorization: Digest`（uri 为 `/cgi/xml_action.cgi`，nc 递增）请求
   `xml_action.cgi?method=get&module=duster&file=status1|statistics|device_management`。
3. 写设置：`method=set` 通道下发 `uapxb_wlan_security_settings`（SSID 十六进制 UTF-16 编码 /
   按当前加密模式节点写 key）和 `uapxb_wlan_basic_settings`（wlan_enable 开关）。
4. 字段换算与原厂后台一致：LTE 时 RSRP=-140+raw dBm、RSRQ=-19.5+raw/2 dB、
   RSSI=-110+raw dBm；电量百分比取 `Battery_voltage`；SSID 为 UTF-16 十六进制编码。

## 说明

- 设备后台本身：<http://192.168.1.1/> （页面右上角有直达链接）
- 若页面提示"设备不可达"，说明电脑当前不在随身 WiFi 的网络里。
- WiFi 改名/改密码会使设备无线网络短暂重启，所有连接设备需要重连，页面弹窗中已提示。
