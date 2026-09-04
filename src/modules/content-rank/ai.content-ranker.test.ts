import { assert, assertEquals, assertThrows } from "@std/assert";
import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import type { LLMProvider } from "@src/core/ports/llm.ts";
import {
  ContentRanker,
  parseRankingResult,
  rankContentsLocally,
} from "./ai.content-ranker.ts";

Deno.test("parseRankingResult strips closed think tags", () => {
  const result = parseRankingResult(`
<think>
这里是模型推理过程，不应该进入排序解析。
我会给 article-1 更高分。
</think>
文章ID: article-1: 92.5
文章ID: article-2: 81
`);

  assertEquals(result, [
    { id: "article-1", score: 92.5 },
    { id: "article-2", score: 81 },
  ]);
});

Deno.test("parseRankingResult handles unclosed think tags before rankings", () => {
  const result = parseRankingResult(`
<think>
模型没有闭合思考标签，但后面已经开始输出结果。
article-1: 90
article-2: 76.5
`);

  assertEquals(result, [
    { id: "article-1", score: 90 },
    { id: "article-2", score: 76.5 },
  ]);
});

Deno.test("parseRankingResult skips unclosed think analysis before final rankings", () => {
  const result = parseRankingResult(`
<think>让我分析这两篇文章：

**文章1 (fc_1779266592715_9_230709837):**
- 标题：Remove-AI-Watermarks
- 内容：介绍命令行工具

**文章2 (tw_1779266592715_1):**
- 标题：新模型发布
- 内容：具备新闻价值

最终评分：
fc_1779266592715_9_230709837: 73
tw_1779266592715_1: 91.5
`);

  assertEquals(result, [
    { id: "fc_1779266592715_9_230709837", score: 73 },
    { id: "tw_1779266592715_1", score: 91.5 },
  ]);
});

Deno.test("parseRankingResult ignores fences and prose around rankings", () => {
  const result = parseRankingResult(`
下面是评分：
\`\`\`text
- 文章ID: foo 分数: 88
- bar：77.5
\`\`\`
`);

  assertEquals(result, [
    { id: "foo", score: 88 },
    { id: "bar", score: 77.5 },
  ]);
});

Deno.test("parseRankingResult rejects responses without rankings", () => {
  assertThrows(
    () => parseRankingResult("<think>只有推理，没有结果</think>"),
    Error,
    "未解析到有效的评分结果",
  );
});

Deno.test("ContentRanker falls back to local explainable ranking when LLM fails", async () => {
  let calls = 0;
  const llm: LLMProvider = {
    initialize: () => Promise.resolve(),
    refresh: () => Promise.resolve(),
    setModel: () => {},
    createChatCompletion: (_messages, options) => {
      calls++;
      assertEquals(options?.timeoutMs, 90_000);
      assertEquals(options?.maxAttempts, 1);
      return Promise.reject(new Error("llm unavailable"));
    },
  };
  const ranker = new ContentRanker(llm);

  const ranked = await ranker.rankContents([
    createContent({
      id: "official-new",
      title: "OpenAI 发布新的研究系统",
      url: "https://openai.com/news/research-system",
      publishDate: "2026-05-31T00:00:00.000Z",
      content: "这是一篇有足够信息量的官方文章。".repeat(80),
      metadata: { wordCount: 900 },
    }),
    createContent({
      id: "old-short",
      title: "News",
      url: "https://example.com/news",
      publishDate: "2025-01-01T00:00:00.000Z",
      content: "太短",
      metadata: { wordCount: 2 },
    }),
  ]);

  assertEquals(calls, 1);
  assertEquals(ranked.map((item) => item.id), ["official-new", "old-short"]);
  assert(ranked[0].score > ranked[1].score);
});

Deno.test("rankContentsLocally prefers recent rich primary sources", () => {
  const ranked = rankContentsLocally([
    createContent({
      id: "generic-old",
      title: "AI News",
      url: "https://example.com/ai-news",
      publishDate: "2025-05-01T00:00:00.000Z",
      content: "短新闻",
      metadata: { wordCount: 20 },
    }),
    createContent({
      id: "primary-rich",
      title: "Anthropic 发布面向开发者的新能力",
      url: "https://www.anthropic.com/news/developer-capability",
      publishDate: "2026-06-01T00:00:00.000Z",
      content: "官方长文内容".repeat(300),
      metadata: { wordCount: 1200 },
    }),
  ], new Date("2026-06-01T12:00:00.000Z"));

  assert(ranked[1].score > ranked[0].score);
});

Deno.test("rankContentsLocally penalizes list pages below article candidates", () => {
  const ranked = rankContentsLocally([
    createContent({
      id: "list",
      title: "OpenAI News",
      url: "https://openai.com/news/",
      publishDate: "2026-06-01T00:00:00.000Z",
      content:
        "![Image](https://example.com/1.png)\n[Article A](https://openai.com/index/a)\n![Image](https://example.com/2.png)\n[Article B](https://openai.com/index/b)\n![Image](https://example.com/3.png)\n[Article C](https://openai.com/index/c)\n[Article D](https://openai.com/index/d)",
      metadata: { score: 84, wordCount: 3000 },
    }),
    createContent({
      id: "candidate",
      title: "Strengthening societal resilience with Rosalind Biodefense",
      url:
        "https://openai.com/index/strengthening-societal-resilience-with-rosalind-biodefense",
      publishDate: "2026-05-29T00:00:00.000Z",
      content:
        "来源列表页出现文章链接：Strengthening societal resilience with Rosalind Biodefense。",
      metadata: {
        score: 54,
        wordCount: 180,
        requiresHydration: true,
        extractedFromListPage: true,
      },
    }),
  ], new Date("2026-06-01T12:00:00.000Z"));

  assert(ranked[1].score > ranked[0].score);
});

function createContent(
  overrides: Partial<ScrapedContent> & Pick<ScrapedContent, "id">,
): ScrapedContent {
  return {
    id: overrides.id,
    title: overrides.title ?? "测试文章",
    content: overrides.content ?? "正文",
    url: overrides.url ?? "https://example.com/article",
    publishDate: overrides.publishDate ?? "2026-06-01T00:00:00.000Z",
    metadata: overrides.metadata ?? {},
    media: overrides.media,
  };
}
