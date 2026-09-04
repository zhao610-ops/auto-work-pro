import { assertEquals } from "@std/assert";
import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import type { ArticleSource } from "@src/features/weixin-article/domain/article-source.ts";
import type { EditorialDecision } from "@src/features/weixin-article/domain/editorial-decision.ts";
import type { EditorialTopicReport } from "@src/features/weixin-article/domain/editorial-topic.ts";
import type {
  ArticleContentFetcher,
  ArticleContentFetchResult,
  ArticleContentHydrationResult,
} from "@src/features/weixin-article/services/content-scrape.service.ts";
import { WeixinArticleResearchService } from "./article-research.service.ts";

Deno.test("article research returns skipped pack when disabled", async () => {
  const service = new WeixinArticleResearchService(new EmptyFetcher(), {
    enabled: false,
    maxResearchQueries: 3,
    maxResultsPerQuery: 3,
    searchProviders: ["jina-search"],
  });

  const pack = await service.createEvidencePack({
    topicReport: topicReportFixture(),
    editorialDecision: decisionFixture(),
    contents: contentFixtures(),
  });

  assertEquals(pack.items.length, 0);
  assertEquals(pack.skippedReason, "未配置搜索能力，跳过补充证据");
});

Deno.test("article research filters noisy background evidence", async () => {
  const service = new WeixinArticleResearchService(new FakeFetcher(), {
    enabled: true,
    maxResearchQueries: 2,
    maxResultsPerQuery: 3,
    searchProviders: ["brave-search", "jina-search"],
  });

  const pack = await service.createEvidencePack({
    topicReport: topicReportFixture(),
    editorialDecision: decisionFixture(),
    contents: contentFixtures(),
  });

  assertEquals(pack.queries.length, 2);
  assertEquals(pack.items.length, 2);
  assertEquals(pack.items[0].sourceType, "official");
  assertEquals(pack.items[1].sourceType, "primary");
});

Deno.test("article research skips noisy candidates before hydration", async () => {
  const fetcher = new NoisyCandidateFetcher();
  const service = new WeixinArticleResearchService(fetcher, {
    enabled: true,
    maxResearchQueries: 1,
    maxResultsPerQuery: 4,
    searchProviders: ["jina-search"],
  });

  const pack = await service.createEvidencePack({
    topicReport: topicReportFixture(),
    editorialDecision: decisionFixture(),
    contents: contentFixtures(),
  });

  assertEquals(fetcher.hydratedUrls, ["https://blog.google/technology/ai/"]);
  assertEquals(pack.items.map((item) => item.url), [
    "https://blog.google/technology/ai/",
  ]);
});

Deno.test("article research rejects superficially official but unrelated evidence", async () => {
  const service = new WeixinArticleResearchService(
    new UnrelatedGithubFetcher(),
    {
      enabled: true,
      maxResearchQueries: 1,
      maxResultsPerQuery: 3,
      searchProviders: ["jina-search"],
    },
  );

  const pack = await service.createEvidencePack({
    topicReport: topicReportFixture(),
    editorialDecision: decisionFixture(),
    contents: contentFixtures(),
  });

  assertEquals(pack.items.map((item) => item.url), [
    "https://blog.google/technology/ai/gemini/",
  ]);
});

Deno.test("article research caps hydration attempts across queries", async () => {
  const fetcher = new ManyOfficialFetcher();
  const service = new WeixinArticleResearchService(fetcher, {
    enabled: true,
    maxResearchQueries: 3,
    maxResultsPerQuery: 3,
    maxHydrationCandidates: 1,
    searchProviders: ["jina-search"],
  });

  const pack = await service.createEvidencePack({
    topicReport: topicReportFixture(),
    editorialDecision: decisionFixture(),
    contents: contentFixtures(),
  });

  assertEquals(fetcher.hydratedUrls.length, 1);
  assertEquals(pack.items.length, 3);
});

class FakeFetcher implements ArticleContentFetcher {
  scrape(_source: ArticleSource): Promise<ArticleContentFetchResult> {
    return Promise.resolve({
      provider: "jina-search",
      failures: [],
      contents: [
        content("official", "https://blog.google/technology/ai/gemini/"),
        content("paper", "https://arxiv.org/abs/2605.00001"),
        {
          ...content("noise", "https://example.com/noise"),
          content: "short",
        },
      ],
    });
  }

