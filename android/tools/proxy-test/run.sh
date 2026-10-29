#!/bin/bash
# 不接手机验证 LocalProxy：在普通 JVM 上跑刚编译出来的 Kotlin 字节码。
# 前提：先跑一次 ./build-apk.sh（产出 build/classes）。
# 用法：./tools/proxy-test/run.sh [发卡平台设备号]
set -euo pipefail
cd "$(dirname "$0")/../.."

SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
PLATFORM="$(ls "$SDK"/platforms/*/android.jar 2>/dev/null | sort -V | tail -1)"
[ -z "$PLATFORM" ] && { echo "找不到 android.jar" >&2; exit 1; }

KOTLINC="${KOTLIN_HOME:-$HOME/.local/share/kotlinc}/bin/kotlinc"
[ -x "$KOTLINC" ] || KOTLINC="$(command -v kotlinc || true)"
[ -x "$KOTLINC" ] || { echo "找不到 kotlinc" >&2; exit 1; }
STDLIB="$(cd "$(dirname "$KOTLINC")/.." && pwd)/lib/kotlin-stdlib.jar"

[ -d build/classes/com/sunzehui/wifimanage ] || { echo "请先执行 ./build-apk.sh" >&2; exit 1; }

OUT=build/proxy-test
rm -rf "$OUT" && mkdir -p "$OUT"

# JDK 默认把 Connection 视为受限头（安卓不拦），测试时放开，行为和真机一致
CP="$OUT:build/classes:$STDLIB:$PLATFORM"
javac -nowarn -encoding UTF-8 -cp "$CP" -d "$OUT" \
  tools/proxy-test/android/util/Log.java \
  tools/proxy-test/Smoke.java

java -Dsun.net.http.allowRestrictedHeaders=true \
  -Dmgx.card="${1:-SDY001046}" -cp "$CP" Smoke
