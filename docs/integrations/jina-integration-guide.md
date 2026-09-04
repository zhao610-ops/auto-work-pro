# Jina AI 集成指南

Jina 在本项目中用于抓取增强、深度检索、向量化与重排。

## 使用前提

在 `trendpublish.config.ts` 中设置：

```ts
providers: {
  fetch: {
    jina: {
      apiKey: "your_jina_api_key",
    },
  },
}
```

Reader / Search / DeepSearch 都复用 `providers.fetch.jina.apiKey`。未设置时，
相关模块会报 `providers.fetch.jina.apiKey is not set`。

## 涉及能力

- Reader 抓取
- Search 关键词搜索
- DeepSearch 深度检索
- Embedding 向量生成
- Reranker 结果重排

## 代码位置

- Reader: `src/integrations/fetch/providers/jina/jina-reader-scraper.ts`
- Search: `src/integrations/fetch/providers/jina/jina-search-scraper.ts`
- DeepSearch: `src/integrations/fetch/providers/jina/jina-deepsearch-scraper.ts`
- Embedding: `src/integrations/vector/providers/jina/jina-embedding-provider.ts`
- Reranker: `src/integrations/vector/providers/jina/jina-reranker-provider.ts`

## 典型使用场景

1. 抓取网页正文时，优先走 Jina Reader。
2. 关键词发现数据源时，使用 Jina Search，例如
   `search:AI agent research breakthrough latest`。
3. 搜索类问答场景，使用 DeepSearch 获取汇总答案和来源。
4. 需要语义相关性排序时，先 Embedding 再 Reranker。

## 排查建议

### 报 401/403

- 检查 `providers.fetch.jina.apiKey` 是否正确、是否过期。

### 响应慢或超时

- 缩小输入文本长度。
- 降低并发。
- 增加上游网络重试机制。

### 结果不理想

- 优先改输入内容质量。
- 按场景切换不同模型。
- 在业务侧增加规则过滤，再交给模型处理。

## 参考

- Jina 官网: <https://jina.ai/?sui=apikey>
- Jina 文档: <https://docs.jina.ai/>
