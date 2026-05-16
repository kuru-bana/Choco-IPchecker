#!/bin/bash
set -e

LICENSE_KEY="${GEOLITE2_LICENSE_KEY}"
DATA_DIR="./data"

if [ -z "$LICENSE_KEY" ]; then
  echo "エラー: 環境変数 GEOLITE2_LICENSE_KEY が設定されていません"
  exit 1
fi

mkdir -p "$DATA_DIR"

echo "GeoLite2-City をダウンロード中..."
curl -sL "https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City&license_key=${LICENSE_KEY}&suffix=tar.gz" \
  | tar -xzO --wildcards "*/GeoLite2-City.mmdb" > "$DATA_DIR/GeoLite2-City.mmdb"
echo "GeoLite2-City 完了"

echo "GeoLite2-ASN をダウンロード中..."
curl -sL "https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-ASN&license_key=${LICENSE_KEY}&suffix=tar.gz" \
  | tar -xzO --wildcards "*/GeoLite2-ASN.mmdb" > "$DATA_DIR/GeoLite2-ASN.mmdb"
echo "GeoLite2-ASN 完了"

echo "データベースの準備が完了しました"
