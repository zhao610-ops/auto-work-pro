import { ContentPublisher } from "@src/core/ports/content-publisher.ts";
import {
  ImageGenerator,
  ImageGeneratorType,
} from "@src/core/ports/image-generator.ts";
import { Logger } from "@zilla/logger";
import { getCoverTitle } from "./article-title.service.ts";
import {
  PromptProfileName,
  resolvePromptProfile,
} from "@src/prompts/prompt-profile.ts";
import { redactError } from "@src/utils/security/redact.ts";
import type { JsonObject } from "@src/core/ports/runtime-config-store.ts";
import { formatAccountBrandGuide } from "@src/prompts/account-brand.ts";

const logger = new Logger("weixin-article-cover-service");
const DEFAULT_COVER_GENERATION_TIMEOUT_MS = 150_000;
const DEFAULT_COVER_UPLOAD_TIMEOUT_MS = 45_000;
export const DEFAULT_COVER_IMAGE_SIZE = "1792*768";
export const DEFAULT_COVER_MEDIA_ID =
  "SwCSRjrdGJNaWioRQUHzgF68BHFkSlb_f5xlTquvsOSA6Yy0ZRjFo0aW9eS3JJu_";

export interface ArticleCoverImageGeneratorResolver {
  getGenerator(
    type: ImageGeneratorType.ALIYUN_POSTER | ImageGeneratorType.MINIMAX_IMAGE,
  ): Promise<ImageGenerator<ArticleCoverImageRequest, string>>;
}

interface ArticleCoverImageRequest {
  model?: string;
  title: string;
  sub_title?: string;
  prompt_text_zh?: string;
  size?: string;
  generate_mode: "generate";
  generate_num: 1;
}

export interface CoverGenerationResult {
  mediaId: string;
  generated: boolean;
  fallback: boolean;
  /** source-image 表示使用抓取原文的图片；ai-generated 表示 AI 补图。 */
  strategy?: "source-image" | "ai-generated" | "fallback";
  generatorType: string;
  model?: string;
  imageUrl?: string;
  sourceArticleUrl?: string;
  sourceSelectionReason?: string;
  error?: string;
}

export interface CoverSourceImage {
  url: string;
  width?: number;
  height?: number;
  alt?: string;
  sourceArticleUrl?: string;
}

export interface CoverGenerationOptions {
  sourceImages?: CoverSourceImage[];
  visualBrief?: string;
}

export interface ArticleCoverTimeoutOptions {
  generationMs?: number;
  uploadMs?: number;
}

export class WeixinArticleCoverService {
  private readonly timeouts: Required<ArticleCoverTimeoutOptions>;

  constructor(
    private publisher: Pick<ContentPublisher, "uploadImage">,
    private imageGeneratorResolver: ArticleCoverImageGeneratorResolver,
    private readonly promptProfile?: PromptProfileName,
    private readonly imageModel?: string,
    private readonly imageGeneratorType:
      | ImageGeneratorType.ALIYUN_POSTER
      | ImageGeneratorType.MINIMAX_IMAGE = ImageGeneratorType.ALIYUN_POSTER,
    private readonly accountBrand?: JsonObject,
    timeoutOptions: ArticleCoverTimeoutOptions = {},
    private readonly defaultCoverMediaId = DEFAULT_COVER_MEDIA_ID,
    private readonly sourceImageMode: "prefer-source" | "ai-only" =
      "prefer-source",
  ) {
    this.timeouts = {
      generationMs: normalizeTimeoutMs(
        timeoutOptions.generationMs,
        DEFAULT_COVER_GENERATION_TIMEOUT_MS,
      ),
      uploadMs: normalizeTimeoutMs(
        timeoutOptions.uploadMs,
        DEFAULT_COVER_UPLOAD_TIMEOUT_MS,
      ),
    };
  }

  public async generateCoverMediaId(
    title: string,
    options?: CoverGenerationOptions,
  ): Promise<string> {
    return (await this.generateCover(title, options)).mediaId;
  }

  public async generateCover(
    title: string,
    options: CoverGenerationOptions = {},
  ): Promise<CoverGenerationResult> {
    try {
      const sourceImage = this.selectSourceImage(options.sourceImages);
      if (sourceImage) return await this.uploadSourceCover(sourceImage);
      return await this.generateAndUploadCover(title, options.visualBrief);
    } catch (error) {
      const redacted = redactError(error);
      logger.warn(
        `[封面生成] 动态封面生成失败，使用默认封面继续发布: ${redacted.message}`,
      );
      return {
        mediaId: this.defaultCoverMediaId,
        generated: false,
        fallback: true,
        strategy: "fallback",
        generatorType: this.imageGeneratorType,
        model: this.imageModel,
        error: redacted.message,
      };
    }
  }

