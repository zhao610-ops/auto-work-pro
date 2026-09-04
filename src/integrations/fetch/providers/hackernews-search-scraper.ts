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

const HackerNewsResponseSchema = z.object({
  hits: z.array(z.object({
    title: z.string().nullable().optional(),
    story_title: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    story_url: z.string().nullable().optional(),
    objectID: z.string().optional(),
    points: z.number().nullable().optional(),
    num_comments: z.number().nullable().optional(),
    created_at: z.string().optional(),
    author: z.string().optional(),
  })).optional(),
});

export class HackerNewsSearchScraper implements ContentScraper {
  constructor(private readonly httpClient = HttpClient.getInstance()) {}

  async scrape(
    query: string,
    options?: ScraperOptions,
  ): Promise<ScrapedContent[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new Error("Hacker News 查询词不能为空");

    const limit = normalizeLimit(options?.limit, 10, 50);
    const url = new URL("https://hn.algolia.com/api/v1/search_by_date");
    url.searchParams.set("query", normalizedQuery);
    url.searchParams.set("tags", "story");
    url.searchParams.set("hitsPerPage", String(limit));
    url.searchParams.set("numericFilters", "points>1");

    const response = await this.httpClient.request<unknown>(url.toString(), {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
      retries: 2,
      timeout: 30000,
    });
    const parsed = HackerNewsResponseSchema.safeParse(response);
    if (!parsed.success) {
      throw new Error(
        `Hacker News Search API returned invalid response: ${parsed.error.toString()}`,
      );
    }

    return (parsed.data.hits ?? [])
      .flatMap((item, index) => {
        const discussionUrl = item.objectID
          ? `https://news.ycombinator.com/item?id=${item.objectID}`
          : undefined;
        const targetUrl = item.url ?? item.story_url ?? discussionUrl;
        return toSearchScrapedContent({
          provider: "hackernews",
          query: normalizedQuery,
          rank: index + 1,
          title: item.title ?? item.story_title ?? undefined,
          url: targetUrl ?? undefined,
          content: [
            item.title ?? item.story_title,
            discussionUrl ? `HN discussion: ${discussionUrl}` : undefined,
            item.points ? `points: ${item.points}` : undefined,
            item.num_comments ? `comments: ${item.num_comments}` : undefined,
          ].filter(Boolean).join("\n"),
          publishedAt: item.created_at,
          extraMetadata: {
            discussionUrl,
            points: item.points,
            comments: item.num_comments,
            author: item.author,
          },
        });
      })
      .slice(0, limit);
  }
}
