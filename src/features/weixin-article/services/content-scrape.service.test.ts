import { assertEquals, assertRejects } from "@std/assert";
import {
  ArticleContentFetcher,
  WeixinArticleContentScrapeService,
} from "@src/features/weixin-article/services/content-scrape.service.ts";
import { INotifier } from "@src/core/ports/notifier.ts";

Deno.test("content scrape service uses injected fetcher and continues after source failure", async () => {
  const warnings: string[] = [];
  const fetcher: ArticleContentFetcher = {
    scrape: (source) =>
      Promise.resolve(
        source.url.includes("ok")
          ? {
            contents: [{
              id: "ok-1",
              title: "ok",
              content: "content",
              url: source.url,
              publishDate: daysAgo(1),
              metadata: {},
            }],
            provider: "mock",
            failures: [],
          }
          : {
            contents: [],
            failures: [{ provider: "mock", message: "boom" }],
          },
      ),
  };
  const stats = { success: 0, failed: 0, contents: 0, duplicates: 0 };
  const service = new WeixinArticleContentScrapeService(
    [
      {
        raw: "https://example.com/fail",
        group: "default",
        url: "https://example.com/fail",
        kind: "url",
        providers: ["mock"],
      },
      {
        raw: "https://example.com/ok",
        group: "default",
        url: "https://example.com/ok",
        kind: "url",
        providers: ["mock"],
      },
    ],
    notifier(warnings),
    stats,
    fetcher,
  );

  const sources = await service.loadSources();
  const result = await service.scrapeAllDetailed(sources);
  const contents = result.contents;

  assertEquals(contents.map((content) => content.id), ["ok-1"]);
  assertEquals(result.health.totalSources, 2);
  assertEquals(result.health.succeeded, 1);
  assertEquals(result.health.failed, 1);
  assertEquals(result.health.totalArticles, 1);
  assertEquals(result.health.records.map((record) => record.status), [
    "failed",
    "succeeded",
  ]);
  assertEquals(stats, { success: 1, failed: 1, contents: 1, duplicates: 0 });
  assertEquals(warnings.length, 1);
});

Deno.test("content scrape service can return health report when every source fails", async () => {
  const fetcher: ArticleContentFetcher = {
    scrape: () =>
      Promise.resolve({
        contents: [],
        failures: [{ provider: "mock", message: "unavailable" }],
      }),
  };
  const stats = { success: 0, failed: 0, contents: 0, duplicates: 0 };
  const service = new WeixinArticleContentScrapeService(
    [{
      raw: "https://example.com/fail",
      group: "default",
      url: "https://example.com/fail",
      kind: "url",
      providers: ["mock"],
    }],
    notifier([]),
    stats,
    fetcher,
  );

  const sources = await service.loadSources();
  const result = await service.scrapeAllDetailed(sources);

  assertEquals(result.contents.length, 0);
  assertEquals(result.health.failed, 1);
  assertEquals(result.health.records[0].failures[0].message, "unavailable");
  await assertRejects(() => service.scrapeAll(sources));
});

Deno.test("content scrape service filters old items and truncates every source", async () => {
  const fetcher: ArticleContentFetcher = {
    scrape: () =>
      Promise.resolve({
        contents: [
          content("old", daysAgo(30)),
          content("newer", daysAgo(2)),
          content("newest", daysAgo(1)),
          content("unknown", "not-a-date"),
        ],
        provider: "mock",
        failures: [],
      }),
  };
  const stats = { success: 0, failed: 0, contents: 0, duplicates: 0 };
  const service = new WeixinArticleContentScrapeService(
    [{
      raw: "https://example.com/feed",
      group: "default",
      url: "https://example.com/feed",
      kind: "url",
      providers: ["mock"],
    }],
    notifier([]),
    stats,
    fetcher,
    { maxAgeDays: 14, maxItemsPerSource: 2 },
  );

  const sources = await service.loadSources();
  const result = await service.scrapeAllDetailed(sources);

  assertEquals(result.contents.map((item) => item.id), ["newest", "newer"]);
  assertEquals(result.health.records[0].originalArticleCount, 4);
  assertEquals(result.health.records[0].articleCount, 2);
  assertEquals(result.health.records[0].filteredOldCount, 1);
  assertEquals(result.health.records[0].truncatedCount, 1);
  assertEquals(result.health.totalArticles, 2);
});

Deno.test("content scrape service expands article links from list pages", async () => {
  const fetcher: ArticleContentFetcher = {
    scrape: () =>
      Promise.resolve({
        contents: [{
          id: "openai-news",
          title: "OpenAI News",
          content: [
            `[A shared playbook for trustworthy third party evaluations Safety ${
              englishDateDaysAgo(3)
            }](https://openai.com/index/trustworthy-third-party-evaluations-foundations/)`,
            `[OpenAI’s Frontier Governance Framework Safety ${
              englishDateDaysAgo(4)
            }](https://openai.com/index/openai-frontier-governance-framework/)`,
            `[Building self-improving tax agents with Codex Engineering ${
              englishDateDaysAgo(5)
            }](https://openai.com/index/building-self-improving-tax-agents-with-codex/)`,
            "![Image 1](https://openai.com/static/card.png)",
            "[Privacy](https://openai.com/privacy/)",
          ].join("\n\n"),
          url: "https://openai.com/news/",
          publishDate: daysAgo(1),
          metadata: {},
        }],
        provider: "mock",
        failures: [],
      }),
  };
  const stats = { success: 0, failed: 0, contents: 0, duplicates: 0 };
  const service = new WeixinArticleContentScrapeService(
    [{
      raw: "https://openai.com/news/",
      group: "default",
      url: "https://openai.com/news/",
      kind: "url",
      providers: ["mock"],
    }],
    notifier([]),
    stats,
    fetcher,
    { maxAgeDays: 30, maxItemsPerSource: 10 },
  );

  const sources = await service.loadSources();
  const result = await service.scrapeAllDetailed(sources);

  assertEquals(result.contents.map((item) => item.id), [
    "openai-news",
    "https://openai.com/index/trustworthy-third-party-evaluations-foundations",
    "https://openai.com/index/openai-frontier-governance-framework",
    "https://openai.com/index/building-self-improving-tax-agents-with-codex",
  ]);
  assertEquals(
    result.contents[1].metadata.source,
    "linked-article-candidate",
  );
  assertEquals(result.contents[1].metadata.requiresHydration, true);
  assertEquals(result.health.records[0].articleCount, 4);
});

function content(id: string, publishDate: string) {
  return {
    id,
    title: id,
    content: "content",
    url: `https://example.com/${id}`,
    publishDate,
    metadata: {},
  };
}

function daysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

function englishDateDaysAgo(days: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(daysAgo(days)));
}

function notifier(warnings: string[]): INotifier {
  return {
    refresh: () => Promise.resolve(),
    info: () => Promise.resolve(true),
    success: () => Promise.resolve(true),
    warning: (_title, message) => {
      warnings.push(message);
      return Promise.resolve(true);
    },
    error: () => Promise.resolve(true),
    notify: () => Promise.resolve(true),
  };
}
