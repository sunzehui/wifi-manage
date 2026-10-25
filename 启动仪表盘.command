#!/bin/bash
# 双击启动随身 WiFi 仪表盘 (macOS)
# PHP_CLI_SERVER_WORKERS=4: 多 worker, 静态页面不会被慢速设备数据请求阻塞
# 绑定 0.0.0.0: 同一 WiFi 下的手机可直接访问
cd "$(dirname "$0")"
export PHP_CLI_SERVER_WORKERS=4

LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
echo "=============================================="
echo "  随身 WiFi 仪表盘"
echo "----------------------------------------------"
echo "  本机访问:  http://127.0.0.1:8765"
if [ -n "$LAN_IP" ]; then
  echo "  手机访问:  http://${LAN_IP}:8765   (需连接同一 WiFi)"
fi
echo "  停止服务:  关闭本窗口 或 Ctrl+C"
echo "=============================================="
echo ""

exec php -S 0.0.0.0:8765 -t public server.php
