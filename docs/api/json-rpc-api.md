# JSON-RPC API（手动触发工作流）

## 概览

该接口用于立即触发微信文章发布工作流，不需要等待定时任务。

- 协议：JSON-RPC 2.0
- 方法：`triggerWorkflow`
- 路径：`POST /api/workflow`
- 默认地址：`http://localhost:8000/api/workflow`

新看板和自动化建议优先使用 REST 入口：

- `GET /dashboard`
- `GET /api/health`
- `GET /api/config/summary`
- `GET /api/config/providers`
- `GET /api/config/capabilities`
- `GET /api/config/features/article/profiles`
- `POST /api/runs`
- `GET /api/runs`
- `GET /api/runs/:runId`
- `GET /api/artifacts?key=...`

`POST /api/workflow` 继续保留，用于兼容旧调用。

## 认证

请求必须带 Bearer Token：

```text
Authorization: Bearer <server.apiKey>
```

`server.apiKey` 来自 `trendpublish.config.ts`。

## REST 冒烟检查

`GET /api/health` 用于检查 Cloudflare 绑定和配置是否可用：

```bash
curl -H "Authorization: Bearer your-api-key" \
  https://your-worker.workers.dev/api/health
```

返回值会包含 `config`、`kv`、`d1`、`r2` 等检查项。任一检查失败时 HTTP 状态为
`500`，方便部署后快速定位是配置、binding 还是存储资源问题。

`GET /api/config/summary` 返回 dashboard 展示用的脱敏配置摘要，只包含模板、
数据源数量、存储类型和功能开关，不返回任何 provider secret。

运行时配置 REST API 用于 Dashboard：

- `GET /api/config/providers`：查看 provider 脱敏可用状态。
- `GET/POST /api/config/capabilities`：管理 LLM、图片生成、通知等共享能力
  Profile。
- `GET/POST /api/config/features/article/profiles`：管理微信文章 Profile。
- `PATCH /api/config/features/article/profiles/:profileId`：更新文章 Profile
  参数。
- `DELETE /api/config/features/article/profiles/:profileId`：删除非默认微信文章
  Profile，并清理它的数据源、抓取分组和定时规则。
- `PUT /api/config/features/article/profiles/:profileId/sources`：替换数据源。
- `PUT /api/config/features/article/profiles/:profileId/fetch-groups`：替换抓取分组。
- `PUT /api/config/features/article/profiles/:profileId/schedule`：更新定时。

触发一次 dry-run：

```bash
curl -X POST https://your-worker.workers.dev/api/runs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{"dryRun": true, "trigger": "manual", "maxArticles": 1}'
```

查询运行详情：

```bash
curl -H "Authorization: Bearer your-api-key" \
  https://your-worker.workers.dev/api/runs/<runId>
```

## 请求示例

```bash
curl -X POST http://localhost:8000/api/workflow \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "jsonrpc": "2.0",
    "method": "triggerWorkflow",
    "params": {
      "dryRun": true
    },
    "id": 1
  }'
```

## 请求参数

```json
{
  "jsonrpc": "2.0",
  "method": "triggerWorkflow",
  "params": {
    "dryRun": true
  },
  "id": 1
}
```

- `jsonrpc`: 固定为 `2.0`
- `method`: 固定为 `triggerWorkflow`
- `params`: 微信文章工作流参数，例如 `dryRun`、`maxArticles`、`sourceType`
- `id`: 请求 ID（数字或字符串）

兼容旧请求中的
`workflowType=weixin-article-workflow`，但不再支持切换到其他工作流。

## 响应示例

成功：

```json
{
  "jsonrpc": "2.0",
  "result": {
    "success": true,
    "message": "微信文章工作流已成功触发"
  },
  "id": 1
}
```

认证失败：

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32001,
    "message": "未授权的访问",
    "data": {
      "error": "缺少有效的 Authorization 请求头"
    }
  }
}
```

参数错误：

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32600,
    "message": "无效的 JSON-RPC 请求"
  },
  "id": "unknown"
}
```

## 常见错误码

| 错误码   | 含义           | 处理建议                                |
| -------- | -------------- | --------------------------------------- |
| `-32001` | 未授权         | 检查 `Authorization` 与 `server.apiKey` |
| `-32600` | 请求格式错误   | 检查 JSON-RPC 字段完整性                |
| `-32601` | 方法或路径错误 | 检查 `method` 与 `/api/workflow`        |
| `-32603` | 服务内部错误   | 查看服务日志定位具体异常                |

## 联调建议

- 先用 `dryRun=true` 做冒烟测试。
- 通过后再关闭 `dryRun` 联调真实发布。
- 若部署在公网，建议在网关层增加来源限制与限流。
