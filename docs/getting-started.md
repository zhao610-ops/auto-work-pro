# 快速开始

## 1. 环境要求

- Deno v2.0.0+
- Node.js 18+（用于 VitePress 文档）

## 2. 克隆项目

```bash
git clone https://github.com/liyown/ai-trend-publish
cd ai-trend-publish
```

## 3. 初始化配置

```bash
cp trendpublish.config.example.ts trendpublish.config.ts
```

至少先完成以下字段：

- `server.apiKey`
- `providers.ai.baseUrl`
- `providers.ai.apiKey`
- `providers.ai.model`

正式发布公众号时再配置：

- `providers.publish.weixin.appId`
- `providers.publish.weixin.appSecret`

跑微信文章工作流时，至少配置一种抓取源：

- `features.article.sources`
- URL 对应的 `providers.fetch.*`

最简单的数据源写法是 URL 列表：

```ts
features: {
  article: {
    renderer: {
      promptProfile: "technology",
    },
    sources: [
      "https://news.ycombinator.com/",
      "social:https://x.com/OpenAIDevs",
    ],
  },
},
fetchGroups: {
  default: ["auto"],
  social: ["twitter"],
},
```

如果你想直接聚合自己维护的 RSS / Atom / JSON Feed，也可以把订阅地址直接放进
`features.article.sources`：

```ts
features: {
  article: {
    renderer: {
      promptProfile: "technology",
    },
    sources: [
      "https://your-feed.example.com/rss.xml",
      "https://another-feed.example.com/atom.xml",
    ],
  },
},
fetchGroups: {
  default: ["auto"],
},
```

先运行 `deno task article --dry-run`，确认当天产物里已经出现自定义 RSS 的文章，
再继续接入正式发布链路。

更多功能开关和必填项见 [配置说明](/configuration)。

## 4. 本地启动

```bash
# 检查配置是否完整
deno task doctor

# 启动主服务（含定时任务 + JSON-RPC 服务）
deno task dev

# 预览微信模板
deno task preview

# dry-run 跑一次微信文章流程，不真正发布
deno task article --dry-run

# 多账号矩阵 dry-run；不传账号时使用全部启用账号
deno task article --matrix
deno task article --matrix --account main,lab
```

默认会启动在 `http://localhost:8000`，并提供：

- `GET /dashboard`：运行看板。
- `GET /api/health`：本地服务健康检查。
- `GET /api/config/summary`：dashboard 使用的脱敏配置摘要。
- `POST /api/runs`：触发微信文章工作流。
- `POST /api/runs/matrix`：触发多账号矩阵 dry-run。
- `POST /api/workflow`：旧 JSON-RPC 兼容入口。

## 5. Docker 启动

也可以直接使用发布镜像：

```bash
mkdir -p config data/temp
cp trendpublish.config.docker.example.ts config/trendpublish.config.ts
docker compose up -d
```

Docker 会读取 `./config/trendpublish.config.ts`，dry-run 输出、运行状态和
artifact 会写到 `./data/temp`，可通过 `/dashboard` 查看。发布镜像已经内置
dashboard 构建产物，不需要在服务器上运行前端构建。更多部署细节见
[部署文档](/deployment)。

## 6. 触发一次工作流

```bash
curl -X POST http://localhost:8000/api/workflow \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "jsonrpc": "2.0",
    "method": "triggerWorkflow",
    "params": {
      "workflowType": "weixin-article-workflow",
      "dryRun": true
    },
    "id": 1
}'
```

## 7. 文档开发（VitePress）

```bash
deno task docs
deno task docs build
```

## 8. 构建当前平台二进制

```bash
deno task build
```
