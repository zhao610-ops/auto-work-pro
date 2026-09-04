import {
  ContentScraper,
  ScrapedContent,
  ScraperOptions,
} from "@src/core/ports/content-scraper.ts";
import { HttpClient } from "@src/utils/http/http-client.ts";
import { z } from "npm:zod@3.25.76";
import {
  normalizeLimit,
  toSearchScrapedContent,
} from "./search-result-utils.ts";

const NewsApiResponseSchema = z.object({
  status: z.string().optional(),
  articles: z.array(z.object({
    source: z.object({
      name: z.string().nullable().optional(),
    }).nullable().optional(),
    author: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    urlToImage: z.string().nullable().optional(),
    publishedAt: z.string().nullable().optional(),
    content: z.string().nullable().optional(),
  })).optional(),
  message: z.string().optional(),
});

export class NewsApiScraper implements ContentScraper {
  constructor(
    private readonly apiKey?: string,
    private readonly httpClient = HttpClient.getInstance(),
  ) {}

  async scrape(
    query: string,
    options?: ScraperOptions,
  ): Promise<ScrapedContent[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new Error("NewsAPI 查询词不能为空");
    if (!this.apiKey) {
      throw new Error(
        "providers.fetch.newsapi.apiKey is not set. NewsAPI: https://newsapi.org/",
      );
    }

    const limit = normalizeLimit(options?.limit, 10, 100);
    const url = new URL("https://newsapi.org/v2/everything");
    url.searchParams.set("q", normalizedQuery);
    url.searchParams.set("pageSize", String(limit));
    url.searchParams.set("sortBy", "publishedAt");
    url.searchParams.set("language", "en");

    const response = await this.httpClient.request<unknown>(url.toString(), {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "X-Api-Key": this.apiKey,
      },
      retries: 2,
      timeout: 30000,
    });
    const parsed = NewsApiResponseSchema.safeParse(response);
    if (!parsed.success) {
      throw new Error(
        `NewsAPI returned invalid response: ${parsed.error.toString()}`,
      );
    }
    if (parsed.data.status && parsed.data.status !== "ok") {
      throw new Error(parsed.data.message ?? "NewsAPI request failed");
    }

    return (parsed.data.articles ?? [])
      .flatMap((item, index) =>
        toSearchScrapedContent({
          provider: "newsapi",
          query: normalizedQuery,
          rank: index + 1,
          title: item.title ?? undefined,
          url: item.url ?? undefined,
          content: [item.description, item.content].filter(Boolean).join("\n"),
          publishedAt: item.publishedAt ?? undefined,
          imageUrl: item.urlToImage ?? undefined,
          extraMetadata: {
            sourceName: item.source?.name,
            author: item.author,
          },
        })
      )
      .slice(0, limit);
  }
}