  private async generateAndUploadCover(
    title: string,
    visualBrief?: string,
  ): Promise<CoverGenerationResult> {
    const coverTitle = getCoverTitle(title);
    const profile = resolvePromptProfile(this.promptProfile);
    const brandGuide = formatAccountBrandGuide(this.accountBrand)
      .replace(/\n+/g, " ")
      .trim();
    const imageUrl = await withTimeout(
      async () => {
        const imageGenerator = await this.imageGeneratorResolver
          .getGenerator(this.imageGeneratorType);
        return await imageGenerator.generate({
          model: this.imageModel,
          title: coverTitle,
          prompt_text_zh: [
            "微信公众号横版封面配图",
            `文章主题：${coverTitle}`,
            `画面方向：${visualBrief?.trim() || profile.coverGuidance}`,
            `目标读者：${profile.audience}`,
            `视觉风格：真实、有编辑感的生活纪实摄影，${profile.editorialTone}`,
            `画面元素：${profile.imageGuidance}`,
            brandGuide ? `账号约束：${brandGuide}` : "",
            "内容相关性：先从标题提取具体经济主题、影响对象和生活场景；人物必须在与标题对应的环境中做自然动作，避免无关的漂亮人物或空泛风景",
            "构图要求：一个明确主体与一个生活场景，层次丰富、自然光影、真实材质和适度留白；重要内容位于画面中央安全区域，左右允许裁切",
            "人物规则：如出现女性，只能是22岁以上的年轻成年女性，穿着日常、淡妆或接近素颜、自然动作；允许侧脸、背影、远景或手部，不做模特摆拍、网红写真或性感化表达",
            "严格限制：文章标题仅用于理解主题，画面中不得出现任何中文、英文、数字、字母、Logo、水印、二维码、界面截图、图表、K线、硬币、增长箭头、商务楼宣传照、蓝紫科技光效或可识别人脸",
          ].filter(Boolean).join(" | "),
          size: DEFAULT_COVER_IMAGE_SIZE,
          generate_mode: "generate",
          generate_num: 1,
        });
      },
      this.timeouts.generationMs,
      "封面图片生成超时",
    );

    return {
      mediaId: await withTimeout(
        () => this.publisher.uploadImage(imageUrl),
        this.timeouts.uploadMs,
        "封面图片上传微信超时",
      ),
      generated: true,
      fallback: false,
      strategy: "ai-generated",
      generatorType: this.imageGeneratorType,
      model: this.imageModel,
      imageUrl,
    };
  }

  private selectSourceImage(
    candidates: CoverSourceImage[] | undefined,
  ): CoverSourceImage | undefined {
    if (this.sourceImageMode !== "prefer-source" || !candidates?.length) {
      return undefined;
    }
    const seen = new Set<string>();
    return candidates.find((candidate) => {
      const url = candidate.url.trim();
      if (!isPublicImageUrl(url) || seen.has(url)) return false;
      seen.add(url);
      if (isUnsuitableSourceImage(url, candidate.alt)) return false;
      if (
        Number.isFinite(candidate.width) && Number.isFinite(candidate.height) &&
        ((candidate.width ?? 0) < 960 || (candidate.height ?? 0) < 420)
      ) return false;
      return true;
    });
  }

  private async uploadSourceCover(
    sourceImage: CoverSourceImage,
  ): Promise<CoverGenerationResult> {
    const imageUrl = sourceImage.url.trim();
    const mediaId = await withTimeout(
      () => this.publisher.uploadImage(imageUrl),
      this.timeouts.uploadMs,
      "原文封面上传微信超时",
    );
    return {
      mediaId,
      generated: false,
      fallback: false,
      strategy: "source-image",
      generatorType: "SOURCE_IMAGE",
      imageUrl,
      sourceArticleUrl: sourceImage.sourceArticleUrl,
      sourceSelectionReason: "入选原文中找到可用的真实主图，优先使用原图",
    };
  }
}

function isPublicImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isUnsuitableSourceImage(url: string, alt?: string): boolean {
  const value = `${url} ${alt ?? ""}`.toLowerCase();
  return /(?:logo|icon|avatar|author|profile|social|share|banner|advert|sponsor|qrcode|qr-code|favicon)/
    .test(value);
}

function normalizeTimeoutMs(
  value: number | undefined,
  fallback: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value as number));
}

async function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
