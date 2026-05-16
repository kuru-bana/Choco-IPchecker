#!/bin/bash
set -e

echo "=== Choco-ip 起動スクリプト ==="

if [ ! -f "/app/data/GeoLite2-City.mmdb" ]; then
  if [ -n "$GEOLITE2_LICENSE_KEY" ]; then
    echo "GeoLite2 データベースをダウンロードします..."
    bash /app/setup.sh
  else
    echo "警告: GEOLITE2_LICENSE_KEY が未設定のため DB ダウンロードをスキップします"
    echo "IP検索機能は利用できません"
  fi
else
  echo "GeoLite2 データベースは既に存在します"
fi

echo "サーバーを起動します (PORT=${PORT:-5000})..."
exec node server.js
