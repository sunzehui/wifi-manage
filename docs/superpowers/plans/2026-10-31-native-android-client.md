# 原生 Android 客户端实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `android/` 从 WebView 壳替换成功能完全对齐网页版的 Kotlin + Compose 原生 App，协议层用现有测试向量验收。

**Architecture:** 单 Gradle 模块 `:app`，包内分 `protocol`（纯 Kotlin）/ `data` / `ui` / `notify` 四层，手写 `AppContainer` 注入。`StatusCoordinator` 持有唯一 5s 轮询，UI 与通知订阅同一个 `StatusSample`。

**Tech Stack:** Gradle 8.13、AGP 8.11.1、Kotlin 2.0.21、Compose BOM 2024.12.01、DataStore、kotlinx-coroutines、kotlinx-serialization-json、JUnit 4。

**Spec:** `docs/superpowers/specs/2026-10-31-native-android-client-design.md`

## Global Constraints

- `minSdk 26`、`compileSdk 36`、`targetSdk 36`、JVM target 17。
- `applicationId` / `namespace` 保持 `com.sunzehui.wifimanage`，`versionCode 2`、`versionName "2.0.0"`。
- 构建必须用 `android/debug.keystore` 签名，保证覆盖安装旧 APK。
- 设备基址固定 `http://192.168.1.1`，用户名固定 `admin`，密码来自设置。
- 所有设备请求：不发 `Accept-Encoding`（显式 `identity`）、`Connection: close`、连接超时 12s、读取超时 20s；发卡平台 20s/20s。
- 缓存 TTL：`status1` 4s、`statistics` 20s、`device_management` 20s、`customconfig` 5s、`esim` 5s、`deviceinfo` 600s、`uapxb_wlan_basic_settings` 20s；`uapxb_wlan_security_settings` 不缓存。
- 通知载荷五键语义：`title / line1 / line2 / ts / bad`。
- 主题色：`#0D1322` 背景、`#151D33` 卡片、`#1B2440` 卡片内嵌、`#28324E` 边框、`#EAF0FF` 主文字、`#93A0C4` 辅助文字、`#34D399` 正常、`#FBBF24` 警告、`#F87171` 异常、`#60A5FA` 主操作。
- 全部界面文案用中文，照抄网页版。
- 不引入 WebView、代理、Hilt、Retrofit、Room。
- 每个任务结束提交一次；提交只列本任务文件。

---

### Task 1: Gradle 工程骨架

**Files:**
- Create: `android/settings.gradle.kts`
- Create: `android/build.gradle.kts`
- Create: `android/gradle.properties`
- Create: `android/local.properties`（不提交）
- Create: `android/app/build.gradle.kts`
- Create: `android/app/src/main/AndroidManifest.xml`
- Create: `android/app/src/main/res/values/strings.xml`
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/MifiApp.kt`
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/MainActivity.kt`
- Move: `android/res` → `android/app/src/main/res`
- Delete: `android/build-apk.sh`、`android/AndroidManifest.xml`、`android/kotlin/`、`android/tools/proxy-test/`、`android/build/`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: 无
- Produces: `MifiApp`（后续替换为真实容器）、`MainActivity`、可跑的 `./gradlew :app:assembleDebug`

- [ ] **Step 1: 删旧构建链并迁移资源**

```bash
cd android
git rm -r build-apk.sh AndroidManifest.xml kotlin tools/proxy-test
rm -rf build
mkdir -p app/src/main
git mv res app/src/main/res
mkdir -p app/src/main/kotlin/com/sunzehui/wifimanage/ui
```

- [ ] **Step 2: 写入 Gradle 配置**

`android/settings.gradle.kts`：

```kotlin
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "wifi-manage-android"
include(":app")
```

`android/build.gradle.kts`：

```kotlin
plugins {
    id("com.android.application") version "8.11.1" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "2.0.21" apply false
}
```

`android/gradle.properties`：

```properties
org.gradle.jvmargs=-Xmx2g -Dfile.encoding=UTF-8
android.useAndroidX=true
android.nonTransitiveRClass=true
kotlin.code.style=official
```

`android/local.properties`：

```properties
sdk.dir=/Users/sunzehui/Library/Android/sdk
```

`android/app/build.gradle.kts`：

```kotlin
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "com.sunzehui.wifimanage"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.sunzehui.wifimanage"
        minSdk = 26
        targetSdk = 36
        versionCode = 2
        versionName = "2.0.0"
    }

    signingConfigs {
        getByName("debug") {
            storeFile = rootProject.file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        debug { signingConfig = signingConfigs.getByName("debug") }
    }

    buildFeatures { compose = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.datastore:datastore-preferences:1.1.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
}
```

`android/app/src/main/AndroidManifest.xml`：

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

    <application
        android:name=".MifiApp"
        android:label="@string/app_name"
        android:icon="@mipmap/ic_launcher"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:usesCleartextTraffic="true"
        android:theme="@android:style/Theme.Material.NoActionBar">
        <activity
            android:name=".ui.MainActivity"
            android:exported="true"
            android:launchMode="singleTop"
            android:configChanges="orientation|screenSize|keyboardHidden"
            android:windowSoftInputMode="adjustResize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
```

`android/app/src/main/res/values/strings.xml`：

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">随身WiFi</string>
</resources>
```

- [ ] **Step 3: 写入最小可安装的 Application 与 Activity**

`MifiApp.kt`：

```kotlin
package com.sunzehui.wifimanage

import android.app.Application

class MifiApp : Application()
```

`ui/MainActivity.kt`：

```kotlin
package com.sunzehui.wifimanage.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.Text

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { Text("随身WiFi") }
    }
}
```

- [ ] **Step 4: 生成 wrapper 并构建**

```bash
cd android
curl -L -o /tmp/gradle-8.13-bin.zip https://services.gradle.org/distributions/gradle-8.13-bin.zip
unzip -q /tmp/gradle-8.13-bin.zip -d "$HOME/.local/share"
"$HOME/.local/share/gradle-8.13/bin/gradle" wrapper --gradle-version 8.13 --distribution-type bin
./gradlew :app:assembleDebug
```

Expected: `BUILD SUCCESSFUL`，产物在 `android/app/build/outputs/apk/debug/app-debug.apk`。

- [ ] **Step 5: 覆盖安装验证签名**

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Expected: `Success`（签名与旧 APK 相同、versionCode 2 更高，可直接覆盖）。打开应用看到「随身WiFi」文字。

- [ ] **Step 6: 更新 .gitignore**

在根 `.gitignore` 追加：

```
android/.gradle/
android/local.properties
android/app/build/
```

- [ ] **Step 7: 提交**

```bash
git add .gitignore android/settings.gradle.kts android/build.gradle.kts android/gradle.properties \
  android/gradle android/gradlew android/gradlew.bat android/app
git commit -m "构建: android 改为 Gradle + Compose 工程骨架"
```

---

### Task 2: MD5 与 Digest

**Files:**
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/protocol/Md5.kt`
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/protocol/Digest.kt`
- Test: `android/app/src/test/kotlin/com/sunzehui/wifimanage/protocol/DigestTest.kt`

**Interfaces:**
- Consumes: 无
- Produces:
  - `Md5.hex(input: String): String`
  - `DeviceCredentials(user: String, pass: String)`
  - `DigestChallenge(realm: String, nonce: String, qop: String)`
  - `DigestSession(realm: String, nonce: String, qop: String, var nc: Int = 1)`
  - `LoginRequest(path: String, authorization: String)`
  - `Digest.parseChallenge(header: String?): DigestChallenge?`
  - `Digest.loginRequest(cred, challenge, cnonce: String = randomCnonce()): LoginRequest`
  - `Digest.authHeader(cred, session, method: String, cnonce: String = randomCnonce()): String`

- [ ] **Step 1: 写失败测试**

```kotlin
package com.sunzehui.wifimanage.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DigestTest {
    private val cred = DeviceCredentials("admin", "testpass")
    private val challenge = DigestChallenge("Highwmg", "6028365", "auth")

    @Test fun md5MatchesPhpAndJs() {
        assertEquals("bfda623baa0a7c65c953803e117b3763", Md5.hex("admin:Highwmg:testpass"))
        assertEquals("202fe3ae6688ea0a29cec56f47556821", Md5.hex("GET:/cgi/protected.cgi"))
        assertEquals("905231dd8a834adf460e748aa0b216e3", Md5.hex("GET:/cgi/xml_action.cgi"))
    }

    @Test fun parseChallengeRequiresRealmAndNonce() {
        assertEquals(challenge, Digest.parseChallenge("""Digest realm="Highwmg", nonce="6028365", qop="auth""""))
        assertEquals("auth", Digest.parseChallenge("""Digest realm="R", nonce="N"""")!!.qop)
        assertNull(Digest.parseChallenge("""Basic realm="R""""))
        assertNull(Digest.parseChallenge("""Digest realm="R""""))
    }

    @Test fun loginRequestUsesTwoHa2AndSharedCnonce() {
        val req = Digest.loginRequest(cred, challenge, cnonce = "0123456789abcdef")
        val query = req.path.substringAfter('?')
        assertTrue(query.contains("cnonce=0123456789abcdef"))
        assertTrue(query.contains("qop=auth"))
        assertTrue(query.contains("temp=asr"))
        assertTrue(req.authorization.contains("""uri="/cgi/xml_action.cgi""""))
        assertTrue(req.authorization.contains("""cnonce="0123456789abcdef""""))
        assertTrue(req.authorization.contains("nc=00000001"))
    }

    @Test fun fixedDigestVectors() {
        val ha1 = Md5.hex("admin:Highwmg:testpass")
        val cnonce = "0123456789abcdef"
        val protected = Md5.hex(listOf(ha1, "6028365", "00000001", cnonce, "auth", Md5.hex("GET:/cgi/protected.cgi")).joinToString(":"))
        val action = Md5.hex(listOf(ha1, "6028365", "00000001", cnonce, "auth", Md5.hex("GET:/cgi/xml_action.cgi")).joinToString(":"))
        assertEquals("bc91a0a5a0013b9d05fdbe6a8eb1c7bb", protected)
        assertEquals("23192d08056d3589140da39c89c238a8", action)
    }

    @Test fun authHeaderPadsNcToEightDigits() {
        val session = DigestSession("Highwmg", "6028365", "auth", nc = 7)
        val header = Digest.authHeader(cred, session, "GET", cnonce = "0123456789abcdef")
        assertTrue(header.contains("nc=00000007"))
        assertTrue(header.contains("""uri="/cgi/xml_action.cgi""""))
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests "com.sunzehui.wifimanage.protocol.DigestTest"`
Expected: 编译失败（`Md5` / `Digest` 不存在）。

- [ ] **Step 3: 实现 Md5**

```kotlin
package com.sunzehui.wifimanage.protocol

object Md5 {
    fun hex(input: String): String {
        val msg = input.toByteArray(Charsets.UTF_8)
        val bitLen = msg.size.toLong() * 8
        val zeros = ((56 - (msg.size + 1) % 64) + 64) % 64
        val buf = msg.copyOf(msg.size + 1 + zeros + 8)
        buf[msg.size] = 0x80.toByte()
        for (i in 0 until 8) buf[buf.size - 8 + i] = ((bitLen ushr (8 * i)) and 0xFF).toByte()

        var a0 = 0x67452301
        var b0 = 0xefcdab89.toInt()
        var c0 = 0x98badcfe.toInt()
        var d0 = 0x10325476
        val s = intArrayOf(
            7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
            5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
            4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
            6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
        )
        val k = IntArray(64) {
            ((kotlin.math.abs(kotlin.math.sin((it + 1).toDouble())) * 4294967296.0).toLong() and 0xFFFFFFFFL).toInt()
        }

        var off = 0
        while (off < buf.size) {
            val m = IntArray(16) { i ->
                (buf[off + i * 4].toInt() and 0xFF) or
                    ((buf[off + i * 4 + 1].toInt() and 0xFF) shl 8) or
                    ((buf[off + i * 4 + 2].toInt() and 0xFF) shl 16) or
                    ((buf[off + i * 4 + 3].toInt() and 0xFF) shl 24)
            }
            var a = a0; var b = b0; var c = c0; var d = d0
            for (i in 0 until 64) {
                val f: Int
                val g: Int
                when {
                    i < 16 -> { f = (b and c) or (b.inv() and d); g = i }
                    i < 32 -> { f = (d and b) or (d.inv() and c); g = (5 * i + 1) % 16 }
                    i < 48 -> { f = b xor c xor d; g = (3 * i + 5) % 16 }
                    else -> { f = c xor (b or d.inv()); g = (7 * i) % 16 }
                }
                val tmp = d
                d = c
                c = b
                b += Integer.rotateLeft(a + f + k[i] + m[g], s[i])
                a = tmp
            }
            a0 += a; b0 += b; c0 += c; d0 += d
            off += 64
        }
        return listOf(a0, b0, c0, d0).joinToString("") { w ->
            (0 until 4).joinToString("") { i ->
                ((w ushr (8 * i)) and 0xFF).toString(16).padStart(2, '0')
            }
        }
    }
}
```

- [ ] **Step 4: 实现 Digest**

```kotlin
package com.sunzehui.wifimanage.protocol

import java.net.URLEncoder

data class DeviceCredentials(val user: String, val pass: String)
data class DigestChallenge(val realm: String, val nonce: String, val qop: String)
data class DigestSession(val realm: String, val nonce: String, val qop: String, var nc: Int = 1)
data class LoginRequest(val path: String, val authorization: String)

object Digest {
    fun parseChallenge(header: String?): DigestChallenge? {
        if (header == null || !header.regionMatches(0, "Digest", 0, 6, ignoreCase = true)) return null
        fun pick(key: String): String? =
            Regex("$key=\"([^\"]+)\"", RegexOption.IGNORE_CASE).find(header)?.groupValues?.get(1)
        val realm = pick("realm") ?: return null
        val nonce = pick("nonce") ?: return null
        return DigestChallenge(realm, nonce, pick("qop") ?: "auth")
    }

    fun randomCnonce(now: Long = System.currentTimeMillis()): String =
        Md5.hex(now.toString() + Math.random()).take(16)

    fun loginRequest(
        cred: DeviceCredentials,
        challenge: DigestChallenge,
        cnonce: String = randomCnonce(),
    ): LoginRequest {
        val ha1 = Md5.hex("${cred.user}:${challenge.realm}:${cred.pass}")
        val nc = "00000001"
        val resp = Md5.hex(
            listOf(ha1, challenge.nonce, nc, cnonce, challenge.qop, Md5.hex("GET:/cgi/protected.cgi"))
                .joinToString(":")
        )
        val authResp = Md5.hex(
            listOf(ha1, challenge.nonce, nc, cnonce, challenge.qop, Md5.hex("GET:/cgi/xml_action.cgi"))
                .joinToString(":")
        )
        val path = "/login.cgi?Action=Digest&username=${enc(cred.user)}&realm=${enc(challenge.realm)}" +
            "&nonce=${enc(challenge.nonce)}&response=$resp&qop=${challenge.qop}" +
            "&cnonce=$cnonce&temp=asr"
        val auth = "Digest username=\"${cred.user}\", realm=\"${challenge.realm}\", " +
            "nonce=\"${challenge.nonce}\", uri=\"/cgi/xml_action.cgi\", response=\"$authResp\", " +
            "qop=${challenge.qop}, nc=$nc, cnonce=\"$cnonce\""
        return LoginRequest(path, auth)
    }

    fun authHeader(
        cred: DeviceCredentials,
        session: DigestSession,
        method: String,
        cnonce: String = randomCnonce(),
    ): String {
        val ha1 = Md5.hex("${cred.user}:${session.realm}:${cred.pass}")
        val ha2 = Md5.hex("$method:/cgi/xml_action.cgi")
        val nc = session.nc.toString().padStart(8, '0')
        val resp = Md5.hex(listOf(ha1, session.nonce, nc, cnonce, session.qop, ha2).joinToString(":"))
        return "Digest username=\"${cred.user}\", realm=\"${session.realm}\", " +
            "nonce=\"${session.nonce}\", uri=\"/cgi/xml_action.cgi\", response=\"$resp\", " +
            "qop=${session.qop}, nc=$nc, cnonce=\"$cnonce\""
    }

    private fun enc(s: String): String =
        URLEncoder.encode(s, "UTF-8").replace("+", "%20")
}
```

- [ ] **Step 5: 运行测试**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests "com.sunzehui.wifimanage.protocol.DigestTest"`
Expected: 5 个测试全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add android/app/src/main/kotlin/com/sunzehui/wifimanage/protocol/Md5.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/protocol/Digest.kt \
  android/app/src/test/kotlin/com/sunzehui/wifimanage/protocol/DigestTest.kt
git commit -m "协议: 移植 MD5 与 Digest 登录/鉴权头"
```

---

### Task 3: XML 解析与文本工具

**Files:**
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/protocol/Xml.kt`
- Test: `android/app/src/test/kotlin/com/sunzehui/wifimanage/protocol/XmlTest.kt`

**Interfaces:**
- Consumes: 无
- Produces:
  - `class XmlNode { val children: Map<String, List<XmlNode>>; var text: String?; fun child(name): XmlNode?; fun items(name): List<XmlNode> }`
  - `Xml.parse(xml: String): XmlNode`（返回 `RGW` 节点，缺失时返回空节点）
  - `Xml.txt(node: XmlNode?, path: String, default: String = ""): String`
  - `Xml.uniDecode(hex: String): String`、`Xml.uniEncode(s: String): String`、`Xml.xmlEsc(s: String): String`
  - `Xml.sec2hms(sec: String?): String`
  - `Xml.signalBars(sysMode: Int, rsrpRaw: String, rscpRaw: String): Int`

- [ ] **Step 1: 写失败测试**

```kotlin
package com.sunzehui.wifimanage.protocol

import org.junit.Assert.assertEquals
import org.junit.Test

class XmlTest {
    private val sample = """<?xml version="1.0" encoding="US-ASCII"?>
        <RGW><wan><rsrp>55</rsrp><cellular><pdp_context_list>
        <Item><default>1</default><ipv4>10.0.0.2</ipv4></Item>
        <Item><default>0</default><ipv4>10.0.0.3</ipv4></Item>
        </pdp_context_list></cellular></wan>
        <wlan_security><ssid>004D006900460069</ssid><mode>WPA2-PSK</mode></wlan_security></RGW>"""

    @Test fun parsesNestedNodesAndItems() {
        val rgw = Xml.parse(sample)
        assertEquals("55", Xml.txt(rgw, "wan/rsrp"))
        val items = rgw.child("wan")!!.child("cellular")!!.child("pdp_context_list")!!.items("Item")
        assertEquals(2, items.size)
        assertEquals("10.0.0.2", Xml.txt(items[0], "ipv4"))
    }

    @Test fun decodesAndEncodesUnicodeHex() {
        assertEquals("MiFi", Xml.uniDecode("004D006900460069"))
        assertEquals("004D006900460069", Xml.uniEncode("MiFi"))
        assertEquals("abc", Xml.uniDecode("abc"))
    }

    @Test fun formatsDurations() {
        assertEquals("1时1分1秒", Xml.sec2hms("3661"))
        assertEquals("2时0分0秒", Xml.sec2hms("7200"))
        assertEquals("45秒", Xml.sec2hms("45"))
    }

    @Test fun mapsSignalBars() {
        assertEquals(4, Xml.signalBars(17, "55", ""))
        assertEquals(3, Xml.signalBars(17, "50", ""))
        assertEquals(2, Xml.signalBars(17, "40", ""))
        assertEquals(1, Xml.signalBars(17, "20", ""))
        assertEquals(0, Xml.signalBars(17, "0", ""))
        assertEquals(4, Xml.signalBars(5, "", "90"))
        assertEquals(0, Xml.signalBars(3, "55", "90"))
    }

