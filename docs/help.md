# 帮助文档

## 常用入口

- [快速开始](/getting-started)
- [配置说明](/configuration)
- [部署与发布](/deployment)
- [JSON-RPC API](/api/json-rpc-api)
- [数据获取 API](/integrations/data-fetching-apis)
- [钉钉 Webhook 配置指南](/integrations/dingtalk-webhook-guide)
- [Jina AI 集成指南](/integrations/jina-integration-guide)

## 常见问题

### 启动时报配置错误

1. 确认仓库根目录存在 `trendpublish.config.ts`。
2. 运行 `deno task doctor` 查看缺失项。
3. 对照 `trendpublish.config.example.ts` 补齐基础配置（尤其是
   `server.apiKey`、`providers.publish.weixin` 与 `providers.ai` 配置）。
4. 如果是数据库相关错误，先将 `features.article.deduplication.enabled=false`
   试跑，确认核心流程可用后再接入数据库。

### JSON-RPC 请求返回 401

1. 请求头必须是 `Authorization: Bearer <server.apiKey>`。
2. 确认 `trendpublish.config.ts` 中 `server.apiKey` 与请求值一致。

### JSON-RPC 请求返回 404

1. 路径必须是 `POST /api/workflow`。
2. 不要遗漏 `/api` 前缀。

### 定时任务没有执行

1. 程序内置 cron 表达式为每天 `03:00`（时区 `Asia/Shanghai`）。
2. 定时任务固定执行微信文章发布工作流。
3. 确认进程常驻（例如使用 `pm2` 托管）。

### 抓取结果质量不稳定

1. 普通网页建议配置 `providers.fetch.firecrawl.apiKey` 或
   `providers.fetch.jina.apiKey`。
2. 关键词搜索可以先用无需 key 的 `gdelt`、`hackernews`、`arxiv`，再按需加入
   `brave-search`、`jina-search`、`tavily-search`、`exa-search` 或
   `serper-search`。
3. 调整数据源质量，避免低质量站点。
4. 使用更适合长文本分析的 `providers.ai.model`。

### 微信发布失败

1. 检查 `providers.publish.weixin.appId` 与
   `providers.publish.weixin.appSecret`。
2. 检查公众号后台 IP 白名单。
3. 检查模板中是否有超长内容或不合法 HTML。
4. 先执行
   `deno task article --dry-run`，确认抓取、摘要和模板渲染无误后再正式发布。

### 想只看模板效果

运行：

```bash
deno task preview
```

生成的 HTML 位于 `src/temp/preview_weixin_*.html`。

## 排查建议

- 先手动触发 API，确认单次工作流可跑通。
- 再启用 cron 与通知，观察完整链路。
- 每次只改一组配置，便于定位问题。
