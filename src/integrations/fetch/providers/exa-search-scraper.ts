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

const ExaSearchResponseSchema = z.object({
  results: z.array(z.object({
    title: z.string().nullable().optional(),
    url: z.string().optional(),
    text: z.string().nullable().optional(),
    summary: z.string().nullable().optional(),
    publishedDate: z.string().nullable().optional(),
    published_date: z.string().nullable().optional(),
    score: z.number().optional(),
    image: z.string().nullable().optional(),
  })).optional(),
});

export class ExaSearchScraper implements ContentScraper {
  constructor(
    private readonly apiKey?: string,
    private readonly httpClient = HttpClient.getInstance(),
  ) {}

  async scrape(
    query: string,
    options?: ScraperOptions,
  ): Promise<ScrapedContent[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new Error("Exa Search 查询词不能为空");
    if (!this.apiKey) {
      throw new Error(
        "providers.fetch.exa.apiKey is not set. Exa API: https://docs.exa.ai/",
      );
    }

    const limit = normalizeLimit(options?.limit, 8, 20);
    const response = await this.httpClient.request<unknown>(
      "https://api.exa.ai/search",
      {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          query: normalizedQuery,
          numResults: limit,
          type: "auto",
          contents: {
            text: {
              maxCharacters: 1200,
            },
          },
        }),
        retries: 2,
        timeout: 45000,
      },
    );
    const parsed = ExaSearchResponseSchema.safeParse(response);
    if (!parsed.success) {
      throw new Error(
        `Exa Search API returned invalid response: ${parsed.error.toString()}`,
      );
    }

    return (parsed.data.results ?? [])
      .flatMap((item, index) =>
        toSearchScrapedContent({
          provider: "exa-search",
          query: normalizedQuery,
          rank: index + 1,
          title: item.title ?? undefined,
          url: item.url,
          content: item.text ?? item.summary ?? undefined,
          publishedAt: item.publishedDate ?? item.published_date ?? undefined,
          imageUrl: item.image ?? undefined,
          extraMetadata: {
            score: item.score,
          },
        })
      )
      .slice(0, limit);
  }
}
