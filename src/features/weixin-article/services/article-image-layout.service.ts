import { Media } from "@src/core/ports/content-scraper.ts";
import {
  ArticleImageLayoutService,
  WeixinTemplate,
} from "@src/features/weixin-article/domain/renderable-article.ts";
import {
  ImageGenerator,
  ImageGeneratorType,
} from "@src/core/ports/image-generator.ts";
import { Logger } from "@zilla/logger";
import {
  PromptProfileName,
  resolvePromptProfile,
} from "@src/prompts/prompt-profile.ts";

const logger = new Logger("weixin-article-image-layout-service");

export interface ArticleImageLayoutOptions {
  paragraphSeparator?: string;
  imageAlt?: string;
}

interface AiImageGeneratorResolver {
  getGenerator(
    type: ImageGeneratorType.ALIYUN_IMAGE | ImageGeneratorType.MINIMAX_IMAGE,
    needRefresh?: boolean,
  ): Promise<ImageGenerator<AiBodyImageRequest, string>>;
}

interface AiBodyImageRequest {
  prompt: string;
  size?: string;
  model?: string;
}

interface AiImageLayoutConfig {
  enabled: boolean;
  imageCount: number;
  onlyWhenNoMedia: boolean;
  imageSize: string;
  imageModel?: string;
  imageGeneratorType:
    | ImageGeneratorType.ALIYUN_IMAGE
    | ImageGeneratorType.MINIMAX_IMAGE;
  promptProfile?: PromptProfileName;
}

const DEFAULT_AI_IMAGE_LAYOUT_CONFIG: AiImageLayoutConfig = {
  enabled: false,
  imageCount: 1,
  onlyWhenNoMedia: false,
  imageSize: "1024*1024",
  imageModel: "qwen-image-2.0",
  imageGeneratorType: ImageGeneratorType.ALIYUN_IMAGE,
  promptProfile: "technology",
};