  hydrate(content: ScrapedContent): Promise<ArticleContentHydrationResult> {
    return Promise.resolve({
      content: {
        ...content,
        content: `${content.content} hydrated detail `.repeat(20),
      },
      hydrated: true,
      provider: "jina",
      failures: [],
      originalContentLength: content.content.length,
      hydratedContentLength: content.content.length + 100,
    });
  }
}

class NoisyCandidateFetcher implements ArticleContentFetcher {
  hydratedUrls: string[] = [];

  scrape(_source: ArticleSource): Promise<ArticleContentFetchResult> {
    return Promise.resolve({
      provider: "jina-search",
      failures: [],
      contents: [
        content("official", "https://blog.google/technology/ai/"),
        content("zhihu", "https://zhuanlan.zhihu.com/p/2040317759591027222"),
        content("sina", "https://finance.sina.com.cn/stock/t/example.shtml"),
        content("youtube", "https://www.youtube.com/watch?v=abc"),
      ],
    });
  }

  hydrate(content: ScrapedContent): Promise<ArticleContentHydrationResult> {
    this.hydratedUrls.push(content.url);
    return Promise.resolve({
      content: {
        ...content,
        content: `${content.content} hydrated detail `.repeat(20),
      },
      hydrated: true,
      provider: "jina",
      failures: [],
      originalContentLength: content.content.length,
      hydratedContentLength: content.content.length + 100,
    });
  }
}

class ManyOfficialFetcher implements ArticleContentFetcher {
  hydratedUrls: string[] = [];

  scrape(_source: ArticleSource): Promise<ArticleContentFetchResult> {
    return Promise.resolve({
      provider: "jina-search",
      failures: [],
      contents: [
        content("official-a", "https://blog.google/technology/ai/a"),
        content("official-b", "https://blog.google/technology/ai/b"),
        content("official-c", "https://blog.google/technology/ai/c"),
      ],
    });
  }

  hydrate(content: ScrapedContent): Promise<ArticleContentHydrationResult> {
    this.hydratedUrls.push(content.url);
    return Promise.resolve({
      content: {
        ...content,
        content: `${content.content} hydrated detail `.repeat(20),
      },
      hydrated: true,
      provider: "jina",
      failures: [],
      originalContentLength: content.content.length,
      hydratedContentLength: content.content.length + 100,
    });
  }
}

class UnrelatedGithubFetcher implements ArticleContentFetcher {
  scrape(_source: ArticleSource): Promise<ArticleContentFetchResult> {
    return Promise.resolve({
      provider: "jina-search",
      failures: [],
      contents: [
        {
          ...content(
            "Antigravity account switcher",
            "https://github.com/lbjlaq/Antigravity-Manager",
          ),
          content:
            "Professional Antigravity account manager and protocol proxy for developer tools. It focuses on local account switching and routing.",
        },
        content(
          "Gemini agentic update official announcement",
          "https://blog.google/technology/ai/gemini/",
        ),
      ],
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

function content(id: string, url: string): ScrapedContent {
  return {
    id,
    title: id,
    content:
      "This is a sufficiently long Gemini source summary that should be retained by the evidence filter. It includes enough context about the Google announcement, product change, and source relevance.",
    url,
    publishDate: "2026-05-24T00:00:00.000Z",
    metadata: { provider: "jina-search" },
  };
}

function topicReportFixture(): EditorialTopicReport {
  return {
    generatedAt: "2026-05-24T00:00:00.000Z",
    fallback: false,
    clusters: [{
      id: "topic-1",
      title: "Gemini agentic update",
      summary: "Gemini product updates.",
      keywords: ["Gemini", "agent", "Google"],
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
    leadTopicTitle: "Gemini agentic update",
    decisionSummary: "围绕 Gemini agentic 更新成文。",
    whyThisNow: ["Google I/O 发布"],
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
    recommendedFormat: "product-review",
    writingDirectives: [],
    titleWarnings: [],
  };
}

function contentFixtures(): ScrapedContent[] {
  return [{
    id: "a1",
    title: "Gemini agentic update",
    content: "Gemini app updates.",
    url: "https://blog.google/technology/ai/gemini/",
    publishDate: "2026-05-24T00:00:00.000Z",
    metadata: {},
  }];
}
