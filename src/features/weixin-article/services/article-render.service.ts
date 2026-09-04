import { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import type { ArticlePlan } from "@src/features/weixin-article/domain/article-plan.ts";
import { WeixinTemplate } from "@src/features/weixin-article/domain/renderable-article.ts";

export interface WeixinArticleRenderContext {
  articlePlan?: ArticlePlan;
}

export interface WeixinArticleRenderer {
  setUploadContentImages(enabled: boolean): void;
  setGenerateContentImages?(enabled: boolean): void;
  render(
    templateData: WeixinTemplate[],
    context?: WeixinArticleRenderContext,
  ): Promise<string>;
}

export class WeixinArticleRenderService {
  constructor(private renderer: WeixinArticleRenderer) {}

  public setUploadContentImages(enabled: boolean): void {
    this.renderer.setUploadContentImages(enabled);
  }

  public setGenerateContentImages(enabled: boolean): void {
    this.renderer.setGenerateContentImages?.(enabled);
  }

  public toTemplateData(
    contents: ScrapedContent[],
    articlePlan?: ArticlePlan,
  ): WeixinTemplate[] {
    if (articlePlan && shouldRenderPlanSections(articlePlan)) {
      return this.planSectionsToTemplateData(contents, articlePlan);
    }

    return this.orderByArticlePlan(contents, articlePlan).map((content) => ({
      id: content.id,
      title: content.title,
      content: content.content,
      url: content.url,
      publishDate: content.publishDate,
      metadata: content.metadata,
      keywords: Array.isArray(content.metadata.keywords)
        ? content.metadata.keywords
        : [],
      media: content.media,
    }));
  }

  private planSectionsToTemplateData(
    contents: ScrapedContent[],
    articlePlan: ArticlePlan,
  ): WeixinTemplate[] {
    const byId = new Map(contents.map((content) => [content.id, content]));
    return articlePlan.sections.map((section, index) => {
      const relatedContents = section.articleIds
        .map((id) => byId.get(id))
        .filter((content): content is ScrapedContent => Boolean(content));
      const primary = relatedContents[0] ?? contents[index] ?? contents[0];
      const content = [
        `章节目标（仅作编辑目标，不是事实来源）：${section.intent}`,
        `写作角度（仅作编辑目标，不是事实来源）：${section.angle}`,
        ...section.keyPoints.map((point) =>
          `待核对编辑要点（必须由来源支持后才能写入正文）：${point}`
        ),
        ...relatedContents.slice(0, 2).map((item) =>
          `可引用来源要点：${item.title} - ${truncateText(item.content, 520)}`
        ),
      ].filter(Boolean).join("<next_paragraph />");
      return {
        id: section.id,
        title: section.title,
        content,
        url: primary?.url ?? "",
        publishDate: primary?.publishDate ?? articlePlan.generatedAt,
        metadata: {
          ...(primary?.metadata ?? {}),
          articlePlanFormat: articlePlan.format,
          articlePlanSectionId: section.id,
          sourceArticleIds: section.articleIds,
          sourceUrls: relatedContents.map((item) => item.url),
          sourceExcerptText: relatedContents.map((item) =>
            sourceExcerptForGrounding(item)
          ).join("\n\n"),
          score: primary?.metadata?.score,
        },
        keywords: collectKeywords(relatedContents),
        media: relatedContents.flatMap((item) => item.media ?? []),
      };
    });
  }

  private orderByArticlePlan(
    contents: ScrapedContent[],
    articlePlan?: ArticlePlan,
  ): ScrapedContent[] {
    const plannedIds = articlePlan?.sections
      .flatMap((section) => section.articleIds)
      .filter((id, index, ids) => id && ids.indexOf(id) === index) ?? [];
    if (!plannedIds.length) return contents;

    const byId = new Map(contents.map((content) => [content.id, content]));
    const plannedContents = plannedIds
      .map((id) => byId.get(id))
      .filter((content): content is ScrapedContent => Boolean(content));

    return plannedContents.length ? plannedContents : contents;
  }

  public render(
    templateData: WeixinTemplate[],
    context?: WeixinArticleRenderContext,
  ): Promise<string> {
    return this.renderer.render(templateData, context);
  }
}

function shouldRenderPlanSections(articlePlan: ArticlePlan): boolean {
  return articlePlan.sections.length > 0;
}

function collectKeywords(contents: ScrapedContent[]): string[] {
  return [
    ...new Set(
      contents.flatMap((content) =>
        Array.isArray(content.metadata.keywords)
          ? content.metadata.keywords
          : []
      ),
    ),
  ];
}

function truncateText(text: string, maxLength: number): string {
  const normalized = text.replace(/<next_paragraph \/>/g, " ").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized;
}

function sourceExcerptForGrounding(content: ScrapedContent): string {
  const originalTitle = typeof content.metadata.originalTitle === "string"
    ? content.metadata.originalTitle
    : content.title;
  const originalContent = typeof content.metadata.originalContentExcerpt ===
      "string"
    ? content.metadata.originalContentExcerpt
    : content.content;
  const processed = `${content.title}\n${truncateText(content.content, 800)}`;
  const original = `${originalTitle}\n${truncateText(originalContent, 1200)}`;
  return original === processed
    ? original
    : `${original}\n\n编辑摘要（仅作辅助，不作为额外事实）：\n${processed}`;
}
