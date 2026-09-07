import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import { load } from "npm:cheerio@1.0.0";

const TRENDWATCHING_HOST = "www.trendwatching.com";
const DIRECT_FETCH_TIMEOUT_MS = 15_000;
const MAX_CONTENT_LENGTH = 12_000;

export function isTrendWatchingUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === TRENDWATCHING_HOST ||
      url.hostname === "trendwatching.com";
  } catch {
    return false;
  }
}

export async function scrapeTrendWatchingDirect(
  sourceUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<ScrapedContent[]> {
  if (!isTrendWatchingUrl(sourceUrl)) return [];

  const response = await fetcher(sourceUrl, {
    headers: {
      "Accept": "text/html,application/xhtml+xml",
      "User-Agent": "Mozilla/5.0 (compatible; TrendPublish/1.0)",
    },
    signal: AbortSignal.timeout(DIRECT_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`TrendWatching 直接抓取失败: HTTP ${response.status}`);
  }
  return parseTrendWatchingHtml(await response.text(), sourceUrl);
}

export function parseTrendWatchingHtml(
  html: string,
  sourceUrl: string,
): ScrapedContent[] {
  const $ = load(html);
  $("script, style, noscript, nav, footer, form").remove();

  const articleContents = $("article").toArray().flatMap((element, index) => {
    const article = $(element);
    const title = article.find("h1, h2, h3, h4").first().text().trim();
    const content = normalizeText(article.text());
    if (!title || content.length < 120) return [];
    const href = article.find("a[href]").first().attr("href");
    return [toContent(title, content, resolveUrl(href, sourceUrl), index)];
  });
  if (articleContents.length) return articleContents;

  const main = $("main").first();
  const root = main.length ? main : $("body");
  const content = normalizeText(root.text()).slice(0, MAX_CONTENT_LENGTH);
  if (content.length < 200) return [];
  const title = normalizeText($("h1").first().text()) ||
    normalizeText($("title").first().text()) || "TrendWatching Daily";
  return [toContent(title, content, sourceUrl, 0)];
}

function toContent(
  title: string,
  content: string,
  url: string,
  index: number,
): ScrapedContent {
  return {
    id: `trendwatching_direct_${stableHash(`${url}:${index}`)}`,
    title,
    content: content.slice(0, MAX_CONTENT_LENGTH),
    url,
    publishDate: new Date().toISOString(),
    metadata: {
      source: "trendwatching-direct",
      provider: "trendwatching-direct",
      originalUrl: url,
    },
  };
}

function resolveUrl(href: string | undefined, baseUrl: string): string {
  if (!href) return baseUrl;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return baseUrl;
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stableHash(value: string): string {
  let result = 0;
  for (let index = 0; index < value.length; index++) {
    result = ((result << 5) - result + value.charCodeAt(index)) | 0;
  }
  return Math.abs(result).toString(36);
}
