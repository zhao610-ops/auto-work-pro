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

const SerperSearchResponseSchema = z.object({
  organic: z.array(z.object({
    title: z.string().optional(),
    link: z.string().optional(),
    snippet: z.string().optional(),
    date: z.string().optional(),
    position: z.number().optional(),
  })).optional(),
  news: z.array(z.object({
    title: z.string().optional(),
    link: z.string().optional(),
    snippet: z.string().optional(),
    date: z.string().optional(),
    imageUrl: z.string().optional(),
    source: z.string().optional(),
  })).optional(),
});

export class SerperSearchScraper implements ContentScraper {
  constructor(
    private readonly apiKey?: string,
    private readonly httpClient = HttpClient.getInstance(),
  ) {}

  async scrape(
    query: string,
    options?: ScraperOptions,
  ): Promise<ScrapedContent[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new Error("Serper Search 查询词不能为空");
    if (!this.apiKey) {
      throw new Error(
        "providers.fetch.serper.apiKey is not set. Serper API: https://serper.dev/",
      );
    }

    const limit = normalizeLimit(options?.limit, 10, 20);
    const response = await this.httpClient.request<unknown>(
      "https://google.serper.dev/search",
      {
        method: "POST",
        headers: {
          "X-API-KEY": this.apiKey,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          q: normalizedQuery,
          num: limit,
        }),
        retries: 2,
        timeout: 30000,
      },
    );
    const parsed = SerperSearchResponseSchema.safeParse(response);
    if (!parsed.success) {
      throw new Error(
        `Serper Search API returned invalid response: ${parsed.error.toString()}`,
      );
    }

    const organic = (parsed.data.organic ?? []).map((item, index) =>
      toSearchScrapedContent({
        provider: "serper-search",
        query: normalizedQuery,
        rank: item.position ?? index + 1,
        title: item.title,
        url: item.link,
        content: item.snippet,
        publishedAt: item.date,
      })
    );
    const news = (parsed.data.news ?? []).map((item, index) =>
      toSearchScrapedContent({
        provider: "serper-search",
        query: normalizedQuery,
        rank: organic.length + index + 1,
        title: item.title,
        url: item.link,
        content: item.snippet,
        publishedAt: item.date,
        imageUrl: item.imageUrl,
        extraMetadata: {
          sourceName: item.source,
          resultType: "news",
        },
      })
    );

    return [...organic, ...news].flat().slice(0, limit);
  }
}
