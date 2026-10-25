#!/bin/bash
# 双击启动随身 WiFi 仪表盘 (macOS)
# PHP_CLI_SERVER_WORKERS=4: 多 worker, 静态页面不会被慢速设备数据请求阻塞
cd "$(dirname "$0")"
export PHP_CLI_SERVER_WORKERS=4
exec php -S 127.0.0.1:8765 -t public server.php
