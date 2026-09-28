import { Media } from "@src/core/ports/content-scraper.ts";
import {
  ArticleImageLayoutService,
  WeixinTemplate,
} from "@src/features/weixin-article/domain/renderable-article.ts";
import { Logger } from "@zilla/logger";
import {
  StockPhoto,
  StockPhotoSearch,
} from "@src/core/ports/stock-photo-search.ts";

const logger = new Logger("weixin-article-image-layout-service");

export interface ArticleImageLayoutOptions {
  paragraphSeparator?: string;
  imageAlt?: string;
}

interface PexelsImageLayoutConfig {
  enabled: boolean;
  locale: string;
  perPage: number;
}

const DEFAULT_PEXELS_IMAGE_LAYOUT_CONFIG: PexelsImageLayoutConfig = {
  enabled: false,
  locale: "zh-CN",
  perPage: 15,
};

/**
 * 每个内容块只布局一张正文图。内容块由 Article Plan 映射为模板项，因此
 * 三条内容会稳定得到三张图，而不会把同一来源的图片全部堆入正文。
 *
 * This service intentionally only decides image placement. Downloading,
 * compression, Weixin upload, and URL replacement are handled later by the
 * image processor. Future AI-generated image placement can replace this
 * service without changing template rendering.
 */
export class WeixinArticleImageLayoutService
  implements ArticleImageLayoutService {
  private readonly paragraphSeparator: string;
  private readonly imageAlt: string;

  constructor(options: ArticleImageLayoutOptions = {}) {
    this.paragraphSeparator = options.paragraphSeparator ??
      "<next_paragraph />";
    this.imageAlt = options.imageAlt ?? "文章配图";
  }

  async layoutArticles(articles: WeixinTemplate[]): Promise<WeixinTemplate[]> {
    const usedMediaUrls = new Set<string>();
    return articles.map((article) =>
      this.layoutExistingMedia(article, usedMediaUrls)
    );
  }

  async layoutArticle(article: WeixinTemplate): Promise<WeixinTemplate> {
    return this.layoutExistingMedia(article);
  }

  layoutExistingMedia(
    article: WeixinTemplate,
    usedMediaUrls = new Set<string>(),
  ): WeixinTemplate {
    if (!isBodyImageEnabled(article)) return article;
    const mediaUrl = this.getUnusedMediaUrl(article.media, usedMediaUrls);
    if (!mediaUrl) {
      return article;
    }
    usedMediaUrls.add(normalizeMediaUrl(mediaUrl));

    const paragraphs = article.content.split(this.paragraphSeparator);
    let content = "";
    paragraphs.forEach((paragraph, index) => {
      content += paragraph;
      // 导语首段先交代事实，再给与该内容块直接相关的配图，避免标题后堆图。
      if (index === 0) {
        content += this.paragraphSeparator;
        content += this.buildImageHtml(mediaUrl);
      }

      if (index < paragraphs.length - 1) {
        content += this.paragraphSeparator;
      }
    });

    return {
      ...article,
      content,
    };
  }

  hasUnusedMedia(
    article: WeixinTemplate,
    usedMediaUrls: ReadonlySet<string>,
  ): boolean {
    return Boolean(this.getUnusedMediaUrl(article.media, usedMediaUrls));
  }

  private getUnusedMediaUrl(
    media: Media[] | undefined,
    usedMediaUrls: ReadonlySet<string>,
  ): string | undefined {
    if (!media?.length) {
      return undefined;
    }
    for (const item of media) {
      const url = item.url?.trim();
      if (url && !usedMediaUrls.has(normalizeMediaUrl(url))) {
        return url;
      }
    }
    return undefined;
  }

  private buildImageHtml(url: string): string {
    return `<img src="${escapeHtmlAttribute(url)}" alt="${
      escapeHtmlAttribute(this.imageAlt)
    }" />`;
  }
}

