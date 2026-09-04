import { Media, ScrapedContent } from "@src/core/ports/content-scraper.ts";

export interface SearchResultInput {
  provider: string;
  query: string;
  rank: number;
  title?: string;
  url?: string;
  content?: string;
  publishedAt?: string;
  imageUrl?: string;
  extraMetadata?: Record<string, unknown>;
}

export function toSearchScrapedContent(
  input: SearchResultInput,
): ScrapedContent[] {
  const url = input.url?.trim();
  if (!url || !isHttpUrl(url)) return [];

  const title = input.title?.trim() || url;
  const content = (input.content?.trim() || title).replace(/\s+/g, " ");
  const media = input.imageUrl && isHttpUrl(input.imageUrl)
    ? [
      {
        url: input.imageUrl,
        type: "image",
        size: { width: 0, height: 0 },
      } satisfies Media,
    ]
    : undefined;

  return [{
    id: `${input.provider}_${
      stableHash(`${input.query}:${url}:${input.rank}`)
    }`,
    title,
    content,
    url,
    publishDate: normalizeDate(input.publishedAt),
    media,
    metadata: {
      source: input.provider,
      provider: input.provider,
      query: input.query,
      rank: input.rank,
      ...input.extraMetadata,
    },
  }];
}

export function normalizeLimit(
  value: number | undefined,
  fallback: number,
  max = 50,
): number {
  if (!Number.isFinite(value) || value === undefined) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function stableHash(value: string): string {
  let result = 0;
  for (let index = 0; index < value.length; index++) {
    result = ((result << 5) - result + value.charCodeAt(index)) | 0;
  }
  return Math.abs(result).toString(36);
}

function normalizeDate(value: string | undefined): string {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}
