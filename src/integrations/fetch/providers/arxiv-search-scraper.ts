import {
  ContentScraper,
  ScrapedContent,
  ScraperOptions,
} from "@src/core/ports/content-scraper.ts";
import {
  normalizeLimit,
  stableHash,
  toSearchScrapedContent,
} from "./search-result-utils.ts";

export class ArxivSearchScraper implements ContentScraper {
  async scrape(
    query: string,
    options?: ScraperOptions,
  ): Promise<ScrapedContent[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new Error("arXiv 查询词不能为空");

    const limit = normalizeLimit(options?.limit, 10, 50);
    const url = new URL("https://export.arxiv.org/api/query");
    url.searchParams.set("search_query", `all:${normalizedQuery}`);
    url.searchParams.set("start", "0");
    url.searchParams.set("max_results", String(limit));
    url.searchParams.set("sortBy", "submittedDate");
    url.searchParams.set("sortOrder", "descending");

    const xml = await fetchText(url.toString(), 30000);
    const entries = parseAtomEntries(xml);

    return entries
      .flatMap((item, index) =>
        toSearchScrapedContent({
          provider: "arxiv",
          query: normalizedQuery,
          rank: index + 1,
          title: item.title,
          url: item.url,
          content: item.summary,
          publishedAt: item.published,
          extraMetadata: {
            authors: item.authors,
            categories: item.categories,
            arxivId: item.id,
          },
        })
      )
      .slice(0, limit);
  }
}

async function fetchText(url: string, timeout: number): Promise<string> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/atom+xml, application/xml, text/xml",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} - ${response.statusText}`);
    }
    return await response.text();
  } finally {
    clearTimeout(id);
  }
}

interface ArxivEntry {
  id: string;
  title: string;
  summary: string;
  url: string;
  published?: string;
  authors: string[];
  categories: string[];
}

function parseAtomEntries(xml: string): ArxivEntry[] {
  return matchAll(xml, /<entry\b[^>]*>([\s\S]*?)<\/entry>/g).map((entry) => {
    const id = decodeXml(readTag(entry, "id")) || `arxiv:${stableHash(entry)}`;
    const title = normalizeText(decodeXml(readTag(entry, "title"))) || id;
    const summary = normalizeText(decodeXml(readTag(entry, "summary")));
    const url = readAlternateLink(entry) || id;
    const authors = matchAll(
      entry,
      /<author\b[^>]*>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g,
    )
      .map((name) => normalizeText(decodeXml(name)))
      .filter(Boolean);
    const categories = matchAll(entry, /<category\b[^>]*\bterm="([^"]+)"/g)
      .map(decodeXml)
      .filter(Boolean);
    return {
      id,
      title,
      summary,
      url,
      published: decodeXml(readTag(entry, "published")) ||
        decodeXml(readTag(entry, "updated")),
      authors,
      categories,
    };
  });
}

function matchAll(value: string, regex: RegExp): string[] {
  const result: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value)) !== null) {
    result.push(match[1] ?? "");
  }
  return result;
}

function readTag(value: string, tagName: string): string {
  const match = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}>`)
    .exec(value);
  return match?.[1]?.trim() ?? "";
}

function readAlternateLink(entry: string): string {
  const links = matchAll(entry, /<link\b([^>]*)\/?>/g);
  for (const attributes of links) {
    const href = readAttribute(attributes, "href");
    if (!href) continue;
    if (readAttribute(attributes, "rel") === "alternate") {
      return decodeXml(href);
    }
    if (href.startsWith("https://arxiv.org/abs/")) {
      return decodeXml(href);
    }
  }
  return "";
}

function readAttribute(value: string, name: string): string {
  const match = new RegExp(`\\b${name}="([^"]+)"`).exec(value);
  return match?.[1] ?? "";
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
