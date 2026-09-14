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
  generatorType: string;
  model?: string;
  imageUrl?: string;
  error?: string;
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

  public async generateCoverMediaId(title: string): Promise<string> {
    return (await this.generateCover(title)).mediaId;
  }

  public async generateCover(title: string): Promise<CoverGenerationResult> {
    try {
      return await this.generateAndUploadCover(title);
    } catch (error) {
      const redacted = redactError(error);
      logger.warn(
        `[封面生成] 动态封面生成失败，使用默认封面继续发布: ${redacted.message}`,
      );
      return {
        mediaId: this.defaultCoverMediaId,
        generated: false,
        fallback: true,
        generatorType: this.imageGeneratorType,
        model: this.imageModel,
        error: redacted.message,
      };
    }
  }

  private async generateAndUploadCover(
    title: string,
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
            `画面方向：${profile.coverGuidance}`,
            `目标读者：${profile.audience}`,
            `视觉风格：高端商业杂志质感，${profile.editorialTone}`,
            `画面元素：${profile.imageGuidance}`,
            brandGuide ? `账号约束：${brandGuide}` : "",
            "内容相关性：优先使用与文章主题直接相关的物体、环境和行为表达核心概念，避免空泛的科技背景、增长箭头、办公桌和报表",
            "构图要求：主体明确、层次丰富、自然光影、细节清晰，重要内容位于画面中央安全区域，左右允许裁切",
            "严格限制：文章标题仅用于理解主题，画面中不得出现任何中文、英文、数字、字母、Logo、水印、二维码、界面截图或可识别人脸",
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
      generatorType: this.imageGeneratorType,
      model: this.imageModel,
      imageUrl,
    };
  }
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
