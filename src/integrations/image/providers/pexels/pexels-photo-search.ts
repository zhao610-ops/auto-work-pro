import {
  StockPhoto,
  StockPhotoSearch,
  StockPhotoSearchRequest,
} from "@src/core/ports/stock-photo-search.ts";

interface PexelsPhotoSearchOptions {
  apiKey: string;
  apiHost?: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
  fetcher?: typeof fetch;
}

interface PexelsPhotoResponse {
  id?: number;
  width?: number;
  height?: number;
  url?: string;
  photographer?: string;
  photographer_url?: string;
  src?: {
    landscape?: string;
    large2x?: string;
    large?: string;
    original?: string;
  };
}

interface PexelsSearchResponse {
  photos?: PexelsPhotoResponse[];
}

interface CachedSearch {
  expiresAt: number;
  photos: StockPhoto[];
}

/**
 * Pexels 官方图片搜索客户端。
 *
 * 搜索结果在进程内缓存 24 小时，减少重复请求并保护 API 配额。
 */
export class PexelsPhotoSearch implements StockPhotoSearch {
  private readonly apiHost: string;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly fetcher: typeof fetch;
  private readonly cache = new Map<string, CachedSearch>();

  constructor(private readonly options: PexelsPhotoSearchOptions) {
    this.apiHost = options.apiHost?.replace(/\/$/, "") ??
      "https://api.pexels.com";
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.cacheTtlMs = options.cacheTtlMs ?? 24 * 60 * 60 * 1000;
    this.fetcher = options.fetcher ?? fetch;
  }

  async search(request: StockPhotoSearchRequest): Promise<StockPhoto[]> {
    const query = normalizeQuery(request.query);
    if (!query) return [];
    if (!this.options.apiKey.trim()) {
      throw new Error("缺少 PEXELS_API_KEY，无法检索 Pexels 正文配图");
    }

    const locale = request.locale ?? "zh-CN";
    const orientation = request.orientation ?? "landscape";
    const perPage = Math.max(
      1,
      Math.min(Math.floor(request.perPage ?? 15), 80),
    );
    const cacheKey =
      `${locale}:${orientation}:${perPage}:${query.toLowerCase()}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.photos;
    }

    const url = new URL("/v1/search", this.apiHost);
    url.searchParams.set("query", query);
    url.searchParams.set("locale", locale);
    url.searchParams.set("orientation", orientation);
    url.searchParams.set("size", "large");
    url.searchParams.set("per_page", String(perPage));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(url, {
        headers: {
          Authorization: this.options.apiKey.trim(),
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Pexels 图片检索失败: HTTP ${response.status}`);
      }
      const payload = await response.json() as PexelsSearchResponse;
      const photos = (payload.photos ?? []).flatMap(normalizePhoto);
      this.cache.set(cacheKey, {
        expiresAt: Date.now() + this.cacheTtlMs,
        photos,
      });
      return photos;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizePhoto(photo: PexelsPhotoResponse): StockPhoto[] {
  const imageUrl = photo.src?.landscape ?? photo.src?.large2x ??
    photo.src?.large ?? photo.src?.original;
  if (!photo.id || !imageUrl || !photo.url) return [];
  return [{
    id: String(photo.id),
    imageUrl,
    pageUrl: photo.url,
    photographer: photo.photographer?.trim() || "Pexels 摄影师",
    photographerUrl: photo.photographer_url?.trim() || photo.url,
    width: Number(photo.width) || 0,
    height: Number(photo.height) || 0,
  }];
}

function normalizeQuery(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 120);
}
