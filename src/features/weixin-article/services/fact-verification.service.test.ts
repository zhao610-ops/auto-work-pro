import { assertEquals } from "@std/assert";
import type { LLMProvider } from "@src/core/ports/llm.ts";
import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import type { ArticleSource } from "@src/features/weixin-article/domain/article-source.ts";
import type { QualityIssue } from "@src/features/weixin-article/domain/quality-review.ts";
import type {
  ArticleContentFetcher,
  ArticleContentFetchResult,
} from "@src/features/weixin-article/services/content-scrape.service.ts";
import { WeixinArticleFactVerificationService } from "./fact-verification.service.ts";

Deno.test("fact verification accepts a supported claim with a real trusted source", async () => {
  const fetcher = new FakeFetcher([
    content("Reuters report", "https://www.reuters.com/technology/report"),
  ]);
  const service = new WeixinArticleFactVerificationService(
    fetcher,
    createLlm({
      verdict: "supported",
      confidence: 0.93,
      reason: "source-1 明确支持完整事实主张",
      supportingSourceIds: ["source-1"],
    }),
    ["jina-search"],
  );

  const report = await service.verify({
    title: "高管变动",
    html: "<section>正文内容</section>",
    issues: [factIssue()],
  });

  assertEquals(report.allSupported, true);
  assertEquals(report.items[0].verdict, "supported");
  assertEquals(report.items[0].sources[0].url.includes("reuters.com"), true);
  assertEquals(report.evidenceItems.length, 1);
  assertEquals(fetcher.queries.length, 1);
});

Deno.test("fact verification rejects source ids invented by the model", async () => {
  const service = new WeixinArticleFactVerificationService(
    new FakeFetcher([
      content("Reuters report", "https://www.reuters.com/technology/report"),
    ]),
    createLlm({
      verdict: "supported",
      confidence: 0.99,
      reason: "声称存在证据",
      supportingSourceIds: ["source-999"],
    }),
    ["jina-search"],
  );

  const report = await service.verify({
    title: "高管变动",
    html: "<section>正文内容</section>",
    issues: [factIssue()],
  });

  assertEquals(report.allSupported, false);
  assertEquals(report.items[0].verdict, "insufficient");
  assertEquals(report.evidenceItems.length, 0);
});

Deno.test("fact verification keeps cited sources for contradicted claims", async () => {
  const service = new WeixinArticleFactVerificationService(
    new FakeFetcher([
      content("Reuters report", "https://www.reuters.com/technology/report"),
    ]),
    createLlm({
      verdict: "contradicted",
      confidence: 0.95,
      reason: "source-1 明确反驳该事实主张",
      supportingSourceIds: ["source-1"],
    }),
    ["jina-search"],
  );

  const report = await service.verify({
    title: "高管变动",
    html: "<section>正文内容</section>",
    issues: [factIssue()],
  });

  assertEquals(report.allSupported, false);
  assertEquals(report.items[0].verdict, "contradicted");
  assertEquals(report.items[0].sources.length, 1);
  assertEquals(report.evidenceItems.length, 0);
});

Deno.test("fact verification ignores non-high-risk issues", async () => {
  const fetcher = new FakeFetcher([]);
  const service = new WeixinArticleFactVerificationService(
    fetcher,
    createLlm({}),
    ["jina-search"],
  );

  const report = await service.verify({
    title: "普通标题",
    html: "<section>正文内容</section>",
    issues: [{ ...factIssue(), severity: "medium" }],
  });

  assertEquals(report.attempted, false);
  assertEquals(fetcher.queries.length, 0);
});

class FakeFetcher implements ArticleContentFetcher {
  queries: string[] = [];

  constructor(private readonly contents: ScrapedContent[]) {}

  scrape(source: ArticleSource): Promise<ArticleContentFetchResult> {
    this.queries.push(source.url);
    return Promise.resolve({
      provider: "jina-search",
      failures: [],
      contents: this.contents,
    });
  }
}

function createLlm(output: Record<string, unknown>): LLMProvider {
  return {
    initialize: () => Promise.resolve(),
    refresh: () => Promise.resolve(),
    setModel: () => {},
    createChatCompletion: () =>
      Promise.resolve({
        choices: [{ message: { content: JSON.stringify(output) } }],
      }),
  };
}

function content(title: string, url: string): ScrapedContent {
  return {
    id: title,
    title,
    url,
    content: "报道明确说明了相关人物、行为和因果关系。".repeat(40),
    publishDate: "2026-09-07T00:00:00.000Z",
    metadata: { provider: "jina-search" },
  };
}

function factIssue(): QualityIssue {
  return {
    id: "issue-fact-1",
    category: "fact",
    severity: "high",
    message: "文章称某项战略直接导致高管离职，但原始来源没有相关表述。",
    evidence: "正文第二段",
    suggestion: "补充可靠来源或删除该表述。",
    autoFixable: false,
  };
}
