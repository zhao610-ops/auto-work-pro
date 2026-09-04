import { assertEquals, assertRejects } from "@std/assert";
import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import type { ArticleSource } from "@src/features/weixin-article/domain/article-source.ts";
import type { EditorialDecision } from "@src/features/weixin-article/domain/editorial-decision.ts";
import type { EditorialTopicReport } from "@src/features/weixin-article/domain/editorial-topic.ts";
import type {
  ArticleContentFetcher,
  ArticleContentFetchResult,
  ArticleContentHydrationResult,
} from "@src/features/weixin-article/services/content-scrape.service.ts";
import { ArticleQualityResearchService } from "./research.service.ts";

Deno.test("ArticleQualityResearchService creates bounded evidence pack", async () => {
  const fetcher = new FakeFetcher();
  const service = new ArticleQualityResearchService(fetcher, {
    maxResearchQueries: 2,
    maxResultsPerQuery: 2,
    searchProviders: ["jina-search"],
  });

  const pack = await service.createEvidencePack({
    topicReport: topicReportFixture(),
    editorialDecision: decisionFixture(),
    contents: contentFixtures(),
  });

  assertEquals(pack.queries.length, 2);
  assertEquals(fetcher.queries.length, 2);
  assertEquals(pack.items.length, 2);
  assertEquals(pack.items[0].sourceType, "official");
  assertEquals(pack.items[0].confidence, "high");

  const evidenceContents = service.toEvidenceContents(pack);
  assertEquals(evidenceContents.length, 2);
  assertEquals(
    evidenceContents[0].metadata.source,
    "quality-experiment-evidence",
  );
});

Deno.test("ArticleQualityResearchService fails clearly when search returns nothing", async () => {
  const service = new ArticleQualityResearchService(new EmptyFetcher(), {
    maxResearchQueries: 1,
    maxResultsPerQuery: 1,
    searchProviders: ["gdelt", "hackernews", "arxiv"],
  });

  await assertRejects(
    () =>
      service.createEvidencePack({
        topicReport: topicReportFixture(),
        editorialDecision: decisionFixture(),
        contents: contentFixtures(),
      }),
    Error,
    "无法生成 EvidencePack",
  );
});

class FakeFetcher implements ArticleContentFetcher {
  readonly queries: string[] = [];

  scrape(source: ArticleSource): Promise<ArticleContentFetchResult> {
    this.queries.push(source.url);
    return Promise.resolve({
      provider: "jina-search",
      failures: [],
      contents: [1, 2, 3].map((index) => ({
        id: `${source.url}-${index}`,
        title: `${source.url} result ${index}`,
        content: `Search snippet ${index}`,
        url: index === 1
          ? `https://openai.com/news/${encodeURIComponent(source.url)}`
          : `https://example.com/${encodeURIComponent(source.url)}/${index}`,
        publishDate: "2026-05-24T00:00:00.000Z",
        metadata: {
          provider: "jina-search",
        },
      })),
    });
  }

  hydrate(content: ScrapedContent): Promise<ArticleContentHydrationResult> {
    return Promise.resolve({
      content: {
        ...content,
        content: `${content.content} with hydrated detail`.repeat(20),
      },
      hydrated: true,
      provider: "jina",
      failures: [],
      originalContentLength: content.content.length,
      hydratedContentLength: content.content.length + 100,
    });
  }
}

class EmptyFetcher implements ArticleContentFetcher {
  scrape(): Promise<ArticleContentFetchResult> {
    return Promise.resolve({
      failures: [],
      contents: [],
    });
  }
}

function topicReportFixture(): EditorialTopicReport {
  return {
    generatedAt: "2026-05-24T00:00:00.000Z",
    fallback: false,
    clusters: [{
      id: "topic-1",
      title: "OpenAI 发布新模型",
      summary: "新模型能力更新。",
      keywords: ["OpenAI", "model", "reasoning"],
      articleIds: ["a1"],
      primaryArticleId: "a1",
      sourceCount: 1,
      freshness: 90,
      confidence: 80,
    }],
    scores: [{
      topicId: "topic-1",
      novelty: 80,
      relevance: 80,
      impact: 80,
      evidence: 70,
      actionability: 60,
      saturation: 20,
      risk: 20,
      finalScore: 80,
      reason: "值得关注",
      recommendedUse: "lead",
    }],
  };
}

function decisionFixture(): EditorialDecision {
  return {
    generatedAt: "2026-05-24T00:00:00.000Z",
    fallback: false,
    leadTopicId: "topic-1",
    leadTopicTitle: "OpenAI 发布新模型",
    decisionSummary: "围绕新模型能力变化成文。",
    whyThisNow: ["发布窗口明确"],
    selectedTopics: [{
      topicId: "topic-1",
      role: "lead",
      reason: "信息密度高",
    }],
    skippedTopics: [],
    duplicationRisk: {
      level: "low",
      reason: "暂无重复",
      avoidAngles: [],
    },
    sourceJudgements: [],
    recommendedFormat: "trend-analysis",
    writingDirectives: [],
    titleWarnings: [],
  };
}

function contentFixtures(): ScrapedContent[] {
  return [{
    id: "a1",
    title: "OpenAI 发布新模型",
    content: "OpenAI 发布新模型，能力更新。",
    url: "https://example.com/openai-model",
    publishDate: "2026-05-24T00:00:00.000Z",
    metadata: {},
  }];
}
