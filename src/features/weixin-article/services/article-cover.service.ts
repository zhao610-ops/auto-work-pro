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
          sub_title: `${new Date().toLocaleDateString()} ${profile.label}`,
          prompt_text_zh: [
            "中文公众号封面图",
            `主题：${profile.coverGuidance}`,
            `标题语义：${coverTitle}`,
            `目标读者：${profile.audience}`,
            `视觉风格：${profile.editorialTone}`,
            `画面元素：${profile.imageGuidance}`,
            brandGuide ? `账号约束：${brandGuide}` : "",
            "限制：不要出现二维码、水印、品牌 Logo、可识别人脸；不要生成除标题外的多余小字",
          ].filter(Boolean).join(" | "),
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
