#!/bin/bash
# 离线构建 APK (无需 Gradle): aapt2 + kotlinc + d8 + zipalign + apksigner
# 产物: 随身WiFi仪表盘.apk
set -euo pipefail
cd "$(dirname "$0")"

SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
BT="$SDK/build-tools/35.0.0"
PLATFORM=""
OUT="build"
JAVA_HOME="${JAVA_HOME:-$(/usr/libexec/java_home)}"
APK="wifi-dashboard.apk"

[ -f "$SDK/platforms/android-35/android.jar" ] && PLATFORM="$SDK/platforms/android-35/android.jar"
[ -z "$PLATFORM" ] && PLATFORM="$(ls $SDK/platforms/*/android.jar 2>/dev/null | sort -V | tail -1)"

rm -rf "$OUT"
mkdir -p "$OUT/classes" "$OUT/stage"

# 1. 准备 assets: 页面 + 内置网关
mkdir -p "$OUT/stage/assets/www"
cp ../public/*.html ../public/*.css ../public/*.js "$OUT/stage/assets/www/"
# 本地预置配置(可选): preset.local.js -> assets/www/preset.js, App 首次打开即带配置
[ -f ../preset.local.js ] && cp ../preset.local.js "$OUT/stage/assets/www/preset.js"
echo "preset: $([ -f $OUT/stage/assets/www/preset.js ] && echo 已注入 || echo 无)"

# 2. aapt2: 编译图标资源 -> manifest + resources + assets -> base.apk
"$BT/aapt2" compile --dir res -o "$OUT/res.zip"
"$BT/aapt2" link -I "$PLATFORM" \
  --manifest AndroidManifest.xml \
  --min-sdk-version 21 --target-sdk-version 28 \
  -R "$OUT/res.zip" \
  -A "$OUT/stage/assets" \
  -o "$OUT/base.apk"

# 3. kotlinc + d8 -> classes.dex
#    查找 kotlinc: KOTLIN_HOME > brew 安装位置 > PATH
KOTLINC=""
for c in "${KOTLIN_HOME:-}/bin/kotlinc" \
         "$HOME/.local/share/kotlinc/bin/kotlinc" \
         "$(brew --prefix kotlin 2>/dev/null)/libexec/bin/kotlinc" \
         "$(command -v kotlinc 2>/dev/null)"; do
  [ -n "$c" ] && [ -x "$c" ] && KOTLINC="$c" && break
done
if [ -z "$KOTLINC" ]; then
  echo "错误: 找不到 kotlinc。请安装 Kotlin 编译器后重试:" >&2
  echo "  curl -L -o /tmp/k.zip https://github.com/JetBrains/kotlin/releases/download/v2.0.21/kotlin-compiler-2.0.21.zip" >&2
  echo "  mkdir -p ~/.local/share && unzip -q /tmp/k.zip -d ~/.local/share" >&2
  echo "注意: 请用 2.0.x。2.1+ 的 kotlin.Metadata 版本高于 build-tools 35 内置 R8 的" >&2
  echo "      识别上限(2.0.0)，d8 会对 stdlib 每个类刷一条警告。" >&2
  exit 1
fi
KOTLIN_HOME_RESOLVED="$(cd "$(dirname "$KOTLINC")/.." && pwd)"
STDLIB="$KOTLIN_HOME_RESOLVED/lib/kotlin-stdlib.jar"
if [ ! -f "$STDLIB" ]; then
  echo "错误: 找不到 kotlin-stdlib.jar ($STDLIB)" >&2
  exit 1
fi

# 关掉运行期断言：Kotlin 默认会为公开函数插入参数/返回值的 null 检查，
# 这种小工具没必要为它付出体积和调用开销。
"$KOTLINC" -no-reflect \
  -Xno-param-assertions -Xno-call-assertions -Xno-receiver-assertions \
  -jvm-target 1.8 -classpath "$PLATFORM" -d "$OUT/classes" \
  kotlin/com/sunzehui/wifimanage/MainActivity.kt
# Kotlin 代码依赖 stdlib，必须和业务 class 一起 dex 进同一个 classes.dex
"$BT/d8" --release --lib "$PLATFORM" --min-api 21 \
  --output "$OUT" \
  $(find "$OUT/classes" -name '*.class') "$STDLIB"

# 4. 合包 + 对齐 + 签名
cd "$OUT"
# macOS zip 向已有包添加条目时会保留重复条目(旧 assets 不被覆盖),
# 因此先解包 base.apk 再与 classes.dex 重新打整包
rm -rf pkg && mkdir pkg
unzip -q base.apk -d pkg
cp classes.dex pkg/
( cd pkg && zip -qr ../unsigned.apk . )
"$BT/zipalign" -f 4 unsigned.apk aligned.apk

KS=../debug.keystore
if [ ! -f "$KS" ]; then
  keytool -genkeypair -keystore "$KS" -storepass android -keypass android \
    -alias androiddebugkey -dname "CN=Android Debug,O=Android,C=US" \
    -keyalg RSA -keysize 2048 -validity 10000
fi
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:android --key-pass pass:android \
  --out "../$APK" aligned.apk

cd ..
ls -lh "$APK"
"$BT/apksigner" verify --print-certs "$APK" | head -3
echo "构建完成: $(pwd)/$APK"
