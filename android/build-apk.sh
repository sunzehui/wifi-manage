#!/bin/bash
# 离线构建 APK (无需 Gradle): aapt2 + javac + d8 + zipalign + apksigner
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

# 2. aapt2: manifest + resources + assets -> base.apk
"$BT/aapt2" link -I "$PLATFORM" \
  --manifest AndroidManifest.xml \
  --min-sdk-version 21 --target-sdk-version 28 \
  -A "$OUT/stage/assets" \
  -o "$OUT/base.apk"

# 3. javac + d8 -> classes.dex
javac -source 1.8 -target 1.8 -nowarn \
  -bootclasspath "$PLATFORM:/Users/sunzehui/Library/Java/JavaVirtualMachines/corretto-1.8.0_482/Contents/Home/jre/lib/rt.jar" \
  -d "$OUT/classes" \
  java/com/sunzehui/wifimanage/MainActivity.java
"$BT/d8" --release --lib "$PLATFORM" --min-api 21 \
  --output "$OUT" \
  $(find "$OUT/classes" -name '*.class')

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
