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

const BraveSearchResponseSchema = z.object({
  web: z.object({
    results: z.array(z.object({
      title: z.string().optional(),
      url: z.string().optional(),
      description: z.string().optional(),
      age: z.string().optional(),
      page_age: z.string().optional(),
      thumbnail: z.object({
        src: z.string().optional(),
      }).optional(),
      profile: z.object({
        name: z.string().optional(),
      }).optional(),
    })).optional(),
  }).optional(),
});

export class BraveSearchScraper implements ContentScraper {
  constructor(
    private readonly apiKey?: string,
    private readonly httpClient = HttpClient.getInstance(),
  ) {}

  async scrape(
    query: string,
    options?: ScraperOptions,
  ): Promise<ScrapedContent[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new Error("Brave Search 查询词不能为空");
    if (!this.apiKey) {
      throw new Error(
        "providers.fetch.brave.apiKey is not set. Brave Search API: https://brave.com/search/api/",
      );
    }

    const limit = normalizeLimit(options?.limit, 10, 20);
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", normalizedQuery);
    url.searchParams.set("count", String(limit));
    url.searchParams.set("safesearch", "moderate");

    const response = await this.httpClient.request<unknown>(url.toString(), {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "X-Subscription-Token": this.apiKey,
      },
      retries: 2,
      timeout: 30000,
    });
    const parsed = BraveSearchResponseSchema.safeParse(response);
    if (!parsed.success) {
      throw new Error(
        `Brave Search API returned invalid response: ${parsed.error.toString()}`,
      );
    }

    return (parsed.data.web?.results ?? [])
      .flatMap((item, index) =>
        toSearchScrapedContent({
          provider: "brave-search",
          query: normalizedQuery,
          rank: index + 1,
          title: item.title,
          url: item.url,
          content: item.description,
          publishedAt: item.page_age ?? item.age,
          imageUrl: item.thumbnail?.src,
          extraMetadata: {
            sourceName: item.profile?.name,
          },
        })
      )
      .slice(0, limit);
  }
}
