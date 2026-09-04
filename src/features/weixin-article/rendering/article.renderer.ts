import {
  ArticleImageLayoutService,
  NoopArticleImageLayoutService,
  WeixinTemplate,
} from "@src/features/weixin-article/domain/renderable-article.ts";
import ejs from "npm:ejs@3.1.10";
import { BaseTemplateRenderer } from "@src/features/weixin-article/rendering/base.renderer.ts";
import { Logger } from "@zilla/logger";
import type { ContentImageUploader } from "@src/core/ports/content-publisher.ts";
import { WEIXIN_TEMPLATE_REGISTRY } from "@src/features/weixin-article/rendering/template-registry.ts";
import type { WeixinArticleRenderContext } from "@src/features/weixin-article/services/article-render.service.ts";

const DYNAMIC_TEMPLATE = "__dynamic__";
const logger = new Logger("weixin-article-template-renderer");

export interface DynamicHtmlGenerator {
  generate(
    articles: WeixinTemplate[],
    context?: WeixinArticleRenderContext,
  ): Promise<string>;
}

/**
 * 文章模板渲染器
 */
export class WeixinArticleTemplateRenderer
  extends BaseTemplateRenderer<WeixinTemplate[]> {
  constructor(
    private dynamicHtmlGenerator?: DynamicHtmlGenerator,
    private uploadContentImages: boolean = true,
    private imageLayoutService: ArticleImageLayoutService =
      new NoopArticleImageLayoutService(),
    private imageUploader?: ContentImageUploader,
    defaultTemplateType?: string,
  ) {
    super("article", defaultTemplateType);
    this.availableTemplates = [
      "default",
      "modern",
      "tech",
      "mianpro",
      "longform",
      "product",
      "minimal",
      "darktech",
      "dynamic",
    ];
  }

  public setUploadContentImages(enabled: boolean): void {
    this.uploadContentImages = enabled;
  }

  public setGenerateContentImages(enabled: boolean): void {
    this.imageLayoutService.setGeneratedImageEnabled?.(enabled);
  }

  public override render(
    data: WeixinTemplate[],
    templateType?: string,
    context?: WeixinArticleRenderContext,
  ): Promise<string>;
  public override render(
    data: WeixinTemplate[],
    context?: WeixinArticleRenderContext,
  ): Promise<string>;
  public override render(
    data: WeixinTemplate[],
    templateTypeOrContext?: string | WeixinArticleRenderContext,
    maybeContext?: WeixinArticleRenderContext,
  ): Promise<string> {
    const templateType = typeof templateTypeOrContext === "string"
      ? templateTypeOrContext
      : undefined;
    const context = typeof templateTypeOrContext === "string"
      ? maybeContext
      : templateTypeOrContext;
    return super.render(data, templateType, context);
  }

  /**
   * 加载文章模板文件
   */
  protected async loadTemplates(): Promise<void> {
    this.templates = {
      ...WEIXIN_TEMPLATE_REGISTRY,
      dynamic: DYNAMIC_TEMPLATE,
    };
  }

  /**
   * 实现doRender方法，添加预处理步骤
   */
  public async doRender(
    data: WeixinTemplate[],
    template: string,
    context?: WeixinArticleRenderContext,
  ): Promise<string> {
    console.log(
      `WeixinArticleTemplateRenderer doRender: ${data.length} articles`,
    );
    const processedData = await this.imageLayoutService.layoutArticles(data);

    let html: string;
    if (template === DYNAMIC_TEMPLATE) {
      try {
        if (!this.dynamicHtmlGenerator) {
          throw new Error("动态微信模板需要注入 DynamicHtmlGenerator");
        }
        html = await this.dynamicHtmlGenerator.generate(processedData, context);
      } catch (error) {
        logger.warn(
          `动态微信模板生成失败，回退 minimal: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        html = this.renderStaticTemplate(processedData, this.templates.minimal);
      }
    } else {
      html = this.renderStaticTemplate(processedData, template);
    }

    return await this.processRenderedImages(html);
  }

  private renderStaticTemplate(
    articles: WeixinTemplate[],
    template: string,
  ): string {
    return ejs.render(
      template,
      {
        articles,
      },
      { rmWhitespace: true },
    );
  }

  private async processRenderedImages(html: string): Promise<string> {
    if (!/<img\b/i.test(html)) return html;

    if (!this.uploadContentImages) {
      logger.info("[DryRun] 跳过微信正文图片上传");
      return html;
    }

    if (!this.imageUploader) {
      throw new Error("正文图片上传需要注入 ContentImageUploader");
    }

    const { WeixinImageProcessor } = await import(
      "@src/utils/image/image-processor.ts"
    );
    const imageProcessor = new WeixinImageProcessor(this.imageUploader);

    const { content, results } = await imageProcessor.processContent(html);
    const failed = results.filter((result) => result.error);
    if (failed.length > 0) {
      logger.warn(
        `正文图片处理失败 ${failed.length}/${results.length}: ${
          failed.map((result) => `${result.originalUrl} (${result.error})`)
            .join("; ")
        }`,
      );
    } else if (results.length > 0) {
      logger.info(`正文图片处理完成: ${results.length} 张`);
    }
    return content;
  }
}
