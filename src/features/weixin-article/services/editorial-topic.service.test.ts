import { assertEquals } from "@std/assert";
import { ProviderError } from "@src/core/errors/provider-error.ts";
import type { LLMProvider } from "@src/core/ports/llm.ts";
import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import {
  normalizeTopicReport,
  WeixinArticleEditorialTopicService,
} from "@src/features/weixin-article/services/editorial-topic.service.ts";

const contents: ScrapedContent[] = [
  {
    id: "a1",
    title: "OpenAI 发布新模型",
    content: "OpenAI 发布新模型，面向开发者提供更低延迟。",
    url: "https://example.com/a1",
    publishDate: "2026-05-23",
    metadata: { keywords: ["OpenAI", "模型"] },
  },
  {
    id: "a2",
    title: "新模型 API 降价",
    content: "同一轮模型更新带来 API 成本下降。",
    url: "https://example.com/a2",
    publishDate: "2026-05-23",
    metadata: {},
  },
];

function createService(content: string): WeixinArticleEditorialTopicService {
  const llm: LLMProvider = {
    initialize: () => Promise.resolve(),
    refresh: () => Promise.resolve(),
    setModel: () => {},
    createChatCompletion: () =>
      Promise.resolve({
        choices: [{ message: { content } }],
      }),
  };
  return new WeixinArticleEditorialTopicService(llm);
}

Deno.test("editorial topic service returns normalized AI report", async () => {
  const service = createService(JSON.stringify({
    clusters: [{
      id: "topic-openai",
      title: "OpenAI 模型更新影响开发者成本",
      summary: "OpenAI 新模型和 API 降价构成同一主题。",
      keywords: ["OpenAI", "API"],
      articleIds: ["a1", "a2", "missing"],
      primaryArticleId: "a1",
      sourceCount: 2,
      freshness: 91,
      confidence: 88,
    }],
    scores: [{
      topicId: "topic-openai",
      novelty: 90,
      relevance: 92,
      impact: 86,
      evidence: 88,
      actionability: 80,
      saturation: 20,
      risk: 15,
      finalScore: 89,
      reason: "新模型和价格变化都影响开发者。",
      recommendedUse: "lead",
    }],
  }));

  const report = await service.createTopicReport(contents);

  assertEquals(report.fallback, false);
  assertEquals(report.clusters[0].articleIds, ["a1", "a2"]);
  assertEquals(report.scores[0].recommendedUse, "lead");
});

Deno.test("editorial topic service passes editorial memory to prompt", async () => {
  let userPrompt = "";
  const llm: LLMProvider = {
    initialize: () => Promise.resolve(),
    refresh: () => Promise.resolve(),
    setModel: () => {},
    createChatCompletion: (messages) => {
      userPrompt = String(messages[1]?.content ?? "");
      return Promise.resolve({
        choices: [{
          message: {
            content: JSON.stringify({
              clusters: [{
                id: "topic-1",
                title: "新主题",
                articleIds: ["a1"],
                primaryArticleId: "a1",
              }],
              scores: [],
            }),
          },
        }],
      });
    },
  };
  const service = new WeixinArticleEditorialTopicService(llm);

  await service.createTopicReport(contents, {
    recentArticles: [{
      runId: "run-1",
      title: "OpenAI 模型更新影响开发者成本",
      thesis: "模型价格下降",
      keywords: ["OpenAI"],
      topicTitles: ["模型更新"],
      sourceUrls: ["https://example.com/a1"],
      qualityScore: 86,
      publishStatus: "draft",
      dryRun: true,
      createdAt: "2026-05-22T00:00:00.000Z",
    }],
    sourcePerformance: [{
      url: "https://example.com/a1",
      group: "default",
      runs: 2,
      successes: 1,
      failures: 1,
      empty: 0,
      totalArticles: 3,
      lastStatus: "succeeded",
      updatedAt: "2026-05-23T00:00:00.000Z",
    }],
    recentFeedback: [{
      runId: "run-1",
      rating: "bad",
      note: "标题太泛，缺少具体读者收益",
      createdAt: "2026-05-22T00:00:00.000Z",
      updatedAt: "2026-05-22T00:00:00.000Z",
    }],
    recentTopicFeedback: [{
      runId: "run-1",
      topicId: "topic-1",
      action: "skip",
      title: "泛泛 AI 快讯",
      reason: "缺少具体读者收益",
      createdAt: "2026-05-22T00:00:00.000Z",
      updatedAt: "2026-05-22T00:00:00.000Z",
    }],
  });

  assertEquals(userPrompt.includes("近期编辑记忆"), true);
  assertEquals(userPrompt.includes("OpenAI 模型更新影响开发者成本"), true);
  assertEquals(userPrompt.includes("标题太泛"), true);
  assertEquals(userPrompt.includes("主题人工取舍"), true);
  assertEquals(userPrompt.includes("泛泛 AI 快讯"), true);
  assertEquals(userPrompt.includes("来源表现摘要"), true);
});

Deno.test("editorial topic service falls back when LLM output is invalid", async () => {
  const service = createService("not json");

  const report = await service.createTopicReport(contents);

  assertEquals(report.fallback, true);
  assertEquals(report.clusters.length, 2);
  assertEquals(report.scores.length, 2);
});