    @Test fun escapesXml() {
        assertEquals("a&amp;b&lt;c&gt;d&quot;e", Xml.xmlEsc("a&b<c>d\"e"))
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests "com.sunzehui.wifimanage.protocol.XmlTest"`
Expected: 编译失败（`Xml` 不存在）。

- [ ] **Step 3: 实现 Xml.kt**

```kotlin
package com.sunzehui.wifimanage.protocol

import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory
import java.io.StringReader

class XmlNode {
    val children = LinkedHashMap<String, MutableList<XmlNode>>()
    var text: String? = null

    fun child(name: String): XmlNode? = children[name]?.firstOrNull()
    fun items(name: String): List<XmlNode> = children[name].orEmpty()
}

object Xml {
    fun parse(xml: String): XmlNode {
        val clean = xml.replace(Regex("<\\?[\\s\\S]*?\\?>"), "").trim()
        val parser = XmlPullParserFactory.newInstance().newPullParser()
        parser.setInput(StringReader(clean))
        var event = parser.eventType
        while (event != XmlPullParser.END_DOCUMENT) {
            if (event == XmlPullParser.START_TAG) {
                return readNode(parser)
            }
            event = parser.next()
        }
        return XmlNode()
    }

    private fun readNode(parser: XmlPullParser): XmlNode {
        val node = XmlNode()
        while (true) {
            when (parser.next()) {
                XmlPullParser.START_TAG -> {
                    val name = parser.name
                    val child = readNode(parser)
                    node.children.getOrPut(name) { mutableListOf() }.add(child)
                }
                XmlPullParser.TEXT -> {
                    val t = parser.text?.trim().orEmpty()
                    if (t.isNotEmpty()) node.text = (node.text ?: "") + t
                }
                XmlPullParser.END_TAG, XmlPullParser.END_DOCUMENT -> return node
                else -> Unit
            }
        }
    }

    fun txt(node: XmlNode?, path: String, default: String = ""): String {
        var cur = node
        for (seg in path.split('/')) cur = cur?.child(seg) ?: return default
        return cur?.text?.trim().orEmpty().ifEmpty { default }
    }

    fun uniDecode(hex: String): String {
        if (hex.isEmpty() || !Regex("^(?:[0-9a-fA-F]{4})+$").matches(hex)) return hex
        return hex.chunked(4).joinToString("") { it.toInt(16).toChar().toString() }
    }

    fun uniEncode(s: String): String {
        val out = StringBuilder()
        var i = 0
        while (i < s.length) {
            val cp = s.codePointAt(i)
            out.append((cp and 0xffff).toString(16).padStart(4, '0'))
            i += Character.charCount(cp)
        }
        return out.toString().uppercase()
    }

    fun xmlEsc(s: String): String = s.replace("&", "&amp;").replace("<", "&lt;")
        .replace(">", "&gt;").replace("\"", "&quot;")

    fun sec2hms(sec: String?): String {
        var s = (sec?.toLongOrNull() ?: 0L).coerceAtLeast(0)
        val h = s / 3600
        val m = (s % 3600) / 60
        s %= 60
        return when {
            h > 0 -> "${h}时${m}分${s}秒"
            m > 0 -> "${m}分${s}秒"
            else -> "${s}秒"
        }
    }

    fun signalBars(sysMode: Int, rsrpRaw: String, rscpRaw: String): Int {
        if (sysMode == 5) {
            val c = rscpRaw.toIntOrNull() ?: 0
            return when {
                c in 31..96 -> 4
                c in 27..30 -> 3
                c in 22..26 -> 2
                c in 1..21 -> 1
                else -> 0
            }
        }
        if (sysMode == 17) {
            val r = rsrpRaw.toIntOrNull() ?: 0
            return when {
                r in 55..97 -> 4
                r in 43..54 -> 3
                r in 34..42 -> 2
                r in 1..33 -> 1
                else -> 0
            }
        }
        return 0
    }
}
```

- [ ] **Step 4: 运行测试**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests "com.sunzehui.wifimanage.protocol.XmlTest"`
Expected: 5 个测试全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add android/app/src/main/kotlin/com/sunzehui/wifimanage/protocol/Xml.kt \
  android/app/src/test/kotlin/com/sunzehui/wifimanage/protocol/XmlTest.kt
git commit -m "协议: XML 节点解析与设备文本工具"
```

---

### Task 4: 读侧模型、映射器、展示文案与通知载荷

**Files:**
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/protocol/Models.kt`
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/protocol/Mappers.kt`
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/protocol/Display.kt`
- Create: `android/app/src/test/kotlin/com/sunzehui/wifimanage/protocol/MappersTest.kt`
- Create: `android/app/src/test/kotlin/com/sunzehui/wifimanage/protocol/DisplayTest.kt`

**Interfaces:**
- Consumes: `Xml`, `XmlNode`
- Produces:
  - 数据类 `DeviceStatus / DeviceInfo / NetworkInfo / BatteryInfo / RateInfo / WifiSummary / LanInfo / Traffic / Devices / Client / SimInfo / SimSlot / BandInfo / Band / WlanBasic / WlanSecurity / RemoteTraffic / RemotePackage / NotifyPayload`
  - `StatusMapper.build(xml: String): DeviceStatus`
  - `TrafficMapper.build(statsXml: String, statusXml: String?): Traffic`
  - `DevicesMapper.build(xml: String): Devices`
  - `SimMapper.build(esimXml: String, deviceinfoXml: String?): SimInfo`
  - `BandMapper.build(xml: String): BandInfo`
  - `WlanMapper.basic(xml: String): WlanBasic`、`WlanMapper.security(xml: String): WlanSecurity`
  - `Display.netLabel(mode: String): String`、`Display.signalLabel(rsrpDbm: Int?): String`、`Display.fmtRate(bps: Long): String`、`Display.fmtBytes(bytes: Long?): String`
  - `NotifyPayloads.normal(status: DeviceStatus, ts: Long): NotifyPayload`、`NotifyPayloads.degraded(error: DeviceError, ts: Long): NotifyPayload`

- [ ] **Step 1: 写失败测试（状态与其余读侧）**

```kotlin
package com.sunzehui.wifimanage.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MappersTest {
    private val statusXml = """<?xml version="1.0" encoding="US-ASCII"?>
    <RGW><wan>
      <wan_conn_status>connected</wan_conn_status><network_name>CMCC</network_name>
      <sys_mode>17</sys_mode><sys_submode>17</sys_submode>
      <rsrp>55</rsrp><rsrq>10</rsrq><rssi>40</rssi><sinr>20</sinr><pci>123</pci><cellid>456</cellid>
      <Battery_connect>1</Battery_connect><Battery_charging>1</Battery_charging>
      <Battery_charge>1</Battery_charge><Battery_voltage>80</Battery_voltage>
      <tx_rate>2048</tx_rate><rx_rate>1048576</rx_rate>
      <SN>SN123</SN><IMEI>IMEI123</IMEI><ICCID>ICCID123</ICCID>
      <cellular><roaming>0</roaming>
        <pdp_context_list><Item><default>1</default><ipv4>10.0.0.2</ipv4>
          <v4gateway>10.0.0.1</v4gateway><v4dns1>8.8.8.8</v4dns1><v4dns2>1.1.1.1</v4dns2>
          <curconntime>3661</curconntime><totalconntime>7200</totalconntime></Item></pdp_context_list>
        <pdp_auto_list><Item><apn>cmnet</apn></Item></pdp_auto_list>
      </cellular>
    </wan>
    <wlan_settings><wlan_enable>1</wlan_enable><channel>0</channel></wlan_settings>
    <wlan_security><ssid>004D006900460069</ssid><mode>WPA2-PSK</mode></wlan_security>
    <lan><ip>192.168.1.1</ip><mac>AA:BB:CC:DD:EE:FF</mac>
      <run_days>1</run_days><run_hours>2</run_hours><run_minutes>3</run_minutes><run_seconds>4</run_seconds></lan>
    <device_management><nr_connected_dev>3</nr_connected_dev></device_management>
    <sysinfo><model_name>MF518</model_name><version_num>1.0.1</version_num></sysinfo>
    </RGW>"""

    @Test fun mapsStatus() {
        val s = StatusMapper.build(statusXml)
        assertEquals("MF518", s.device.model)
        assertEquals("connected", s.network.status)
        assertEquals("LTE", s.network.mode)
        assertEquals(4, s.network.signalBars)
        assertEquals(-85, s.network.rsrpDbm)
        assertEquals(-14.5, s.network.rsrqDb!!, 0.001)
        assertEquals(-70, s.network.rssiDbm)
        assertEquals("1时1分1秒", s.network.curConnTime)
        assertEquals("2时0分0秒", s.network.totalConnTime)
        assertEquals("10.0.0.2", s.network.ipv4)
        assertEquals(listOf("8.8.8.8", "1.1.1.1"), s.network.dns)
        assertEquals("cmnet", s.network.apn)
        assertEquals(80, s.battery.percent)
        assertTrue(s.battery.charging)
        assertEquals("充电中", s.battery.state)
        assertEquals(1048576L, s.rate.rxRate)
        assertEquals("MiFi", s.wifi.ssid)
        assertEquals("自动", s.wifi.channel)
        assertEquals("1天 2时3分4秒", s.lan.uptime)
        assertEquals(3, s.lan.connectedCount)
    }

    @Test fun mapsTrafficDevicesSimBandWlan() {
        val stats = """<RGW><statistics><WanStatistics>
            <total_used_month>1048576</total_used_month>
            <total_used_unlimit>2097152</total_used_unlimit>
            <total_available_month>1073741824</total_available_month>
            </WanStatistics></statistics></RGW>"""
        val traffic = TrafficMapper.build(stats, statusXml)
        assertEquals(1048576L, traffic.monthUsedBytes)
        assertEquals(1073741824L, traffic.quotaBytes)
        assertEquals("1时1分1秒", traffic.curConnTime)

        val devices = """<RGW><device_management><client_list>
            <Item><name>phone</name><mac>AA</mac><ip_address>NA</ip_address><status>1</status>
              <rx_data_used>100</rx_data_used><tx_data_used>20</tx_data_used>
              <rx_data_used_monthly>300</rx_data_used_monthly><tx_data_used_monthly>40</tx_data_used_monthly>
              <conn_time_at>2026-10-31 10:00</conn_time_at></Item>
            <Item><name>pc</name><mac>BB</mac><ip_address>192.168.1.9</ip_address><status>0</status>
              <rx_data_used>500</rx_data_used><tx_data_used>10</tx_data_used></Item>
            </client_list></device_management></RGW>"""
        val d = DevicesMapper.build(devices)
        assertEquals(1, d.onlineCount)
        assertEquals(2, d.total)
        assertEquals("phone", d.clients[0].name)
        assertEquals("--", d.clients[0].ip)
        assertTrue(d.clients[0].connected)
        assertEquals("pc", d.clients[1].name)

        val sim = SimMapper.build("""<RGW><esim><simid>1</simid></esim></RGW>""", """<RGW><sysinfo><simmuxpwd>1</simmuxpwd></sysinfo></RGW>""")
        assertEquals(1, sim.current)
        assertTrue(sim.pwdRequired)
        assertEquals(listOf("卡1", "卡2", "卡3"), sim.slots.map { it.label })

        val band = BandMapper.build("""<RGW><customconfig>
            <band_factory>0,0,0,00000003,00000001,0,0,0,00000001</band_factory>
            <ltebandh>00000001</ltebandh><ltebandl>00000001</ltebandl><ltebandext>0</ltebandext>
            <band_current>1</band_current><act_current>7</act_current></customconfig></RGW>""")
        assertTrue(band.bands.any { it.band == 1 && it.enabled })
        assertTrue(band.bands.any { it.band == 33 && it.enabled })
        assertEquals("FDD B1", band.current)

        val basic = WlanMapper.basic("""<RGW><wlan_settings><wifi_sleep_time>30</wifi_sleep_time></wlan_settings></RGW>""")
        assertEquals(30, basic.autoOff.minutes)
        assertEquals(true, basic.autoOff.enabled)

        val sec = WlanMapper.security("""<RGW><wlan_security><ssid>004D006900460069</ssid>
            <mode>WPA2-PSK</mode><WPA2-PSK><key>secret123</key></WPA2-PSK></wlan_security></RGW>""")
        assertEquals("MiFi", sec.ssid)
        assertEquals("WPA2-PSK", sec.mode)
        assertEquals("secret123", sec.key)
    }
}
```

`DisplayTest.kt`：

```kotlin
package com.sunzehui.wifimanage.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DisplayTest {
    @Test fun mapsModeLabels() {
        assertEquals("4G LTE", Display.netLabel("LTE"))
        assertEquals("4G LTE", Display.netLabel("17"))
        assertEquals("5G", Display.netLabel("41"))
        assertEquals("--", Display.netLabel(""))
    }

    @Test fun mapsSignalLabels() {
        assertEquals("信号极好", Display.signalLabel(-80))
        assertEquals("信号良好", Display.signalLabel(-90))
        assertEquals("信号一般", Display.signalLabel(-100))
        assertEquals("信号较差", Display.signalLabel(-110))
        assertEquals("信号未知", Display.signalLabel(null))
    }

    @Test fun formatsRatesAndBytes() {
        assertEquals("2.00 MB/s", Display.fmtRate(2L * 1024 * 1024))
        assertEquals("1.0 KB/s", Display.fmtRate(1024))
        assertEquals("512 B/s", Display.fmtRate(512))
        assertEquals("1.00 GB", Display.fmtBytes(1L shl 30))
        assertEquals("--", Display.fmtBytes(null))
    }

    @Test fun buildsNotifyPayloads() {
        val status = DeviceStatus(
            time = "t",
            device = DeviceInfo("M", "F", "", "", ""),
            network = NetworkInfo(
                status = "connected", operator = "CMCC", roaming = false, mode = "LTE",
                signalBars = 4, rsrpDbm = -85, rsrqDb = null, rssiDbm = null, sinr = null,
                pci = null, cellId = "", ipv4 = "", gateway = "", dns = listOf(),
                apn = "", curConnTime = "1分", totalConnTime = "2分",
            ),
            battery = BatteryInfo(true, 80, false, "未充电"),
            rate = RateInfo(2048, 1048576),
            wifi = WifiSummary(true, "MiFi", "WPA2-PSK", "自动"),
            lan = LanInfo("192.168.1.1", "mac", "uptime", 3),
        )
        val p = NotifyPayloads.normal(status, 123L)
        assertEquals("4G LTE · 已连接", p.title)
        assertEquals("↓ 1.00 MB/s ↑ 2.0 KB/s", p.line1)
        assertEquals("3 台在线 · 信号极好 · 80% 未充电", p.line2)
        assertEquals(123L, p.ts)

        val bad = NotifyPayloads.degraded(DeviceError.Unreachable, 99L)
        assertEquals("⚠ 随身WiFi · 状态读取失败", bad.title)
        assertEquals("99", bad.ts.toString().takeLast(2))
        assertTrue(bad.bad)
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests "com.sunzehui.wifimanage.protocol.MappersTest" --tests "com.sunzehui.wifimanage.protocol.DisplayTest"`
Expected: 编译失败。

- [ ] **Step 3: 实现 Models.kt**

```kotlin
package com.sunzehui.wifimanage.protocol

data class DeviceInfo(val model: String, val firmware: String, val sn: String, val imei: String, val iccid: String)
data class NetworkInfo(
    val status: String, val operator: String, val roaming: Boolean, val mode: String,
    val signalBars: Int, val rsrpDbm: Int?, val rsrqDb: Double?, val rssiDbm: Int?,
    val sinr: Int?, val pci: Int?, val cellId: String, val ipv4: String, val gateway: String,
    val dns: List<String>, val apn: String, val curConnTime: String, val totalConnTime: String,
)
data class BatteryInfo(val present: Boolean, val percent: Int?, val charging: Boolean, val state: String)
data class RateInfo(val txRate: Long, val rxRate: Long)
data class WifiSummary(val enabled: Boolean, val ssid: String, val security: String, val channel: String)
data class LanInfo(val ip: String, val mac: String, val uptime: String, val connectedCount: Int)
data class DeviceStatus(
    val time: String, val device: DeviceInfo, val network: NetworkInfo,
    val battery: BatteryInfo, val rate: RateInfo, val wifi: WifiSummary, val lan: LanInfo,
)

data class Traffic(
    val monthUsedBytes: Long, val totalUsedBytes: Long, val quotaBytes: Long,
    val curConnTime: String?, val totalConnTime: String?,
)
data class Client(
    val name: String, val mac: String, val ip: String, val connected: Boolean,
    val rxBytes: Long, val txBytes: Long, val rxMonthly: Long, val txMonthly: Long, val since: String,
)
data class Devices(val onlineCount: Int, val total: Int, val clients: List<Client>)
data class SimSlot(val value: Int, val label: String)
data class SimInfo(val current: Int, val pwdRequired: Boolean, val slots: List<SimSlot>)
data class Band(val band: Int, val type: String, val enabled: Boolean)
data class BandInfo(val bands: List<Band>, val current: String?)
data class AutoOff(val minutes: Int?, val enabled: Boolean?)
data class WlanBasic(val autoOff: AutoOff)
data class WlanSecurity(val ssid: String, val mode: String, val key: String)

data class NotifyPayload(val title: String, val line1: String, val line2: String, val ts: Long, val bad: Boolean)

sealed class DeviceError(val userMessage: String) {
    object Unreachable : DeviceError("无法连接设备，请确认手机已连接到随身 WiFi")
    object BadPassword : DeviceError("设备拒绝登录: 账号或密码不正确，请到设置确认设备后台密码")
    object Kicked : DeviceError("设备把本机会话踢出了(同一台设备同一时间只允许一个管理会话，多半是网页版也在访问)")
    object Locked : DeviceError("设备登录已锁定(失败次数过多)，请稍后重试或重启随身 WiFi")
    data class Unexpected(val detail: String) : DeviceError("无法获取设备数据($detail)")
    object NotConfigured : DeviceError("未配置设备密码: 打开设置填写设备后台密码")
}

class DeviceException(
    val kind: DeviceError,
    message: String = kind.userMessage,
    val retrySec: Int? = null,
) : Exception(message)
```

- [ ] **Step 4: 实现 Mappers.kt**

```kotlin
package com.sunzehui.wifimanage.protocol

import java.time.Instant

object StatusMapper {
    private val NET_MODES = mapOf(
        2 to "GPRS", 3 to "EDGE", 5 to "HSDPA", 6 to "HSUPA",
        7 to "HSPA", 15 to "TD-SCDMA", 17 to "LTE",
    )

    fun build(xml: String): DeviceStatus {
        val x = Xml.parse(xml)
        val w = x.child("wan")
        val cell = w?.child("cellular")
        val items = cell?.child("pdp_context_list")?.items("Item").orEmpty()
        val pdp = items.firstOrNull { Xml.txt(it, "default") == "1" } ?: items.firstOrNull()
        val apnItem = cell?.child("pdp_auto_list")?.items("Item")?.firstOrNull()
        val sysMode = Xml.txt(w, "sys_mode").toIntOrNull() ?: 0
        val rsrpRaw = Xml.txt(w, "rsrp").toIntOrNull()
        val rsrqRaw = Xml.txt(w, "rsrq").toIntOrNull()
        val rssiRaw = Xml.txt(w, "rssi").toIntOrNull()
        val charging = Xml.txt(w, "Battery_charging") == "1"
        val batteryState = when {
            Xml.txt(w, "Battery_connect") != "1" -> "无电池"
            !charging -> "未充电"
            Xml.txt(w, "Battery_charge") == "2" -> "已充满"
            Xml.txt(w, "Battery_charge") == "1" -> "充电中"
            else -> "已插电"
        }
        val dns = listOf(Xml.txt(pdp, "v4dns1"), Xml.txt(pdp, "v4dns2")).filter { it.isNotEmpty() }
        return DeviceStatus(
            time = Instant.now().toString(),
            device = DeviceInfo(
                model = Xml.txt(x.child("sysinfo"), "model_name", "MiFi"),
                firmware = Xml.txt(x.child("sysinfo"), "version_num"),
                sn = Xml.txt(w, "SN"), imei = Xml.txt(w, "IMEI"), iccid = Xml.txt(w, "ICCID"),
            ),
            network = NetworkInfo(
                status = Xml.txt(w, "wan_conn_status", "--"),
                operator = Xml.txt(w, "network_name", Xml.txt(w, "ISP_name", "--")),
                roaming = Xml.txt(cell, "roaming") == "1",
                mode = Xml.txt(w, "sys_submode").toIntOrNull()?.let { NET_MODES[it] }
                    ?: NET_MODES[sysMode] ?: "--",
                signalBars = Xml.signalBars(sysMode, Xml.txt(w, "rsrp"), Xml.txt(w, "rscp")),
                rsrpDbm = rsrpRaw?.takeIf { it in 0..97 }?.let { -140 + it },
                rsrqDb = rsrqRaw?.takeIf { it in 0..34 }?.let { Math.round((-19.5 + it / 2.0) * 10) / 10.0 },
                rssiDbm = rssiRaw?.takeIf { it in 0..63 }?.let { -110 + it },
                sinr = Xml.txt(w, "sinr").toIntOrNull(),
                pci = Xml.txt(w, "pci").toIntOrNull(),
                cellId = Xml.txt(w, "cellid"),
                ipv4 = Xml.txt(pdp, "ipv4"),
                gateway = Xml.txt(pdp, "v4gateway"),
                dns = dns,
                apn = Xml.txt(apnItem, "apn"),
                curConnTime = Xml.sec2hms(Xml.txt(pdp, "curconntime")),
                totalConnTime = Xml.sec2hms(Xml.txt(pdp, "totalconntime")),
            ),
            battery = BatteryInfo(
                present = Xml.txt(w, "Battery_connect") == "1",
                percent = Xml.txt(w, "Battery_voltage").toIntOrNull()
                    .takeIf { Xml.txt(w, "Battery_connect") == "1" },
                charging = charging,
                state = batteryState,
            ),
            rate = RateInfo(
                txRate = Xml.txt(w, "tx_rate").toLongOrNull() ?: 0,
                rxRate = Xml.txt(w, "rx_rate").toLongOrNull() ?: 0,
            ),
            wifi = WifiSummary(
                enabled = Xml.txt(x.child("wlan_settings"), "wlan_enable") == "1",
                ssid = Xml.uniDecode(Xml.txt(x.child("wlan_security"), "ssid")),
                security = Xml.txt(x.child("wlan_security"), "mode"),
                channel = Xml.txt(x.child("wlan_settings"), "channel").let { if (it == "0") "自动" else it },
            ),
            lan = LanInfo(
                ip = Xml.txt(x.child("lan"), "ip"),
                mac = Xml.txt(x.child("lan"), "mac"),
                uptime = buildString {
                    val days = Xml.txt(x.child("lan"), "run_days")
                    if (days.isNotEmpty()) append(days).append("天 ")
                    append(Xml.txt(x.child("lan"), "run_hours").ifEmpty { "0" }).append("时")
                    append(Xml.txt(x.child("lan"), "run_minutes").ifEmpty { "0" }).append("分")
                    append(Xml.txt(x.child("lan"), "run_seconds").ifEmpty { "0" }).append("秒")
                },
                connectedCount = Xml.txt(x.child("device_management"), "nr_connected_dev").toIntOrNull() ?: 0,
            ),
        )
    }
}

object TrafficMapper {
    fun build(statsXml: String, statusXml: String?): Traffic {
        val x = Xml.parse(statsXml)
        val ws = x.child("statistics")?.child("WanStatistics")
        val cur = statusXml?.let { Xml.parse(it) }
        val pdp = cur?.child("wan")?.child("cellular")?.child("pdp_context_list")?.items("Item")?.firstOrNull()
        return Traffic(
            monthUsedBytes = Xml.txt(ws, "total_used_month").toLongOrNull() ?: 0,
            totalUsedBytes = Xml.txt(ws, "total_used_unlimit").toLongOrNull() ?: 0,
            quotaBytes = Xml.txt(ws, "total_available_month").toLongOrNull() ?: 0,
            curConnTime = pdp?.let { Xml.sec2hms(Xml.txt(it, "curconntime")) },
            totalConnTime = pdp?.let { Xml.sec2hms(Xml.txt(it, "totalconntime")) },
        )
    }
}

object DevicesMapper {
    fun build(xml: String): Devices {
        val list = Xml.parse(xml).child("device_management")?.child("client_list")?.items("Item").orEmpty()
        val clients = list.map { c ->
            Client(
                name = Xml.txt(c, "name"), mac = Xml.txt(c, "mac"),
                ip = Xml.txt(c, "ip_address").let { if (it == "NA") "--" else it },
                connected = Xml.txt(c, "status") == "1",
                rxBytes = Xml.txt(c, "rx_data_used").toLongOrNull() ?: 0,
                txBytes = Xml.txt(c, "tx_data_used").toLongOrNull() ?: 0,
                rxMonthly = Xml.txt(c, "rx_data_used_monthly").toLongOrNull() ?: 0,
                txMonthly = Xml.txt(c, "tx_data_used_monthly").toLongOrNull() ?: 0,
                since = Xml.txt(c, "conn_time_at"),
            )
        }.sortedWith(compareByDescending<Client> { it.connected }.thenByDescending { it.rxBytes })
        return Devices(clients.count { it.connected }, clients.size, clients)
    }
}

object SimMapper {
    fun build(esimXml: String, deviceinfoXml: String?): SimInfo {
        val e = Xml.parse(esimXml)
        val d = deviceinfoXml?.let { Xml.parse(it) } ?: XmlNode()
        return SimInfo(
            current = Xml.txt(e.child("esim"), "simid", "-1").toIntOrNull() ?: -1,
            pwdRequired = Xml.txt(d.child("sysinfo"), "simmuxpwd", "0") == "1",
            slots = listOf(SimSlot(0, "卡1"), SimSlot(1, "卡2"), SimSlot(2, "卡3")),
        )
    }
}

object BandMapper {
    fun build(xml: String): BandInfo {
        val cc = Xml.parse(xml).child("customconfig")
        val parts = Xml.txt(cc, "band_factory").split(",")
        fun part(i: Int) = parts.getOrNull(i)?.toIntOrNull() ?: 0
        val supH = part(3); val supL = part(4); val supE = part(8)
        val setH = Xml.txt(cc, "ltebandh").toIntOrNull() ?: 0
        val setL = Xml.txt(cc, "ltebandl").toIntOrNull() ?: 0
        val setE = Xml.txt(cc, "ltebandext").toIntOrNull() ?: 0
        val bands = mutableListOf<Band>()
        for (i in 0 until 32) {
            if (supL and (1 shl i) != 0) bands += Band(1 + i, "FDD", setL and (1 shl i) != 0)
            if (supH and (1 shl i) != 0) bands += Band(33 + i, "TDD", setH and (1 shl i) != 0)
            if (supE and (1 shl i) != 0) bands += Band(65 + i, "FDD", setE and (1 shl i) != 0)
        }
        return BandInfo(bands.sortedBy { it.band }, current(cc))
    }

    private fun current(cc: XmlNode?): String? {
        val cur = Xml.txt(cc, "band_current").toIntOrNull() ?: 0
        val act = Xml.txt(cc, "act_current").toIntOrNull() ?: 0
        if (act == 7 && cur > 0) return (if (cur in 33..64) "TDD" else "FDD") + " B" + cur
        if (act in listOf(2, 4, 5, 6, 8) && cur > 1) return "UMTS B" + (cur - 1)
        return null
    }
}

object WlanMapper {
    fun basic(xml: String): WlanBasic {
        val ws = Xml.parse(xml).child("wlan_settings")
        val raw = Xml.txt(ws, "wifi_sleep_time")
        val n = raw.toIntOrNull()
        return WlanBasic(AutoOff(n, n?.let { it > 0 }))
    }

    fun security(xml: String): WlanSecurity {
        val ws = Xml.parse(xml).child("wlan_security")
        val mode = Xml.txt(ws, "mode")
        return WlanSecurity(
            ssid = Xml.uniDecode(Xml.txt(ws, "ssid")),
            mode = mode,
            key = if (mode.isNotEmpty()) Xml.txt(ws?.child(mode), "key") else "",
        )
    }
}
```

- [ ] **Step 5: 实现 Display.kt**

```kotlin
package com.sunzehui.wifimanage.protocol

object Display {
    fun netLabel(mode: String): String = when (mode) {
        "LTE", "17" -> "4G LTE"
        "41", "45" -> "5G"
        "" -> "--"
        else -> mode
    }

    fun signalLabel(rsrpDbm: Int?): String = when {
        rsrpDbm == null -> "信号未知"
        rsrpDbm >= -85 -> "信号极好"
        rsrpDbm >= -95 -> "信号良好"
        rsrpDbm >= -105 -> "信号一般"
        else -> "信号较差"
    }

    fun fmtRate(bps: Long): String = when {
        bps >= 1L shl 20 -> String.format("%.2f MB/s", bps / (1L shl 20).toDouble())
        bps >= 1024 -> String.format("%.1f KB/s", bps / 1024.0)
        else -> "$bps B/s"
    }

    fun fmtBytes(bytes: Long?): String {
        if (bytes == null) return "--"
        return when {
            bytes >= 1L shl 30 -> String.format("%.2f GB", bytes / (1L shl 30).toDouble())
            bytes >= 1L shl 20 -> String.format("%.1f MB", bytes / (1L shl 20).toDouble())
            bytes >= 1024 -> String.format("%.1f KB", bytes / 1024.0)
            else -> "$bytes B"
        }
    }
}

object NotifyPayloads {
    fun normal(s: DeviceStatus, ts: Long): NotifyPayload {
        val connected = s.network.status == "connected"
        val batt = s.battery.percent?.let { "$it% ${s.battery.state}" } ?: s.battery.state
        return NotifyPayload(
            title = "${Display.netLabel(s.network.mode)} · ${if (connected) "已连接" else "未联网"}",
            line1 = "↓ ${Display.fmtRate(s.rate.rxRate)} ↑ ${Display.fmtRate(s.rate.txRate)}",
            line2 = "${s.lan.connectedCount} 台在线 · ${Display.signalLabel(s.network.rsrpDbm)} · $batt",
            ts = ts,
            bad = false,
        )
    }

    fun degraded(error: DeviceError, ts: Long): NotifyPayload = NotifyPayload(
        title = "⚠ 随身WiFi · 状态读取失败",
        line1 = error.userMessage,
        line2 = "打开 App 可重试",
        ts = ts,
        bad = true,
    )
}
```

- [ ] **Step 6: 运行测试**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests "com.sunzehui.wifimanage.protocol.MappersTest" --tests "com.sunzehui.wifimanage.protocol.DisplayTest"`
Expected: 6 个测试全部 PASS（`MappersTest` 2 个、`DisplayTest` 4 个）。

- [ ] **Step 7: 提交**

```bash
git add android/app/src/main/kotlin/com/sunzehui/wifimanage/protocol/Models.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/protocol/Mappers.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/protocol/Display.kt \
  android/app/src/test/kotlin/com/sunzehui/wifimanage/protocol/MappersTest.kt \
  android/app/src/test/kotlin/com/sunzehui/wifimanage/protocol/DisplayTest.kt
git commit -m "协议: 读侧模型、映射器与通知文案"
```

---

### Task 5: 写操作 XML 构建与整机动作

**Files:**
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/protocol/SettingsXml.kt`
- Test: `android/app/src/test/kotlin/com/sunzehui/wifimanage/protocol/SettingsXmlTest.kt`

**Interfaces:**
- Consumes: `Xml.uniEncode`、`Xml.xmlEsc`
- Produces:
  - `data class SetCommand(val file: String, val xml: String)`
  - `data class DeviceAction(val file: String, val label: String)`
  - `SettingsXml.security(ssid: String, mode: String, password: String): SetCommand`
  - `SettingsXml.autoOff(minutes: Int): SetCommand`
  - `SettingsXml.sim(slot: Int, pw: String): SetCommand`
  - `SettingsXml.band(bands: List<Int>): SetCommand`
  - `SettingsXml.quota(bytes: Long): SetCommand`
  - `SettingsXml.deviceAction(kind: String): DeviceAction`（`reboot` / `poweroff`）

- [ ] **Step 1: 写失败测试**

```kotlin
package com.sunzehui.wifimanage.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SettingsXmlTest {
    private val decl = "<?xml version=\"1.0\" encoding=\"US-ASCII\"?> "

    @Test fun securityWritesSsidModeAndKey() {
        val c = SettingsXml.security("MiFi", "WPA2-PSK", "secret123")
        assertEquals("uapxb_wlan_security_settings", c.file)
        assertEquals(
            decl + "<RGW><wlan_security><ssid>004D006900460069</ssid><mode>WPA2-PSK</mode><WPA2-PSK><key>secret123</key></WPA2-PSK></wlan_security></RGW>",
            c.xml,
        )
    }

    @Test fun autoOffIncludesActionFlag() {
        val c = SettingsXml.autoOff(20)
        assertEquals("uapxb_wlan_basic_settings", c.file)
        assertTrue(c.xml.contains("<wifi_sleep_time>20</wifi_sleep_time>"))
        assertTrue(c.xml.contains("<wifi_sleep_action>1</wifi_sleep_action>"))
        assertTrue(SettingsXml.autoOff(0).xml.contains("<wifi_sleep_time>0</wifi_sleep_time>"))
    }

    @Test fun simIncludesPasswordOnlyWhenPresent() {
        assertTrue(SettingsXml.sim(1, "").xml.contains("<simmode>1</simmode>"))
        assertFalse(SettingsXml.sim(1, "").xml.contains("<pw>"))
        assertTrue(SettingsXml.sim(2, "a&b").xml.contains("<pw>a&amp;b</pw>"))
    }

    @Test fun bandSetsBitmasks() {
        val c = SettingsXml.band(listOf(1, 3, 33, 65))
        assertTrue(c.xml.contains("<ltebandl>5</ltebandl>"))
        assertTrue(c.xml.contains("<ltebandh>1</ltebandh>"))
        assertTrue(c.xml.contains("<ltebandext>1</ltebandext>"))
    }

    @Test fun quotaUsesTotalAvailableMonth() {
        val c = SettingsXml.quota(1073741824L)
        assertEquals("statistics", c.file)
        assertTrue(c.xml.contains("<total_available_month>1073741824</total_available_month>"))
    }

    @Test fun deviceActionsAreGetFilesAndRejectUnknown() {
        assertEquals("reset", SettingsXml.deviceAction("reboot").file)
        assertEquals("power_off", SettingsXml.deviceAction("poweroff").file)
        try {
            SettingsXml.deviceAction("shutdown")
            throw AssertionError("应当拒绝未知动作")
        } catch (e: IllegalArgumentException) {
            assertEquals("不支持的操作", e.message)
        }
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests "com.sunzehui.wifimanage.protocol.SettingsXmlTest"`
Expected: 编译失败。

- [ ] **Step 3: 实现 SettingsXml.kt**

```kotlin
package com.sunzehui.wifimanage.protocol

data class SetCommand(val file: String, val xml: String)
data class DeviceAction(val file: String, val label: String)

object SettingsXml {
    private const val DECL = "<?xml version=\"1.0\" encoding=\"US-ASCII\"?> "
    private val ACTIONS = mapOf(
        "reboot" to DeviceAction("reset", "重启设备"),
        "poweroff" to DeviceAction("power_off", "关闭设备"),
    )

    fun security(ssid: String, mode: String, password: String): SetCommand {
        require(ssid.isNotEmpty()) { "security 需要 ssid" }
        val parts = StringBuilder("<ssid>${Xml.uniEncode(ssid)}</ssid>")
        if (mode.isNotEmpty() && password.isNotEmpty()) {
            parts.append("<mode>$mode</mode><$mode><key>${Xml.xmlEsc(password)}</key></$mode>")
        }
        return SetCommand(
            "uapxb_wlan_security_settings",
            DECL + "<RGW><wlan_security>$parts</wlan_security></RGW>",
        )
    }

    fun autoOff(minutes: Int): SetCommand = SetCommand(
        "uapxb_wlan_basic_settings",
        DECL + "<RGW><wlan_settings><wifi_sleep_time>$minutes</wifi_sleep_time>" +
            "<wifi_sleep_action>1</wifi_sleep_action></wlan_settings></RGW>",
    )

    fun sim(slot: Int, pw: String): SetCommand = SetCommand(
        "esim",
        DECL + "<RGW><esim><simmode>$slot</simmode>" +
            (if (pw.isNotEmpty()) "<pw>${Xml.xmlEsc(pw)}</pw>" else "") +
            "</esim></RGW>",
    )

    fun band(bands: List<Int>): SetCommand {
        var h = 0; var l = 0; var e = 0
        for (b in bands) {
            when {
                b <= 32 -> l = l or (1 shl (b - 1))
                b <= 64 -> h = h or (1 shl (b - 33))
                else -> e = e or (1 shl (b - 65))
            }
        }
        return SetCommand(
            "customconfig",
            DECL + "<RGW><customconfig><ltebandh>$h</ltebandh><ltebandl>$l</ltebandl>" +
                "<ltebandext>$e</ltebandext></customconfig></RGW>",
        )
    }

    fun quota(bytes: Long): SetCommand = SetCommand(
        "statistics",
        DECL + "<RGW><statistics><WanStatistics><total_available_month>$bytes</total_available_month>" +
            "</WanStatistics></statistics></RGW>",
    )

    fun deviceAction(kind: String): DeviceAction =
        ACTIONS[kind] ?: throw IllegalArgumentException("不支持的操作")
}
```

- [ ] **Step 4: 运行测试**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests "com.sunzehui.wifimanage.protocol.SettingsXmlTest"`
Expected: 6 个测试全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add android/app/src/main/kotlin/com/sunzehui/wifimanage/protocol/SettingsXml.kt \
  android/app/src/test/kotlin/com/sunzehui/wifimanage/protocol/SettingsXmlTest.kt
git commit -m "协议: 写操作 XML 与整机动作"
```

---

### Task 6: 发卡平台 JSON 映射

**Files:**
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/protocol/Json.kt`
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/protocol/MgxMapper.kt`
- Test: `android/app/src/test/kotlin/com/sunzehui/wifimanage/protocol/MgxMapperTest.kt`

**Interfaces:**
- Consumes: 无
- Produces:
  - `MifiJson`（`Json { ignoreUnknownKeys = true }`）
  - `LooseJson.parse(text: String): JsonObject?`
  - `MgxMapper.build(info: JsonObject, card: String): RemoteTraffic`
  - `@Serializable data class RemoteTraffic(...)`、`RemotePackage(name, sizeGB)`

- [ ] **Step 1: 写失败测试**

```kotlin
package com.sunzehui.wifimanage.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MgxMapperTest {
    @Test fun parsesLeadingWhitespaceAndBuildsTraffic() {
        val text = "\n\n  {\"code\":\"0\",\"entity\":{\"flowSize\":\"2048\",\"totalBytesCnt\":\"512\"," +
            "\"cardPackage\":\"包月\",\"statusStr\":\"正常\",\"expireDate\":\"2026-12-31\"}," +
            "\"cardLiftList\":[{\"mealName\":\"套餐A\",\"flowSize\":\"1024\"}," +
            "{\"mealName\":\"套餐B\",\"flowSize\":\"1024\"}]}"
        val obj = LooseJson.parse(text)!!
        val t = MgxMapper.build(obj, "CARD1")
        assertEquals("CARD1", t.card)
        assertEquals("包月", t.packageName)
        assertEquals(2, t.packages.size)
        assertEquals(1.0, t.packages[0].sizeGB, 0.001)
        assertEquals(2048L * 1048576, t.totalBytes)
        assertEquals(512L * 1048576, t.usedBytes)
        assertEquals(1536L * 1048576, t.leftBytes)
        assertTrue(!t.unlimited)
        assertNull(LooseJson.parse("no json here"))
    }

    @Test fun unlimitedWhenNoPackage() {
        val t = MgxMapper.build(LooseJson.parse("""{"entity":{"flowSize":"0","totalBytesCnt":"0"}}""")!!, "C2")
        assertTrue(t.unlimited)
        assertEquals(0L, t.totalBytes)
        assertEquals(0L, t.leftBytes)
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests "com.sunzehui.wifimanage.protocol.MgxMapperTest"`
Expected: 编译失败。

- [ ] **Step 3: 实现 Json.kt 与 MgxMapper.kt**

`Json.kt`：

```kotlin
package com.sunzehui.wifimanage.protocol

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

val MifiJson = Json { ignoreUnknownKeys = true }

object LooseJson {
    fun parse(text: String): JsonObject? {
        val i = text.indexOf('{')
        if (i < 0) return null
        return try {
            MifiJson.parseToJsonElement(text.substring(i)) as? JsonObject
        } catch (e: Exception) {
            null
        }
    }
}
```

`MgxMapper.kt`：

```kotlin
package com.sunzehui.wifimanage.protocol

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive

@Serializable data class RemotePackage(val name: String, val sizeGB: Double)
@Serializable data class RemoteTraffic(
    val card: String,
    val packageName: String,
    val status: String,
    val expireDate: String,
    val totalBytes: Long,
    val usedBytes: Long,
    val leftBytes: Long,
    val unlimited: Boolean,
    val packages: List<RemotePackage>,
    val cached: Boolean = false,
)

object MgxMapper {
    fun build(info: JsonObject, card: String): RemoteTraffic {
        val entity = info["entity"] as? JsonObject
        val lives = info["cardLiftList"] as? JsonArray
        fun str(key: String): String = entity?.get(key)?.jsonPrimitive?.contentOrNull ?: ""
        fun num(key: String): Double = entity?.get(key)?.jsonPrimitive?.doubleOrNull ?: 0.0

        var totalMb = num("flowSize")
        val packages = mutableListOf<RemotePackage>()
        if (lives != null && lives.isNotEmpty()) {
            totalMb = 0.0
            for (life in lives) {
                val o = life as? JsonObject ?: continue
                val size = o["flowSize"]?.jsonPrimitive?.doubleOrNull ?: 0.0
                totalMb += size
                packages += RemotePackage(
                    name = o["mealName"]?.jsonPrimitive?.contentOrNull ?: "套餐",
                    sizeGB = Math.round(size / 1024 * 100) / 100.0,
                )
            }
        }
        val usedMb = num("totalBytesCnt")
        fun mbToBytes(mb: Double) = Math.round(mb * 1048576.0)
        return RemoteTraffic(
            card = card,
            packageName = str("cardPackage"),
            status = str("statusStr"),
            expireDate = str("expireDate"),
            totalBytes = mbToBytes(totalMb),
            usedBytes = mbToBytes(usedMb),
            leftBytes = mbToBytes(Math.max(0.0, totalMb - usedMb)),
            unlimited = totalMb <= 0,
            packages = packages,
        )
    }
}
```

- [ ] **Step 4: 运行测试**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests "com.sunzehui.wifimanage.protocol.MgxMapperTest"`
Expected: 2 个测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add android/app/src/main/kotlin/com/sunzehui/wifimanage/protocol/Json.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/protocol/MgxMapper.kt \
  android/app/src/test/kotlin/com/sunzehui/wifimanage/protocol/MgxMapperTest.kt
git commit -m "协议: 发卡平台 JSON 与套餐流量映射"
```

---

### Task 7: TTL 缓存与 HTTP 传输

**Files:**
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/data/TtlCache.kt`
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/data/HttpTransport.kt`
- Test: `android/app/src/test/kotlin/com/sunzehui/wifimanage/data/TtlCacheTest.kt`
- Test: `android/app/src/test/kotlin/com/sunzehui/wifimanage/data/UrlConnectionTransportTest.kt`

**Interfaces:**
- Consumes: 无
- Produces:
  - `class TtlCache(clock: () -> Long = System::currentTimeMillis)`：`get(key, ttlSec): String?`、`put(key, value)`、`clear(vararg keys)`、`clearAll()`
  - `data class HttpResult(status: Int, body: String, wwwAuthenticate: String?, setCookies: List<String>)`
  - `interface HttpTransport { suspend fun get(url, headers = emptyMap(), connectTimeoutMs = 12_000, readTimeoutMs = 20_000): HttpResult; suspend fun post(url, body, headers = emptyMap(), connectTimeoutMs = 12_000, readTimeoutMs = 20_000): HttpResult }`
  - `class UrlConnectionTransport : HttpTransport`

- [ ] **Step 1: 写失败测试**

`TtlCacheTest.kt`：

```kotlin
package com.sunzehui.wifimanage.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TtlCacheTest {
    @Test fun expiresByTtl() {
        var now = 1_000L
        val c = TtlCache { now }
        c.put("status1", "<RGW/>")
        assertEquals("<RGW/>", c.get("status1", 4))
        now += 3_000
        assertEquals("<RGW/>", c.get("status1", 4))
        now += 1_001
        assertNull(c.get("status1", 4))
    }

    @Test fun clearsSelectedKeys() {
        val c = TtlCache()
        c.put("a", "1"); c.put("b", "2")
        c.clear("a")
        assertNull(c.get("a", 60)); assertEquals("2", c.get("b", 60))
        c.clearAll()
        assertNull(c.get("b", 60))
    }
}
```

`UrlConnectionTransportTest.kt`：

```kotlin
package com.sunzehui.wifimanage.data

import com.sun.net.httpserver.HttpServer
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.net.InetSocketAddress

class UrlConnectionTransportTest {
    private lateinit var server: HttpServer
    private var lastAcceptEncoding: String? = null
    private var lastConnection: String? = null

    @Before fun start() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/probe") { ex ->
            lastAcceptEncoding = ex.requestHeaders.getFirst("Accept-Encoding")
            lastConnection = ex.requestHeaders.getFirst("Connection")
            val body = "ok".toByteArray()
            ex.sendResponseHeaders(200, body.size.toLong())
            ex.responseBody.use { it.write(body) }
        }
        server.start()
    }

    @After fun stop() = server.stop(0)

    @Test fun sendsIdentityAndConnectionClose() = runBlocking {
        val port = server.address.port
        val r = UrlConnectionTransport().get("http://127.0.0.1:$port/probe")
        assertEquals(200, r.status)
        assertEquals("ok", r.body)
        assertEquals("identity", lastAcceptEncoding)
        assertEquals("close", lastConnection)
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests "com.sunzehui.wifimanage.data.TtlCacheTest" --tests "com.sunzehui.wifimanage.data.UrlConnectionTransportTest"`
Expected: 编译失败。

- [ ] **Step 3: 实现 TtlCache.kt**

```kotlin
package com.sunzehui.wifimanage.data

import java.util.concurrent.ConcurrentHashMap

class TtlCache(private val clock: () -> Long = System::currentTimeMillis) {
    private data class Entry(val value: String, val at: Long)
    private val map = ConcurrentHashMap<String, Entry>()

    fun get(key: String, ttlSec: Long): String? {
        val e = map[key] ?: return null
        return if ((clock() - e.at) / 1000.0 <= ttlSec) e.value else null
    }

    fun put(key: String, value: String) {
        map[key] = Entry(value, clock())
    }

    fun clear(vararg keys: String) {
        keys.forEach { map.remove(it) }
    }

    fun clearAll() = map.clear()
}
```

- [ ] **Step 4: 实现 HttpTransport.kt**

```kotlin
package com.sunzehui.wifimanage.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

data class HttpResult(
    val status: Int,
    val body: String,
    val wwwAuthenticate: String?,
    val setCookies: List<String>,
)

interface HttpTransport {
    suspend fun get(
        url: String,
        headers: Map<String, String> = emptyMap(),
        connectTimeoutMs: Int = 12_000,
        readTimeoutMs: Int = 20_000,
    ): HttpResult

    suspend fun post(
        url: String,
        body: String,
        headers: Map<String, String> = emptyMap(),
        connectTimeoutMs: Int = 12_000,
        readTimeoutMs: Int = 20_000,
    ): HttpResult
}

class UrlConnectionTransport : HttpTransport {
    override suspend fun get(
        url: String,
        headers: Map<String, String>,
        connectTimeoutMs: Int,
        readTimeoutMs: Int,
    ): HttpResult = request("GET", url, null, headers, connectTimeoutMs, readTimeoutMs)

    override suspend fun post(
        url: String,
        body: String,
        headers: Map<String, String>,
        connectTimeoutMs: Int,
        readTimeoutMs: Int,
    ): HttpResult = request("POST", url, body, headers, connectTimeoutMs, readTimeoutMs)

    private suspend fun request(
        method: String,
        url: String,
        body: String?,
        headers: Map<String, String>,
        connectTimeoutMs: Int,
        readTimeoutMs: Int,
    ): HttpResult = withContext(Dispatchers.IO) {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = connectTimeoutMs
            conn.readTimeout = readTimeoutMs
            conn.instanceFollowRedirects = false
            conn.setRequestProperty("Accept-Encoding", "identity")
            conn.setRequestProperty("Connection", "close")
            headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
            if (body != null) {
                conn.doOutput = true
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val status = conn.responseCode
            val stream: InputStream? = if (status >= 400) conn.errorStream else conn.inputStream
            val bytes = stream?.use { readAll(it) } ?: ByteArray(0)
            HttpResult(
                status = status,
                body = String(bytes, Charsets.UTF_8),
                wwwAuthenticate = conn.getHeaderField("WWW-Authenticate"),
                setCookies = conn.headerFields.entries
                    .firstOrNull { it.key?.equals("Set-Cookie", ignoreCase = true) == true }
                    ?.value.orEmpty(),
            )
        } finally {
            conn.disconnect()
        }
    }

    private fun readAll(input: InputStream): ByteArray {
        val out = ByteArrayOutputStream()
        val buf = ByteArray(8192)
        while (true) {
            val n = input.read(buf)
            if (n <= 0) break
            out.write(buf, 0, n)
        }
        return out.toByteArray()
    }
}
```

- [ ] **Step 5: 运行测试**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests "com.sunzehui.wifimanage.data.TtlCacheTest" --tests "com.sunzehui.wifimanage.data.UrlConnectionTransportTest"`
Expected: 3 个测试 PASS。

- [ ] **Step 6: 提交**

```bash
git add android/app/src/main/kotlin/com/sunzehui/wifimanage/data/TtlCache.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/data/HttpTransport.kt \
  android/app/src/test/kotlin/com/sunzehui/wifimanage/data/TtlCacheTest.kt \
  android/app/src/test/kotlin/com/sunzehui/wifimanage/data/UrlConnectionTransportTest.kt
git commit -m "数据: TTL 缓存与 HttpURLConnection 传输"
```

---

### Task 8: 设备会话与错误分类

**Files:**
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/data/XmlSource.kt`
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/data/DeviceClient.kt`
- Test: `android/app/src/test/kotlin/com/sunzehui/wifimanage/data/DeviceClientTest.kt`

**Interfaces:**
- Consumes: `Digest`、`DeviceCredentials`、`DigestSession`、`DeviceError`、`DeviceException`、`HttpTransport`
- Produces:
  - `interface XmlSource { suspend fun fetchXml(file: String): String; suspend fun postXml(file: String, xml: String): String; suspend fun triggerAction(file: String) }`
  - `class DeviceClient(transport, credentials: () -> DeviceCredentials?, baseUrl = "http://192.168.1.1", clock = System::currentTimeMillis) : XmlSource`

- [ ] **Step 1: 写失败测试**

```kotlin
package com.sunzehui.wifimanage.data

import com.sunzehui.wifimanage.protocol.DeviceCredentials
import com.sunzehui.wifimanage.protocol.DeviceError
import com.sunzehui.wifimanage.protocol.DeviceException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.IOException

class DeviceClientTest {
    private val challenge = """Digest realm="Highwmg", nonce="6028365", qop="auth""""

    private class FakeTransport : HttpTransport {
        val calls = mutableListOf<Pair<String, String>>()
        var script: (String, Map<String, String>) -> HttpResult = { _, _ -> HttpResult(200, "", null, emptyList()) }

        override suspend fun get(url: String, headers: Map<String, String>, connectTimeoutMs: Int, readTimeoutMs: Int): HttpResult {
            calls += "GET" to url
            return script(url, headers)
        }
        override suspend fun post(url: String, body: String, headers: Map<String, String>, connectTimeoutMs: Int, readTimeoutMs: Int): HttpResult {
            calls += "POST" to url
            return script(url, headers)
        }
    }

    private fun xmlOk(body: String = "<RGW><ok>1</ok></RGW>") = HttpResult(200, body, null, emptyList())

    @Test fun logsInThenFetches() = runBlocking {
        val t = FakeTransport()
        t.script = { url, headers ->
            when {
                url.endsWith("/login.cgi") -> HttpResult(401, "", challenge, emptyList())
                url.contains("/login.cgi?Action=Digest") -> {
                    assertTrue(headers["Authorization"]!!.startsWith("Digest "))
                    xmlOk("HTTP/1.1 200 OK")
                }
                url.contains("file=status1") -> {
                    assertTrue(headers["Authorization"]!!.contains("nc=00000001"))
                    xmlOk()
                }
                else -> error("unexpected $url")
            }
        }
        val c = DeviceClient(t, { DeviceCredentials("admin", "testpass") })
        assertEquals("<RGW><ok>1</ok></RGW>", c.fetchXml("status1"))
        assertEquals(3, t.calls.size)
    }

    @Test fun classifiesKickoffAndDoesNotRetry() = runBlocking {
        val t = FakeTransport()
        t.script = { url, _ ->
            when {
                url.endsWith("/login.cgi") -> HttpResult(401, "", challenge, emptyList())
                url.contains("/login.cgi?Action=Digest") -> xmlOk("HTTP/1.1 200 OK")
                else -> xmlOk("""<RGW><login_status>KICKOFF</login_status></RGW>""")
            }
        }
        val c = DeviceClient(t, { DeviceCredentials("admin", "testpass") })
        try {
            c.fetchXml("status1"); fail("应当抛会话被踢")
        } catch (e: DeviceException) {
            assertEquals(DeviceError.Kicked, e.kind)
        }
        assertEquals(3, t.calls.size)
    }

    @Test fun networkFailureRetriesOnceAfterRelogin() = runBlocking {
        val t = FakeTransport()
        var dataCalls = 0
        t.script = { url, _ ->
            when {
                url.endsWith("/login.cgi") -> HttpResult(401, "", challenge, emptyList())
                url.contains("/login.cgi?Action=Digest") -> xmlOk("HTTP/1.1 200 OK")
                else -> {
                    dataCalls++
                    if (dataCalls == 1) throw IOException("timeout")
                    xmlOk()
                }
            }
        }
        val c = DeviceClient(t, { DeviceCredentials("admin", "testpass") })
        assertEquals("<RGW><ok>1</ok></RGW>", c.fetchXml("status1"))
        assertEquals(2, dataCalls)
    }

    @Test fun respectsLoginBackoff() = runBlocking {
        var now = 1_000L
        val t = FakeTransport()
        t.script = { url, _ ->
            when {
                url.endsWith("/login.cgi") -> HttpResult(401, "", challenge, emptyList())
                url.contains("/login.cgi?Action=Digest") -> xmlOk("HTTP/1.1 200 OK")
                else -> xmlOk("""<RGW><login_status>LOCK</login_status></RGW>""")
            }
        }
        val c = DeviceClient(t, { DeviceCredentials("admin", "testpass") }, clock = { now })
        try { c.fetchXml("status1") } catch (e: DeviceException) { assertEquals(DeviceError.Locked, e.kind) }
        val before = t.calls.size
        now += 1_000
        try { c.fetchXml("status1"); fail("退避期内应直接失败") } catch (_: DeviceException) { }
        assertEquals(before, t.calls.size)
    }

    @Test fun resetAuthStateClearsBackoff() = runBlocking {
        var now = 1_000L
        val t = FakeTransport()
        t.script = { url, _ ->
            when {
                url.endsWith("/login.cgi") -> HttpResult(401, "", challenge, emptyList())
                url.contains("/login.cgi?Action=Digest") -> xmlOk("HTTP/1.1 200 OK")
                else -> xmlOk("""<RGW><login_status>LOCK</login_status></RGW>""")
            }
        }
        val c = DeviceClient(t, { DeviceCredentials("admin", "testpass") }, clock = { now })
        try { c.fetchXml("status1") } catch (_: DeviceException) { }
        val before = t.calls.size
        c.resetAuthState()
        try { c.fetchXml("status1") } catch (_: DeviceException) { }
        assertTrue(t.calls.size > before)
    }

    @Test fun triggerActionToleratesDisconnect() = runBlocking {
        val t = FakeTransport()
        var phase = 0
        t.script = { url, _ ->
            when {
                url.endsWith("/login.cgi") -> HttpResult(401, "", challenge, emptyList())
                url.contains("/login.cgi?Action=Digest") -> xmlOk("HTTP/1.1 200 OK")
                else -> { phase++; throw IOException("device rebooting") }
            }
        }
        val c = DeviceClient(t, { DeviceCredentials("admin", "testpass") })
        c.triggerAction("reset")
        assertEquals(1, phase)
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests "com.sunzehui.wifimanage.data.DeviceClientTest"`
Expected: 编译失败。

- [ ] **Step 3: 实现 XmlSource.kt 与 DeviceClient.kt**

```kotlin
package com.sunzehui.wifimanage.data

interface XmlSource {
    suspend fun fetchXml(file: String): String
    suspend fun postXml(file: String, xml: String): String
    suspend fun triggerAction(file: String)
}
```

```kotlin
package com.sunzehui.wifimanage.data

import com.sunzehui.wifimanage.protocol.DeviceCredentials
import com.sunzehui.wifimanage.protocol.DeviceError
import com.sunzehui.wifimanage.protocol.DeviceException
import com.sunzehui.wifimanage.protocol.Digest
import com.sunzehui.wifimanage.protocol.DigestSession
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.IOException

class DeviceClient(
    private val transport: HttpTransport,
    private val credentials: () -> DeviceCredentials?,
    private val baseUrl: String = "http://192.168.1.1",
    private val clock: () -> Long = System::currentTimeMillis,
) : XmlSource {

    private val mutex = Mutex()
    private var session: DigestSession? = null
    private var loginBackoffMs = 0L
    private var loginBlockedUntil = 0L
    private var lastAuthReason = ""

    override suspend fun fetchXml(file: String): String = mutex.withLock { fetchLocked(file) }
    override suspend fun postXml(file: String, xml: String): String = mutex.withLock { postLocked(file, xml) }
    override suspend fun triggerAction(file: String) = mutex.withLock { triggerLocked(file) }

    private suspend fun fetchLocked(file: String): String {
        ensureSession()
        val url = "$baseUrl/xml_action.cgi?method=get&module=duster&file=$file&_=${clock()}"
        val first = get(url, authHeader("GET"))
        if (isOk(first.body)) { noteLoginResult(true, null); return first.body }
        authReason(first.body)?.let { throw failAuth(it) }

        invalidate()
        login()
        val second = get(url, authHeader("GET"))
        if (isOk(second.body)) { noteLoginResult(true, null); return second.body }
        authReason(second.body)?.let { throw failAuth(it) }
        throw DeviceException(DeviceError.Unexpected("获取设备数据 $file 失败"))
    }

    private suspend fun postLocked(file: String, xml: String): String {
        ensureSession()
        val url = "$baseUrl/xml_action.cgi?method=set&module=duster&file=$file"
        suspend fun send(): HttpResult = try {
            transport.post(url, xml, mapOf("Authorization" to authHeader("POST")))
        } catch (e: IOException) {
            throw DeviceException(DeviceError.Unreachable)
        }
        var body = send().body
        if (!body.contains("UNAUTHORIZED") && !body.contains("Error")) { noteLoginResult(true, null); return body }
        authReason(body)?.let { throw failAuth(it) }

        invalidate()
        login()
        body = send().body
        if (!body.contains("UNAUTHORIZED") && !body.contains("Error")) { noteLoginResult(true, null); return body }
        authReason(body)?.let { throw failAuth(it) }
        throw DeviceException(DeviceError.Unexpected("设备拒绝了设置请求"))
    }

    private suspend fun triggerLocked(file: String) {
        ensureSession()
        val url = "$baseUrl/xml_action.cgi?method=get&module=duster&file=$file&_=${clock()}"
        val r = try {
            transport.get(url, mapOf("Authorization" to authHeader("GET")), connectTimeoutMs = 15_000)
        } catch (e: IOException) {
            return
        }
        authReason(r.body)?.let { throw failAuth(it) }
        noteLoginResult(true, null)
    }

    private suspend fun get(url: String, authorization: String): HttpResult = try {
        transport.get(url, mapOf("Authorization" to authorization))
    } catch (e: IOException) {
        throw DeviceException(DeviceError.Unreachable)
    }

    suspend fun resetAuthState() = mutex.withLock {
        session = null
        loginBackoffMs = 0
        loginBlockedUntil = 0
        lastAuthReason = ""
    }

    private suspend fun ensureSession() {
        if (session == null) login()
    }

    private suspend fun login() {
        val cred = credentials()
        if (cred == null || cred.pass.isBlank()) throw DeviceException(DeviceError.NotConfigured)
        val now = clock()
        if (now < loginBlockedUntil) {
            val wait = ((loginBlockedUntil - now + 999) / 1000).toInt()
            throw DeviceException(mapAuth(lastAuthReason), authMessage(lastAuthReason, wait), wait)
        }
        val probe = try {
            transport.get("$baseUrl/login.cgi")
        } catch (e: IOException) {
            throw DeviceException(DeviceError.Unreachable)
        }
        val challenge = Digest.parseChallenge(probe.wwwAuthenticate)
            ?: throw DeviceException(DeviceError.Unexpected("设备未返回质询"))
        val req = Digest.loginRequest(cred, challenge)
        try {
            transport.get(baseUrl + req.path, mapOf("Authorization" to req.authorization))
        } catch (e: IOException) {
            throw DeviceException(DeviceError.Unreachable)
        }
        session = DigestSession(challenge.realm, challenge.nonce, challenge.qop, 1)
    }

    private fun authHeader(method: String): String {
        val s = session ?: throw DeviceException(DeviceError.Unexpected("未登录"))
        val cred = credentials() ?: throw DeviceException(DeviceError.NotConfigured)
        val header = Digest.authHeader(cred, s, method)
        s.nc += 1
        return header
    }

    private fun invalidate() {
        session = null
    }

    private fun isOk(body: String): Boolean =
        body.contains("<RGW") && !AUTH_FAIL.containsMatchIn(body)

    private fun authReason(body: String): String? =
        AUTH_FAIL.find(body)?.groupValues?.get(1)?.uppercase()

    private fun failAuth(reason: String): DeviceException {
        invalidate()
        noteLoginResult(false, reason)
        val wait = ((loginBackoffMs + 999) / 1000).toInt()
        return DeviceException(mapAuth(reason), authMessage(reason, wait), wait)
    }

    private fun noteLoginResult(ok: Boolean, reason: String?) {
        if (ok) {
            loginBackoffMs = 0
            lastAuthReason = ""
            return
        }
        if (reason != null) lastAuthReason = reason
        loginBackoffMs = if (loginBackoffMs == 0L) 30_000 else minOf(loginBackoffMs * 2, 600_000)
        loginBlockedUntil = clock() + loginBackoffMs
    }

    private fun mapAuth(reason: String): DeviceError = when (reason) {
        "KICKOFF" -> DeviceError.Kicked
        "LOCK" -> DeviceError.Locked
        "NOTLOGIN", "UNAUTHORIZED" -> DeviceError.BadPassword
        else -> DeviceError.Unexpected(reason)
    }

    private fun authMessage(reason: String, wait: Int): String {
        val suffix = if (wait > 0) ", $wait 秒后自动重试" else ""
        return when (reason) {
            "KICKOFF" -> "设备把本机会话踢出了(同一台设备同一时间只允许一个管理会话, 多半是电脑端仪表盘也在访问)$suffix"
            "LOCK" -> "设备登录已锁定(失败次数过多), 请稍后重试或重启随身 WiFi$suffix"
            "NOTLOGIN", "UNAUTHORIZED" -> "设备拒绝登录: 账号或密码不正确, 请到设置确认设备后台密码$suffix"
            else -> "无法获取设备数据($reason)$suffix"
        }
    }

    private companion object {
        val AUTH_FAIL = Regex(
            """<login_status>\s*(UNAUTHORIZED|KICKOFF|LOCK|NOTLOGIN)\s*</login_status>""",
            RegexOption.IGNORE_CASE,
        )
    }
}
```

- [ ] **Step 4: 运行测试**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests "com.sunzehui.wifimanage.data.DeviceClientTest"`
Expected: 6 个测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add android/app/src/main/kotlin/com/sunzehui/wifimanage/data/XmlSource.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/data/DeviceClient.kt \
  android/app/src/test/kotlin/com/sunzehui/wifimanage/data/DeviceClientTest.kt
git commit -m "数据: 设备 Digest 会话、错误分类与登录退避"
```

---

### Task 9: 仓储、发卡平台客户端与写操作

**Files:**
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/data/Sources.kt`
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/data/DeviceRepository.kt`
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/data/MgxClient.kt`
- Test: `android/app/src/test/kotlin/com/sunzehui/wifimanage/data/DeviceRepositoryTest.kt`
- Test: `android/app/src/test/kotlin/com/sunzehui/wifimanage/data/MgxClientTest.kt`

**Interfaces:**
- Consumes: `XmlSource`、`TtlCache`、`HttpTransport`、全部 mapper、`SettingsXml`
- Produces:
  - `interface StatusSource { suspend fun status(): DeviceStatus }`
  - `interface TrafficSource { suspend fun traffic(): Traffic; suspend fun setQuota(gb: Double); suspend fun remoteTraffic(refresh: Boolean): RemoteTraffic }`
  - `interface DevicesSource { suspend fun devices(): Devices }`
  - `interface SimBandSource { suspend fun sim(): SimInfo; suspend fun band(): BandInfo; suspend fun setSim(slot: Int, pw: String); suspend fun setBand(bands: List<Int>) }`
  - `interface WifiSource { suspend fun wlanBasic(): WlanBasic; suspend fun saveWifi(ssid: String, password: String?): String; suspend fun setAutoOff(minutes: Int) }`
  - `interface DeviceOps { suspend fun reboot(); suspend fun poweroff() }`
  - `class DeviceRepository(xml: XmlSource, mgx: MgxClient, cache = TtlCache())` 实现上述全部接口，并暴露 `lastTraffic/lastSim/lastBand: StateFlow`
  - `class MgxClient(transport, cardProvider: () -> String?, cache = TtlCache(), clock, sleep)`

- [ ] **Step 1: 写失败测试**

`DeviceRepositoryTest.kt` 关键断言：

```kotlin
package com.sunzehui.wifimanage.data

import com.sunzehui.wifimanage.protocol.DeviceStatus
import com.sunzehui.wifimanage.protocol.RemoteTraffic
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceRepositoryTest {
    private val statusXml = """<RGW><wan><wan_conn_status>connected</wan_conn_status>
        <sys_mode>17</sys_mode><sys_submode>17</sys_submode><rsrp>55</rsrp>
        <Battery_connect>1</Battery_connect><Battery_voltage>80</Battery_voltage>
        <cellular><pdp_context_list><Item><default>1</default><curconntime>10</curconntime></Item></pdp_context_list></cellular>
        </wan><wlan_settings><wlan_enable>1</wlan_enable><channel>1</channel></wlan_settings>
        <wlan_security><ssid>004D006900460069</ssid><mode>WPA2-PSK</mode></wlan_security>
        <lan><ip>192.168.1.1</ip><mac>AA</mac></lan>
        <device_management><nr_connected_dev>2</nr_connected_dev></device_management>
        <sysinfo><model_name>MF518</model_name></sysinfo></RGW>"""

    private class FakeXml : XmlSource {
        val fetched = mutableListOf<String>()
        val posted = mutableListOf<Pair<String, String>>()
        val triggered = mutableListOf<String>()
        var body: (String) -> String = { "<RGW/>" }
        override suspend fun fetchXml(file: String): String { fetched += file; return body(file) }
        override suspend fun postXml(file: String, xml: String): String { posted += file to xml; return "<RGW><ok>1</ok></RGW>" }
        override suspend fun triggerAction(file: String) { triggered += file }
    }

    private class FakeMgx : MgxLike {
        override suspend fun remoteTraffic(refresh: Boolean) = RemoteTraffic("C", "p", "s", "e", 1, 0, 1, false, emptyList())
    }

    @Test fun cachesStatusAndInvalidatesAfterWrite() = runBlocking {
        var now = 0L
        val cache = TtlCache { now }
        val xml = FakeXml()
        xml.body = { if (it == "status1") statusXml else "<RGW/>" }
        val repo = DeviceRepository(xml, FakeMgx(), cache)
        val s: DeviceStatus = repo.status()
        assertEquals("MF518", s.device.model)
        now = 3_000
        repo.status()
        assertEquals(listOf("status1"), xml.fetched)
        now = 5_000
        repo.status()
        assertEquals(listOf("status1", "status1"), xml.fetched)
    }

    @Test fun validatesAutoOffAndQuota() = runBlocking {
        val repo = DeviceRepository(FakeXml(), FakeMgx(), TtlCache())
        for (bad in listOf(1, 9, 61)) {
            try { repo.setAutoOff(bad); throw AssertionError("应拒绝 $bad") }
            catch (e: IllegalArgumentException) { assertTrue(e.message!!.contains("10 - 60")) }
        }
        try { repo.setQuota(-1.0); throw AssertionError("应拒绝负值") }
        catch (e: IllegalArgumentException) { assertTrue(e.message!!.contains("0 - 100000")) }
    }

    @Test fun wifiSaveReadsCurrentKeyAndPostsOneSecurityFile() = runBlocking {
        val xml = FakeXml()
        xml.body = { file ->
            if (file == "uapxb_wlan_security_settings")
                """<RGW><wlan_security><ssid>004D006900460069</ssid><mode>WPA2-PSK</mode><WPA2-PSK><key>oldpass1</key></WPA2-PSK></wlan_security></RGW>"""
            else "<RGW/>"
        }
        val repo = DeviceRepository(xml, FakeMgx(), TtlCache())
        val msg = repo.saveWifi("NewName", "")
        assertEquals("WiFi 名称已更新，设备无线将短暂重启", msg)
        assertEquals(1, xml.posted.size)
        assertTrue(xml.posted[0].second.contains("<key>oldpass1</key>"))
        assertTrue(xml.posted[0].second.contains("<ssid>004E00650077004E0061006D0065</ssid>"))
    }

    @Test fun simRejectsWrongPasswordMarkerAndInvalidatesCaches() = runBlocking {
        val xml = FakeXml()
        xml.body = { if (it == "esim") "<RGW><esim><simid>0</simid></esim></RGW>" else "<RGW/>" }
        val repo = DeviceRepository(xml, FakeMgx(), TtlCache())
        repo.setSim(1, "pw")
        assertEquals("esim", xml.posted[0].first)
        assertTrue(xml.posted[0].second.contains("<simmode>1</simmode>"))
    }

    @Test fun rebootTriggersGetFileAndClearsCache() = runBlocking {
        val xml = FakeXml()
        val repo = DeviceRepository(xml, FakeMgx(), TtlCache())
        repo.reboot()
        assertEquals(listOf("reset"), xml.triggered)
    }
}
```

`MgxClientTest.kt`：

```kotlin
package com.sunzehui.wifimanage.data

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MgxClientTest {
    private class FakeTransport : HttpTransport {
        val calls = mutableListOf<Pair<String, Map<String, String>>>()
        var bodies = ArrayDeque<String>()
        var cookies = ArrayDeque<List<String>>()
        override suspend fun get(url: String, headers: Map<String, String>, connectTimeoutMs: Int, readTimeoutMs: Int): HttpResult {
            calls += url to headers
            return HttpResult(200, bodies.removeFirst(), null, cookies.removeFirstOrNull() ?: emptyList())
        }
        override suspend fun post(url: String, body: String, headers: Map<String, String>, connectTimeoutMs: Int, readTimeoutMs: Int) =
            error("unused")
    }

    @Test fun logsInKeepsCookieAndMapsTraffic() = runBlocking {
        val t = FakeTransport()
        t.bodies.addLast("  {\"code\":\"0\"}")
        t.cookies.addLast(listOf("JSESSIONID=abc; Path=/"))
        t.bodies.addLast("{\"code\":\"0\",\"entity\":{\"flowSize\":\"1024\",\"totalBytesCnt\":\"512\"}}")
        val c = MgxClient(t, { "CARD" }, sleep = {})
        val r = c.remoteTraffic(refresh = true)
        assertEquals(1024L * 1048576, r.totalBytes)
        assertEquals(512L * 1048576, r.usedBytes)
        assertTrue(t.calls[0].first.contains("iccidMark=CARD"))
        assertEquals("JSESSIONID=abc", t.calls[1].second["Cookie"])
    }

    @Test fun missingCardFailsWithReadableMessage() = runBlocking {
        val c = MgxClient(FakeTransport(), { "" }, sleep = {})
        try { c.remoteTraffic(true); throw AssertionError("应失败") }
        catch (e: IllegalArgumentException) { assertTrue(e.message!!.contains("未配置发卡平台设备号")) }
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests "com.sunzehui.wifimanage.data.DeviceRepositoryTest" --tests "com.sunzehui.wifimanage.data.MgxClientTest"`
Expected: 编译失败。

- [ ] **Step 3: 实现 Sources.kt**

```kotlin
package com.sunzehui.wifimanage.data

import com.sunzehui.wifimanage.protocol.BandInfo
import com.sunzehui.wifimanage.protocol.DeviceStatus
import com.sunzehui.wifimanage.protocol.Devices
import com.sunzehui.wifimanage.protocol.RemoteTraffic
import com.sunzehui.wifimanage.protocol.SimInfo
import com.sunzehui.wifimanage.protocol.Traffic
import com.sunzehui.wifimanage.protocol.WlanBasic
import com.sunzehui.wifimanage.protocol.WlanSecurity

interface StatusSource { suspend fun status(): DeviceStatus }
interface TrafficSource {
    suspend fun traffic(): Traffic
    suspend fun setQuota(gb: Double)
    suspend fun remoteTraffic(refresh: Boolean): RemoteTraffic
}
interface DevicesSource { suspend fun devices(): Devices }
interface SimBandSource {
    suspend fun sim(): SimInfo
    suspend fun band(): BandInfo
    suspend fun setSim(slot: Int, pw: String)
    suspend fun setBand(bands: List<Int>)
}
interface WifiSource {
    suspend fun wlanBasic(): WlanBasic
    suspend fun wlanSecurity(): WlanSecurity
    suspend fun saveWifi(ssid: String, password: String?): String
    suspend fun setAutoOff(minutes: Int)
}
interface DeviceOps { suspend fun reboot(); suspend fun poweroff() }
```

- [ ] **Step 4: 实现 DeviceRepository.kt**

```kotlin
package com.sunzehui.wifimanage.data

import com.sunzehui.wifimanage.protocol.BandMapper
import com.sunzehui.wifimanage.protocol.BandInfo
import com.sunzehui.wifimanage.protocol.DeviceStatus
import com.sunzehui.wifimanage.protocol.Devices
import com.sunzehui.wifimanage.protocol.DevicesMapper
import com.sunzehui.wifimanage.protocol.RemoteTraffic
import com.sunzehui.wifimanage.protocol.SettingsXml
import com.sunzehui.wifimanage.protocol.SimInfo
import com.sunzehui.wifimanage.protocol.SimMapper
import com.sunzehui.wifimanage.protocol.StatusMapper
import com.sunzehui.wifimanage.protocol.Traffic
import com.sunzehui.wifimanage.protocol.TrafficMapper
import com.sunzehui.wifimanage.protocol.WlanBasic
import com.sunzehui.wifimanage.protocol.WlanMapper
import com.sunzehui.wifimanage.protocol.WlanSecurity
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

interface MgxLike { suspend fun remoteTraffic(refresh: Boolean): RemoteTraffic }

class DeviceRepository(
    private val xml: XmlSource,
    private val mgx: MgxLike,
    private val cache: TtlCache = TtlCache(),
) : StatusSource, TrafficSource, DevicesSource, SimBandSource, WifiSource, DeviceOps {

    private val _lastTraffic = MutableStateFlow<Traffic?>(null)
    val lastTraffic: StateFlow<Traffic?> = _lastTraffic
    private val _lastSim = MutableStateFlow<SimInfo?>(null)
    val lastSim: StateFlow<SimInfo?> = _lastSim
    private val _lastBand = MutableStateFlow<BandInfo?>(null)
    val lastBand: StateFlow<BandInfo?> = _lastBand

    private suspend fun source(file: String, ttlSec: Long): String {
        cache.get(file, ttlSec)?.let { return it }
        val body = xml.fetchXml(file)
        cache.put(file, body)
        return body
    }

    override suspend fun status(): DeviceStatus = StatusMapper.build(source("status1", 4))

    override suspend fun traffic(): Traffic {
        val t = TrafficMapper.build(source("statistics", 20), cache.get("status1", 60))
        _lastTraffic.value = t
        return t
    }

    override suspend fun devices(): Devices = DevicesMapper.build(source("device_management", 20))

    override suspend fun sim(): SimInfo {
        val info = SimMapper.build(source("esim", 5), source("deviceinfo", 600))
        _lastSim.value = info
        return info
    }

    override suspend fun band(): BandInfo {
        val info = BandMapper.build(source("customconfig", 5))
        _lastBand.value = info
        return info
    }

    override suspend fun wlanBasic(): WlanBasic = WlanMapper.basic(source("uapxb_wlan_basic_settings", 20))

    override suspend fun wlanSecurity(): WlanSecurity =
        WlanMapper.security(xml.fetchXml("uapxb_wlan_security_settings"))

    override suspend fun saveWifi(ssid: String, password: String?): String {
        val name = ssid.trim()
        require(name.isNotEmpty()) { "WiFi 名称不能为空" }
        require(name.toByteArray(Charsets.UTF_8).size <= 32) { "WiFi 名称需为 1-32 字节（1 个汉字占 3 字节）" }
        val pwd = password.orEmpty()
        require(pwd.isEmpty() || Regex("^[\\x20-\\x7E]{8,63}$").matches(pwd)) {
            "密码需为 8-63 位字符，且不含中文"
        }
        val sec = wlanSecurity()
        val mode = sec.mode.trim()
        val encMode = mode.replace(Regex("[^A-Za-z0-9-]"), "")
        val encOn = encMode.isNotEmpty() && mode != "None"
        require(pwd.isEmpty() || encOn) { "当前 WiFi 未启用加密，请先在设备后台设置加密方式" }
        val effective = if (pwd.isNotEmpty()) pwd else if (encOn) sec.key else ""
        val renamed = name != sec.ssid
        if (!renamed && pwd.isEmpty()) return "名称和密码都没有改动"
        val cmd = SettingsXml.security(name, encMode, effective)
        xml.postXml(cmd.file, cmd.xml)
        cache.clear("status1", "uapxb_wlan_security_settings")
        return when {
            pwd.isEmpty() -> "WiFi 名称已更新，设备无线将短暂重启"
            renamed -> "WiFi 名称和密码已更新，请用新的名称和密码重新连接"
            else -> "WiFi 密码已更新，请用新密码重新连接"
        }
    }

    override suspend fun setAutoOff(minutes: Int) {
        require(minutes == 0 || minutes in 10..60) { "自动关闭时间需为 10 - 60 分钟，或设为关闭" }
        val cmd = SettingsXml.autoOff(minutes)
        xml.postXml(cmd.file, cmd.xml)
        cache.clear("uapxb_wlan_basic_settings")
    }

    override suspend fun setSim(slot: Int, pw: String) {
        require(slot in 0..2) { "请选择有效的卡槽" }
        val info = sim()
        require(!info.pwdRequired || pw.isNotBlank()) { "请输入切换密码" }
        val cmd = SettingsXml.sim(slot, if (info.pwdRequired) pw else "")
        val resp = xml.postXml(cmd.file, cmd.xml)
        require(!resp.contains("<cmd_status>pw</cmd_status>")) { "密码错误，请重试" }
        cache.clear("esim", "status1", "statistics", "device_management")
    }

    override suspend fun setBand(bands: List<Int>) {
        val info = band()
        val valid = bands.distinct().filter { b -> info.bands.any { it.band == b } }
        require(valid.isNotEmpty()) { "请至少选择一个有效频段" }
        val cmd = SettingsXml.band(valid)
        xml.postXml(cmd.file, cmd.xml)
        cache.clear("customconfig")
    }

    override suspend fun setQuota(gb: Double) {
        require(!gb.isNaN() && gb in 0.0..100000.0) { "流量总量需为 0 - 100000 GB" }
        val cmd = SettingsXml.quota((gb * 1073741824.0).toLong())
        xml.postXml(cmd.file, cmd.xml)
        cache.clear("statistics")
    }

    override suspend fun remoteTraffic(refresh: Boolean): RemoteTraffic = mgx.remoteTraffic(refresh)

    override suspend fun reboot() {
        xml.triggerAction(SettingsXml.deviceAction("reboot").file)
        cache.clearAll()
    }

    override suspend fun poweroff() {
        xml.triggerAction(SettingsXml.deviceAction("poweroff").file)
        cache.clearAll()
    }
}
```

- [ ] **Step 5: 实现 MgxClient.kt**

```kotlin
package com.sunzehui.wifimanage.data

import com.sunzehui.wifimanage.protocol.DeviceError
import com.sunzehui.wifimanage.protocol.DeviceException
import com.sunzehui.wifimanage.protocol.LooseJson
import com.sunzehui.wifimanage.protocol.MgxMapper
import com.sunzehui.wifimanage.protocol.MifiJson
import com.sunzehui.wifimanage.protocol.RemoteTraffic
import kotlinx.coroutines.delay
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.io.IOException
import java.net.URLEncoder

class MgxClient(
    private val transport: HttpTransport,
    private val cardProvider: () -> String?,
    private val cache: TtlCache = TtlCache(),
    private val sleep: suspend (Long) -> Unit = { delay(it) },
) : MgxLike {

    private val base = "http://xmgxx.maigaoxun.com/kyhl-weixin-1.0"
    private var cookie: String? = null

    override suspend fun remoteTraffic(refresh: Boolean): RemoteTraffic {
        if (!refresh) {
            cache.get("mgx_traffic", 120)?.let {
                return MifiJson.decodeFromString<RemoteTraffic>(it).copy(cached = true)
            }
        }
        return try {
            fetchOnce()
        } catch (e: IOException) {
            sleep(800)
            fetchOnce()
        }
    }

    private suspend fun fetchOnce(): RemoteTraffic {
        val card = cardProvider()?.trim().orEmpty()
        if (card.isEmpty()) {
            throw IllegalArgumentException("未配置发卡平台设备号: 打开设置填写")
        }
        val loginPath = "/card/login.do?responseFunction=cb&iccidMark=${enc(card)}"
        val login = mgxGet(loginPath)
        if (code(login) != "0") {
            throw IllegalArgumentException(
                "发卡平台登录失败: " + (login["msg"]?.jsonPrimitive?.contentOrNull ?: "设备号可能有误")
            )
        }
        val infoPath = "/card/findCardInfo.do?iccidOrPhone=&responseFunction=cb&skipGift=true&rfm=${Math.random()}"
        var info = mgxGet(infoPath)
        val expired = info["system_result_key"]?.jsonPrimitive?.contentOrNull == "7" ||
            (info["returnurl"]?.jsonPrimitive?.contentOrNull ?: "").contains("login")
        if (code(info) != "0" && expired) {
            mgxGet(loginPath)
            info = mgxGet(infoPath)
        }
        if (code(info) != "0") {
            throw IllegalArgumentException(
                "发卡平台查询失败: " + (
                    info["system_result_message_key"]?.jsonPrimitive?.contentOrNull
                        ?: info["msg"]?.jsonPrimitive?.contentOrNull
                        ?: "会话已过期, 请稍后重试"
                    )
            )
        }
        val out = MgxMapper.build(info, card)
        cache.put("mgx_traffic", MifiJson.encodeToString(out))
        return out
    }

    private suspend fun mgxGet(path: String): JsonObject {
        val headers = cookie?.let { mapOf("Cookie" to it) } ?: emptyMap()
        val r = transport.get(base + path, headers, connectTimeoutMs = 20_000, readTimeoutMs = 20_000)
        r.setCookies.firstOrNull()?.let { cookie = it.substringBefore(';').trim() }
        if (r.status >= 500) {
            throw IllegalArgumentException(r.body.trim().ifEmpty { "发卡平台转发失败 (HTTP ${r.status})" })
        }
        return LooseJson.parse(r.body)
            ?: throw IllegalArgumentException("发卡平台返回异常(响应无法解析)")
    }

    private fun code(o: JsonObject): String =
        o["code"]?.jsonPrimitive?.contentOrNull ?: ""

    private fun enc(s: String): String =
        URLEncoder.encode(s, "UTF-8").replace("+", "%20")
}
```

- [ ] **Step 6: 运行测试**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests "com.sunzehui.wifimanage.data.DeviceRepositoryTest" --tests "com.sunzehui.wifimanage.data.MgxClientTest"`
Expected: 7 个测试 PASS。

- [ ] **Step 7: 提交**

```bash
git add android/app/src/main/kotlin/com/sunzehui/wifimanage/data/Sources.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/data/DeviceRepository.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/data/MgxClient.kt \
  android/app/src/test/kotlin/com/sunzehui/wifimanage/data/DeviceRepositoryTest.kt \
  android/app/src/test/kotlin/com/sunzehui/wifimanage/data/MgxClientTest.kt
git commit -m "数据: 设备仓储、发卡平台客户端与写操作"
```

---

### Task 10: 设置存储与 Keystore 加密

**Files:**
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/data/Settings.kt`
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/data/AndroidSettings.kt`
- Test: `android/app/src/test/kotlin/com/sunzehui/wifimanage/data/SettingsStoreTest.kt`

**Interfaces:**
- Consumes: 无
- Produces:
  - `data class Settings(devicePassword: String = "", mgxCard: String = "", notifyEnabled: Boolean = true)`
  - `interface SettingsSource { val flow: StateFlow<Settings>; suspend fun current(): Settings; fun snapshot(): Settings; suspend fun setDevicePassword(value: String); suspend fun setMgxCard(value: String); suspend fun setNotifyEnabled(value: Boolean) }`
  - `interface SettingsStorage { suspend fun read(): Map<String, String>; suspend fun put(key: String, value: String?) }`
  - `interface SecretCipher { fun encrypt(plain: String): String; fun decrypt(token: String, fallback: String = ""): String }`
  - `class SettingsStore(storage: SettingsStorage, cipher: SecretCipher) : SettingsSource`，另有 `val ready: StateFlow<Boolean>`、`suspend fun ensureLoaded()`
  - `class DataStoreSettingsStorage(context: Context) : SettingsStorage`
  - `class AndroidKeystoreCipher : SecretCipher`

- [ ] **Step 1: 写失败测试**

`SettingsStoreTest.kt`：

```kotlin
package com.sunzehui.wifimanage.data

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SettingsStoreTest {
    private class MemoryStorage : SettingsStorage {
        val map = mutableMapOf<String, String>()
        override suspend fun read(): Map<String, String> = map.toMap()
        override suspend fun put(key: String, value: String?) {
            if (value == null) map.remove(key) else map[key] = value
        }
    }

    private class ReversingCipher : SecretCipher {
        override fun encrypt(plain: String): String = "enc:" + plain.reversed()
        override fun decrypt(token: String, fallback: String): String =
            if (token.startsWith("enc:")) token.removePrefix("enc:").reversed() else fallback
    }

    @Test fun defaultsBeforeLoad() = runBlocking {
        val store = SettingsStore(MemoryStorage(), ReversingCipher())
        assertEquals(Settings(), store.snapshot())
        assertFalse(store.ready.value)
        assertEquals(Settings(), store.current())
        assertTrue(store.ready.value)
    }

    @Test fun storesCiphertextOnly() = runBlocking {
        val storage = MemoryStorage()
        val store = SettingsStore(storage, ReversingCipher())
        store.setDevicePassword("secret12")
        store.setMgxCard("SDY001")
        assertEquals("enc:21terces", storage.map["password_enc"])
        assertEquals("enc:100YDS", storage.map["card_enc"])
        assertEquals("secret12", store.snapshot().devicePassword)
        assertEquals("SDY001", store.snapshot().mgxCard)
    }

    @Test fun loadDecryptsAndDefaultsNotifyOn() = runBlocking {
        val storage = MemoryStorage()
        storage.map["password_enc"] = "enc:21terces"
        storage.map["card_enc"] = "enc:100YDS"
        val store = SettingsStore(storage, ReversingCipher())
        store.ensureLoaded()
        assertEquals("secret12", store.snapshot().devicePassword)
        assertEquals("SDY001", store.snapshot().mgxCard)
        assertTrue(store.snapshot().notifyEnabled)
    }

    @Test fun notifyOffPersists() = runBlocking {
        val storage = MemoryStorage()
        val store = SettingsStore(storage, ReversingCipher())
        store.setNotifyEnabled(false)
        assertEquals("0", storage.map["notify_on"])
        assertFalse(store.snapshot().notifyEnabled)
    }

    @Test fun corruptedTokenFallsBackToEmpty() = runBlocking {
        val storage = MemoryStorage()
        storage.map["password_enc"] = "garbage"
        val store = SettingsStore(storage, ReversingCipher())
        store.ensureLoaded()
        assertEquals("", store.snapshot().devicePassword)
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests "com.sunzehui.wifimanage.data.SettingsStoreTest"`
Expected: 编译失败（`SettingsStore` 不存在）。

- [ ] **Step 3: 实现 Settings.kt**

```kotlin
package com.sunzehui.wifimanage.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class Settings(
    val devicePassword: String = "",
    val mgxCard: String = "",
    val notifyEnabled: Boolean = true,
)

interface SettingsSource {
    val flow: StateFlow<Settings>
    suspend fun current(): Settings
    fun snapshot(): Settings
    suspend fun setDevicePassword(value: String)
    suspend fun setMgxCard(value: String)
    suspend fun setNotifyEnabled(value: Boolean)
}

interface SettingsStorage {
    suspend fun read(): Map<String, String>
    suspend fun put(key: String, value: String?)
}

interface SecretCipher {
    fun encrypt(plain: String): String
    fun decrypt(token: String, fallback: String = ""): String
}

class SettingsStore(
    private val storage: SettingsStorage,
    private val cipher: SecretCipher,
) : SettingsSource {

    private val mutex = Mutex()
    private val _flow = MutableStateFlow(Settings())
    override val flow: StateFlow<Settings> = _flow

    private val _ready = MutableStateFlow(false)
    val ready: StateFlow<Boolean> = _ready

    private var loaded = false

    override fun snapshot(): Settings = _flow.value

    override suspend fun current(): Settings {
        ensureLoaded()
        return _flow.value
    }

    suspend fun ensureLoaded() = mutex.withLock {
        if (!loaded) {
            _flow.value = decode(storage.read())
            loaded = true
            _ready.value = true
        }
    }

    override suspend fun setDevicePassword(value: String) {
        storage.put(KEY_PASSWORD, cipher.encrypt(value))
        _flow.value = _flow.value.copy(devicePassword = value)
    }

    override suspend fun setMgxCard(value: String) {
        storage.put(KEY_CARD, cipher.encrypt(value))
        _flow.value = _flow.value.copy(mgxCard = value)
    }

    override suspend fun setNotifyEnabled(value: Boolean) {
        storage.put(KEY_NOTIFY, if (value) "1" else "0")
        _flow.value = _flow.value.copy(notifyEnabled = value)
    }

    private fun decode(raw: Map<String, String>): Settings = Settings(
        devicePassword = cipher.decrypt(raw[KEY_PASSWORD].orEmpty()),
        mgxCard = cipher.decrypt(raw[KEY_CARD].orEmpty()),
        notifyEnabled = raw[KEY_NOTIFY] != "0",
    )

    private companion object {
        const val KEY_PASSWORD = "password_enc"
        const val KEY_CARD = "card_enc"
        const val KEY_NOTIFY = "notify_on"
    }
}
```

- [ ] **Step 4: 实现 AndroidSettings.kt**

```kotlin
package com.sunzehui.wifimanage.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStoreFile
import kotlinx.coroutines.flow.first
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class DataStoreSettingsStorage(context: Context) : SettingsStorage {
    private val store: DataStore<Preferences> = PreferenceDataStoreFactory.create(
        produceFile = { context.preferencesDataStoreFile("mifi_settings") },
    )

    override suspend fun read(): Map<String, String> =
        store.data.first().asMap().entries.mapNotNull { (key, value) ->
            (value as? String)?.let { key.name to it }
        }.toMap()

    override suspend fun put(key: String, value: String?) {
        store.edit { prefs ->
            val prefKey = stringPreferencesKey(key)
            if (value == null) prefs.remove(prefKey) else prefs[prefKey] = value
        }
    }
}

class AndroidKeystoreCipher : SecretCipher {
    override fun encrypt(plain: String): String {
        if (plain.isEmpty()) return ""
        val iv = ByteArray(12).also { SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
        val body = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(iv, Base64.NO_WRAP) + ":" +
            Base64.encodeToString(body, Base64.NO_WRAP)
    }

    override fun decrypt(token: String, fallback: String): String {
        if (token.isEmpty()) return fallback
        return try {
            val parts = token.split(':', limit = 2)
            val iv = Base64.decode(parts[0], Base64.NO_WRAP)
            val body = Base64.decode(parts[1], Base64.NO_WRAP)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
            String(cipher.doFinal(body), Charsets.UTF_8)
        } catch (e: Exception) {
            fallback
        }
    }

    private fun secretKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private companion object {
        const val ALIAS = "mifi_settings_key"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
```

- [ ] **Step 5: 运行测试**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests "com.sunzehui.wifimanage.data.SettingsStoreTest"`
Expected: 5 个测试 PASS。

- [ ] **Step 6: 提交**

```bash
git add android/app/src/main/kotlin/com/sunzehui/wifimanage/data/Settings.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/data/AndroidSettings.kt \
  android/app/src/test/kotlin/com/sunzehui/wifimanage/data/SettingsStoreTest.kt
git commit -m "设置: DataStore 持久化与 Keystore AES-GCM 加密"
```

---

### Task 11: 应用容器、主题、主框架与设置页

**Files:**
- Modify: `android/app/src/main/kotlin/com/sunzehui/wifimanage/MifiApp.kt`
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/AppContainer.kt`
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/Theme.kt`
- Replace: `android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/MainActivity.kt`
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/AppRoot.kt`
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/SettingsForm.kt`
- Create: `android/app/src/main/res/values/themes.xml`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Modify: `android/app/build.gradle.kts`

**Interfaces:**
- Consumes: `SettingsStore`、`DeviceClient`、`DeviceRepository`、`MgxClient`、`UrlConnectionTransport`
- Produces:
  - `class AppContainer(context: Context)`，字段 `settings: SettingsStore`、`repository: DeviceRepository`
  - `class MifiApp`，字段 `container: AppContainer`
  - `@Composable fun AppRoot(container: AppContainer)`
  - `@Composable fun MifiTheme(content: @Composable () -> Unit)`
  - `enum class Tab { Home, Traffic, Devices }`

- [ ] **Step 1: 写入容器与 Application**

`AppContainer.kt`：

```kotlin
package com.sunzehui.wifimanage

import android.content.Context
import com.sunzehui.wifimanage.data.AndroidKeystoreCipher
import com.sunzehui.wifimanage.data.DataStoreSettingsStorage
import com.sunzehui.wifimanage.data.DeviceClient
import com.sunzehui.wifimanage.data.DeviceRepository
import com.sunzehui.wifimanage.data.MgxClient
import com.sunzehui.wifimanage.data.SettingsStore
import com.sunzehui.wifimanage.data.UrlConnectionTransport
import com.sunzehui.wifimanage.protocol.DeviceCredentials

class AppContainer(context: Context) {
    private val appContext = context.applicationContext

    val settings = SettingsStore(DataStoreSettingsStorage(appContext), AndroidKeystoreCipher())

    private val transport = UrlConnectionTransport()
    private val deviceClient = DeviceClient(transport) {
        DeviceCredentials("admin", settings.snapshot().devicePassword)
    }

    val repository = DeviceRepository(
        deviceClient,
        MgxClient(transport) { settings.snapshot().mgxCard },
    )
}
```

`MifiApp.kt`：

```kotlin
package com.sunzehui.wifimanage

import android.app.Application

class MifiApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}
```

- [ ] **Step 2: 写入主题**

`ui/Theme.kt`：

```kotlin
package com.sunzehui.wifimanage.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val MifiBg = Color(0xFF0D1322)
val MifiCard = Color(0xFF151D33)
val MifiCardInner = Color(0xFF1B2440)
val MifiBorder = Color(0xFF28324E)
val MifiText = Color(0xFFEAF0FF)
val MifiMuted = Color(0xFF93A0C4)
val MifiGood = Color(0xFF34D399)
val MifiWarn = Color(0xFFFBBF24)
val MifiBad = Color(0xFFF87171)
val MifiAccent = Color(0xFF60A5FA)

private val Colors = darkColorScheme(
    primary = MifiAccent,
    onPrimary = Color(0xFF08101F),
    background = MifiBg,
    onBackground = MifiText,
    surface = MifiCard,
    onSurface = MifiText,
    surfaceVariant = MifiCardInner,
    onSurfaceVariant = MifiMuted,
    outline = MifiBorder,
    error = MifiBad,
)

@Composable
fun MifiTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = Colors, typography = Typography(), content = content)
}
```

- [ ] **Step 3: 写入 Activity、AppRoot 与设置表单**

`ui/MainActivity.kt`：

```kotlin
package com.sunzehui.wifimanage.ui

import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.sunzehui.wifimanage.MifiApp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        val container = (application as MifiApp).container
        setContent {
            MifiTheme { AppRoot(container) }
        }
    }
}
```

`ui/AppRoot.kt`：

```kotlin
package com.sunzehui.wifimanage.ui

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.sunzehui.wifimanage.AppContainer
import com.sunzehui.wifimanage.data.Settings
import kotlinx.coroutines.launch

enum class Tab(val label: String, val subtitle: String, val icon: ImageVector) {
    Home("首页", "设备状态", Icons.Default.Home),
    Traffic("流量", "流量统计", Icons.Default.List),
    Devices("设备", "连接设备", Icons.Default.Phone),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppRoot(container: AppContainer) {
    val settings by container.settings.flow.collectAsStateWithLifecycle()
    val ready by container.settings.ready.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    LaunchedEffect(Unit) { container.settings.ensureLoaded() }

    if (!ready) {
        Box(Modifier.fillMaxSize().background(MifiBg), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = MifiAccent)
        }
        return
    }

    if (settings.devicePassword.isBlank()) {
        FirstRunGate(initial = settings) { password, card ->
            scope.launch {
                container.settings.setDevicePassword(password)
                container.settings.setMgxCard(card)
            }
        }
        return
    }

    var tab by rememberSaveable { mutableStateOf(Tab.Home) }
    var showSettings by rememberSaveable { mutableStateOf(false) }

    BackHandler(enabled = tab != Tab.Home) { tab = Tab.Home }

    Scaffold(
        containerColor = MifiBg,
        topBar = {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MifiCard)
                    .statusBarsPadding()
                    .padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text("随身WiFi", fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = MifiText)
                    Text(tab.subtitle, fontSize = 12.sp, color = MifiMuted)
                }
                TextButton(onClick = {
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("http://192.168.1.1/")))
                }) { Text("设备后台", color = MifiMuted) }
                IconButton(onClick = { showSettings = true }) {
                    Icon(Icons.Default.Settings, contentDescription = "设置", tint = MifiMuted)
                }
            }
        },
        bottomBar = {
            NavigationBar(containerColor = MifiCard) {
                Tab.entries.forEach { item ->
                    NavigationBarItem(
                        selected = tab == item,
                        onClick = { tab = item },
                        icon = { Icon(item.icon, contentDescription = item.label) },
                        label = { Text(item.label) },
                    )
                }
            }
        },
    ) { padding ->
        Box(Modifier.padding(padding)) {
            when (tab) {
                Tab.Home -> Placeholder("设备状态")
                Tab.Traffic -> Placeholder("流量统计")
                Tab.Devices -> Placeholder("连接设备")
            }
        }
    }

    if (showSettings) {
        ModalBottomSheet(onDismissRequest = { showSettings = false }, containerColor = MifiCard) {
            SettingsForm(
                initial = settings,
                submitLabel = "保存",
                showCancel = true,
                onSubmit = { password, card, notify ->
                    scope.launch {
                        container.settings.setDevicePassword(password)
                        container.settings.setMgxCard(card)
                        container.settings.setNotifyEnabled(notify)
                        showSettings = false
                    }
                },
                onCancel = { showSettings = false },
            )
        }
    }
}

@Composable
fun Placeholder(title: String) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(title, color = MifiMuted, fontSize = 15.sp)
    }
}

@Composable
fun FirstRunGate(initial: Settings, onSave: (String, String) -> Unit) {
    Box(
        modifier = Modifier.fillMaxSize().background(MifiBg).statusBarsPadding().padding(20.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("首次使用", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = MifiText)
            Text(
                "原生版无法读取旧网页版保存在 WebView 里的密码。请重新输入设备后台密码；发卡平台设备号可选。",
                fontSize = 13.sp,
                color = MifiMuted,
            )
            SettingsForm(
                initial = initial,
                submitLabel = "保存并连接",
                showCancel = false,
                onSubmit = { password, card, _ -> onSave(password, card) },
                onCancel = {},
            )
        }
    }
}
```

`ui/SettingsForm.kt`：

```kotlin
package com.sunzehui.wifimanage.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sunzehui.wifimanage.data.Settings

@Composable
fun SettingsForm(
    initial: Settings,
    submitLabel: String,
    showCancel: Boolean,
    onSubmit: (password: String, card: String, notify: Boolean) -> Unit,
    onCancel: () -> Unit,
) {
    var password by rememberSaveable { mutableStateOf(initial.devicePassword) }
    var card by rememberSaveable { mutableStateOf(initial.mgxCard) }
    var notify by rememberSaveable { mutableStateOf(initial.notifyEnabled) }
    var error by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier.fillMaxWidth().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("设备后台密码（必填）") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = card,
            onValueChange = { card = it },
            label = { Text("发卡平台设备号（可选）") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("在通知栏显示状态", modifier = Modifier.weight(1f), color = MifiText)
            Switch(checked = notify, onCheckedChange = { notify = it })
        }
        error?.let { Text(it, color = MifiBad, fontSize = 12.sp) }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (showCancel) {
                OutlinedButton(onClick = onCancel, modifier = Modifier.weight(1f)) { Text("取消") }
            }
            Button(
                onClick = {
                    if (password.isBlank()) {
                        error = "请填写设备后台密码"
                    } else {
                        onSubmit(password.trim(), card.trim(), notify)
                    }
                },
                modifier = Modifier.weight(1f),
            ) { Text(submitLabel) }
        }
    }
}
```

- [ ] **Step 4: 写入主题资源并切换 manifest**

`android/app/src/main/res/values/themes.xml`：

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="Theme.Mifi" parent="@android:style/Theme.Material.NoActionBar">
        <item name="android:windowBackground">#0D1322</item>
        <item name="android:statusBarColor">#0D1322</item>
        <item name="android:navigationBarColor">#0D1322</item>
        <item name="android:windowLightStatusBar">false</item>
    </style>
</resources>
```

把 manifest 的 `android:theme="@android:style/Theme.Material.NoActionBar"` 改为：

```xml
android:theme="@style/Theme.Mifi"
```

- [ ] **Step 5: 补依赖**

在 `app/build.gradle.kts` 的 `dependencies` 中加入（通知与运行时权限都要用）：

```kotlin
implementation("androidx.core:core-ktx:1.13.1")
```

- [ ] **Step 6: 构建并安装**

Run: `cd android && ./gradlew :app:assembleDebug`
Expected: `BUILD SUCCESSFUL`。

Run: `adb install -r app/build/outputs/apk/debug/app-debug.apk`
Expected: `Success`；打开后先看到「首次使用」，填任意密码保存后进入三页框架，底部显示 首页 / 流量 / 设备。

- [ ] **Step 7: 提交**

```bash
git add android/app/build.gradle.kts \
  android/app/src/main/AndroidManifest.xml \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/MifiApp.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/AppContainer.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/Theme.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/MainActivity.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/AppRoot.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/SettingsForm.kt \
  android/app/src/main/res/values/themes.xml
git commit -m "界面: 原生容器、深色主题、导航与设置页"
```

---

### Task 12: 状态轮询、续航估算与首页

**Files:**
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/protocol/BatteryEstimator.kt`
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/data/StatusCoordinator.kt`
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/Components.kt`
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/HomeViewModel.kt`
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/HomeScreen.kt`
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/AppViewModelFactory.kt`
- Test: `android/app/src/test/kotlin/com/sunzehui/wifimanage/protocol/BatteryEstimatorTest.kt`
- Test: `android/app/src/test/kotlin/com/sunzehui/wifimanage/data/StatusCoordinatorTest.kt`
- Modify: `android/app/src/main/kotlin/com/sunzehui/wifimanage/AppContainer.kt`
- Modify: `android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/AppRoot.kt`

**Interfaces:**
- Consumes: `StatusSource`、`DeviceOps`、`DeviceRepository`、`DeviceStatus`
- Produces:
  - `data class StatusSample(status: DeviceStatus?, error: DeviceError?, ts: Long)`
  - `sealed interface HoldState { data class Reboot(since: Long, sawDown: Boolean = false); data class PowerOff(since: Long) }`
  - `class StatusCoordinator(source, ops, scope, clock = System::currentTimeMillis, intervalMs = 5_000, log = {})`，暴露 `sample / hold / notice`，方法 `start / stop / tick / reboot / powerOff / confirmPoweredOn / consumeNotice`
  - `class BatteryEstimator(clock = System::currentTimeMillis, zone = ZoneId.systemDefault())`，`estimate(percent: Int, charging: Boolean): BatteryEta`
  - `HomeViewModel(coordinator, repository)`，暴露 `sample / hold / notice / heavy / history / batteryEta / traffic / sim / band`
  - `class AppViewModelFactory(container)`

- [ ] **Step 1: 写失败测试（续航估算）**

`BatteryEstimatorTest.kt`：

```kotlin
package com.sunzehui.wifimanage.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

class BatteryEstimatorTest {
    private val zone = ZoneId.of("UTC")

    private fun at(hour: Int, minute: Int = 0): Long =
        Instant.parse("2026-10-31T00:00:00Z")
            .plusSeconds(hour * 3600L + minute * 60L)
            .toEpochMilli()

    @Test fun seedsFromNineAmAndComputesRate() {
        var now = at(10)
        val estimator = BatteryEstimator({ now }, zone)
        val eta = estimator.estimate(74, charging = false)
        assertEquals("约 3 天 0 小时", eta.value)
        assertEquals("耗电 1.0 %/时", eta.note)
    }

    @Test fun usesReferenceRateOutsideSeedWindow() {
        var now = at(22)
        val estimator = BatteryEstimator({ now }, zone)
        val eta = estimator.estimate(80, charging = false)
        assertEquals("约 10 小时 0 分", eta.value)
        assertTrue(eta.note.startsWith("参考 8.0 %/时"))
    }

    @Test fun chargingUsesObservedRate() {
        var now = at(10)
        val estimator = BatteryEstimator({ now }, zone)
        estimator.estimate(74, charging = false)
        val eta = estimator.estimate(73, charging = true)
        assertEquals("充电中 · 2.0 %/时", eta.note)
    }

    @Test fun batteryRiseStartsNewCycleAndKeepsLastRate() {
        var now = at(9)
        val estimator = BatteryEstimator({ now }, zone)
        estimator.estimate(75, charging = false)
        now = at(11)
        estimator.estimate(71, charging = false)
        now = at(12)
        val eta = estimator.estimate(72, charging = false)
        assertEquals("沿用上次 2.0 %/时", eta.note)
    }

    @Test fun staleSeedIsDiscarded() {
        var now = at(10)
        val estimator = BatteryEstimator({ now }, zone)
        estimator.estimate(75, charging = false)
        now = at(11, 1)
        val eta = estimator.estimate(75, charging = false)
        assertTrue(eta.note.startsWith("参考 8.0 %/时"))
    }
}
```

- [ ] **Step 2: 写失败测试（轮询与 hold）**

`StatusCoordinatorTest.kt`：

```kotlin
package com.sunzehui.wifimanage.data

import com.sunzehui.wifimanage.protocol.BatteryInfo
import com.sunzehui.wifimanage.protocol.DeviceError
import com.sunzehui.wifimanage.protocol.DeviceException
import com.sunzehui.wifimanage.protocol.DeviceInfo
import com.sunzehui.wifimanage.protocol.DeviceStatus
import com.sunzehui.wifimanage.protocol.LanInfo
import com.sunzehui.wifimanage.protocol.NetworkInfo
import com.sunzehui.wifimanage.protocol.RateInfo
import com.sunzehui.wifimanage.protocol.WifiSummary
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StatusCoordinatorTest {
    private val status = DeviceStatus(
        time = "t",
        device = DeviceInfo("M", "F", "", "", ""),
        network = NetworkInfo(
            status = "connected", operator = "CMCC", roaming = false, mode = "LTE",
            signalBars = 4, rsrpDbm = -85, rsrqDb = null, rssiDbm = null, sinr = null,
            pci = null, cellId = "", ipv4 = "", gateway = "", dns = listOf(),
            apn = "", curConnTime = "1分", totalConnTime = "2分",
        ),
        battery = BatteryInfo(true, 80, false, "未充电"),
        rate = RateInfo(1, 2),
        wifi = WifiSummary(true, "MiFi", "WPA2-PSK", "自动"),
        lan = LanInfo("192.168.1.1", "mac", "uptime", 1),
    )

    private class FakeSource : StatusSource {
        var next: () -> DeviceStatus = { error("set next") }
        override suspend fun status(): DeviceStatus = next()
    }

    private class FakeOps : DeviceOps {
        var reboots = 0
        var poweroffs = 0
        override suspend fun reboot() { reboots++ }
        override suspend fun poweroff() { poweroffs++ }
    }

    @Test fun keepsLastGoodTimestampOnFailure() = runTest {
        var now = 1_000L
        val source = FakeSource()
        source.next = { status }
        val coordinator = StatusCoordinator(source, FakeOps(), this, clock = { now })
        coordinator.tick()
        assertEquals(1_000L, coordinator.sample.value.ts)
        source.next = { throw DeviceException(DeviceError.Unreachable) }
        now = 9_000L
        coordinator.tick()
        assertEquals(1_000L, coordinator.sample.value.ts)
        assertEquals(DeviceError.Unreachable, coordinator.sample.value.error)
    }

    @Test fun rebootHoldSwallowsFailureAndEndsOnSuccess() = runTest {
        var now = 1_000L
        val source = FakeSource()
        val ops = FakeOps()
        val coordinator = StatusCoordinator(source, ops, this, clock = { now })
        source.next = { throw DeviceException(DeviceError.Unreachable) }
        coordinator.reboot()
        assertEquals(1, ops.reboots)
        coordinator.tick()
        assertEquals(HoldState.Reboot(1_000L, sawDown = true), coordinator.hold.value)
        assertNull(coordinator.sample.value.error)
        now = 6_000L
        source.next = { status }
        coordinator.tick()
        assertNull(coordinator.hold.value)
        assertEquals("设备已重启完成", coordinator.notice.value)
    }

    @Test fun rebootWithoutDowntimeReportsNotice() = runTest {
        val source = FakeSource()
        source.next = { status }
        val coordinator = StatusCoordinator(source, FakeOps(), this, clock = { 1_000L })
        coordinator.reboot()
        coordinator.tick()
        assertNull(coordinator.hold.value)
        assertTrue(coordinator.notice.value!!.contains("可能不生效"))
    }

    @Test fun powerOffHoldWaitsForConfirmation() = runTest {
        var now = 1_000L
        val source = FakeSource()
        source.next = { throw DeviceException(DeviceError.Unreachable) }
        val coordinator = StatusCoordinator(source, FakeOps(), this, clock = { now })
        coordinator.powerOff()
        coordinator.tick()
        assertTrue(coordinator.hold.value is HoldState.PowerOff)
        now = 6_000L
        source.next = { status }
        coordinator.tick()
        assertTrue(coordinator.hold.value is HoldState.PowerOff)
        assertEquals(status, coordinator.sample.value.status)
        coordinator.confirmPoweredOn()
        assertNull(coordinator.hold.value)
    }
}
```

- [ ] **Step 3: 运行确认失败**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests "com.sunzehui.wifimanage.protocol.BatteryEstimatorTest" --tests "com.sunzehui.wifimanage.data.StatusCoordinatorTest"`
Expected: 编译失败（`BatteryEstimator` / `StatusCoordinator` 不存在）。

- [ ] **Step 4: 实现 BatteryEstimator.kt**

```kotlin
package com.sunzehui.wifimanage.protocol

import java.time.Instant
import java.time.ZoneId
import java.util.Locale

data class BatteryEta(val value: String, val note: String)

class BatteryEstimator(
    private val clock: () -> Long = System::currentTimeMillis,
    private val zone: ZoneId = ZoneId.systemDefault(),
) {
    private data class Sample(val t: Long, val p: Int, val seed: Boolean = false)

    private var run = mutableListOf<Sample>()
    private var lastRate: Pair<Double, Long>? = null
    private var seeded = false

    fun estimate(percent: Int, charging: Boolean): BatteryEta {
        val now = clock()
        run = run.filter { now - it.t < KEEP_MS }.toMutableList()

        if (run.isEmpty() && !seeded && lastRate == null) {
            val seedAt = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
                .atTime(SEED_HOUR, 0).atZone(zone).toInstant().toEpochMilli()
            if (now > seedAt && now - seedAt <= SEED_MAX_AGE_MS) {
                run = mutableListOf(Sample(seedAt, SEED_PERCENT, seed = true))
                seeded = true
            }
        }

        if (run.isNotEmpty() && run.first().seed &&
            (charging || (percent >= run.first().p && now - run.first().t > SEED_STALE_MS))
        ) {
            run.clear()
            seeded = true
        }

        if (charging) {
            if (run.isEmpty()) run.add(Sample(now, percent))
            val observed = rate(run)
            if (observed > 0) lastRate = observed to now
            run.clear()
            val effective = observed.takeIf { it > 0 }
                ?: lastRate?.takeIf { now - it.second < KEEP_MS / 2 }?.first
                ?: REF_RATE
            return BatteryEta(
                value = "约 " + fmtDur(percent / effective),
                note = "充电中 · " + oneDecimal(effective) + " %/时",
            )
        }

        val prev = run.lastOrNull()
        if (prev != null && percent > prev.p) {
            val observed = rate(run)
            if (observed > 0) lastRate = observed to now
            run.clear()
        }
        if (run.isEmpty()) run.add(Sample(now, percent))
        val tail = run.last()
        if (percent < tail.p || now - tail.t > SAMPLE_GAP_MS) run.add(Sample(now, percent))
        if (run.size > 240) run = run.takeLast(240).toMutableList()

        val observed = rate(run)
        val stored = lastRate?.takeIf { now - it.second < KEEP_MS / 2 }?.first ?: 0.0
        val effective = observed.takeIf { it > 0 } ?: stored.takeIf { it > 0 } ?: REF_RATE
        val note = when {
            observed > 0 -> "耗电 " + oneDecimal(observed) + " %/时"
            stored > 0 -> "沿用上次 " + oneDecimal(stored) + " %/时"
            else -> "参考 " + oneDecimal(REF_RATE) + " %/时" +
                if (minutes(run, now) >= 1) " · 已采 ${minutes(run, now)} 分" else ""
        }
        return BatteryEta(value = "约 " + fmtDur(percent / effective), note = note)
    }

    fun reset() {
        run.clear()
        lastRate = null
        seeded = false
    }

    private fun rate(samples: List<Sample>): Double {
        if (samples.size < 2) return 0.0
        val first = samples.first()
        val last = samples.last()
        val hours = (last.t - first.t) / 3_600_000.0
        val drained = first.p - last.p
        return if (hours < 1 || drained <= 0) 0.0 else drained / hours
    }

    private fun minutes(samples: List<Sample>, now: Long): Long =
        if (samples.isEmpty()) 0 else Math.round((now - samples.first().t) / 60_000.0)

    private fun oneDecimal(value: Double): String =
        String.format(Locale.US, "%.1f", value)

    private fun fmtDur(hours: Double): String {
        if (!hours.isFinite() || hours <= 0) return "--"
        if (hours > 48) return "＞48 小时"
        var total = Math.round(hours * 60)
        val days = total / 1440
        total %= 1440
        val hh = total / 60
        val mm = total % 60
        return when {
            days > 0 -> "$days 天 $hh 小时"
            hh > 0 -> "$hh 小时 $mm 分"
            else -> "$mm 分"
        }
    }

    private companion object {
        const val SEED_HOUR = 9
        const val SEED_PERCENT = 75
        const val REF_RATE = 8.0
        const val KEEP_MS = 86_400_000L
        const val SAMPLE_GAP_MS = 300_000L
        const val SEED_MAX_AGE_MS = 12 * 3_600_000L
        const val SEED_STALE_MS = 2 * 3_600_000L
    }
}
```

- [ ] **Step 5: 实现 StatusCoordinator.kt**

```kotlin
package com.sunzehui.wifimanage.data

import com.sunzehui.wifimanage.protocol.DeviceError
import com.sunzehui.wifimanage.protocol.DeviceException
import com.sunzehui.wifimanage.protocol.DeviceStatus
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

data class StatusSample(
    val status: DeviceStatus?,
    val error: DeviceError?,
    val ts: Long,
)

sealed interface HoldState {
    data class Reboot(val since: Long, val sawDown: Boolean = false) : HoldState
    data class PowerOff(val since: Long) : HoldState
}

class StatusCoordinator(
    private val source: StatusSource,
    private val ops: DeviceOps,
    private val scope: CoroutineScope,
    private val clock: () -> Long = System::currentTimeMillis,
    private val intervalMs: Long = 5_000,
    private val log: (String) -> Unit = {},
) {
    private val _sample = MutableStateFlow(StatusSample(null, null, 0))
    val sample: StateFlow<StatusSample> = _sample

    private val _hold = MutableStateFlow<HoldState?>(null)
    val hold: StateFlow<HoldState?> = _hold

    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice

    private var job: Job? = null
    private var lastGoodTs = 0L

    fun start() {
        if (job?.isActive == true) return
        job = scope.launch {
            while (isActive) {
                tick()
                delay(intervalMs)
            }
        }
    }

    fun stop() {
        job?.cancel()
        job = null
    }

    internal suspend fun tick() {
        val now = clock()
        val active = _hold.value
        if (active is HoldState.Reboot && now - active.since > HOLD_MAX_MS) {
            _hold.value = null
        }
        try {
            val data = source.status()
            _sample.value = StatusSample(data, null, now)
            lastGoodTs = now
            val after = _hold.value
            if (after is HoldState.Reboot) {
                _hold.value = null
                _notice.value = if (after.sawDown) {
                    "设备已重启完成"
                } else {
                    "设备仍在运行，没观察到重启 —— 这条指令在这版固件上可能不生效"
                }
            }
            log("sample ok ts=$now")
        } catch (e: CancellationException) {
            throw e
        } catch (e: DeviceException) {
            val duringHold = _hold.value
            if (duringHold is HoldState.Reboot && !duringHold.sawDown) {
                _hold.value = duringHold.copy(sawDown = true)
            }
            if (_hold.value == null) {
                _sample.value = StatusSample(null, e.kind, if (lastGoodTs > 0) lastGoodTs else now)
            }
            log("sample fail ${e.kind::class.simpleName}")
        } catch (e: Exception) {
            if (_hold.value == null) {
                _sample.value = StatusSample(
                    null,
                    DeviceError.Unexpected(e.message ?: "未知错误"),
                    if (lastGoodTs > 0) lastGoodTs else now,
                )
            }
            log("sample crash ${e.message}")
        }
    }

    suspend fun reboot() {
        ops.reboot()
        _hold.value = HoldState.Reboot(clock())
    }

    suspend fun powerOff() {
        ops.poweroff()
        _hold.value = HoldState.PowerOff(clock())
    }

    fun confirmPoweredOn() {
        _hold.value = null
    }

    fun consumeNotice() {
        _notice.value = null
    }

    private companion object {
        const val HOLD_MAX_MS = 5 * 60 * 1000L
    }
}
```

- [ ] **Step 6: 实现 Components.kt**

```kotlin
package com.sunzehui.wifimanage.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sunzehui.wifimanage.data.HoldState
import kotlinx.coroutines.delay

@Composable
fun MifiCard(
    modifier: Modifier = Modifier,
    title: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(MifiCard)
            .border(1.dp, MifiBorder, RoundedCornerShape(16.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (title != null) {
            Text(title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = MifiText)
        }
        content()
    }
}

@Composable
fun KvRow(key: String, value: String, valueColor: Color = MifiText) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(key, color = MifiMuted, fontSize = 13.sp)
        Text(value, color = valueColor, fontSize = 13.sp, textAlign = TextAlign.End)
    }
}

@Composable
fun ErrorBanner(message: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(MifiBad.copy(alpha = 0.12f))
            .padding(12.dp),
    ) {
        Text(message, color = MifiBad, fontSize = 13.sp)
    }
}

@Composable
fun HoldBanner(hold: HoldState, onConfirm: () -> Unit) {
    var now by remember { mutableStateOf(System.currentTimeMillis()) }
    LaunchedEffect(hold) {
        while (true) {
            delay(1_000)
            now = System.currentTimeMillis()
        }
    }
    val reboot = hold is HoldState.Reboot
    val since = if (reboot) (hold as HoldState.Reboot).since else (hold as HoldState.PowerOff).since
    val seconds = ((now - since) / 1000).coerceAtLeast(0)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (reboot) MifiWarn.copy(alpha = 0.12f) else MifiBad.copy(alpha = 0.12f))
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                if (reboot) "设备正在重启" else "设备已关机",
                color = if (reboot) MifiWarn else MifiBad,
                fontSize = 14.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                if (reboot) {
                    "已用时 $seconds 秒，通常 60 秒左右恢复；恢复后本页会自动重新读取数据。"
                } else {
                    "整机已断电。请长按机身上的电源键开机，开机后点右侧按钮重新连接。"
                },
                color = MifiMuted,
                fontSize = 12.sp,
            )
        }
        if (!reboot) {
            TextButton(onClick = onConfirm) { Text("我已开机", color = MifiAccent) }
        }
    }
}

@Composable
fun EntryCard(title: String, description: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(MifiCard)
            .border(1.dp, MifiBorder, RoundedCornerShape(16.dp))
            .clickable(onClick = onClick)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, color = MifiText, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            Text(description, color = MifiMuted, fontSize = 12.sp)
        }
        Text("›", color = MifiMuted, fontSize = 22.sp)
    }
}

@Composable
fun SignalBars(bars: Int) {
    Row(
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        repeat(4) { index ->
            Box(
                Modifier
                    .width(4.dp)
                    .height((6 + index * 4).dp)
                    .clip(RoundedCornerShape(1.dp))
                    .background(if (index < bars) MifiGood else MifiBorder),
            )
        }
    }
}

@Composable
fun RateChart(points: List<RatePoint>, modifier: Modifier = Modifier) {
    Canvas(modifier.fillMaxWidth().height(120.dp)) {
        val maxValue = maxOf(65_536f, (points.maxOfOrNull { maxOf(it.rx, it.tx) } ?: 0L).toFloat()) * 1.15f
        val slots = 60
        fun x(index: Int): Float = (index + (slots - points.size)) / (slots - 1f) * size.width
        fun y(value: Long): Float =
            size.height - (value / maxValue) * (size.height - 6.dp.toPx()) - 3.dp.toPx()

        drawLine(
            MifiBorder,
            Offset(0f, size.height - 1.dp.toPx()),
            Offset(size.width, size.height - 1.dp.toPx()),
            1.dp.toPx(),
        )
        fun series(select: (RatePoint) -> Long, color: Color) {
            if (points.size < 2) return
            val path = Path()
            points.forEachIndexed { index, point ->
                if (index == 0) path.moveTo(x(index), y(select(point)))
                else path.lineTo(x(index), y(select(point)))
            }
            drawPath(path, color, style = Stroke(width = 1.6.dp.toPx()))
        }
        series({ it.rx }, MifiGood)
        series({ it.tx }, MifiAccent)
    }
}
```

- [ ] **Step 7: 实现 HomeViewModel 与工厂**

`ui/HomeViewModel.kt`：

```kotlin
package com.sunzehui.wifimanage.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.sunzehui.wifimanage.data.DeviceRepository
import com.sunzehui.wifimanage.data.HoldState
import com.sunzehui.wifimanage.data.StatusCoordinator
import com.sunzehui.wifimanage.data.StatusSample
import com.sunzehui.wifimanage.protocol.BandInfo
import com.sunzehui.wifimanage.protocol.BatteryEta
import com.sunzehui.wifimanage.protocol.BatteryEstimator
import com.sunzehui.wifimanage.protocol.DeviceStatus
import com.sunzehui.wifimanage.protocol.SimInfo
import com.sunzehui.wifimanage.protocol.Traffic
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

data class RatePoint(val rx: Long, val tx: Long)

class HomeViewModel(
    private val coordinator: StatusCoordinator,
    repository: DeviceRepository,
) : ViewModel() {
    val sample: StateFlow<StatusSample> = coordinator.sample
    val hold: StateFlow<HoldState?> = coordinator.hold
    val notice: StateFlow<String?> = coordinator.notice
    val traffic: StateFlow<Traffic?> = repository.lastTraffic
    val sim: StateFlow<SimInfo?> = repository.lastSim
    val band: StateFlow<BandInfo?> = repository.lastBand

    private val _heavy = MutableStateFlow<DeviceStatus?>(null)
    val heavy: StateFlow<DeviceStatus?> = _heavy

    private val _history = MutableStateFlow<List<RatePoint>>(emptyList())
    val history: StateFlow<List<RatePoint>> = _history

    private val _batteryEta = MutableStateFlow<BatteryEta?>(null)
    val batteryEta: StateFlow<BatteryEta?> = _batteryEta

    private val estimator = BatteryEstimator()
    private var lastHeavyAt = 0L

    init {
        viewModelScope.launch {
            coordinator.sample.collect { sample ->
                val data = sample.status ?: return@collect
                val now = System.currentTimeMillis()
                if (_heavy.value == null || now - lastHeavyAt >= 30_000) {
                    _heavy.value = data
                    lastHeavyAt = now
                }
                _history.value = (_history.value + RatePoint(data.rate.rxRate, data.rate.txRate)).takeLast(60)
                val percent = data.battery.percent
                if (data.battery.present && percent != null) {
                    _batteryEta.value = estimator.estimate(percent, data.battery.charging)
                }
            }
        }
    }

    fun consumeNotice() {
        coordinator.consumeNotice()
    }

    fun confirmPoweredOn() {
        coordinator.confirmPoweredOn()
        viewModelScope.launch { coordinator.tick() }
    }
}
```

`ui/AppViewModelFactory.kt`：

```kotlin
package com.sunzehui.wifimanage.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.sunzehui.wifimanage.AppContainer

class AppViewModelFactory(private val container: AppContainer) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T = when {
        modelClass.isAssignableFrom(HomeViewModel::class.java) ->
            HomeViewModel(container.coordinator, container.repository) as T
        else -> error("未知 ViewModel: ${modelClass.name}")
    }
}
```

- [ ] **Step 8: 实现 HomeScreen.kt**

```kotlin
package com.sunzehui.wifimanage.ui

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.sunzehui.wifimanage.data.HoldState
import com.sunzehui.wifimanage.protocol.DeviceStatus
import com.sunzehui.wifimanage.protocol.Display
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable
fun HomeScreen(
    vm: HomeViewModel,
    onOpenTraffic: () -> Unit,
    onOpenDevices: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val sample by vm.sample.collectAsStateWithLifecycle()
    val heavy by vm.heavy.collectAsStateWithLifecycle()
    val hold by vm.hold.collectAsStateWithLifecycle()
    val notice by vm.notice.collectAsStateWithLifecycle()
    val history by vm.history.collectAsStateWithLifecycle()
    val batteryEta by vm.batteryEta.collectAsStateWithLifecycle()
    val traffic by vm.traffic.collectAsStateWithLifecycle()
    val context = LocalContext.current

    LaunchedEffect(notice) {
        notice?.let {
            Toast.makeText(context, it, Toast.LENGTH_SHORT).show()
            vm.consumeNotice()
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        hold?.let { HoldBanner(it, onConfirm = { vm.confirmPoweredOn() }) }
        sample.error?.let { ErrorBanner(it.userMessage) }

        val data = heavy ?: sample.status
        val live = sample.status

        if (data == null) {
            MifiCard(title = "设备状态") {
                Text("正在读取设备数据…", color = MifiMuted, fontSize = 13.sp)
            }
        } else {
            StatusCard(data, batteryEta)
        }

        if (live != null) {
            SpeedCard(live, history)
        }

        val trafficDesc = traffic?.let { t ->
            val left = t.quotaBytes - t.monthUsedBytes
            if (t.quotaBytes > 0) {
                "本月已用 ${Display.fmtBytes(t.monthUsedBytes)} · 剩余 " +
                    (if (left >= 0) Display.fmtBytes(left) else "已超出 ${Display.fmtBytes(-left)}")
            } else {
                "本月已用 ${Display.fmtBytes(t.monthUsedBytes)}，点击查看详情"
            }
        } ?: "点击查看本月流量统计"
        EntryCard("流量使用", trafficDesc, onOpenTraffic)

        if (data != null) {
            DeviceInfoCard(data)
            EntryCard(
                "连接设备",
                "当前已连接 ${data.lan.connectedCount} 台设备，点击查看明细",
                onOpenDevices,
            )
        }

        Text(
            "更新于 " + if (sample.ts > 0) {
                Instant.ofEpochMilli(sample.ts).atZone(ZoneId.systemDefault())
                    .format(DateTimeFormatter.ofPattern("HH:mm:ss"))
            } else {
                "--"
            },
            color = MifiMuted,
            fontSize = 11.sp,
            modifier = Modifier.fillMaxWidth(),
        )
        Text("网速每 5 秒刷新 · 其他信息每 30 秒刷新", color = MifiMuted, fontSize = 11.sp)
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun StatusCard(data: DeviceStatus, eta: com.sunzehui.wifimanage.protocol.BatteryEta?) {
    val connected = data.network.status == "connected"
    MifiCard(title = "设备状态") {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(
                if (connected) "已联网" else "未联网",
                color = if (connected) MifiGood else MifiBad,
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
            )
            Text(
                Display.netLabel(data.network.mode),
                color = MifiMuted,
                fontSize = 12.sp,
                modifier = Modifier
                    .clip(RoundedCornerShape(6.dp))
                    .background(MifiCardInner)
                    .padding(horizontal = 8.dp, vertical = 3.dp),
            )
        }
        Text(
            data.network.operator + if (data.network.roaming) " · 漫游中" else "",
            color = MifiMuted,
            fontSize = 13.sp,
        )
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SignalBars(data.network.signalBars)
            Column {
                Text(Display.signalLabel(data.network.rsrpDbm), color = MifiText, fontSize = 13.sp)
                Text(
                    data.network.rsrpDbm?.let { "RSRP $it dBm" } ?: "--",
                    color = MifiMuted,
                    fontSize = 11.sp,
                )
            }
        }
        HorizontalDivider(color = MifiBorder)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    data.battery.percent?.let { "$it%" } ?: "--",
                    color = MifiText,
                    fontSize = 30.sp,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    if (data.battery.charging) "${data.battery.state} (充电中)" else data.battery.state,
                    color = MifiMuted,
                    fontSize = 12.sp,
                )
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(eta?.value ?: "剩余续航", color = MifiText, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                Text(eta?.note ?: "--", color = MifiMuted, fontSize = 11.sp)
            }
        }
        val percent = data.battery.percent ?: 0
        LinearProgressIndicator(
            progress = { percent.coerceIn(0, 100) / 100f },
            modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)),
            color = when {
                percent <= 15 -> MifiBad
                percent <= 30 || data.battery.charging -> MifiWarn
                else -> MifiGood
            },
            trackColor = MifiCardInner,
        )
    }
}

@Composable
private fun SpeedCard(data: DeviceStatus, history: List<RatePoint>) {
    val connected = data.network.status == "connected"
    MifiCard(title = "网络速度") {
        Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
            Column {
                Text("↓ 下载", color = MifiMuted, fontSize = 12.sp)
                Text(Display.fmtRate(data.rate.rxRate), color = MifiGood, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
            }
            Column {
                Text("↑ 上传", color = MifiMuted, fontSize = 12.sp)
                Text(Display.fmtRate(data.rate.txRate), color = MifiAccent, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
            }
        }
        RateChart(history)
        Text(
            if (connected) {
                Display.signalLabel(data.network.rsrpDbm) + "，网络运行正常"
            } else {
                "当前未联网，无法测速"
            },
            color = MifiMuted,
            fontSize = 12.sp,
        )
    }
}

@Composable
private fun DeviceInfoCard(data: DeviceStatus) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    MifiCard(title = "设备信息") {
        KvRow("设备型号", data.device.model)
        KvRow("固件版本", data.device.firmware.ifBlank { "--" })
        KvRow("运行时间", data.lan.uptime.ifBlank { "--" })
        KvRow("网络类型", Display.netLabel(data.network.mode))
        TextButton(onClick = { expanded = !expanded }) {
            Text(if (expanded) "收起设备详情 ⌃" else "查看设备详情 ⌄", color = MifiAccent, fontSize = 13.sp)
        }
        if (expanded) {
            KvRow("SN 序列号", data.device.sn.orDash())
            KvRow("IMEI", data.device.imei.orDash())
            KvRow("ICCID (SIM 卡号)", data.device.iccid.orDash())
            KvRow("管理地址", "${data.lan.ip.orDash()} · ${data.lan.mac.orDash()}")
            KvRow("网络地址 (WAN IP)", data.network.ipv4.orDash())
            KvRow(
                "网关 / DNS",
                (listOf(data.network.gateway) + data.network.dns).filter { it.isNotBlank() }
                    .joinToString(" / ").ifBlank { "--" },
            )
            KvRow("接入点 (APN)", data.network.apn.orDash())
            KvRow("信号强度 RSRP", data.network.rsrpDbm?.let { "$it dBm" } ?: "--")
            KvRow("信号质量 RSRQ", data.network.rsrqDb?.let { "$it dB" } ?: "--")
            KvRow("抗干扰 SINR", data.network.sinr?.let { "$it dB" } ?: "--")
            KvRow("信号强度 RSSI", data.network.rssiDbm?.let { "$it dBm" } ?: "--")
            KvRow("PCI / 小区 ID", "${data.network.pci ?: "--"} / ${data.network.cellId.ifBlank { "--" }}")
        }
    }
}

private fun String.orDash(): String = ifBlank { "--" }
```

- [ ] **Step 9: 接入容器与路由**

`AppContainer.kt` 改为（新增协程作用域、协调器与设置变更入口）：

```kotlin
package com.sunzehui.wifimanage

import android.content.Context
import android.util.Log
import com.sunzehui.wifimanage.data.AndroidKeystoreCipher
import com.sunzehui.wifimanage.data.DataStoreSettingsStorage
import com.sunzehui.wifimanage.data.DeviceClient
import com.sunzehui.wifimanage.data.DeviceRepository
import com.sunzehui.wifimanage.data.MgxClient
import com.sunzehui.wifimanage.data.SettingsStore
import com.sunzehui.wifimanage.data.StatusCoordinator
import com.sunzehui.wifimanage.data.UrlConnectionTransport
import com.sunzehui.wifimanage.protocol.DeviceCredentials
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

class AppContainer(context: Context) {
    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    val settings = SettingsStore(DataStoreSettingsStorage(appContext), AndroidKeystoreCipher())

    private val transport = UrlConnectionTransport()
    private val deviceClient = DeviceClient(transport) {
        DeviceCredentials("admin", settings.snapshot().devicePassword)
    }

    val repository = DeviceRepository(
        deviceClient,
        MgxClient(transport) { settings.snapshot().mgxCard },
    )

    val coordinator = StatusCoordinator(
        source = repository,
        ops = repository,
        scope = scope,
        log = { Log.d("MifiPoll", it) },
    )

    suspend fun credentialsChanged() {
        deviceClient.resetAuthState()
        coordinator.tick()
    }
}
```

`AppRoot.kt` 做三处修改：

1. 在 `val context = LocalContext.current` 之后加生命周期启停：

```kotlin
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> container.coordinator.start()
                Lifecycle.Event.ON_STOP -> container.coordinator.stop()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
```

2. `when (tab)` 的 `Tab.Home` 分支改为：

```kotlin
                Tab.Home -> {
                    val factory = remember(container) { AppViewModelFactory(container) }
                    val home: HomeViewModel = viewModel(factory = factory)
                    HomeScreen(
                        vm = home,
                        onOpenTraffic = { tab = Tab.Traffic },
                        onOpenDevices = { tab = Tab.Devices },
                    )
                }
```

3. 设置与首次启动保存成功后刷新会话：

- `FirstRunGate` 的 `scope.launch` 内，在两次 `set...` 之后加 `container.credentialsChanged()`
- `SettingsForm` 的 `scope.launch` 内，在三个 `set...` 之后加 `container.credentialsChanged()`

所需新增 import：

```kotlin
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.compose.viewModel
```

`LocalLifecycleOwner` 用 `androidx.lifecycle.compose.LocalLifecycleOwner`（2.8+），删掉 `androidx.compose.ui.platform.LocalLifecycleOwner` 那行。

- [ ] **Step 10: 运行测试**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests "com.sunzehui.wifimanage.protocol.BatteryEstimatorTest" --tests "com.sunzehui.wifimanage.data.StatusCoordinatorTest"`
Expected: 9 个测试 PASS（续航 5、协调器 4）。

- [ ] **Step 11: 构建与真机冒烟**

Run: `cd android && ./gradlew :app:assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk`
Expected: 首页出现设备状态、网速曲线、流量/设备入口、设备信息；`adb logcat -s MifiPoll:D` 每 5 秒一行 `sample ok`。

- [ ] **Step 12: 提交**

```bash
git add android/app/src/main/kotlin/com/sunzehui/wifimanage/protocol/BatteryEstimator.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/data/StatusCoordinator.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/Components.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/HomeViewModel.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/HomeScreen.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/AppViewModelFactory.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/AppContainer.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/AppRoot.kt \
  android/app/src/test/kotlin/com/sunzehui/wifimanage/protocol/BatteryEstimatorTest.kt \
  android/app/src/test/kotlin/com/sunzehui/wifimanage/data/StatusCoordinatorTest.kt
git commit -m "首页: 5 秒状态轮询、30 秒重区块节奏、续航估算与网速曲线"
```

---

### Task 13: 通知栏状态条

**Files:**
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/notify/StatusNotifier.kt`
- Modify: `android/app/src/main/kotlin/com/sunzehui/wifimanage/MifiApp.kt`
- Modify: `android/app/src/main/kotlin/com/sunzehui/wifimanage/AppContainer.kt`
- Modify: `android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/AppRoot.kt`
- Modify: `android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/SettingsForm.kt`

**Interfaces:**
- Consumes: `StatusSample`、`HoldState`、`NotifyPayloads`
- Produces:
  - `class StatusNotifier(context)`，方法 `ensureChannel()`、`update(sample: StatusSample, hold: HoldState?, enabled: Boolean)`、`cancel()`
  - `StatusNotifier.isAllowed(context): Boolean`
  - `SettingsForm(..., notificationsAllowed: Boolean = true, onOpenNotificationSettings: (() -> Unit)? = null)`

- [ ] **Step 1: 实现 StatusNotifier.kt**

```kotlin
package com.sunzehui.wifimanage.notify

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.text.format.DateUtils
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.sunzehui.wifimanage.R
import com.sunzehui.wifimanage.data.HoldState
import com.sunzehui.wifimanage.data.StatusSample
import com.sunzehui.wifimanage.protocol.NotifyPayload
import com.sunzehui.wifimanage.protocol.NotifyPayloads
import com.sunzehui.wifimanage.ui.MainActivity

class StatusNotifier(private val context: Context) {
    private val manager = NotificationManagerCompat.from(context)

    fun ensureChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "设备状态",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "前台查看设备状态时显示"
            setShowBadge(false)
            enableVibration(false)
            setSound(null, null)
        }
        manager.createNotificationChannel(channel)
    }

    @SuppressLint("MissingPermission")
    fun update(sample: StatusSample, hold: HoldState?, enabled: Boolean) {
        if (!enabled || !isAllowed(context)) {
            cancel()
            return
        }
        val payload = payloadOf(sample, hold) ?: return
        val relative = DateUtils.getRelativeTimeSpanString(
            if (payload.ts > 0) payload.ts else System.currentTimeMillis(),
            System.currentTimeMillis(),
            DateUtils.MINUTE_IN_MILLIS,
        ).toString()
        val bigText = buildString {
            append(payload.line1)
            if (payload.line2.isNotBlank()) append('\n').append(payload.line2)
        }
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_mifi)
            .setContentTitle(payload.title)
            .setContentText(payload.line1)
            .setStyle(NotificationCompat.BigTextStyle().bigText(bigText))
            .setSubText(relative)
            .setWhen(if (payload.ts > 0) payload.ts else System.currentTimeMillis())
            .setShowWhen(true)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setColor(if (payload.bad) 0xFFF87171.toInt() else 0xFF34D399.toInt())
            .setContentIntent(pendingIntent())
            .build()
        manager.notify(NOTIFICATION_ID, notification)
    }

    fun cancel() {
        manager.cancel(NOTIFICATION_ID)
    }

    private fun payloadOf(sample: StatusSample, hold: HoldState?): NotifyPayload? = when {
        hold is HoldState.Reboot -> NotifyPayload(
            title = "随身WiFi · 正在重启",
            line1 = "等待设备恢复…",
            line2 = "重启期间不产生新通知",
            ts = hold.since,
            bad = false,
        )
        hold is HoldState.PowerOff -> NotifyPayload(
            title = "随身WiFi · 已关机",
            line1 = "请长按机身电源键开机",
            line2 = "开机后回到应用点「我已开机」",
            ts = hold.since,
            bad = false,
        )
        sample.status != null && sample.error == null ->
            NotifyPayloads.normal(sample.status, sample.ts)
        sample.error != null -> NotifyPayloads.degraded(sample.error, sample.ts)
        else -> null
    }

    private fun pendingIntent(): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        return PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    companion object {
        private const val CHANNEL_ID = "device_status"
        private const val NOTIFICATION_ID = 1001

        fun isAllowed(context: Context): Boolean =
            Build.VERSION.SDK_INT < 33 ||
                ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.POST_NOTIFICATIONS,
                ) == PackageManager.PERMISSION_GRANTED
    }
}
```

- [ ] **Step 2: 容器与 Application 接上通知**

`AppContainer.kt` 增加字段（import `com.sunzehui.wifimanage.notify.StatusNotifier`）：

```kotlin
    val notifier = StatusNotifier(appContext)
```

`MifiApp.kt`：

```kotlin
    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        container.notifier.ensureChannel()
    }
```

- [ ] **Step 3: AppRoot 推送与权限**

在 `AppRoot` 的 `val context = LocalContext.current` 之后、早退判断之前**不要**加；在 `if (settings.devicePassword.isBlank()) { ... return }` 之后加：

```kotlin
    val sample by container.coordinator.sample.collectAsStateWithLifecycle()
    val hold by container.coordinator.hold.collectAsStateWithLifecycle()
    var notificationsAllowed by remember { mutableStateOf(StatusNotifier.isAllowed(context)) }

    NotificationPermissionEffect { notificationsAllowed = it }

    LaunchedEffect(sample, hold, settings.notifyEnabled) {
        container.notifier.update(sample, hold, settings.notifyEnabled)
    }
    DisposableEffect(Unit) {
        onDispose { container.notifier.cancel() }
    }
```

同一文件末尾加：

```kotlin
@Composable
private fun NotificationPermissionEffect(onChanged: (Boolean) -> Unit) {
    val context = LocalContext.current
    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { onChanged(StatusNotifier.isAllowed(context)) }
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= 33 && !StatusNotifier.isAllowed(context)) {
            launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}
```

新增 import：

```kotlin
import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import com.sunzehui.wifimanage.notify.StatusNotifier
```

生命周期观察器补一个 `ON_RESUME` 分支，并在其中刷新权限状态：

```kotlin
                Lifecycle.Event.ON_RESUME -> notificationsAllowed = StatusNotifier.isAllowed(context)
```

注意：`notificationsAllowed` 的声明必须在这段观察器代码之前；把 Step 3 的代码块放在 `BackHandler` 之前、观察器之后即可。

- [ ] **Step 4: 设置页提示权限**

`SettingsForm.kt` 签名改为：

```kotlin
@Composable
fun SettingsForm(
    initial: Settings,
    submitLabel: String,
    showCancel: Boolean,
    onSubmit: (password: String, card: String, notify: Boolean) -> Unit,
    onCancel: () -> Unit,
    notificationsAllowed: Boolean = true,
    onOpenNotificationSettings: (() -> Unit)? = null,
)
```

在 Switch 的 `Row` 之后加：

```kotlin
        if (notify && !notificationsAllowed) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "通知权限未开启，请到系统设置允许通知",
                    color = MifiWarn,
                    fontSize = 12.sp,
                    modifier = Modifier.weight(1f),
                )
                if (onOpenNotificationSettings != null) {
                    TextButton(onClick = onOpenNotificationSettings) {
                        Text("去设置", color = MifiAccent, fontSize = 12.sp)
                    }
                }
            }
        }
```

新增 import：

```kotlin
import androidx.compose.material3.TextButton
```

`AppRoot` 打开设置弹层时传入：

```kotlin
                notificationsAllowed = notificationsAllowed,
                onOpenNotificationSettings = {
                    context.startActivity(
                        Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                            .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, context.packageName),
                    )
                },
```

- [ ] **Step 5: 构建并验证通知**

Run: `cd android && ./gradlew :app:assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk`
Expected: 允许通知后通知栏出现 1 条「4G LTE · 已连接」；关闭设置里的开关后立即消失，重开恢复。

Run: `adb shell dumpsys notification --noredact | grep -c 'com.sunzehui.wifimanage'`
Expected: 开关打开时 ≥ 1，关闭时 0。

- [ ] **Step 6: 提交**

```bash
git add android/app/src/main/kotlin/com/sunzehui/wifimanage/notify/StatusNotifier.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/MifiApp.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/AppContainer.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/AppRoot.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/SettingsForm.kt
git commit -m "通知: 前台状态条、降级冻结与 Android 13 权限"
```

---

### Task 14: 流量页

**Files:**
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/UiText.kt`
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/TrafficViewModel.kt`
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/TrafficScreen.kt`
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/QuotaDialog.kt`
- Modify: `android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/Components.kt`
- Modify: `android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/AppViewModelFactory.kt`
- Modify: `android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/AppRoot.kt`
- Test: `android/app/src/test/kotlin/com/sunzehui/wifimanage/ui/TrafficViewModelTest.kt`

**Interfaces:**
- Consumes: `TrafficSource`（`traffic` / `setQuota` / `remoteTraffic`）、`Traffic`、`RemoteTraffic`、`Display.fmtBytes`、`MifiCard` / `KvRow` / `ErrorBanner`、`container.repository`
- Produces:
  - `object UiText { fun time(ts: Long): String; fun error(e: Throwable): String }`
  - `object TrafficText { fun monthUsed(bytes: Long): String; fun quotaTotal(bytes: Long): String; fun left(bytes: Long): String; fun percent(used: Long, total: Long): Double; fun pctText(used: Long, total: Long): String; fun remoteTotal(t: RemoteTraffic): String; fun packages(list: List<RemotePackage>): String?; fun quotaInput(gb: Double): String }`
  - `data class TrafficUiState(...)`、`class TrafficViewModel(source: TrafficSource, scope: CoroutineScope? = null)`
  - `@Composable fun TrafficScreen(vm: TrafficViewModel)`
  - `@Composable fun QuotaDialog(initialGb: Double?, saving: Boolean, onDismiss: () -> Unit, onSave: (Double) -> Unit)`
  - `@Composable fun MifiButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit)`

- [ ] **Step 1: 写失败测试**

`android/app/src/test/kotlin/com/sunzehui/wifimanage/ui/TrafficViewModelTest.kt`：

```kotlin
package com.sunzehui.wifimanage.ui

import com.sunzehui.wifimanage.data.TrafficSource
import com.sunzehui.wifimanage.protocol.DeviceError
import com.sunzehui.wifimanage.protocol.DeviceException
import com.sunzehui.wifimanage.protocol.RemoteTraffic
import com.sunzehui.wifimanage.protocol.Traffic
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

private const val GB = 1073741824L

class TrafficViewModelTest {
    private class FakeSource : TrafficSource {
        var traffic = Traffic(2L * GB, 10L * GB, 0L, "1 小时", "2 小时")
        var quotaGb: Double? = null
        var remoteError: Exception? = null

        override suspend fun traffic(): Traffic = traffic

        override suspend fun setQuota(gb: Double) {
            quotaGb = gb
            traffic = traffic.copy(quotaBytes = (gb * GB).toLong())
        }

        override suspend fun remoteTraffic(refresh: Boolean): RemoteTraffic {
            remoteError?.let { throw it }
            return RemoteTraffic("CARD1", "包月", "正常", "2026-12-31", 0L, 0L, 0L, true, emptyList())
        }
    }

    @Test fun loadsTrafficOnInit() = runTest {
        val fake = FakeSource()
        val vm = TrafficViewModel(fake, this)
        advanceUntilIdle()

        val s = vm.state.value
        assertFalse(s.loading)
        assertEquals(2L * GB, s.traffic?.monthUsedBytes)
        assertNotNull(s.updatedAt)
        assertEquals("2.00", TrafficText.monthUsed(2L * GB))
        assertEquals("1.50 GB", TrafficText.quotaTotal(3L * GB / 2))
        assertEquals("已超出 1.0 MB", TrafficText.left(-1048576L))
    }

    @Test fun savesQuotaAndReloads() = runTest {
        val fake = FakeSource()
        val vm = TrafficViewModel(fake, this)
        advanceUntilIdle()

        vm.setQuota(150.0)
        advanceUntilIdle()

        assertEquals(150.0, fake.quotaGb!!, 0.001)
        assertEquals((150.0 * GB).toLong(), vm.state.value.traffic?.quotaBytes)
        assertEquals("流量总量已保存", vm.state.value.toast)
        assertFalse(vm.state.value.quotaSaving)
    }

    @Test fun remoteFailureShowsMessage() = runTest {
        val fake = FakeSource().apply { remoteError = DeviceException(DeviceError.Unreachable) }
        val vm = TrafficViewModel(fake, this)
        advanceUntilIdle()

        vm.loadRemote(false)
        advanceUntilIdle()

        assertEquals("获取失败: 无法连接设备，请确认手机已连接到随身 WiFi", vm.state.value.remoteError)
        assertNull(vm.state.value.remote)
        assertFalse(vm.state.value.remoteLoading)
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests "com.sunzehui.wifimanage.ui.TrafficViewModelTest"`
Expected: 编译失败（`TrafficViewModel` / `TrafficText` 未定义）。

- [ ] **Step 3: 实现 UiText.kt**

```kotlin
package com.sunzehui.wifimanage.ui

import com.sunzehui.wifimanage.protocol.DeviceException
import com.sunzehui.wifimanage.protocol.Display
import com.sunzehui.wifimanage.protocol.RemotePackage
import com.sunzehui.wifimanage.protocol.RemoteTraffic
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object UiText {
    fun time(ts: Long): String = SimpleDateFormat("HH:mm:ss", Locale.CHINA).format(Date(ts))

    fun error(e: Throwable): String =
        if (e is DeviceException) e.kind.userMessage else (e.message ?: "未知错误")
}

object TrafficText {
    private const val GB = 1073741824.0

    fun monthUsed(bytes: Long): String = String.format(Locale.US, "%.2f", bytes / GB)

    fun quotaTotal(bytes: Long): String =
        if (bytes % 1073741824L == 0L) String.format(Locale.US, "%.0f GB", bytes / GB)
        else String.format(Locale.US, "%.2f GB", bytes / GB)

    fun left(bytes: Long): String =
        if (bytes >= 0) Display.fmtBytes(bytes) else "已超出 " + Display.fmtBytes(-bytes)

    fun percent(used: Long, total: Long): Double = if (total > 0) used * 100.0 / total else 0.0

    fun pctText(used: Long, total: Long): String =
        String.format(Locale.US, "%.1f %%", percent(used, total))

    fun remoteTotal(t: RemoteTraffic): String = when {
        t.unlimited || t.totalBytes <= 0 -> "不限量"
        t.totalBytes % 1073741824L == 0L -> String.format(Locale.US, "%.0f GB", t.totalBytes / GB)
        else -> String.format(Locale.US, "%.1f GB", t.totalBytes / GB)
    }

    fun packages(list: List<RemotePackage>): String? =
        if (list.isEmpty()) null
        else "当前生效: " + list.joinToString("、") { "${it.name}（${it.sizeGB} GB）" }

    fun quotaInput(gb: Double): String {
        val rounded = Math.round(gb * 10) / 10.0
        return if (rounded % 1.0 == 0.0) rounded.toInt().toString()
        else String.format(Locale.US, "%.1f", rounded)
    }
}
```

- [ ] **Step 4: 实现 TrafficViewModel.kt**

```kotlin
package com.sunzehui.wifimanage.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.sunzehui.wifimanage.data.TrafficSource
import com.sunzehui.wifimanage.protocol.RemoteTraffic
import com.sunzehui.wifimanage.protocol.Traffic
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class TrafficUiState(
    val traffic: Traffic? = null,
    val remote: RemoteTraffic? = null,
    val loading: Boolean = true,
    val remoteLoading: Boolean = false,
    val error: String? = null,
    val remoteError: String? = null,
    val updatedAt: Long? = null,
    val quotaSaving: Boolean = false,
    val toast: String? = null,
)

class TrafficViewModel(
    private val source: TrafficSource,
    scope: CoroutineScope? = null,
) : ViewModel() {
    private val scope = scope ?: viewModelScope
    private val _state = MutableStateFlow(TrafficUiState())
    val state: StateFlow<TrafficUiState> = _state

    init {
        scope.launch {
            load()
            loadRemote(false)
        }
    }

    suspend fun load() {
        _state.update { it.copy(loading = true, error = null) }
        try {
            val t = source.traffic()
            _state.update {
                it.copy(traffic = t, loading = false, updatedAt = System.currentTimeMillis())
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _state.update { it.copy(loading = false, error = UiText.error(e)) }
        }
    }

    fun refresh() {
        scope.launch { load() }
    }

    fun setQuota(gb: Double) {
        scope.launch {
            _state.update { it.copy(quotaSaving = true) }
            try {
                source.setQuota(gb)
                _state.update { it.copy(quotaSaving = false, toast = "流量总量已保存") }
                load()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(quotaSaving = false, toast = UiText.error(e)) }
            }
        }
    }

    fun loadRemote(refresh: Boolean) {
        scope.launch {
            _state.update { it.copy(remoteLoading = true, remoteError = null) }
            try {
                val remote = source.remoteTraffic(refresh)
                _state.update {
                    it.copy(remote = remote, remoteLoading = false)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update {
                    it.copy(remoteLoading = false, remoteError = "获取失败: ${UiText.error(e)}")
                }
            }
        }
    }

    fun consumeToast() {
        _state.update { it.copy(toast = null) }
    }
}
```

- [ ] **Step 5: 在 Components.kt 末尾加 MifiButton**

```kotlin
@Composable
fun MifiButton(
    text: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.height(40.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = MifiCardInner,
            contentColor = MifiText,
            disabledContainerColor = MifiCardInner.copy(alpha = 0.5f),
            disabledContentColor = MifiMuted,
        ),
        shape = RoundedCornerShape(10.dp),
    ) {
        Text(text, fontSize = 13.sp)
    }
}
```

新增 import：

```kotlin
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
```

`Components.kt` 已有 `RoundedCornerShape`、`dp`、`sp`、`Text`，无需重复。

- [ ] **Step 6: 实现 QuotaDialog.kt**

```kotlin
package com.sunzehui.wifimanage.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun QuotaDialog(
    initialGb: Double?,
    saving: Boolean,
    onDismiss: () -> Unit,
    onSave: (Double) -> Unit,
) {
    var text by remember {
        mutableStateOf(initialGb?.takeIf { it > 0 }?.let { TrafficText.quotaInput(it) } ?: "")
    }
    var error by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = MifiCard,
        titleContentColor = MifiText,
        textContentColor = MifiText,
        title = { Text("设置流量总量") },
        text = {
            Column {
                Text(
                    "输入本月套餐总量（GB）。剩余流量按「总量 − 设备已用」实时计算。填 0 表示清除设置（不限量）。",
                    color = MifiMuted,
                    fontSize = 12.sp,
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    label = { Text("总量 (GB)") },
                    singleLine = true,
                    enabled = !saving,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                )
                error?.let {
                    Spacer(Modifier.height(6.dp))
                    Text(it, color = MifiBad, fontSize = 12.sp)
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = !saving,
                onClick = {
                    val n = text.trim().toDoubleOrNull()
                    if (n == null || n < 0 || n > 100000) {
                        error = "请输入 0 - 100000 之间的数值（GB）"
                    } else {
                        error = null
                        onSave(n)
                    }
                },
            ) {
                Text(if (saving) "保存中…" else "保存", color = MifiAccent)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("取消", color = MifiMuted) }
        },
    )
}
```

- [ ] **Step 7: 实现 TrafficScreen.kt**

```kotlin
package com.sunzehui.wifimanage.ui

import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.sunzehui.wifimanage.protocol.Display

@Composable
fun TrafficScreen(vm: TrafficViewModel) {
    val state by vm.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var quotaOpen by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(state.toast) {
        val msg = state.toast ?: return@LaunchedEffect
        Toast.makeText(context, msg, Toast.LENGTH_SHORT).show()
        vm.consumeToast()
    }

    if (quotaOpen) {
        QuotaDialog(
            initialGb = state.traffic?.quotaBytes?.takeIf { it > 0 }?.let { it / 1073741824.0 },
            saving = state.quotaSaving,
            onDismiss = { quotaOpen = false },
            onSave = { gb ->
                vm.setQuota(gb)
                quotaOpen = false
            },
        )
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        state.error?.let { ErrorBanner(it) }
        MonthCard(state, onQuota = { quotaOpen = true }, onRefresh = vm::refresh)
        PackageCard(state, onRefresh = { vm.loadRemote(true) })
        ExplainCard()
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(
                state.updatedAt?.let { "更新于 ${UiText.time(it)}" } ?: "--",
                color = MifiMuted,
                fontSize = 11.sp,
            )
            Text("不自动轮询，点击「刷新数据」更新", color = MifiMuted, fontSize = 11.sp)
        }
    }
}

@Composable
private fun MonthCard(state: TrafficUiState, onQuota: () -> Unit, onRefresh: () -> Unit) {
    val t = state.traffic
    val used = t?.monthUsedBytes ?: 0L
    val quota = t?.quotaBytes ?: 0L
    MifiCard(title = "本月流量") {
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                if (t == null) "--" else TrafficText.monthUsed(used),
                fontSize = 34.sp,
                fontWeight = FontWeight.Bold,
                color = MifiText,
            )
            if (t != null) {
                Spacer(Modifier.width(4.dp))
                Text("GB", fontSize = 14.sp, color = MifiMuted, modifier = Modifier.padding(bottom = 4.dp))
            }
        }
        Text("本月已使用", fontSize = 12.sp, color = MifiMuted)
        if (quota > 0) {
            val pct = TrafficText.percent(used, quota)
            ProgressBar(pct)
            KvRow("套餐总量", TrafficText.quotaTotal(quota))
            KvRow("剩余流量", TrafficText.left(quota - used), leftColor(quota - used, pct))
            KvRow("已用占比", TrafficText.pctText(used, quota))
        }
        KvRow("累计已用", t?.totalUsedBytes?.let { Display.fmtBytes(it) } ?: "--")
        KvRow("当前连接时长", t?.curConnTime ?: "--")
        KvRow("累计在线", t?.totalConnTime ?: "--")
        Text(
            if (quota > 0) "套餐总量已设置，剩余流量按设备统计实时计算。"
            else "设备未设置流量套餐总量，仅展示实际已用流量。",
            fontSize = 12.sp,
            color = MifiMuted,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            MifiButton("设置总量", modifier = Modifier.weight(1f), onClick = onQuota)
            MifiButton(
                if (state.loading) "刷新中…" else "刷新数据",
                modifier = Modifier.weight(1f),
                enabled = !state.loading,
                onClick = onRefresh,
            )
        }
    }
}

@Composable
private fun PackageCard(state: TrafficUiState, onRefresh: () -> Unit) {
    val r = state.remote
    val limited = r?.takeIf { !it.unlimited && it.totalBytes > 0 }
    MifiCard(title = "套餐流量（发卡平台）") {
        Text(
            when {
                r == null -> "--"
                limited == null -> "不限量"
                else -> TrafficText.remoteTotal(r)
            },
            fontSize = 34.sp,
            fontWeight = FontWeight.Bold,
            color = MifiText,
        )
        Text(
            state.remoteError ?: when {
                r == null -> "套餐总量"
                r.cached -> "套餐总量（缓存，点击刷新更新）"
                else -> "套餐总量"
            },
            fontSize = 12.sp,
            color = if (state.remoteError != null) MifiBad else MifiMuted,
        )
        if (limited != null) {
            val pct = TrafficText.percent(limited.usedBytes, limited.totalBytes)
            ProgressBar(pct)
            KvRow("已用流量", Display.fmtBytes(limited.usedBytes))
            KvRow("剩余流量", TrafficText.left(limited.leftBytes), leftColor(limited.leftBytes, pct))
        } else {
            KvRow("已用流量", "--")
            KvRow("剩余流量", "--")
        }
        KvRow("套餐", r?.packageName?.ifBlank { "--" } ?: "--")
        KvRow("卡状态", r?.status?.ifBlank { "--" } ?: "--")
        KvRow("过期时间", r?.expireDate?.take(10)?.ifBlank { "--" } ?: "--")
        r?.let { TrafficText.packages(it.packages) }?.let {
            Text(it, fontSize = 12.sp, color = MifiMuted)
        }
        MifiButton(
            if (state.remoteLoading) "刷新中…" else "刷新套餐流量",
            modifier = Modifier.fillMaxWidth(),
            enabled = !state.remoteLoading,
            onClick = onRefresh,
        )
    }
}

@Composable
private fun ExplainCard() {
    MifiCard(title = "说明") {
        KvRow("统计来源", "设备原生流量统计")
        KvRow("刷新频率", "进入页面加载一次，手动刷新")
        Text(
            "流量总量会保存到设备中（与设备后台「流量管理」同一设置）。剩余流量 = " +
                "总量 − 设备统计的本月已用。填 0 可清除总量设置（不限量）。" +
                "「套餐流量」来自发卡平台（按设备号查询），点击按钮手动刷新，不自动轮询。",
            fontSize = 12.sp,
            color = MifiMuted,
        )
    }
}

@Composable
private fun ProgressBar(pct: Double) {
    LinearProgressIndicator(
        progress = { (pct / 100.0).coerceIn(0.0, 1.0).toFloat() },
        modifier = Modifier
            .fillMaxWidth()
            .height(8.dp)
            .clip(RoundedCornerShape(4.dp)),
        color = barColor(pct),
        trackColor = MifiCardInner,
    )
}

private fun barColor(pct: Double): Color = when {
    pct >= 100 -> MifiBad
    pct >= 80 -> MifiWarn
    else -> MifiGood
}

private fun leftColor(left: Long, pct: Double): Color = when {
    left < 0 -> MifiBad
    pct >= 80 -> MifiWarn
    else -> MifiText
}
```

- [ ] **Step 8: 接工厂与路由**

`ui/AppViewModelFactory.kt` 的 `when` 加分支：

```kotlin
        modelClass.isAssignableFrom(TrafficViewModel::class.java) ->
            TrafficViewModel(container.repository) as T
```

`ui/AppRoot.kt` 的 `when (tab)` 把 `Tab.Traffic -> Placeholder("流量统计")` 换成：

```kotlin
                Tab.Traffic -> {
                    val factory = remember(container) { AppViewModelFactory(container) }
                    val traffic: TrafficViewModel = viewModel(factory = factory)
                    TrafficScreen(traffic)
                }
```

- [ ] **Step 9: 运行测试**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests "com.sunzehui.wifimanage.ui.TrafficViewModelTest"`
Expected: 3 个测试 PASS。

- [ ] **Step 10: 构建与真机冒烟**

Run: `cd android && ./gradlew :app:assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk`
Expected:
- 点底部「流量」，本月流量数字与网页版同一时刻相差 < 0.01 GB；累计已用、连接时长一致。
- 点「设置总量」填 150 保存 → Toast「流量总量已保存」，进度条出现，剩余 = 150 − 本月已用。
- 发卡平台卡进入页面即加载一次；点「刷新套餐流量」按钮文字变为「刷新中…」后回填；未填卡号时卡片显示红字「获取失败: 未配置发卡平台设备号: 打开设置填写」。
- 断开设备 WiFi 后点刷新 → 顶部红条「无法连接设备，请确认手机已连接到随身 WiFi」，已显示的数字保留。

- [ ] **Step 11: 提交**

```bash
git add android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/UiText.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/TrafficViewModel.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/TrafficScreen.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/QuotaDialog.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/Components.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/AppViewModelFactory.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/AppRoot.kt \
  android/app/src/test/kotlin/com/sunzehui/wifimanage/ui/TrafficViewModelTest.kt
git commit -m "流量页: 本月用量、套餐总量设置与发卡平台套餐卡"
```

---

### Task 15: 设备页

**Files:**
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/DevicesViewModel.kt`
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/DevicesScreen.kt`
- Modify: `android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/AppViewModelFactory.kt`
- Modify: `android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/AppRoot.kt`
- Test: `android/app/src/test/kotlin/com/sunzehui/wifimanage/ui/DevicesViewModelTest.kt`

**Interfaces:**
- Consumes: `DevicesSource.devices()`、`Devices`、`Client`、`Display.fmtBytes`、`MifiCard` / `KvRow` / `ErrorBanner` / `MifiButton`、`UiText`
- Produces:
  - `enum class DeviceFilter(val label: String) { All("全部"), Online("在线"), Offline("离线") }`
  - `fun filteredClients(devices: Devices?, query: String, mode: DeviceFilter): List<Client>`
  - `fun deviceType(name: String): String`
  - `data class DevicesUiState(...)`、`class DevicesViewModel(source: DevicesSource, scope: CoroutineScope? = null)`
  - `@Composable fun DevicesScreen(vm: DevicesViewModel)`

- [ ] **Step 1: 写失败测试**

`android/app/src/test/kotlin/com/sunzehui/wifimanage/ui/DevicesViewModelTest.kt`：

```kotlin
package com.sunzehui.wifimanage.ui

import com.sunzehui.wifimanage.data.DevicesSource
import com.sunzehui.wifimanage.protocol.Client
import com.sunzehui.wifimanage.protocol.DeviceError
import com.sunzehui.wifimanage.protocol.DeviceException
import com.sunzehui.wifimanage.protocol.Devices
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Test

class DevicesViewModelTest {
    private fun client(name: String, mac: String, connected: Boolean) = Client(
        name = name,
        mac = mac,
        ip = "192.168.1.2",
        connected = connected,
        rxBytes = 1024L,
        txBytes = 2048L,
        rxMonthly = 1024L,
        txMonthly = 2048L,
        since = "10:00",
    )

    private class FakeSource(var devices: Devices) : DevicesSource {
        var error: Exception? = null
        override suspend fun devices(): Devices {
            error?.let { throw it }
            return devices
        }
    }

    @Test fun loadsDevicesOnInit() = runTest {
        val fake = FakeSource(Devices(1, 2, listOf(client("iPhone 13", "AA", true), client("MacBook Pro", "BB", false))))
        val vm = DevicesViewModel(fake, this)
        advanceUntilIdle()

        assertFalse(vm.state.value.loading)
        assertEquals(2, vm.state.value.devices?.total)
        assertEquals(1, vm.state.value.devices?.onlineCount)
        assertNotNull(vm.state.value.updatedAt)
    }

    @Test fun filtersByQueryAndStatus() {
        val data = Devices(
            1,
            2,
            listOf(client("iPhone 13", "AA", true), client("MacBook Pro", "BB", false)),
        )

        assertEquals(1, filteredClients(data, "iphone", DeviceFilter.All).size)
        assertEquals(1, filteredClients(data, "", DeviceFilter.Online).size)
        assertEquals(1, filteredClients(data, "", DeviceFilter.Offline).size)
        assertEquals(1, filteredClients(data, "192.168.1.2", DeviceFilter.Offline).size)
        assertEquals("手机", deviceType("iPhone 13"))
        assertEquals("电脑", deviceType("MacBook Pro"))
        assertEquals("未知", deviceType("Living Room"))
    }

    @Test fun refreshFailureShowsError() = runTest {
        val fake = FakeSource(Devices(1, 1, listOf(client("iPhone 13", "AA", true))))
        val vm = DevicesViewModel(fake, this)
        advanceUntilIdle()

        fake.error = DeviceException(DeviceError.Unreachable)
        vm.refresh()
        advanceUntilIdle()

        assertEquals("无法连接设备，请确认手机已连接到随身 WiFi", vm.state.value.error)
        assertFalse(vm.state.value.loading)
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests "com.sunzehui.wifimanage.ui.DevicesViewModelTest"`
Expected: 编译失败（`DevicesViewModel` / `filteredClients` 未定义）。

- [ ] **Step 3: 实现 DevicesViewModel.kt**

```kotlin
package com.sunzehui.wifimanage.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.sunzehui.wifimanage.data.DevicesSource
import com.sunzehui.wifimanage.protocol.Client
import com.sunzehui.wifimanage.protocol.Devices
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class DeviceFilter(val label: String) {
    All("全部"),
    Online("在线"),
    Offline("离线"),
}

fun filteredClients(devices: Devices?, query: String, mode: DeviceFilter): List<Client> {
    val list = devices?.clients.orEmpty()
    val q = query.trim().lowercase()
    return list.filter { c ->
        val modeOk = when (mode) {
            DeviceFilter.All -> true
            DeviceFilter.Online -> c.connected
            DeviceFilter.Offline -> !c.connected
        }
        val queryOk = q.isEmpty() || "${c.name} ${c.mac} ${c.ip}".lowercase().contains(q)
        modeOk && queryOk
    }
}

fun deviceType(name: String): String {
    val n = name.lowercase()
    return when {
        Regex("iphone|vivo|huawei|xiaomi|redmi|oppo|honor|pixel|meizu|oneplus|手机").containsMatchIn(n) -> "手机"
        Regex("ipad|tablet|pad(?!e)|平板").containsMatchIn(n) -> "平板"
        Regex("mac|book|pc|desktop|thinkpad|surface|air|imac").containsMatchIn(n) -> "电脑"
        else -> "未知"
    }
}

data class DevicesUiState(
    val devices: Devices? = null,
    val loading: Boolean = true,
    val error: String? = null,
    val query: String = "",
    val mode: DeviceFilter = DeviceFilter.All,
    val updatedAt: Long? = null,
    val selectedMac: String? = null,
)

class DevicesViewModel(
    private val source: DevicesSource,
    scope: CoroutineScope? = null,
) : ViewModel() {
    private val scope = scope ?: viewModelScope
    private val _state = MutableStateFlow(DevicesUiState())
    val state: StateFlow<DevicesUiState> = _state

    init {
        scope.launch { load() }
    }

    suspend fun load() {
        _state.update { it.copy(loading = true, error = null) }
        try {
            val d = source.devices()
            _state.update {
                it.copy(devices = d, loading = false, updatedAt = System.currentTimeMillis())
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _state.update { it.copy(loading = false, error = UiText.error(e)) }
        }
    }

    fun refresh() {
        scope.launch { load() }
    }

    fun setQuery(query: String) {
        _state.update { it.copy(query = query) }
    }

    fun setMode(mode: DeviceFilter) {
        _state.update { it.copy(mode = mode) }
    }

    fun openClient(mac: String) {
        _state.update { it.copy(selectedMac = mac) }
    }

    fun closeClient() {
        _state.update { it.copy(selectedMac = null) }
    }
}
```

- [ ] **Step 4: 实现 DevicesScreen.kt**

```kotlin
package com.sunzehui.wifimanage.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.sunzehui.wifimanage.protocol.Client
import com.sunzehui.wifimanage.protocol.Display

@Composable
fun DevicesScreen(vm: DevicesViewModel) {
    val state by vm.state.collectAsStateWithLifecycle()
    val data = state.devices
    val list = filteredClients(data, state.query, state.mode)
    val selected = data?.clients?.firstOrNull { it.mac == state.selectedMac }

    if (selected != null) {
        ClientDetail(client = selected, onDismiss = vm::closeClient)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        state.error?.let { ErrorBanner(it) }

        MifiCard(title = "连接设备") {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    "在线 ${data?.onlineCount ?: 0} · 共 ${data?.total ?: 0} 台",
                    color = MifiMuted,
                    fontSize = 13.sp,
                )
                MifiButton(
                    if (state.loading) "刷新中…" else "刷新数据",
                    enabled = !state.loading,
                    onClick = vm::refresh,
                )
            }
            OutlinedTextField(
                value = state.query,
                onValueChange = vm::setQuery,
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("搜索名称 / MAC / IP", fontSize = 13.sp) },
                singleLine = true,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                DeviceFilter.entries.forEach { f ->
                    val on = state.mode == f
                    FilterChip(
                        selected = on,
                        onClick = { vm.setMode(f) },
                        label = { Text(f.label, fontSize = 12.sp) },
                        colors = FilterChipDefaults.filterChipColors(
                            containerColor = MifiCardInner,
                            labelColor = MifiMuted,
                            selectedContainerColor = MifiAccent.copy(alpha = 0.18f),
                            selectedLabelColor = MifiAccent,
                        ),
                        border = FilterChipDefaults.filterChipBorder(
                            enabled = true,
                            selected = on,
                            borderColor = MifiBorder,
                            selectedBorderColor = MifiAccent,
                        ),
                    )
                }
            }
        }

        if (list.isEmpty()) {
            Text(
                "没有符合条件的设备",
                modifier = Modifier.fillMaxWidth().padding(vertical = 24.dp),
                color = MifiMuted,
                fontSize = 13.sp,
                textAlign = TextAlign.Center,
            )
        } else {
            list.forEach { client ->
                ClientCard(client = client, onClick = { vm.openClient(client.mac) })
            }
        }

        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(
                state.updatedAt?.let { "更新于 ${UiText.time(it)}" } ?: "--",
                color = MifiMuted,
                fontSize = 11.sp,
            )
            Text("不自动轮询，点击「刷新数据」更新", color = MifiMuted, fontSize = 11.sp)
        }
    }
}

@Composable
private fun ClientCard(client: Client, onClick: () -> Unit) {
    MifiCard(modifier = Modifier.clickable(onClick = onClick)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(client.name, color = MifiText, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                Text(
                    "${client.ip} · ${deviceType(client.name)}",
                    color = MifiMuted,
                    fontSize = 12.sp,
                )
            }
            StatusBadge(client.connected)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("↓ ${Display.fmtBytes(client.rxBytes)}", color = MifiText, fontSize = 12.sp)
            Text("↑ ${Display.fmtBytes(client.txBytes)}", color = MifiText, fontSize = 12.sp)
        }
        Text("查看详情 ›", color = MifiAccent, fontSize = 12.sp)
    }
}

@Composable
private fun StatusBadge(connected: Boolean) {
    val color = if (connected) MifiGood else MifiBad
    Text(
        if (connected) "在线" else "离线",
        color = color,
        fontSize = 11.sp,
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(color.copy(alpha = 0.15f))
            .padding(horizontal = 6.dp, vertical = 2.dp),
    )
}

@Composable
private fun ClientDetail(client: Client, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = MifiCard,
        titleContentColor = MifiText,
        textContentColor = MifiText,
        title = {
            Text(client.name + if (client.connected) "（在线）" else "（离线）")
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                KvRow("设备类型", deviceType(client.name))
                KvRow("IP 地址", client.ip.ifBlank { "--" })
                KvRow("MAC 地址", client.mac.ifBlank { "--" })
                KvRow("累计下载", Display.fmtBytes(client.rxBytes))
                KvRow("累计上传", Display.fmtBytes(client.txBytes))
                KvRow("本月下载", Display.fmtBytes(client.rxMonthly))
                KvRow("本月上传", Display.fmtBytes(client.txMonthly))
                KvRow("接入时间", client.since.ifBlank { "--" })
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("关闭", color = MifiAccent) }
        },
    )
}
```

- [ ] **Step 5: 接工厂与路由**

`ui/AppViewModelFactory.kt` 的 `when` 加分支：

```kotlin
        modelClass.isAssignableFrom(DevicesViewModel::class.java) ->
            DevicesViewModel(container.repository) as T
```

`ui/AppRoot.kt` 把 `Tab.Devices -> Placeholder("连接设备")` 换成：

```kotlin
                Tab.Devices -> {
                    val factory = remember(container) { AppViewModelFactory(container) }
                    val devices: DevicesViewModel = viewModel(factory = factory)
                    DevicesScreen(devices)
                }
```

- [ ] **Step 6: 运行测试**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests "com.sunzehui.wifimanage.ui.DevicesViewModelTest"`
Expected: 3 个测试 PASS。

- [ ] **Step 7: 构建与真机冒烟**

Run: `cd android && ./gradlew :app:assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk`
Expected:
- 点底部「设备」，顶部显示「在线 X · 共 Y 台」，与网页版同一时刻一致。
- 搜索「iphone」只剩名称含 iPhone 的卡片；点「在线」/「离线」筛选即时生效；无匹配时显示「没有符合条件的设备」。
- 点卡片弹出详情，显示类型、IP、MAC、累计/本月上下行、接入时间；点「关闭」返回。
- 点「刷新数据」后文案变「刷新中…」，完成后更新时刻变化。
- 断开设备 WiFi 点刷新 → 顶部红条「无法连接设备，请确认手机已连接到随身 WiFi」。

- [ ] **Step 8: 提交**

```bash
git add android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/DevicesViewModel.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/DevicesScreen.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/AppViewModelFactory.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/AppRoot.kt \
  android/app/src/test/kotlin/com/sunzehui/wifimanage/ui/DevicesViewModelTest.kt
git commit -m "设备页: 在线筛选、搜索与单设备流量详情"
```

---

### Task 16: 写操作 UI（WiFi / 自动关闭 / SIM / 频段 / 重启关机）

**Files:**
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/protocol/WriteRules.kt`
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/HomeActionsViewModel.kt`
- Create: `android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/WriteSheets.kt`
- Modify: `android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/UiText.kt`
- Modify: `android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/Components.kt`
- Modify: `android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/HomeScreen.kt`
- Modify: `android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/AppViewModelFactory.kt`
- Modify: `android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/AppRoot.kt`
- Test: `android/app/src/test/kotlin/com/sunzehui/wifimanage/protocol/WriteRulesTest.kt`

**Interfaces:**
- Consumes: `DeviceRepository`（`wlanBasic` / `wlanSecurity` / `saveWifi` / `setAutoOff` / `sim` / `setSim` / `band` / `setBand`）、`StatusCoordinator.reboot/powerOff`、`WlanSecurity` / `WlanBasic` / `SimInfo` / `BandInfo`
- Produces:
  - `object WriteRules { fun wifiError(...); fun autoOffError(minutes: Int?); fun simError(...); fun bandError(...); fun quotaError(gb: Double?) }`
  - `class HomeActionsViewModel(repository, coordinator, scope: CoroutineScope? = null)`，暴露 `busy / toast / wlanSecurity / wlanBasic / sim / band` 与 `loadWifi / loadSim / loadBand / saveWifi / setAutoOff / switchSim / saveBand / reboot / powerOff / consumeToast`
  - `ui/WriteSheets.kt`：`WifiSheet`、`AutoOffSheet`、`SimSheet`、`BandSheet`、`RebootDialog`、`PowerOffDialog`
  - `UiText.autoOffLabel(minutes: Int?)`、`UiText.simSlotLabel(info: SimInfo?, value: Int)`
  - `MifiButton` 新增 `containerColor` / `contentColor` 参数

- [ ] **Step 1: 写失败测试**

`android/app/src/test/kotlin/com/sunzehui/wifimanage/protocol/WriteRulesTest.kt`：

```kotlin
package com.sunzehui.wifimanage.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WriteRulesTest {
    @Test fun wifiRulesMatchWebCopy() {
        assertEquals("请输入 WiFi 名称", WriteRules.wifiError("  ", "", "", "Old"))
        assertEquals(
            "名称过长（最多 32 字节，汉字占 3 字节）",
            WriteRules.wifiError("a".repeat(33), "", "", "Old"),
        )
        assertEquals("名称过长（最多 32 字节，汉字占 3 字节）", WriteRules.wifiError("中".repeat(11), "", "", "Old"))
        assertEquals("密码需为 8 - 63 位字符", WriteRules.wifiError("New", "1234567", "1234567", "Old"))
        assertEquals("密码需为 8 - 63 位字符", WriteRules.wifiError("New", "a".repeat(64), "a".repeat(64), "Old"))
        assertEquals("密码只能包含英文字母、数字和符号（不含中文）", WriteRules.wifiError("New", "密码密码密码密码", "密码密码密码密码", "Old"))
        assertEquals("两次输入的密码不一致", WriteRules.wifiError("New", "12345678", "12345679", "Old"))
        assertEquals("名称没有变化，请输入新密码", WriteRules.wifiError("Old", "", "", "Old"))
        assertNull(WriteRules.wifiError("New", "12345678", "12345678", "Old"))
        assertNull(WriteRules.wifiError("Old", "12345678", "12345678", "Old"))
    }

    @Test fun simRules() {
        val info = SimInfo(1, pwdRequired = true, slots = listOf(SimSlot(0, "卡1"), SimSlot(1, "卡2")))
        assertEquals("请先选择要切换到的卡槽", WriteRules.simError(info, null, ""))
        assertEquals("请选择有效的卡槽", WriteRules.simError(info, 3, ""))
        assertEquals("当前已在使用该卡槽，无需切换", WriteRules.simError(info, 1, "1234"))
        assertEquals("请输入切换密码", WriteRules.simError(info, 0, "  "))
        assertNull(WriteRules.simError(info, 0, "1234"))
        assertNull(WriteRules.simError(info.copy(pwdRequired = false), 0, ""))
    }

    @Test fun bandRules() {
        val info = BandInfo(
            bands = listOf(Band(1, "FDD", true), Band(3, "FDD", true), Band(41, "TDD", false)),
            current = "B3",
        )
        assertEquals("请至少选择一个频段", WriteRules.bandError(info, emptySet()))
        assertEquals("请选择有效的频段", WriteRules.bandError(info, setOf(99)))
        assertNull(WriteRules.bandError(info, setOf(1, 41)))
    }

    @Test fun autoOffAndQuotaRules() {
        assertEquals("请先选择空闲关闭时间", WriteRules.autoOffError(null))
        assertEquals("自动关闭时间需为 10 - 60 分钟，或设为关闭", WriteRules.autoOffError(5))
        assertEquals("自动关闭时间需为 10 - 60 分钟，或设为关闭", WriteRules.autoOffError(61))
        assertNull(WriteRules.autoOffError(0))
        assertNull(WriteRules.autoOffError(60))

        assertEquals("请输入 0 - 100000 之间的数值（GB）", WriteRules.quotaError(null))
        assertEquals("请输入 0 - 100000 之间的数值（GB）", WriteRules.quotaError(Double.NaN))
        assertEquals("请输入 0 - 100000 之间的数值（GB）", WriteRules.quotaError(100001.0))
        assertNull(WriteRules.quotaError(0.0))
        assertNull(WriteRules.quotaError(150.0))
    }
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests "com.sunzehui.wifimanage.protocol.WriteRulesTest"`
Expected: 编译失败（`WriteRules` 未定义）。

- [ ] **Step 3: 实现 WriteRules.kt**

```kotlin
package com.sunzehui.wifimanage.protocol

object WriteRules {
    fun wifiError(ssid: String, password: String, confirm: String, currentSsid: String): String? {
        val name = ssid.trim()
        if (name.isEmpty()) return "请输入 WiFi 名称"
        if (name.toByteArray(Charsets.UTF_8).size > 32) return "名称过长（最多 32 字节，汉字占 3 字节）"
        if (password.isNotEmpty()) {
            if (password.length !in 8..63) return "密码需为 8 - 63 位字符"
            if (password.any { it.code !in 0x20..0x7E }) return "密码只能包含英文字母、数字和符号（不含中文）"
            if (password != confirm) return "两次输入的密码不一致"
        }
        if (name == currentSsid && password.isEmpty()) return "名称没有变化，请输入新密码"
        return null
    }

    fun autoOffError(minutes: Int?): String? {
        if (minutes == null) return "请先选择空闲关闭时间"
        return if (minutes == 0 || minutes in 10..60) null
        else "自动关闭时间需为 10 - 60 分钟，或设为关闭"
    }

    fun simError(info: SimInfo, slot: Int?, password: String): String? = when {
        slot == null -> "请先选择要切换到的卡槽"
        info.slots.none { it.value == slot } -> "请选择有效的卡槽"
        slot == info.current -> "当前已在使用该卡槽，无需切换"
        info.pwdRequired && password.isBlank() -> "请输入切换密码"
        else -> null
    }

    fun bandError(info: BandInfo, selected: Collection<Int>): String? = when {
        selected.isEmpty() -> "请至少选择一个频段"
        selected.none { b -> info.bands.any { it.band == b } } -> "请选择有效的频段"
        else -> null
    }

    fun quotaError(gb: Double?): String? =
        if (gb == null || gb.isNaN() || gb < 0 || gb > 100000) "请输入 0 - 100000 之间的数值（GB）"
        else null
}
```

- [ ] **Step 4: 实现 HomeActionsViewModel.kt**

```kotlin
package com.sunzehui.wifimanage.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.sunzehui.wifimanage.data.DeviceRepository
import com.sunzehui.wifimanage.data.StatusCoordinator
import com.sunzehui.wifimanage.protocol.BandInfo
import com.sunzehui.wifimanage.protocol.SimInfo
import com.sunzehui.wifimanage.protocol.WlanBasic
import com.sunzehui.wifimanage.protocol.WlanSecurity
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class HomeActionsViewModel(
    private val repository: DeviceRepository,
    private val coordinator: StatusCoordinator,
    scope: CoroutineScope? = null,
) : ViewModel() {
    private val scope = scope ?: viewModelScope

    private val _busy = MutableStateFlow<String?>(null)
    val busy: StateFlow<String?> = _busy

    private val _toast = MutableStateFlow<String?>(null)
    val toast: StateFlow<String?> = _toast

    private val _wlanSecurity = MutableStateFlow<WlanSecurity?>(null)
    val wlanSecurity: StateFlow<WlanSecurity?> = _wlanSecurity

    private val _wlanBasic = MutableStateFlow<WlanBasic?>(null)
    val wlanBasic: StateFlow<WlanBasic?> = _wlanBasic

    private val _sim = MutableStateFlow<SimInfo?>(null)
    val sim: StateFlow<SimInfo?> = _sim

    private val _band = MutableStateFlow<BandInfo?>(null)
    val band: StateFlow<BandInfo?> = _band

    fun loadWifi() {
        scope.launch {
            try {
                _wlanSecurity.value = repository.wlanSecurity()
                _wlanBasic.value = repository.wlanBasic()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _toast.value = UiText.error(e)
            }
        }
    }

    fun loadSim() {
        scope.launch {
            try {
                _sim.value = repository.sim()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _toast.value = UiText.error(e)
            }
        }
    }

    fun loadBand() {
        scope.launch {
            try {
                _band.value = repository.band()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _toast.value = UiText.error(e)
            }
        }
    }

    fun saveWifi(ssid: String, password: String?) = launchAction("wifi") {
        val message = repository.saveWifi(ssid, password)
        _wlanSecurity.value = repository.wlanSecurity()
        message
    }

    fun setAutoOff(minutes: Int) = launchAction("autooff") {
        repository.setAutoOff(minutes)
        _wlanBasic.value = repository.wlanBasic()
        if (minutes == 0) "已关闭「无客户端自动关闭」"
        else "已设为空闲 $minutes 分钟后自动关闭无线"
    }

    fun switchSim(slot: Int, password: String) = launchAction("sim") {
        repository.setSim(slot, password)
        _sim.value = repository.sim()
        "SIM 卡槽已切换，网络将在几秒到几十秒内恢复"
    }

    fun saveBand(bands: List<Int>) = launchAction("band") {
        repository.setBand(bands)
        _band.value = repository.band()
        "频段设置已保存，设备将只在所选频段上驻网"
    }

    fun reboot() = launchAction("reboot", tickAfter = false) {
        coordinator.reboot()
        "重启指令已发出"
    }

    fun powerOff() = launchAction("poweroff", tickAfter = false) {
        coordinator.powerOff()
        "关机指令已发出"
    }

    fun consumeToast() {
        _toast.value = null
    }

    private fun launchAction(
        name: String,
        tickAfter: Boolean = true,
        block: suspend () -> String,
    ) {
        scope.launch {
            _busy.value = name
            try {
                val message = block()
                _toast.value = message
                if (tickAfter) coordinator.tick()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _toast.value = UiText.error(e)
            } finally {
                _busy.value = null
            }
        }
    }
}
```

- [ ] **Step 5: 扩展 UiText 与 MifiButton**

`ui/UiText.kt` 的 `object UiText` 内加：

```kotlin
    fun autoOffLabel(minutes: Int?): String = when {
        minutes == null -> "--"
        minutes > 0 -> "$minutes 分钟"
        else -> "已关闭"
    }

    fun simSlotLabel(info: SimInfo?, value: Int): String =
        info?.slots?.firstOrNull { it.value == value }?.label ?: "未知"
```

新增 import：

```kotlin
import com.sunzehui.wifimanage.protocol.SimInfo
```

`ui/Components.kt` 的 `MifiButton` 改为：

```kotlin
@Composable
fun MifiButton(
    text: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    containerColor: Color = MifiCardInner,
    contentColor: Color = MifiText,
    onClick: () -> Unit,
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.height(40.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = containerColor,
            contentColor = contentColor,
            disabledContainerColor = MifiCardInner.copy(alpha = 0.5f),
            disabledContentColor = MifiMuted,
        ),
        shape = RoundedCornerShape(10.dp),
    ) {
        Text(text, fontSize = 13.sp)
    }
}
```

- [ ] **Step 6: 实现 WriteSheets.kt**

```kotlin
package com.sunzehui.wifimanage.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sunzehui.wifimanage.protocol.BandInfo
import com.sunzehui.wifimanage.protocol.SimInfo
import com.sunzehui.wifimanage.protocol.WlanSecurity
import com.sunzehui.wifimanage.protocol.WriteRules

@Composable
fun WifiSheet(
    security: WlanSecurity?,
    onDismiss: () -> Unit,
    onSave: (String, String?) -> Unit,
) {
    var ssid by remember(security?.ssid) { mutableStateOf(security?.ssid.orEmpty()) }
    var p1 by remember { mutableStateOf("") }
    var p2 by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    ActionDialog(
        title = "修改名称与密码",
        confirmText = "保存",
        confirmEnabled = security != null,
        onDismiss = onDismiss,
        onConfirm = {
            val current = security?.ssid.orEmpty()
            val e = WriteRules.wifiError(ssid, p1, p2, current)
            if (e != null) {
                error = e
            } else {
                onSave(ssid.trim(), p1.ifEmpty { null })
            }
        },
    ) {
        Text(
            "当前：${security?.ssid?.ifBlank { "--" } ?: "--"} · 加密方式：" +
                (security?.mode?.ifBlank { "--" } ?: "--"),
            color = MifiMuted,
            fontSize = 12.sp,
        )
        OutlinedTextField(
            value = ssid,
            onValueChange = { ssid = it },
            label = { Text("名称") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = p1,
            onValueChange = { p1 = it },
            label = { Text("新密码") },
            placeholder = { Text("留空表示不修改") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = p2,
            onValueChange = { p2 = it },
            label = { Text("确认新密码") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
        )
        error?.let { Text(it, color = MifiBad, fontSize = 12.sp) }
        Text(
            "保存后设备无线会重启一次，已连接的设备要用新名称 / 密码重新连接；两项一起改也只重启一次。",
            color = MifiMuted,
            fontSize = 12.sp,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AutoOffSheet(
    currentMinutes: Int?,
    onDismiss: () -> Unit,
    onSave: (Int) -> Unit,
) {
    var pick by remember(currentMinutes) { mutableStateOf(currentMinutes ?: 0) }

    ActionDialog(
        title = "无客户端自动关闭",
        confirmText = "确认修改",
        onDismiss = onDismiss,
        onConfirm = { onSave(pick) },
    ) {
        Text(
            "没有设备连着 WiFi 时，设备会自动关掉无线网络来省电。一旦无线被自动关掉，" +
                "就无法通过本页面重新开启，只能到设备上手动打开。",
            color = MifiMuted,
            fontSize = 12.sp,
        )
        Text("空闲多久后关闭无线", color = MifiText, fontSize = 13.sp)
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            listOf(0, 10, 20, 30, 45, 60).forEach { m ->
                Chip(if (m == 0) "不自动关闭" else "$m 分钟", pick == m) { pick = m }
            }
        }
        Text(
            if (pick == 0) "推荐：设备始终连着，随时可以连上来。"
            else "开着它，空闲 $pick 分钟后无线会被自动关掉；那时手机和电脑都连不回来，只能到设备上手动打开。",
            color = MifiMuted,
            fontSize = 12.sp,
        )
    }
}

@Composable
fun SimSheet(
    info: SimInfo?,
    onDismiss: () -> Unit,
    onSave: (Int, String) -> Unit,
) {
    var pick by remember { mutableStateOf<Int?>(null) }
    var pw by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }

    ActionDialog(
        title = "SIM 卡设置",
        confirmText = "确认切换",
        confirmEnabled = info != null,
        onDismiss = onDismiss,
        onConfirm = {
            val i = info ?: return@ActionDialog
            val slot = pick
            if (slot == null) {
                error = "请先选择要切换到的卡槽"
                return@ActionDialog
            }
            val e = WriteRules.simError(i, slot, pw)
            if (e != null) {
                error = e
            } else {
                onSave(slot, if (i.pwdRequired) pw.trim() else "")
            }
        },
    ) {
        Text(
            "当前使用：" + (info?.let { UiText.simSlotLabel(it, it.current) } ?: "加载中…"),
            color = MifiMuted,
            fontSize = 12.sp,
        )
        Text("切换到", color = MifiText, fontSize = 13.sp)
        if (info == null) {
            Text("正在读取卡槽…", color = MifiMuted, fontSize = 12.sp)
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                info.slots.forEach { slot ->
                    Chip(slot.label, pick == slot.value) {
                        pick = slot.value
                        error = null
                    }
                }
            }
        }
        if (info?.pwdRequired == true) {
            OutlinedTextField(
                value = pw,
                onValueChange = { pw = it },
                label = { Text("切换密码") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        error?.let { Text(it, color = MifiBad, fontSize = 12.sp) }
        Text(
            "切换后设备会重新注册网络，网络将短暂中断（几秒到几十秒），期间页面可能提示设备不可达，属正常现象。",
            color = MifiMuted,
            fontSize = 12.sp,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BandSheet(
    info: BandInfo?,
    onDismiss: () -> Unit,
    onSave: (List<Int>) -> Unit,
) {
    var selected by remember(info) {
        mutableStateOf(info?.bands?.filter { it.enabled }?.map { it.band }?.toSet().orEmpty())
    }
    var error by remember { mutableStateOf<String?>(null) }

    ActionDialog(
        title = "频段锁定",
        confirmText = "保存",
        confirmEnabled = info != null,
        onDismiss = onDismiss,
        onConfirm = {
            val i = info ?: return@ActionDialog
            val e = WriteRules.bandError(i, selected)
            if (e != null) {
                error = e
            } else {
                onSave(selected.toList())
            }
        },
    ) {
        Text(
            "当前驻留：${info?.current?.ifBlank { "未知" } ?: "加载中…"} · " +
                "已启用 ${selected.size} / ${info?.bands?.size ?: 0} 个频段",
            color = MifiMuted,
            fontSize = 12.sp,
        )
        Text("勾选允许设备使用的频段（至少一个）", color = MifiText, fontSize = 13.sp)
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            info?.bands?.forEach { b ->
                Chip("${b.type} B${b.band}", selected.contains(b.band)) {
                    selected = if (selected.contains(b.band)) selected - b.band else selected + b.band
                    error = null
                }
            }
        }
        MifiButton("全选", onClick = {
            selected = info?.bands?.map { it.band }?.toSet().orEmpty()
            error = null
        })
        error?.let { Text(it, color = MifiBad, fontSize = 12.sp) }
        Text(
            "保存后设备会按所选频段重新搜网，网络可能短暂中断。频段选得太少可能导致无信号，不确定时建议全选。",
            color = MifiMuted,
            fontSize = 12.sp,
        )
    }
}

@Composable
fun RebootDialog(onDismiss: () -> Unit, onConfirm: () -> Unit) {
    ActionDialog(
        title = "重启设备",
        confirmText = "确认重启",
        onDismiss = onDismiss,
        onConfirm = onConfirm,
    ) {
        Text(
            "设备会断开约 1 分钟，期间 WiFi 和本页都会失联，恢复后自动重新连上。",
            color = MifiMuted,
            fontSize = 12.sp,
        )
        Text(
            "WiFi 名称、密码和各项设置不会被改动，已连接的设备需要重新连接一次。",
            color = MifiMuted,
            fontSize = 12.sp,
        )
    }
}

@Composable
fun PowerOffDialog(onDismiss: () -> Unit, onConfirm: () -> Unit) {
    var confirmed by remember { mutableStateOf(false) }

    ActionDialog(
        title = "关闭设备",
        titleColor = MifiBad,
        confirmText = "确认关闭设备",
        confirmEnabled = confirmed,
        confirmColor = MifiBad,
        onDismiss = onDismiss,
        onConfirm = onConfirm,
    ) {
        Text(
            "关闭后设备立即断电：本页、手机、电脑全部失去连接，没有任何远程方式能把它重新打开。",
            color = MifiText,
            fontSize = 12.sp,
        )
        Text(
            "要重新使用，只能到设备上长按电源键开机。如果你现在不在设备旁边，请不要继续。",
            color = MifiText,
            fontSize = 12.sp,
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(
                checked = confirmed,
                onCheckedChange = { confirmed = it },
                colors = CheckboxDefaults.colors(
                    checkedColor = MifiBad,
                    uncheckedColor = MifiBorder,
                    checkmarkColor = MifiBg,
                ),
            )
            Text("我确认设备就在身边，可以手动开机", color = MifiText, fontSize = 12.sp)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Chip(text: String, on: Boolean, onClick: () -> Unit) {
    FilterChip(
        selected = on,
        onClick = onClick,
        label = { Text(text, fontSize = 12.sp) },
        colors = FilterChipDefaults.filterChipColors(
            containerColor = MifiCardInner,
            labelColor = MifiMuted,
            selectedContainerColor = MifiAccent.copy(alpha = 0.18f),
            selectedLabelColor = MifiAccent,
        ),
    )
}

@Composable
private fun ActionDialog(
    title: String,
    confirmText: String,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
    confirmEnabled: Boolean = true,
    titleColor: Color = MifiText,
    confirmColor: Color = MifiAccent,
    content: @Composable ColumnScope.() -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = MifiCard,
        titleContentColor = titleColor,
        textContentColor = MifiText,
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) { content() }
        },
        confirmButton = {
            TextButton(onClick = onConfirm, enabled = confirmEnabled) {
                Text(confirmText, color = if (confirmEnabled) confirmColor else MifiMuted)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("取消", color = MifiMuted) }
        },
    )
}
```

- [ ] **Step 7: 首页接入 WiFi / SIM / 频段 / 设备操作**

`ui/HomeScreen.kt` 的签名改为：

```kotlin
fun HomeScreen(
    vm: HomeViewModel,
    actions: HomeActionsViewModel,
    onOpenTraffic: () -> Unit,
    onOpenDevices: () -> Unit,
    modifier: Modifier = Modifier,
)
```

函数体开头、现有 `val context = LocalContext.current` 之后加：

```kotlin
    val wlanBasic by actions.wlanBasic.collectAsStateWithLifecycle()
    val wlanSecurity by actions.wlanSecurity.collectAsStateWithLifecycle()
    val sim by actions.sim.collectAsStateWithLifecycle()
    val band by actions.band.collectAsStateWithLifecycle()
    val busy by actions.busy.collectAsStateWithLifecycle()
    val actionToast by actions.toast.collectAsStateWithLifecycle()
    var sheet by rememberSaveable { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        actions.loadWifi()
        actions.loadSim()
        actions.loadBand()
    }

    LaunchedEffect(actionToast) {
        actionToast?.let {
            Toast.makeText(context, it, Toast.LENGTH_SHORT).show()
            actions.consumeToast()
        }
    }

    when (sheet) {
        "wifi" -> WifiSheet(
            security = wlanSecurity,
            onDismiss = { sheet = null },
            onSave = { ssid, pwd ->
                actions.saveWifi(ssid, pwd)
                sheet = null
            },
        )
        "autooff" -> AutoOffSheet(
            currentMinutes = wlanBasic?.autoOff?.minutes,
            onDismiss = { sheet = null },
            onSave = { minutes ->
                actions.setAutoOff(minutes)
                sheet = null
            },
        )
        "sim" -> SimSheet(
            info = sim,
            onDismiss = { sheet = null },
            onSave = { slot, pw ->
                actions.switchSim(slot, pw)
                sheet = null
            },
        )
        "band" -> BandSheet(
            info = band,
            onDismiss = { sheet = null },
            onSave = { bands ->
                actions.saveBand(bands)
                sheet = null
            },
        )
        "reboot" -> RebootDialog(
            onDismiss = { sheet = null },
            onConfirm = {
                actions.reboot()
                sheet = null
            },
        )
        "poweroff" -> PowerOffDialog(
            onDismiss = { sheet = null },
            onConfirm = {
                actions.powerOff()
                sheet = null
            },
        )
    }
```

在 `EntryCard("流量使用", trafficDesc, onOpenTraffic)` 之后，把现有 `if (data != null) { ... }` 整块改为：

```kotlin
        val simDesc = sim?.let {
            "当前使用 ${UiText.simSlotLabel(it, it.current)}，点击切换卡槽"
        } ?: "切换 SIM 卡槽（卡1 / 卡2 / 卡3）"
        val bandDesc = band?.current?.takeIf { it.isNotBlank() }?.let {
            "当前驻留 $it，点击设置频段"
        } ?: "选择设备驻网使用的 4G 频段"

        if (data != null) {
            WifiCard(
                data = data,
                autoOffMinutes = wlanBasic?.autoOff?.minutes,
                onEdit = {
                    actions.loadWifi()
                    sheet = "wifi"
                },
                onAutoOff = {
                    actions.loadWifi()
                    sheet = "autooff"
                },
            )
            DeviceInfoCard(data)
            EntryCard(
                "连接设备",
                "当前已连接 ${data.lan.connectedCount} 台设备，点击查看明细",
                onOpenDevices,
            )
            EntryCard("SIM 卡设置", simDesc, {
                actions.loadSim()
                sheet = "sim"
            })
            EntryCard("频段锁定", bandDesc, {
                actions.loadBand()
                sheet = "band"
            })
            OpsCard(
                busy = busy,
                onReboot = { sheet = "reboot" },
                onPowerOff = { sheet = "poweroff" },
            )
        }
```

在文件末尾（`private fun String.orDash()` 之前）加：

```kotlin
@Composable
private fun WifiCard(
    data: DeviceStatus,
    autoOffMinutes: Int?,
    onEdit: () -> Unit,
    onAutoOff: () -> Unit,
) {
    MifiCard(title = "WiFi 管理") {
        KvRow("名称", data.wifi.ssid.ifBlank { "--" })
        KvRow("加密方式", data.wifi.security.ifBlank { "--" })
        KvRow("信道", data.wifi.channel.ifBlank { "--" })
        KvRow("空闲自动关闭", UiText.autoOffLabel(autoOffMinutes))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            MifiButton("修改名称与密码", Modifier.weight(1f), onClick = onEdit)
            MifiButton("自动关闭设置", Modifier.weight(1f), onClick = onAutoOff)
        }
        Text(
            "关闭无线会让手机和电脑立刻断开，且没有任何远程方式能再打开，因此这里不提供关闭入口。",
            color = MifiMuted,
            fontSize = 12.sp,
        )
    }
}

@Composable
private fun OpsCard(busy: String?, onReboot: () -> Unit, onPowerOff: () -> Unit) {
    MifiCard(title = "设备操作") {
        Text("重启设备", color = MifiText, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
        Text(
            "断开约 1 分钟，之后自动恢复联网。WiFi 名称、密码和各项设置都不变。",
            color = MifiMuted,
            fontSize = 12.sp,
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            MifiButton("重启", enabled = busy == null, onClick = onReboot)
        }
        HorizontalDivider(color = MifiBorder)
        Text("关闭设备", color = MifiBad, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
        Text(
            "整机断电，WiFi 和本页同时失联。关机后只能按机身上的电源键开机，远程无法恢复。",
            color = MifiMuted,
            fontSize = 12.sp,
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            MifiButton(
                "关闭",
                enabled = busy == null,
                containerColor = MifiBad.copy(alpha = 0.18f),
                contentColor = MifiBad,
                onClick = onPowerOff,
            )
        }
    }
}
```

所需新增 import（`HomeScreen.kt` 已有 `DeviceStatus`、`HorizontalDivider`，不要重复添加）：

```kotlin
import androidx.compose.foundation.layout.Row
```

Task 12 的 `HomeScreen.kt` 已导入 `Row`，因此这一行同样可以省略；若编译器报未解析引用，再按提示补。

- [ ] **Step 8: 接入工厂与主框架**

`ui/AppViewModelFactory.kt` 的 `when` 加分支：

```kotlin
        modelClass.isAssignableFrom(HomeActionsViewModel::class.java) ->
            HomeActionsViewModel(container.repository, container.coordinator) as T
```

`ui/AppRoot.kt` 的 `Tab.Home` 分支改为：

```kotlin
                Tab.Home -> {
                    val factory = remember(container) { AppViewModelFactory(container) }
                    val home: HomeViewModel = viewModel(factory = factory)
                    val actions: HomeActionsViewModel = viewModel(factory = factory)
                    HomeScreen(
                        vm = home,
                        actions = actions,
                        onOpenTraffic = { tab = Tab.Traffic },
                        onOpenDevices = { tab = Tab.Devices },
                    )
                }
```

- [ ] **Step 9: 运行测试**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests "com.sunzehui.wifimanage.protocol.WriteRulesTest"`
Expected: 4 个测试 PASS。

Run: `cd android && ./gradlew :app:testDebugUnitTest`
Expected: 全部 64 个测试 PASS。

- [ ] **Step 10: 构建与真机验收（写操作）**

Run: `cd android && ./gradlew :app:assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk`
Expected（逐项都要同时看数字与现象）：
- WiFi 管理卡显示当前 SSID / 加密方式 / 信道 / 空闲自动关闭，与设备后台一致；改名称+密码保存后 Toast 显示「WiFi 名称和密码已更新…」，约 10 秒后首页 SSID 变为新名称。
- 自动关闭选 30 分钟保存 → Toast「已设为空闲 30 分钟后自动关闭无线」，卡片行显示「30 分钟」，再打开弹层默认选中 30 分钟。
- SIM 弹层显示当前卡槽；切到另一卡槽后 Toast「SIM 卡槽已切换…」，约 30 秒后卡片描述变为新卡槽；切到当前卡槽提示「当前已在使用该卡槽，无需切换」。
- 频段弹层默认勾选已启用频段；只留 B1+B3 保存 → Toast「频段设置已保存…」，重开弹层仍是这两项；全部取消时提示「请至少选择一个频段」。
- 重启 → 首页出现「设备正在重启」计时条，约 1 分钟后 Toast「设备已重启完成」，状态条消失。
- 关闭 → 红色二次确认，未勾选时按钮不可点；确认后出现「设备已关机」，长按电源键开机后点「我已开机」恢复。

- [ ] **Step 11: 提交**

```bash
git add android/app/src/main/kotlin/com/sunzehui/wifimanage/protocol/WriteRules.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/HomeActionsViewModel.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/WriteSheets.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/UiText.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/Components.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/HomeScreen.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/AppViewModelFactory.kt \
  android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/AppRoot.kt \
  android/app/src/test/kotlin/com/sunzehui/wifimanage/protocol/WriteRulesTest.kt
git commit -m "写操作: WiFi、自动关闭、SIM、频段与整机动作"
```

---

### Task 17: 文档、ADR 与旧壳清理

**Files:**
- Create: `docs/adr/0001-native-android-client.md`
- Modify: `README.md`
- Delete: `android/wifi-dashboard.apk`（仓库内旧 WebView 包，历史上带过明文凭据）
- Delete: `android/tools/`（`make_icon.py` 与重复的 `tools/res`，图标已迁入 `:app`）
- Delete: 本机遗留的 `android/wifi-dashboard.apk.idsig`

**Interfaces:**
- Consumes: 全部实现任务
- Produces: 与原生实现一致的 README、可追溯的决策记录、不再残留旧壳产物

- [ ] **Step 1: 删除旧 APK 与工具目录**

```bash
git rm android/wifi-dashboard.apk
git rm -r android/tools
rm -f android/wifi-dashboard.apk.idsig
```

Expected: `git status` 显示 `android/wifi-dashboard.apk`、`android/tools/` 为删除；工作区不再有 `*.idsig`。

- [ ] **Step 2: 写 ADR**

`docs/adr/0001-native-android-client.md`：

```markdown
# ADR 0001: 原生 Android 客户端替代 WebView 壳

- 日期：2026-10-31
- 状态：已接受
- 关联：[原生 Android 客户端设计](../superpowers/specs/2026-10-31-native-android-client-design.md)

## 背景

旧 APK 是 WebView 壳：页面与 `core.js` / `gateway.js` 打包进 assets，`MainActivity` 另起
`127.0.0.1:8787` 本地代理转发设备与发卡平台。它解决了两件事——WebView 强制携带
`Accept-Encoding: gzip` 会让固件 KICKOFF，浏览器又读不到发卡平台的 `Set-Cookie`——但也带来：

- 两套运行时（WebView + 代理）与三端代码（PHP / Node / 内嵌 JS）持续漂移；
- 密码与卡号只能存 `localStorage`，与原生设置、通知桥割裂；
- WebView 的内存与生命周期不可控，界面无法复用系统组件。

## 决策

Android 端改为全原生：Kotlin + Compose 单模块，`protocol/` 重写 Digest、XML 与字段换算，
`data/` 负责会话、缓存与设置（Keystore AES-GCM），`ui/` 为 Compose 页面，`notify/` 为状态条。
只直连 `192.168.1.1`，固定 `admin`，不再有服务器地址回退；请求显式 `Accept-Encoding: identity`
并保持 `Connection: close`。协议正确性由现有 JS / PHP 固定向量约束。

## 后果

- 正面：去掉代理与 WebView，安装包更小；设置、通知、生命周期统一；离线可构建。
- 负面：协议出现 Kotlin 实现，必须与 `public/core.js` 同批跑测试向量；升级后需重输一次凭据；
  后台常驻刷新仍不可用（唯一管理会话 + 耗电）。
- 回滚：旧 APK 的 `versionCode 1` 低于新版 `2`，回滚需先卸载新版再装旧包；签名不变。

## 被否掉的替代方案

1. 保留 WebView + 代理，只换壳——问题原样保留，且无法安全存密码。
2. 原生 UI + WebView 数据层（离屏 WebView 跑网关）——等于把浏览器藏进服务，生命周期与内存更难管。
3. 原生 UI + 保留本地代理、复用 `core.js`——仍需 JS 运行时，协议仍是两份，收益最低。
4. 原生 + 前台服务后台轮询——会与网页版抢唯一管理会话，且持续耗电，超出「瞟一眼状态」的收益。
```

- [ ] **Step 3: 改写 README 的 Android 段**

把 `README.md` 第 9 行的特性条目：

```markdown
- **APK**: WebView 壳 + 内置 JS 网关，手机**无需任何服务器**直连设备（见下）
```

替换为：

```markdown
- **原生 App**: Kotlin + Jetpack Compose，手机**无需任何服务器**直连设备（见下）
```

把从 `## Android App (APK)` 开始、到 `## 使用` 之前的整段（旧壳原理、通知桥、为什么没做后台刷新、
免 Gradle 构建）替换为：

```markdown
## 原生 Android App

`android/` 是 Kotlin + Jetpack Compose 的原生客户端，**不嵌 WebView、不需要任何服务器**；
手机连上随身 WiFi 后直接访问 `192.168.1.1`。

1. 构建：`cd android && ./gradlew :app:assembleDebug`
2. 安装：`adb install -r app/build/outputs/apk/debug/app-debug.apk`
3. 首次打开点右上角 **⚙** 填设备密码（发卡平台设备号可选）；密码与卡号用 Android Keystore
   AES-GCM 加密后存 DataStore，通知开关明文保存。

功能与网页版对齐：状态、网速曲线、流量与套餐总量、设备列表、WiFi 名称/密码、无客户端自动关闭、
SIM 卡槽、频段锁定、重启/关机，以及通知栏常驻状态条。

### 与旧 WebView 版的差异

- 原生重写后 `versionCode 2`，仍用本地 `android/debug.keystore` 签名；保留旧 APK 即可覆盖升级。
- WebView 的 `localStorage` 原生读不到：升级后首次打开要重输设备密码与发卡平台设备号，
  通知开关回到默认开启。
- 只直连 `192.168.1.1`，不再提供「填服务器地址走局域网」的回退模式。
- 同一台设备同一时间只允许一个管理会话：App 与网页版同时使用会互相踢下线，后登录的一方获胜。

### 通知与刷新范围

- 通知栏常驻一条：制式与连接状态、实时上下行、在线设备数/信号/电量。取不到数据时就地降级为
  ⚠ + 具体原因，时间冻结在最后一次成功采样，不新增第二条通知。
- 只在 App 可见时轮询：前台每 5 秒采样，重区块每 30 秒重绘；退到后台停止请求，通知保留最后快照；
  Activity 销毁即撤条。不做后台常驻刷新——会与网页版抢唯一管理会话，也持续耗电。
- Android 13+ 首次启动申请通知权限；拒绝后可在系统设置开启，App 设置页提供入口。

### 构建环境

- JDK 17、Android SDK Platform 36、Gradle wrapper（首次构建联网拉依赖，之后可离线重复）。
- 协议实现（MD5/Digest、XML、字段换算）在 `protocol/`，与 `public/core.js` 共用同一批固定测试向量；
  改协议时两端同批跑测试。
```

- [ ] **Step 4: 更新 README 文件清单**

把下列旧条目：

```markdown
- `public/gateway.js` — APK 内置浏览器网关（经本地代理转设备与发卡平台）
...
- `android/kotlin/com/sunzehui/wifimanage/MainActivity.kt` — APK 壳：全屏 WebView + 本地代理 `LocalProxy`
- `android/kotlin/com/sunzehui/wifimanage/StatusNotifier.kt` — 通知栏常驻状态条 + 页面→原生的窄桥 `StatusBridge`
- `android/res/drawable/ic_stat_mifi.xml` — 状态栏小图标（24dp 纯白 alpha 矢量 WiFi）
- `android/tools/make_icon.py` — 程序化生成启动图标（`res/mipmap-*/`、`public/icon.png`）
- `android/tools/proxy-test/` — 不接手机验证代理的 JVM 冒烟测试（`run.sh`）
```

替换为：

```markdown
- `public/gateway.js` — 旧 WebView 壳的浏览器网关（已归档，原生客户端不再使用）
...
- `android/app/src/main/kotlin/com/sunzehui/wifimanage/protocol/` — MD5/Digest、XML 解析、模型映射、写操作 XML（纯 Kotlin）
- `android/app/src/main/kotlin/com/sunzehui/wifimanage/data/` — 设备会话、仓储、TTL 缓存、设置存储（Keystore 加密）
- `android/app/src/main/kotlin/com/sunzehui/wifimanage/ui/` — Compose 页面、ViewModel、组件与主题
- `android/app/src/main/kotlin/com/sunzehui/wifimanage/notify/StatusNotifier.kt` — 通知栏常驻状态条
- `android/app/src/main/res/drawable/ic_stat_mifi.xml` — 状态栏小图标（24dp 纯白 alpha 矢量 WiFi）
- `android/debug.keystore` — 本地签名文件（已 gitignore，需自行保留以覆盖升级）
- `docs/adr/0001-native-android-client.md` — 原生重写的决策记录
```

同时把「说明」一节两处「页面 / APK / 所有远程入口」中的 `APK` 改为 `App`，避免继续指向已删除的壳。

- [ ] **Step 5: 补 Android 测试命令**

在 README「检查与测试」一节末尾追加：

```markdown
Android 原生客户端（JVM 单测，覆盖 Digest 固定向量、XML 映射、错误分类与写操作校验）：

```bash
cd android && ./gradlew :app:testDebugUnitTest
```
```

- [ ] **Step 6: 检查文档**

Run: `grep -n "LocalProxy\|wifi-dashboard\.apk\|proxy-test\|build-apk" README.md`
Expected: 无输出（`WebView` 只允许出现在「与旧 WebView 版的差异」标题与对照说明中）。

Run: `git status --short`
Expected: 只包含 Step 1 的删除、README 与 ADR 的新增/修改，不出现 `debug.keystore` 或任何 APK。

- [ ] **Step 7: 提交**

```bash
git add README.md docs/adr/0001-native-android-client.md
git add -u android
git commit -m "文档: 原生客户端说明、ADR 与旧 WebView 壳清理"
```

---

### Task 18: 真机验收（vivo / Android 16）

**Files:**
- 无（只跑验证；结果同时给出数字与可见现象，不新增分析文档）

**Interfaces:**
- Consumes: 全部实现
- Produces: 可复现的验收结论；未通过项回到对应任务修复

真机型号：vivo / Android 16，设备地址固定 `192.168.1.1`。安装可能耗时约 170 秒
（`adb install` 卡在 `Performing Streamed Install` 属正常），**不要中断**。

- [ ] **Step 1: 全量单测**

Run:
```bash
cd android
./gradlew :app:testDebugUnitTest
grep -h "<testcase" app/build/test-results/testDebugUnitTest/*.xml | wc -l
```
Expected: `BUILD SUCCESSFUL`，最后一行数字为 `64`。

- [ ] **Step 2: 构建并覆盖安装**

Run:
```bash
cd android
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```
Expected: `Success`；打开 App 直接进首页（已配置过密码时），或先进设置页（首次安装）。

- [ ] **Step 3: 轮询节奏与通知条数**

Run:
```bash
adb logcat -c
adb logcat -s MifiPoll:D > /tmp/mifi-poll.log &
PID=$!
sleep 32
kill $PID
grep -c "sample ok" /tmp/mifi-poll.log
adb shell dumpsys notification --noredact | grep -c 'com.sunzehui.wifimanage'
```
Expected: 约 6 行 `sample ok`（30 秒 ÷ 5 秒）；通知条数为 `1`；首页网速数字每 5 秒变化，曲线持续向左滚动。

- [ ] **Step 4: 与网页版数字一致（顺序比对，避免互踢）**

1. 保持 App 首页可见，记录本月流量、累计流量、在线设备数、上下行速率。
2. `adb shell am force-stop com.sunzehui.wifimanage`。
3. 在电脑打开网页版，60 秒内记录同四项。

Expected: 本月流量与累计流量差值 < 0.01 GB；在线设备数完全相同；速率同一量级（空载时都可能为 0）。
反过来先开网页再开 App 时，App 应显示「会话被踢」文案，而不是静默空白——这验证唯一会话约束。

- [ ] **Step 5: 写操作逐项验收**

| 操作 | 数字 | 现象 |
|---|---|---|
| WiFi 改名 + 改密 | 保存后约 10 秒，`status1` 的 SSID 变为新名称 | Toast「WiFi 名称和密码已更新…」；手机需用新密码重连 |
| 自动关闭 30 分钟 | 卡片行显示「30 分钟」；重开弹层默认选中 30 分钟 | Toast「已设为空闲 30 分钟后自动关闭无线」 |
| SIM 切到另一卡槽 | 约 30 秒后 `sim.current` 变为目标值 | Toast「SIM 卡槽已切换…」；期间短暂断网属正常 |
| 频段只选 B1 + B3 | 重开弹层仍勾选 2 项 | Toast「频段设置已保存…」；设备重新搜网 |
| 重启 | 计时条从 0 秒走到约 60 秒 | 约 1 分钟后 Toast「设备已重启完成」，状态条消失 |
| 关机 | 二次确认未勾选时按钮不可点 | 勾选后「设备已关机」；长按电源键开机后点「我已开机」恢复 |

- [ ] **Step 6: 失败路径**

- 设置里把设备密码改错 → 5 秒内首页出现「设备拒绝登录: 账号或密码不正确…」，通知就地变 ⚠ 且时间冻结；改回正确密码保存后，一个轮询周期内恢复，通知 ⚠ 消失且条数仍为 1。
- 临时关闭手机 WiFi 或关掉随身 WiFi → 首页「无法连接设备…」，已显示的数字保留；恢复网络后自动回填。
- 在电脑打开设备后台或网页版 → App 显示「设备把本机会话踢出了…」，不自动重试风暴。

- [ ] **Step 7: 后台与生命周期**

Run:
```bash
adb shell input keyevent KEYCODE_HOME
sleep 15
adb logcat -d -s MifiPoll:D | tail -3
adb shell dumpsys notification --noredact | grep -c 'com.sunzehui.wifimanage'
```
Expected: 退到后台后日志不再新增 `sample ok`；通知条数仍为 `1`（保留最后快照）。

Run:
```bash
adb shell am force-stop com.sunzehui.wifimanage
adb shell dumpsys notification --noredact | grep -c 'com.sunzehui.wifimanage'
```
Expected: `0`（进程结束即撤条）。

- [ ] **Step 8: 覆盖升级与凭据迁移**

```bash
git cat-file -e 4a906ed:android/wifi-dashboard.apk && echo old-apk-ok
git show 4a906ed:android/wifi-dashboard.apk > /tmp/wifi-dashboard-old.apk
adb install -r /tmp/wifi-dashboard-old.apk     # versionCode 1，可能约 170 秒
```
打开旧版确认能启动（WebView 首页出现），然后：

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```
Expected: 覆盖安装 `Success`（同签名、versionCode 2 > 1）；打开新版直接停在设置页并提示填写设备密码——
`localStorage` 不可读，这是设计内的迁移成本。

- [ ] **Step 9: 人工观感确认（无法自动化）**

以下项目由用户目视确认，不写断言：
- 网速曲线滚动是否流畅、无明显跳动；
- 深色配色、字号与卡片间距是否与网页版观感一致；
- 弹层与 Toast 的动画是否跟手。

- [ ] **Step 10: 收尾**

Run: `git status --short`
Expected: 干净（验收不产生文件）。

将 Step 1–8 的数字与现象、Step 9 的目视结论记录到对应 GitHub Issue / PR 描述；任何一项不符合预期，
回到产生该行为的任务修复后重跑本任务。

---
