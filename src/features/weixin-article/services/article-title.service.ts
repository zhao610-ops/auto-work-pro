import { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import type { ArticlePlan } from "@src/features/weixin-article/domain/article-plan.ts";
import type { EditorialDecision } from "@src/features/weixin-article/domain/editorial-decision.ts";

export interface SummaryTitleContext {
  articlePlan?: ArticlePlan;
  editorialDecision?: EditorialDecision;
}

export class WeixinArticleTitleService {
  public generateSummaryTitle(
    contents: ScrapedContent[],
    context: SummaryTitleContext = {},
  ): string {
    return buildSummaryTitle(contents, context);
  }
}

export function getCoverTitle(title: string): string {
  const titlePart = title.split(" | ").at(1) ?? title;
  const cleanedTitle = titlePart
    .replace(/^\d{4}[/-]\d{1,2}[/-]\d{1,2}\s*AI速递\s*\|?\s*/i, "")
    .replace(/^AI速递\s*\|?\s*/i, "")
    .trim();

  return (cleanedTitle || "AI趋势速递").slice(0, 30);
}

export function formatSummaryTitle(title: string): string {
  return toWeixinTitle(title.trim() || "今日 AI 趋势观察");
}

export function buildSummaryTitle(
  contents: ScrapedContent[],
  context: SummaryTitleContext = {},
): string {
  const candidates = [
    ...(context.articlePlan?.titleDirections ?? []).map((item) => item.title),
    context.articlePlan?.thesis,
    context.editorialDecision?.leadTopicTitle,
    buildFallbackSummaryTitle(contents),
  ];

  for (const candidate of candidates) {
    const title = normalizeTitleCandidate(candidate);
    if (title) {
      return toWeixinTitle(title);
    }
  }

  return "今日 AI 趋势观察";
}

export function buildFallbackSummaryTitle(contents: ScrapedContent[]): string {
  const firstTitle = contents.find((content) => content.title?.trim())?.title;
  if (!firstTitle) {
    return "今日 AI 趋势观察";
  }

  return normalizeTitleCandidate(firstTitle).slice(0, 40) ||
    "今日 AI 趋势观察";
}

function normalizeTitleCandidate(value?: string): string {
  if (!value) return "";
  const title = value
    .replace(/^["“”'「」『』]+|["“”'「」『』]+$/g, "")
    .replace(/^\d{4}[/-]\d{1,2}[/-]\d{1,2}\s*/i, "")
    .replace(/^\d{1,2}[/-]\d{1,2}[/-]\d{4}\s*/i, "")
    .replace(/^AI\s*速递\s*[｜|:：-]?\s*/i, "")
    .replace(/^今日\s*AI\s*(速递|快报)\s*[｜|:：-]?\s*/i, "")
    .replace(/[｜|]\s*(来源|Source|via).*/i, "")
    .replace(
      /\s*[-—–]\s*(36氪|量子位|机器之心|虎嗅|雷锋网|TechCrunch|The Verge|Wired)$/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (
    !title ||
    /^AI\s*(趋势)?速递$/i.test(title) ||
    isLowQualityTitle(title)
  ) {
    return "";
  }
  return title;
}

function isLowQualityTitle(title: string): boolean {
  return lowQualityTitlePatterns.some((pattern) => pattern.test(title));
}

const lowQualityTitlePatterns = [
  /^补充证据不足/u,
  /^证据不足/u,
  /^本期只围绕/u,
  /但更强的还在后面/u,
  /史上首次/u,
  /改写历史/u,
  /夺回.*王座/u,
  /杀回来了/u,
  /炸裂|震撼|重磅/u,
];

function toWeixinTitle(title: string): string {
  const normalized = normalizeTitleCandidate(title) || "今日 AI 趋势观察";
  if ([...normalized].length <= 64) {
    return normalized;
  }

  const hardCut = [...normalized].slice(0, 64).join("").trim();
  const punctuationCut =
    hardCut.match(/^(.{24,63})[，,：:；;、-]\s*[^，,：:；;、-]*$/u)
      ? hardCut.replace(/[，,：:；;、-]\s*[^，,：:；;、-]*$/u, "")
      : hardCut;

  return punctuationCut
    .replace(/[A-Za-z0-9_.-]{2,}$/u, "")
    .replace(/[，,：:；;、-]\s*$/u, "")
    .trim() || hardCut;
}
