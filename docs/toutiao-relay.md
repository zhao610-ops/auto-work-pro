# 今日头条 Relay

今日头条 Relay 通过独立的浏览器资料目录复用单账号登录态，只负责头条图文草稿和原生定时发布，不影响微信公众号发布链路。

## 启动

```bash
TOUTIAO_RELAY_TOKEN=你的本机令牌 \
TOUTIAO_DEFAULT_SCHEDULE_TIME=11:00 \
deno task toutiao:relay
```

`TOUTIAO_DEFAULT_SCHEDULE_TIME` 默认是 `11:00`，按北京时间计算下一次可用发布时间。今日头条仅接受当前时间后 2 小时至 7 天内的定时任务；超出窗口时 Relay 会返回 `SCHEDULE_WINDOW_INVALID`，不会确认发布。

## 定时发布接口

`POST /api/toutiao/scheduled` 会写入标题、正文和可选封面，确认草稿保存后打开头条的定时发布控件。若省略 `scheduledAt`，会自动选择下一次北京时间 11:00。

```bash
curl -X POST http://127.0.0.1:8091/api/toutiao/scheduled \
  -H "Authorization: Bearer 你的本机令牌" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "文章标题",
    "contentHtml": "<p>文章正文</p>",
    "coverImagePath": "/absolute/path/cover.png",
    "idempotencyKey": "article-run-001"
  }'
```

传入 `scheduledAt` 时必须使用 ISO 8601 时间，例如 `2026-09-15T03:00:00.000Z`，即北京时间 2026-09-15 11:00。

返回的 `scheduledFor` 是实际确认的 UTC 时间；失败响应会提供稳定错误码和浏览器截图路径。请勿把 `data/toutiao/browser-data` 或 `data/toutiao/screenshots` 提交到版本库。
