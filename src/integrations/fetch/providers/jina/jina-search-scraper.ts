import {
  ContentScraper,
  Media,
  ScrapedContent,
  ScraperOptions,
} from "@src/core/ports/content-scraper.ts";
import { HttpClient } from "@src/utils/http/http-client.ts";
import { z } from "npm:zod@3.25.76";
import { Logger } from "@zilla/logger";

const logger = new Logger("jina-search-scraper");

const SearchResultSchema = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
  link: z.string().optional(),
  content: z.string().optional(),
  description: z.string().optional(),
  snippet: z.string().optional(),
  publishedTime: z.string().optional(),
  publishedDate: z.string().optional(),
  date: z.string().optional(),
  image: z.string().optional(),
});

const SearchResponseSchema = z.union([
  z.array(SearchResultSchema),
  z.object({
    data: z.array(SearchResultSchema).optional(),
    results: z.array(SearchResultSchema).optional(),
  }),
]);

type SearchResult = z.infer<typeof SearchResultSchema>;

export class JinaSearchScraper implements ContentScraper {
  private apiKey = "";
  private readonly searchApiUrl = "https://s.jina.ai/";

  constructor(
    private readonly configuredApiKey?: string,
    private readonly httpClient = HttpClient.getInstance(),
  ) {}

  async refresh(): Promise<void> {
    this.apiKey = this.configuredApiKey ?? "";
    if (!this.apiKey) {
      throw new Error(
        "providers.fetch.jina.apiKey is not set. " +
          "Jina Search requires a Jina AI API key: https://jina.ai/?sui=apikey",
      );
    }
  }

  async scrape(
    query: string,
    options?: ScraperOptions,
  ): Promise<ScrapedContent[]> {
    await this.refresh();
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      throw new Error("Jina Search 查询词不能为空");
    }

    const result = await this.httpClient.request<unknown>(
      `${this.searchApiUrl}?q=${encodeURIComponent(normalizedQuery)}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Accept": "application/json",
          "X-Respond-With": "no-content",
        },
        retries: 2,
        timeout: 45000,
      },
    );

    const parsed = SearchResponseSchema.safeParse(result);
    if (!parsed.success) {
      logger.error(
        `[Jina Search] 响应结构无效: ${parsed.error.toString()}`,
        result,
      );
      throw new Error(
        `Jina Search API returned an invalid response structure. ${parsed.error.toString()}`,
      );
    }

    const results = Array.isArray(parsed.data)
      ? parsed.data
      : parsed.data.data ?? parsed.data.results ?? [];
    const limit = normalizeLimit(options?.limit, 10);
    return results
      .flatMap((item, index) => toScrapedContent(item, normalizedQuery, index))
      .slice(0, limit);
  }
}

function toScrapedContent(
  result: SearchResult,
  query: string,
  index: number,
): ScrapedContent[] {
  const url = result.url ?? result.link;
  if (!url || !isHttpUrl(url)) return [];

  const title = result.title?.trim() || url;
  const content = (
    result.content ?? result.description ?? result.snippet ?? title
  ).trim();
  const publishDate = result.publishedTime ?? result.publishedDate ??
    result.date ?? new Date().toISOString();
  const media = result.image && isHttpUrl(result.image)
    ? [
      {
        url: result.image,
        type: "image",
        size: { width: 0, height: 0 },
      } satisfies Media,
    ]
    : undefined;

  return [{
    id: `jina_search_${hash(`${query}:${url}:${index}`)}`,
    title,
    content,
    url,
    publishDate,
    media,
    metadata: {
      source: "jina-search",
      query,
      rank: index + 1,
      provider: "jina-search",
    },
  }];
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined) return fallback;
  return Math.max(1, Math.min(50, Math.floor(value)));
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function hash(value: string): string {
  let result = 0;
  for (let index = 0; index < value.length; index++) {
    result = ((result << 5) - result + value.charCodeAt(index)) | 0;
  }
  return Math.abs(result).toString(36);
}
