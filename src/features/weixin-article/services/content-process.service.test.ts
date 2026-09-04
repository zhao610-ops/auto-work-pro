import { assertEquals } from "@std/assert";
import type { RankResult } from "@src/core/ports/content-ranker.ts";
import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import type { ContentSummarizer } from "@src/core/ports/content-summarizer.ts";
import type { INotifier } from "@src/core/ports/notifier.ts";
import { WeixinArticleContentProcessService } from "@src/features/weixin-article/services/content-process.service.ts";
import type { EditorialDecision } from "@src/features/weixin-article/domain/editorial-decision.ts";
import type { EditorialTopicReport } from "@src/features/weixin-article/domain/editorial-topic.ts";
import type {
  ArticleContentFetcher,
} from "@src/features/weixin-article/services/content-scrape.service.ts";

Deno.test("processTopRanked prioritizes editorial decision articles before generic ranking", async () => {
  const service = new WeixinArticleContentProcessService(
    new EchoSummarizer(),
    new NoopNotifier(),
    2,
  );
  const contents = [
    createContent("google-1", "Google I/O 主线 1", "https://google.test/1"),
    createContent("google-2", "Google I/O 主线 2", "https://google.test/2"),
    createContent("hf-1", "HuggingFace 高分 1", "https://hf.test/1"),
    createContent("hf-2", "HuggingFace 高分 2", "https://hf.test/2"),
  ];
  const ranked: RankResult[] = [
    { id: "hf-1", score: 98 },
    { id: "hf-2", score: 90 },
    { id: "google-1", score: 45 },
    { id: "google-2", score: 44 },
  ];

  const result = await service.processTopRanked(
    ranked,
    contents,
    2,
    {
      topicReport: createTopicReport(),
      editorialDecision: createEditorialDecision(),
    },
  );

  assertEquals(result.map((item) => item.id), ["google-1", "google-2"]);
  assertEquals(result.map((item) => item.title), [
    "摘要 Google I/O 主线 1",
    "摘要 Google I/O 主线 2",
  ]);
});

Deno.test("processTopRanked hydrates selected content before summarizing", async () => {
  const service = new WeixinArticleContentProcessService(
    new EchoSummarizer(),
    new NoopNotifier(),
    1,
    new FakeHydratingFetcher("完整正文".repeat(120)),
  );
  const contents = [
    createContent("a1", "短摘要文章", "https://example.com/a1"),
  ];

  const result = await service.processTopRanked(
    [{ id: "a1", score: 90 }],
    contents,
    1,
  );

  assertEquals(result[0].metadata.hydrated, true);
  assertEquals(result[0].title, "摘要 深抓标题");
  assertEquals(
    String(result[0].content).startsWith("摘要内容 完整正文"),
    true,
  );
});

function createContent(id: string, title: string, url: string): ScrapedContent {
  return {
    id,
    title,
    content: `${title} 的原始内容`,
    url,
    publishDate: "2026-05-24T00:00:00.000Z",
    metadata: {},
  };
}

function createTopicReport(): EditorialTopicReport {
  return {
    generatedAt: "2026-05-24T00:00:00.000Z",
    fallback: false,
    clusters: [{
      id: "topic-google",
      title: "Google I/O",
      summary: "Gemini Agentic 主线",
      keywords: ["Gemini"],
      articleIds: ["google-1", "google-2"],
      primaryArticleId: "google-1",
      sourceCount: 2,
      freshness: 90,
      confidence: 90,
    }],
    scores: [{
      topicId: "topic-google",
      novelty: 80,
      relevance: 90,
      impact: 90,
      evidence: 80,
      actionability: 70,
      saturation: 10,
      risk: 20,
      finalScore: 88,
      reason: "主线最强",
      recommendedUse: "lead",
    }],
  };
}

function createEditorialDecision(): EditorialDecision {
  return {
    generatedAt: "2026-05-24T00:00:00.000Z",
    fallback: false,
    leadTopicId: "topic-google",
    leadTopicTitle: "Google I/O",
    decisionSummary: "围绕 Google I/O 写主线",
    whyThisNow: ["年度主线"],
    selectedTopics: [{
      topicId: "topic-google",
      role: "lead",
      reason: "本次主线",
    }],
    skippedTopics: [],
    duplicationRisk: {
      level: "low",
      reason: "无重复",
      avoidAngles: [],
    },
    sourceJudgements: [],
    recommendedFormat: "deep-analysis",
    writingDirectives: [],
    titleWarnings: [],
  };
}

class EchoSummarizer implements ContentSummarizer {
  summarize(content: string) {
    const parsed = JSON.parse(content) as ScrapedContent;
    return Promise.resolve({
      title: `摘要 ${parsed.title}`,
      content: `摘要内容 ${parsed.content}`,
      keywords: ["test"],
    });
  }

  generateTitle() {
    return Promise.resolve("标题");
  }
}

class NoopNotifier implements INotifier {
  refresh(): Promise<void> {
    return Promise.resolve();
  }

  notify(): Promise<boolean> {
    return Promise.resolve(true);
  }

  success(): Promise<boolean> {
    return Promise.resolve(true);
  }

  error(): Promise<boolean> {
    return Promise.resolve(true);
  }

  warning(): Promise<boolean> {
    return Promise.resolve(true);
  }

  info(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

class FakeHydratingFetcher implements ArticleContentFetcher {
  constructor(private readonly content: string) {}

  scrape() {
    return Promise.resolve({ contents: [], failures: [] });
  }

  hydrate(content: ScrapedContent) {
    return Promise.resolve({
      content: {
        ...content,
        title: "深抓标题",
        content: this.content,
        metadata: {
          ...content.metadata,
          hydrated: true,
        },
      },
      hydrated: true,
      provider: "jina",
      failures: [],
      originalContentLength: content.content.length,
      hydratedContentLength: this.content.length,
    });
  }
}