export class PexelsArticleImageLayoutService
  implements ArticleImageLayoutService {
  private readonly config: PexelsImageLayoutConfig;

  constructor(
    private fallbackLayoutService = new WeixinArticleImageLayoutService(),
    private photoSearch: StockPhotoSearch,
    config: Partial<PexelsImageLayoutConfig> = {},
  ) {
    this.config = { ...DEFAULT_PEXELS_IMAGE_LAYOUT_CONFIG, ...config };
  }

  async layoutArticles(articles: WeixinTemplate[]): Promise<WeixinTemplate[]> {
    if (!this.isEnabled()) {
      return await this.fallbackLayoutService.layoutArticles(articles);
    }

    const usedMediaUrls = new Set<string>();
    const usedStockPhotoIds = new Set<string>();
    const result: WeixinTemplate[] = [];
    for (const article of articles) {
      result.push(
        await this.layoutArticleWithUsedMedia(
          article,
          usedMediaUrls,
          usedStockPhotoIds,
        ),
      );
    }
    return result;
  }

  async layoutArticle(article: WeixinTemplate): Promise<WeixinTemplate> {
    if (!this.isEnabled()) {
      return await this.fallbackLayoutService.layoutArticle(article);
    }

    return await this.layoutArticleWithUsedMedia(
      article,
      new Set<string>(),
      new Set<string>(),
    );
  }

  private async layoutArticleWithUsedMedia(
    article: WeixinTemplate,
    usedMediaUrls: Set<string>,
    usedStockPhotoIds: Set<string>,
  ): Promise<WeixinTemplate> {
    if (!isBodyImageEnabled(article)) return article;
    if (this.fallbackLayoutService.hasUnusedMedia(article, usedMediaUrls)) {
      return this.fallbackLayoutService.layoutExistingMedia(
        article,
        usedMediaUrls,
      );
    }

    try {
      const photo = await this.findUnusedPhoto(
        article,
        usedMediaUrls,
        usedStockPhotoIds,
      );
      if (!photo) {
        logger.warn(
          `[Pexels正文配图] 未找到相关图片，跳过章节: ${article.title}`,
        );
        return article;
      }
      usedMediaUrls.add(normalizeMediaUrl(photo.imageUrl));
      usedStockPhotoIds.add(photo.id);
      return insertAfterFirstParagraph(
        article,
        this.buildPexelsImageHtml(article, photo),
        "<next_paragraph />",
      );
    } catch (error) {
      logger.warn(
        `[Pexels正文配图] 检索失败，跳过章节配图: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return article;
    }
  }

  private async findUnusedPhoto(
    article: WeixinTemplate,
    usedMediaUrls: ReadonlySet<string>,
    usedStockPhotoIds: ReadonlySet<string>,
  ): Promise<StockPhoto | undefined> {
    for (const query of buildPexelsQueries(article)) {
      const photos = await this.photoSearch.search({
        query,
        locale: this.config.locale,
        orientation: "landscape",
        perPage: this.config.perPage,
      });
      const photo = photos.find((item) =>
        !usedStockPhotoIds.has(item.id) &&
        !usedMediaUrls.has(normalizeMediaUrl(item.imageUrl))
      );
      if (photo) {
        return photo;
      }
    }
    return undefined;
  }

  private buildPexelsImageHtml(
    article: WeixinTemplate,
    photo: StockPhoto,
  ): string {
    const image = `<img src="${escapeHtmlAttribute(photo.imageUrl)}" alt="${
      escapeHtmlAttribute(`${article.title}相关配图`)
    }" />`;
    const credit =
      `<p style="margin:6px 0 18px;color:#999999;font-size:11px;line-height:1.6;text-align:center;">图片：<a href="${
        escapeHtmlAttribute(photo.photographerUrl)
      }">${escapeHtmlText(photo.photographer)}</a> / <a href="${
        escapeHtmlAttribute(photo.pageUrl)
      }">Pexels</a></p>`;
    return `${image}${credit}`;
  }

  private isEnabled(): boolean {
    return this.config.enabled;
  }
}

function insertAfterFirstParagraph(
  article: WeixinTemplate,
  imageHtml: string,
  paragraphSeparator: string,
): WeixinTemplate {
  const paragraphs = article.content.split(paragraphSeparator);
  const [first = "", ...rest] = paragraphs;
  return {
    ...article,
    content: [first, imageHtml, ...rest].join(paragraphSeparator),
  };
}

function buildPexelsQueries(article: WeixinTemplate): string[] {
  const promptHint = stringMetadata(article, "bodyImagePromptHint");
  const purpose = stringMetadata(article, "bodyImagePurpose");
  const title = stripHtml(article.title).replace(/[《》【】「」“”]/g, " ");
  const keywords = article.keywords
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5)
    .join(" ");
  return [...new Set([promptHint, purpose, title, keywords])]
    .map((item) => item.replace(/\s+/g, " ").trim().slice(0, 120))
    .filter(Boolean);
}

function isBodyImageEnabled(article: WeixinTemplate): boolean {
  return article.metadata.bodyImageEnabled !== false;
}

function stringMetadata(
  article: WeixinTemplate,
  key: string,
): string {
  const value = article.metadata[key];
  return typeof value === "string" ? value.trim() : "";
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeMediaUrl(url: string): string {
  return url.trim();
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function stripHtml(value: string): string {
  return value
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}