/**
 * Lays out existing article media in the body.
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
    return articles.map((article) => this.layoutExistingMedia(article));
  }

  async layoutArticle(article: WeixinTemplate): Promise<WeixinTemplate> {
    return this.layoutExistingMedia(article);
  }

  layoutExistingMedia(article: WeixinTemplate): WeixinTemplate {
    const mediaUrls = this.getUniqueMediaUrls(article.media);
    if (mediaUrls.length === 0) {
      return article;
    }

    const paragraphs = article.content.split(this.paragraphSeparator);
    let mediaIndex = 0;
    let content = "";

    content += this.buildImageHtml(mediaUrls[mediaIndex++]);
    content += this.paragraphSeparator;

    paragraphs.forEach((paragraph, index) => {
      content += paragraph;

      if (mediaIndex < mediaUrls.length && index < paragraphs.length - 1) {
        content += this.paragraphSeparator;
        content += this.buildImageHtml(mediaUrls[mediaIndex++]);
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

  private getUniqueMediaUrls(media?: Media[]): string[] {
    if (!media?.length) {
      return [];
    }

    const urls = new Set<string>();
    for (const item of media) {
      if (item.url?.trim()) {
        urls.add(item.url.trim());
      }
    }
    return Array.from(urls);
  }

  private buildImageHtml(url: string): string {
    return `<img src="${escapeHtmlAttribute(url)}" alt="${
      escapeHtmlAttribute(this.imageAlt)
    }" />`;
  }
}

export class AiArticleImageLayoutService implements ArticleImageLayoutService {
  private generatedImageEnabled = true;

  constructor(
    private fallbackLayoutService = new WeixinArticleImageLayoutService(),
    private imageGeneratorResolver: AiImageGeneratorResolver,
    private config: AiImageLayoutConfig = DEFAULT_AI_IMAGE_LAYOUT_CONFIG,
  ) {}

  setGeneratedImageEnabled(enabled: boolean): void {
    this.generatedImageEnabled = enabled;
  }

  async layoutArticles(articles: WeixinTemplate[]): Promise<WeixinTemplate[]> {
    if (!await this.isEnabled()) {
      return await this.fallbackLayoutService.layoutArticles(articles);
    }

    return await Promise.all(
      articles.map((article) => this.layoutArticle(article)),
    );
  }

  async layoutArticle(article: WeixinTemplate): Promise<WeixinTemplate> {
    if (!await this.isEnabled()) {
      return await this.fallbackLayoutService.layoutArticle(article);
    }

    try {
      const articleWithGeneratedImages = await this.generateArticleImages(
        article,
      );
      return await this.fallbackLayoutService.layoutArticle(
        articleWithGeneratedImages,
      );
    } catch (error) {
      logger.warn(
        `[AI正文配图] 生成失败，回退已有图片布局: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return await this.fallbackLayoutService.layoutArticle(article);
    }
  }

  private async generateArticleImages(
    article: WeixinTemplate,
  ): Promise<WeixinTemplate> {
    const onlyWhenNoMedia = await this.getOnlyWhenNoMedia();
    if (onlyWhenNoMedia && article.media?.length) {
      return article;
    }

    const imageCount = await this.getImageCount();
    if (imageCount <= 0) {
      return article;
    }

    const generator = await this.imageGeneratorResolver.getGenerator(
      this.config.imageGeneratorType,
    );
    const generatedMedia: Media[] = [];

    for (let index = 0; index < imageCount; index++) {
      const url = await generator.generate({
        prompt: this.buildImagePrompt(article, index),
        size: await this.getImageSize(),
        model: await this.getImageModel(),
      });
      if (typeof url !== "string") {
        throw new Error("正文配图生成结果不是图片 URL");
      }
      generatedMedia.push({
        url,
        type: "image",
        size: this.parseImageSize(await this.getImageSize()),
      });
    }

    return {
      ...article,
      media: [...generatedMedia, ...(article.media ?? [])],
    };
  }

  private async isEnabled(): Promise<boolean> {
    return this.generatedImageEnabled && this.config.enabled;
  }

  private async getImageCount(): Promise<number> {
    const value = this.config.imageCount;
    const count = Number(value);
    if (!Number.isFinite(count)) {
      return 1;
    }
    return Math.max(0, Math.min(Math.floor(count), 3));
  }

  private async getOnlyWhenNoMedia(): Promise<boolean> {
    return this.config.onlyWhenNoMedia;
  }

  private async getImageSize(): Promise<string> {
    return this.config.imageSize;
  }

  private async getImageModel(): Promise<string | undefined> {
    return this.config.imageModel;
  }

  private buildImagePrompt(article: WeixinTemplate, index: number): string {
    const profile = resolvePromptProfile(this.config.promptProfile);
    const content = stripHtml(article.content)
      .replace(/<next_paragraph \/>/g, "\n")
      .slice(0, 600);
    return [
      `为中文微信公众号“${profile.label}”文章生成一张正文配图。`,
      "画面方向：专业媒体配图，不要做广告海报，不要生成封面标题，不要出现任何文字。",
      `视觉要求：${profile.imageGuidance}`,
      "避免：水印、Logo、二维码、可识别人物脸部、夸张赛博朋克、过度蓝紫渐变、廉价股票素材感。",
      "构图：适合放在公众号正文段落之间，主体明确，留有呼吸感，横竖构图均衡。",
      `文章标题：${article.title}`,
      `文章摘要：${content}`,
      `图片序号：${index + 1}`,
    ].join("\n");
  }

  private parseImageSize(size: string): { width: number; height: number } {
    const match = size.match(/^(\d+)\*(\d+)$/);
    if (!match) {
      return { width: 1024, height: 1024 };
    }
    return {
      width: Number(match[1]),
      height: Number(match[2]),
    };
  }
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function stripHtml(value: string): string {
  return value
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}
