import {
  ContentScraper,
  ScrapedContent,
  ScraperOptions,
} from "@src/core/ports/content-scraper.ts";
import { z } from "npm:zod@3.25.76";
import {
  normalizeLimit,
  toSearchScrapedContent,
} from "./search-result-utils.ts";
import { Logger } from "@zilla/logger";

const logger = new Logger("gdelt-scraper");

const GdeltResponseSchema = z.object({
  articles: z.array(z.object({
    url: z.string().optional(),
    title: z.string().optional(),
    seendate: z.string().optional(),
    domain: z.string().optional(),
    sourcecountry: z.string().optional(),
    language: z.string().optional(),
    socialimage: z.string().optional(),
  })).optional(),
});

export class GdeltScraper implements ContentScraper {
  async scrape(
    query: string,
    options?: ScraperOptions,
  ): Promise<ScrapedContent[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new Error("GDELT 查询词不能为空");

    const limit = normalizeLimit(options?.limit, 10, 50);
    const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
    url.searchParams.set("query", normalizedQuery);
    url.searchParams.set("mode", "artlist");
    url.searchParams.set("format", "json");
    url.searchParams.set("sort", "datedesc");
    url.searchParams.set("maxrecords", String(limit));
    url.searchParams.set("timespan", "7d");

    const response = await fetchJsonWithTextFallback(url.toString(), 30000);
    if (!response) return [];
    const parsed = GdeltResponseSchema.safeParse(response);
    if (!parsed.success) {
      throw new Error(
        `GDELT API returned invalid response: ${parsed.error.toString()}`,
      );
    }

    return (parsed.data.articles ?? [])
      .flatMap((item, index) =>
        toSearchScrapedContent({
          provider: "gdelt",
          query: normalizedQuery,
          rank: index + 1,
          title: item.title,
          url: item.url,
          content: item.title,
          publishedAt: item.seendate,
          imageUrl: item.socialimage,
          extraMetadata: {
            domain: item.domain,
            sourceCountry: item.sourcecountry,
            language: item.language,
          },
        })
      )
      .slice(0, limit);
  }
}

async function fetchJsonWithTextFallback(
  url: string,
  timeout: number,
): Promise<unknown | undefined> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json,text/plain",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} - ${response.statusText}`);
    }
    const text = await response.text();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      logger.warn(
        `[GDELT] 返回非 JSON 内容，视为无结果: ${text.slice(0, 160)}`,
      );
      return undefined;
    }
  } finally {
    clearTimeout(id);
  }
}
