#!/bin/sh
set -eu

APP_DIR=/root/trendpublish
DATA_DIR="$APP_DIR/data/toutiao"
ENV_FILE="$DATA_DIR/relay.env"

mkdir -p "$DATA_DIR/browser-data" "$DATA_DIR/browser-home" "$DATA_DIR/screenshots"
chown -R 1993:1993 "$DATA_DIR"

if [ ! -f "$ENV_FILE" ]; then
  umask 077
  printf 'TOUTIAO_RELAY_TOKEN=%s\n' "$(openssl rand -hex 32)" > "$ENV_FILE"
fi

docker rm -f trendpublish-toutiao-relay >/dev/null 2>&1 || true
docker run -d \
  --name trendpublish-toutiao-relay \
  --restart unless-stopped \
  --log-opt max-size=20m \
  --log-opt max-file=5 \
  -p 127.0.0.1:8091:8091 \
  -p 127.0.0.1:6080:6080 \
  --env-file "$ENV_FILE" \
  -e TOUTIAO_RELAY_PORT=8091 \
  -e TOUTIAO_HEADLESS=false \
  -e TOUTIAO_CHROME_EXECUTABLE_PATH=/usr/bin/chromium \
  -e TOUTIAO_CHROME_NO_SANDBOX=true \
  -e HOME=/data/toutiao/browser-home \
  -e TOUTIAO_PROFILE_DIR=/data/toutiao/browser-data \
  -e TOUTIAO_SCREENSHOTS_DIR=/data/toutiao/screenshots \
  -e TOUTIAO_STATE_PATH=/data/toutiao/article-records.json \
  -v "$APP_DIR/src:/app/src:ro" \
  -v "$DATA_DIR:/data/toutiao" \
  trendpublish:toutiao-relay

# 容器就绪后自动打开扫码页；令牌只在服务器本地读取，不写入日志。
# 首次运行需要下载 Deno 依赖和启动 Chromium，60 秒在网络波动时不够。
for _ in $(seq 1 90); do
  if curl -fsS http://127.0.0.1:8091/health >/dev/null; then
    token=$(sed -n 's/^TOUTIAO_RELAY_TOKEN=//p' "$ENV_FILE")
    curl -fsS -X POST http://127.0.0.1:8091/api/toutiao/login \
      -H "Authorization: Bearer $token" >/dev/null
    exit 0
  fi
  sleep 2
done

echo "今日头条 Relay 未在 180 秒内就绪" >&2
exit 1
