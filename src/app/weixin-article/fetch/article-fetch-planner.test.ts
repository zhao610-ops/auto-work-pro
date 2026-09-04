import { assertEquals, assertRejects } from "@std/assert";
import { ResolvedTrendPublishConfig } from "@src/utils/config/define-config.ts";
import {
  inferProvider,
  planArticleSources,
  resolveSourceProviders,
} from "./article-fetch-planner.ts";

Deno.test("inferProvider routes common URLs", () => {
  assertEquals(inferProvider("https://x.com/OpenAIDevs"), "twitter");
  assertEquals(inferProvider("https://twitter.com/OpenAIDevs"), "twitter");
  assertEquals(
    inferProvider("https://rsshub.app/github/trending/daily"),
    "rss",
  );
  assertEquals(inferProvider("https://example.com/feed.xml"), "rss");
  assertEquals(inferProvider("https://news.ycombinator.com/"), "firecrawl");
  assertEquals(inferProvider("AI agent news", "query"), "jina-search");
});

Deno.test("resolveSourceProviders expands auto and keeps fallback order", () => {
  assertEquals(
    resolveSourceProviders("https://example.com/", ["firecrawl", "jina"]),
    ["firecrawl", "jina"],
  );
  assertEquals(resolveSourceProviders("https://x.com/OpenAIDevs", ["auto"]), [
    "twitter",
  ]);
  assertEquals(resolveSourceProviders("AI agent news", ["auto"], "query"), [
    "jina-search",
  ]);
});

Deno.test("planArticleSources resolves configured group providers", () => {
  assertEquals(
    planArticleSources({
      ...configFixture(),
      features: {
        article: {
          ...configFixture().features.article,
          sources: [
            "https://news.ycombinator.com/",
            "web:https://example.com/",
            "search:AI agent news",
          ],
        },
      },
    }).map(({ group, providers, url, kind }) => ({
      group,
      providers,
      url,
      kind,
    })),
    [
      {
        group: "default",
        providers: ["firecrawl"],
        url: "https://news.ycombinator.com/",
        kind: "url",
      },
      {
        group: "web",
        providers: ["firecrawl", "jina"],
        url: "https://example.com/",
        kind: "url",
      },
      {
        group: "search",
        providers: ["jina-search"],
        url: "AI agent news",
        kind: "query",
      },
    ],
  );
});

Deno.test("planArticleSources supports multiple search providers", () => {
  assertEquals(
    planArticleSources({
      ...configFixture(),
      fetchGroups: {
        ...configFixture().fetchGroups,
        research: ["brave-search", "gdelt", "hackernews", "arxiv"],
      },
      features: {
        article: {
          ...configFixture().features.article,
          sources: ["research:query:AI agent frameworks"],
        },
      },
    }).map(({ providers, kind }) => ({ providers, kind })),
    [{
      providers: ["brave-search", "gdelt", "hackernews", "arxiv"],
      kind: "query",
    }],
  );
});

Deno.test("planArticleSources rejects query sources routed to URL providers", () => {
  assertRejectsLike(() =>
    planArticleSources({
      ...configFixture(),
      fetchGroups: {
        ...configFixture().fetchGroups,
        search: ["firecrawl"],
      },
      features: {
        article: {
          ...configFixture().features.article,
          sources: ["search:AI agent news"],
        },
      },
    })
  );
});

Deno.test("planArticleSources rejects URL sources routed to search providers", () => {
  assertRejectsLike(() =>
    planArticleSources({
      ...configFixture(),
      fetchGroups: {
        ...configFixture().fetchGroups,
        webSearch: ["brave-search"],
      },
      features: {
        article: {
          ...configFixture().features.article,
          sources: ["webSearch:https://example.com"],
        },
      },
    })
  );
});

Deno.test("planArticleSources validates unknown group", () => {
  assertRejectsLike(() =>
    planArticleSources({
      ...configFixture(),
      features: {
        article: {
          ...configFixture().features.article,
          sources: ["web:https://example.com"],
        },
      },
      fetchGroups: { default: ["auto"] },
    })
  );
});

Deno.test("planArticleSources validates provider config", () => {
  assertRejectsLike(() =>
    planArticleSources({
      ...configFixture(),
      providers: {
        ...configFixture().providers,
        fetch: {
          ...configFixture().providers.fetch,
          twitter: { bearerToken: "", xquikApiKey: "" },
        },
      },
      features: {
        article: {
          ...configFixture().features.article,
          sources: ["https://x.com/OpenAIDevs"],
        },
      },
    })
  );
});

Deno.test("planArticleSources validates default fetch group", () => {
  assertRejectsLike(() =>
    planArticleSources({
      ...configFixture(),
      fetchGroups: { web: ["firecrawl"] },
      features: {
        article: {
          ...configFixture().features.article,
          sources: ["web:https://example.com"],
        },
      },
    })
  );
});

function assertRejectsLike(fn: () => unknown): Promise<unknown> {
  return assertRejects(
    async () => {
      fn();
    },
    Error,
  );
}

function configFixture(): Pick<
  ResolvedTrendPublishConfig,
  "features" | "fetchGroups" | "providers"
> {
  return {
    providers: {
      ai: { baseUrl: "", apiKey: "", model: "" },
      fetch: {
        firecrawl: { apiKey: "firecrawl-key" },
        jina: { apiKey: "jina-key" },
        brave: { apiKey: "brave-key" },
        tavily: { apiKey: "tavily-key" },
        exa: { apiKey: "exa-key" },
        serper: { apiKey: "serper-key" },
        newsapi: { apiKey: "newsapi-key" },
        twitter: { bearerToken: "", xquikApiKey: "xquik-key" },
        rss: { baseUrl: "" },
      },
      image: {
        dashscope: { apiKey: "" },
        minimax: { apiKey: "", apiHost: "https://api.minimax.io" },
      },
      publish: {
        weixin: {
          appId: "",
          appSecret: "",
          author: "AI Trend Publish",
          needOpenComment: true,
          onlyFansCanComment: false,
        },
        weixinRelay: { url: "", token: "" },
      },
      notify: {
        bark: { url: "" },
        dingtalk: { webhook: "" },
        feishu: { webhookUrl: "" },
      },
      vector: {
        embedding: { baseUrl: "", apiKey: "", model: "" },
      },
    },
    fetchGroups: {
      default: ["auto"],
      web: ["firecrawl", "jina"],
      search: ["jina-search"],
    },
    features: {
      article: {
        sources: ["https://news.ycombinator.com/"],
        renderer: {
          template: "minimal",
          promptProfile: "technology",
        },
        publisher: {
          provider: "weixin",
        },
        count: 10,
        dryRun: true,
        notifications: {
          channels: [],
        },
        cover: {
          enabled: true,
          provider: "dashscope",
          model: "wanx-poster-generation-v1",
        },
        bodyImages: {
          mode: "off",
          provider: "dashscope",
          model: "qwen-image-2.0",
          count: 1,
          size: "1024*1024",
        },
        deduplication: {
          enabled: false,
          embeddingProvider: "dashscope",
          vectorStore: "sqlite",
        },
        sourceLimits: {
          maxAgeDays: 14,
          maxItemsPerSource: 20,
        },
        qualityGate: {
          enabled: true,
          minScore: 80,
          blockOnHighFactIssue: true,
          forcePublish: false,
          allowForcePublish: true,
          maxRevisionRounds: 1,
        },
      },
    },
  };
}