Deno.test("editorial topic fallback avoids list pages when linked article candidates exist", async () => {
  const llm: LLMProvider = {
    initialize: () => Promise.resolve(),
    refresh: () => Promise.resolve(),
    setModel: () => {},
    createChatCompletion: () =>
      Promise.reject(
        new ProviderError({
          provider: "openai-compatible",
          kind: "network",
          message: "network down",
        }),
      ),
  };
  const service = new WeixinArticleEditorialTopicService(llm);

  const report = await service.createTopicReport([
    {
      id: "list",
      title: "OpenAI News",
      content:
        "![Image](https://example.com/1.png)\n[Article A](https://openai.com/index/a)\n![Image](https://example.com/2.png)\n[Article B](https://openai.com/index/b)\n![Image](https://example.com/3.png)\n[Article C](https://openai.com/index/c)\n[Article D](https://openai.com/index/d)",
      url: "https://openai.com/news/",
      publishDate: "2026-06-01",
      metadata: {},
    },
    {
      id: "detail",
      title: "Strengthening societal resilience with Rosalind Biodefense",
      content:
        "来源列表页出现文章链接：Strengthening societal resilience with Rosalind Biodefense。",
      url:
        "https://openai.com/index/strengthening-societal-resilience-with-rosalind-biodefense",
      publishDate: "2026-05-29",
      metadata: {
        requiresHydration: true,
        extractedFromListPage: true,
      },
    },
  ]);

  assertEquals(report.fallback, true);
  assertEquals(report.clusters[0].primaryArticleId, "detail");
});

Deno.test("normalizeTopicReport adds default scores for unscored clusters", () => {
  const report = normalizeTopicReport(
    {
      clusters: [{
        id: "topic-1",
        title: "主题",
        articleIds: ["a1"],
        primaryArticleId: "a1",
      }],
      scores: [],
    },
    contents,
    false,
  );

  assertEquals(report.scores[0].topicId, "topic-1");
  assertEquals(report.scores[0].recommendedUse, "brief");
});

Deno.test("normalizeTopicReport downgrades unsupported high-risk claims", () => {
  const report = normalizeTopicReport(
    {
      clusters: [{
        id: "topic-coscientist",
        title: "Co-Scientist 开放付费 API",
        summary: "六 Agent 博弈机制首次产品化，定价和 waitlist 已开放。",
        keywords: ["Co-Scientist", "付费API"],
        articleIds: ["deepmind-index"],
        primaryArticleId: "deepmind-index",
        confidence: 90,
        freshness: 90,
      }],
      scores: [{
        topicId: "topic-coscientist",
        evidence: 92,
        risk: 10,
        finalScore: 94,
        recommendedUse: "lead",
        reason: "看起来很重要。",
      }],
    },
    [{
      id: "deepmind-index",
      title: "Google DeepMind News",
      content:
        "Co-Scientist: A multi-agent AI partner to accelerate research. Gemini 3.5 and Gemma 4 are also listed.",
      url: "https://deepmind.google/discover/blog/",
      publishDate: "2026-05-30",
      metadata: {},
    }],
    false,
  );

  assertEquals(report.scores[0].recommendedUse, "watch");
  assertEquals(report.scores[0].finalScore, 45);
  assertEquals(report.scores[0].evidence, 35);
});

Deno.test("normalizeTopicReport applies skip topic feedback as a hard downgrade", () => {
  const report = normalizeTopicReport(
    {
      clusters: [{
        id: "topic-openai-cost",
        title: "OpenAI 模型更新影响开发者成本",
        summary: "OpenAI 新模型和成本变化构成同一主题。",
        keywords: ["OpenAI", "开发者成本"],
        articleIds: ["a1", "a2"],
        primaryArticleId: "a1",
        confidence: 88,
        freshness: 90,
      }],
      scores: [{
        topicId: "topic-openai-cost",
        evidence: 86,
        risk: 12,
        saturation: 20,
        finalScore: 88,
        recommendedUse: "lead",
        reason: "具备主线价值。",
      }],
    },
    contents,
    false,
    undefined,
    {
      recentArticles: [],
      sourcePerformance: [],
      recentFeedback: [],
      recentTopicFeedback: [{
        runId: "run-old",
        topicId: "old-topic",
        action: "skip",
        title: "OpenAI 模型更新影响开发者成本",
        reason: "上次已经写过，角度重复",
        createdAt: "2026-05-22T00:00:00.000Z",
        updatedAt: "2026-05-22T00:00:00.000Z",
      }],
    },
  );

  assertEquals(report.scores[0].recommendedUse, "skip");
  assertEquals(report.scores[0].finalScore, 35);
  assertEquals(report.scores[0].saturation, 85);
  assertEquals(report.scores[0].reason.includes("人工反馈曾要求跳过"), true);
});

Deno.test("normalizeTopicReport promotes lead topic feedback when evidence is enough", () => {
  const report = normalizeTopicReport(
    {
      clusters: [{
        id: "topic-dev-cost",
        title: "OpenAI 开发者成本变化",
        summary: "模型延迟和成本变化会影响开发者选型。",
        keywords: ["OpenAI", "开发者成本"],
        articleIds: ["a1", "a2"],
        primaryArticleId: "a1",
        confidence: 80,
        freshness: 82,
      }],
      scores: [{
        topicId: "topic-dev-cost",
        evidence: 70,
        risk: 25,
        finalScore: 64,
        recommendedUse: "watch",
        reason: "值得观察。",
      }],
    },
    contents,
    false,
    undefined,
    {
      recentArticles: [],
      sourcePerformance: [],
      recentFeedback: [],
      recentTopicFeedback: [{
        runId: "run-old",
        topicId: "old-topic",
        action: "lead",
        title: "OpenAI 开发者成本变化",
        reason: "读者关注成本和迁移判断",
        createdAt: "2026-05-22T00:00:00.000Z",
        updatedAt: "2026-05-22T00:00:00.000Z",
      }],
    },
  );

  assertEquals(report.scores[0].recommendedUse, "lead");
  assertEquals(report.scores[0].finalScore, 82);
  assertEquals(report.scores[0].reason.includes("锁主线"), true);
});
