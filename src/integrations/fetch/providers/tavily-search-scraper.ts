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

const TavilySearchResponseSchema = z.object({
  results: z.array(z.object({
    title: z.string().optional(),
    url: z.string().optional(),
    content: z.string().optional(),
    raw_content: z.string().nullable().optional(),
    score: z.number().optional(),
    published_date: z.string().optional(),
  })).optional(),
  answer: z.string().nullable().optional(),
});

export class TavilySearchScraper implements ContentScraper {
  constructor(
    private readonly apiKey?: string,
    private readonly httpClient = HttpClient.getInstance(),
  ) {}

  async scrape(
    query: string,
    options?: ScraperOptions,
  ): Promise<ScrapedContent[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new Error("Tavily Search 查询词不能为空");
    if (!this.apiKey) {
      throw new Error(
        "providers.fetch.tavily.apiKey is not set. Tavily API: https://docs.tavily.com/",
      );
    }

    const limit = normalizeLimit(options?.limit, 8, 20);
    const response = await this.httpClient.request<unknown>(
      "https://api.tavily.com/search",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          query: normalizedQuery,
          search_depth: "advanced",
          max_results: limit,
          include_answer: false,
          include_raw_content: false,
        }),
        retries: 2,
        timeout: 45000,
      },
    );
    const parsed = TavilySearchResponseSchema.safeParse(response);
    if (!parsed.success) {
      throw new Error(
        `Tavily Search API returned invalid response: ${parsed.error.toString()}`,
      );
    }

    return (parsed.data.results ?? [])
      .flatMap((item, index) =>
        toSearchScrapedContent({
          provider: "tavily-search",
          query: normalizedQuery,
          rank: index + 1,
          title: item.title,
          url: item.url,
          content: item.raw_content ?? item.content,
          publishedAt: item.published_date,
          extraMetadata: {
            score: item.score,
          },
        })
      )
      .slice(0, limit);
  }
}
