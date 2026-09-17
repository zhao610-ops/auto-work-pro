# 今日头条 Relay

今日头条 Relay 通过独立的浏览器资料目录复用单账号登录态，只负责头条图文草稿和原生定时发布，不影响微信公众号发布链路。

Relay 会将 `idempotencyKey` 与头条草稿列表返回的真实文章 ID 持久化到
`data/toutiao/article-records.json`。该文件不保存正文和 Cookie，必须与浏览器资料目录一起保留在本机，且不应提交到版本库。

## 启动

```bash
TOUTIAO_RELAY_TOKEN=你的本机令牌 \
TOUTIAO_DEFAULT_SCHEDULE_TIME=11:00 \
deno task toutiao:relay
```

`TOUTIAO_DEFAULT_SCHEDULE_TIME` 默认是 `11:00`，按北京时间计算下一次可用发布时间。今日头条仅接受当前时间后 2 小时至 7 天内的定时任务；超出窗口时 Relay 会返回 `SCHEDULE_WINDOW_INVALID`，不会确认发布。

## 第四阶段：接入主系统调度

主服务可复用现有文章工作流预生成标题和 HTML，但不会创建微信草稿；头条任务由独立队列提交给本 Relay。请在 `trendpublish.config.ts` 中配置：

```ts
providers: {
  publish: {
    // 原有 weixin / weixinRelay 配置保持不变
    toutiaoRelay: {
      url: "http://127.0.0.1:8091",
      token: "与 TOUTIAO_RELAY_TOKEN 一致的本机令牌",
    },
  },
},
features: {
  article: {
    toutiao: {
      enabled: true,
      scheduleTime: "11:00",
      // 默认 150 分钟；头条原生定时要求至少提前 2 小时。
      preparationLeadMinutes: 150,
      // 可选：复用指定文章 Runtime Profile。
      profileId: "article-default",
    },
  },
},
```

主服务每 5 分钟检查一次。到达预生成窗口后，它会以 dry-run 运行文章工作流、保存标题/HTML 产物，并立即提交头条原生定时发布；因此 11:00 是头条实际发布时间，不是浏览器操作时间。连续失败 3 次会熔断为 `blocked`，不会持续重复创建草稿。

运行管理接口：

```bash
# 查看队列、文章 ID、终态、执行失败信息与截图路径
curl http://127.0.0.1:8000/api/toutiao/jobs \
  -H "Authorization: Bearer 主服务 API 令牌"

# 手动触发一次安全调度检查（只会在预生成时间窗内创建任务）
curl -X POST http://127.0.0.1:8000/api/toutiao/jobs \
  -H "Authorization: Bearer 主服务 API 令牌"
```

## 第五阶段：上线运维保障

主服务提供 `GET /api/toutiao/ops`，返回 Relay 可达性、队列状态和最近任务；该检查不创建文章。
对 `failed` 或 `blocked` 的任务可调用 `POST /api/toutiao/ops` 并传入 `jobId` 重置为 `ready`，后续仍由调度器按头条最小提前时间限制提交，不能绕过平台时间窗口。

上线前请确认：Relay 与主服务使用不同进程、`data/toutiao/browser-data` 持久化存储、通知渠道已配置、以及 Dashboard 能访问 `/api/toutiao/ops`。登录失效或浏览器异常时，应先查看任务中的截图路径，再在 Relay 机器完成登录后重试。

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

## 阶段三：反查与幂等

草稿或定时请求提供 `idempotencyKey` 后，Relay 在自动保存完成时会读取头条
`creator_center/draft_list` 接口，按精确标题查找并回填 `articleId`、`reconciledAt`。
重试相同的键不会再次创建草稿；若同一键对应了不同标题，会返回
`IDEMPOTENCY_CONFLICT`。

可主动反查本地任务并刷新状态：

```bash
curl "http://127.0.0.1:8091/api/toutiao/articles?idempotencyKey=article-run-001" \
  -H "Authorization: Bearer 你的本机令牌"
```

若头条刚保存、列表尚未可见，Relay 会保存为 `pending_reconciliation`，并拒绝用相同幂等键重复创建；稍后再次调用反查接口即可。反查会先查询草稿列表，再查询“作品管理”列表，以确认 `draft`、`scheduled` 或 `published` 终态；两处都暂未出现已确认定时任务时，才保留本地已确认的 `scheduled` 状态。
