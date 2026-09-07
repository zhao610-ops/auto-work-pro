import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import type { LLMProvider } from "@src/core/ports/llm.ts";
import type { JsonObject } from "@src/core/ports/runtime-config-store.ts";
import type { ArticlePlan } from "@src/features/weixin-article/domain/article-plan.ts";
import type { EditorialTopicReport } from "@src/features/weixin-article/domain/editorial-topic.ts";
import type { EvidencePack } from "@src/features/weixin-article/domain/evidence.ts";
import { ARTICLE_LLM_TIMEOUT_MS } from "@src/features/weixin-article/services/article-llm-budget.ts";
import {
  ArticleQualityReview,
  QualityDimensionScores,
  QualityIssue,
  QualityIssueCategory,
  QualityIssueSeverity,
  QualityReviewAction,
} from "@src/features/weixin-article/domain/quality-review.ts";
import {
  getQualityReviewSystemPrompt,
  getQualityReviewUserPrompt,
} from "@src/prompts/quality-review.prompt.ts";
import type { PromptProfileName } from "@src/prompts/prompt-profile.ts";
import { createStructuredJsonCompletion } from "@src/utils/llm-structured-output.ts";
import { Logger } from "@zilla/logger";

const logger = new Logger("weixin-quality-review-service");

interface RawQualityReview {
  overallScore?: unknown;
  allowPublish?: unknown;
  recommendedAction?: unknown;
  summary?: unknown;
  dimensionScores?: unknown;
  issues?: unknown;
  repairSuggestions?: unknown;
}

export class WeixinArticleQualityReviewService {
  constructor(
    private readonly llm: LLMProvider,
    private readonly promptProfile?: PromptProfileName,
    private readonly accountBrand?: JsonObject,
  ) {}

  async reviewArticle(input: {
    title: string;
    html: string;
    articlePlan: ArticlePlan;
    topicReport: EditorialTopicReport;
    contents: ScrapedContent[];
    evidencePack?: EvidencePack;
  }): Promise<ArticleQualityReview> {
    try {
      const messages = [
        {
          role: "system" as const,
          content: getQualityReviewSystemPrompt(
            this.promptProfile,
            this.accountBrand,
          ),
        },
        {
          role: "user" as const,
          content: getQualityReviewUserPrompt(
            input,
            this.promptProfile,
            this.accountBrand,
          ),
        },
      ];
      const review = await createStructuredJsonCompletion<
        RawQualityReview,
        ArticleQualityReview
      >({
        label: "质量审稿",
        llm: this.llm,
        messages,
        chatOptions: {
          temperature: 0.2,
          max_tokens: 3200,
          timeoutMs: ARTICLE_LLM_TIMEOUT_MS.qualityReview,
          maxAttempts: 2,
          response_format: { type: "json_object" },
        },
        maxAttempts: 2,
        normalize: (raw) => normalizeQualityReview(raw, false),
      });
      return applyLocalComplianceReview(review, input, this.accountBrand);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[质量审稿] AI 审稿失败，使用本地规则兜底: ${message}`);
      return applyLocalComplianceReview(
        createFallbackQualityReview(input.html, message),
        input,
        this.accountBrand,
      );
    }
  }
}

interface ComplianceRule {
  id: string;
  pattern: RegExp;
  message: string;
}

const COMPLIANCE_RULES: ComplianceRule[] = [
  {
    id: "controlled-substance-trade",
    pattern:
      /(?:购买|出售|代购|供应|批发|交易).{0,16}(?:毒品|冰毒|海洛因|摇头丸)|(?:毒品|冰毒|海洛因|摇头丸).{0,16}(?:购买|出售|代购|供应|批发|交易)/iu,
    message: "正文包含受管制物品的交易或引流信息。",
  },
  {
    id: "gambling-promotion",
    pattern:
      /(?:博彩|赌博|赌场|下注|投注).{0,20}(?:开户链接|送彩金|稳赚|代理|投注入口|下注入口)/iu,
    message: "正文包含赌博推广、开户链接或投注引流信息。",
  },
  {
    id: "sexual-service-promotion",
    pattern:
      /(?:招嫖|卖淫|嫖娼|色情服务|成人视频).{0,20}(?:联系|加微信|购买|下载|入口|网址)/iu,
    message: "正文包含色情服务或成人内容推广信息。",
  },
  {
    id: "weapon-instructions",
    pattern:
      /(?:炸弹|爆炸物|枪支|武器).{0,24}(?:制作教程|制作方法|详细配方|购买渠道|交易渠道)/iu,
    message: "正文包含武器或爆炸物的制作、购买指引。",
  },
  {
    id: "fraud-instructions",
    pattern:
      /(?:刷单|跑分|洗钱|诈骗).{0,20}(?:教程|方法|渠道|平台|招募|兼职|获利)/iu,
    message: "正文包含欺诈、洗钱或黑灰产操作指引。",
  },
  {
    id: "illegal-financial-promotion",
    pattern:
      /(?:稳赚不赔|保本高收益|零风险高收益|内幕消息).{0,24}(?:立即|加入|购买|联系|开户|点击|投资|理财)/iu,
    message: "正文包含违规金融承诺或投资引流信息。",
  },
];

export function scanLocalComplianceIssues(
  input: { title: string; html: string },
  accountBrand?: JsonObject,
): QualityIssue[] {
  const text = normalizeComplianceText(`${input.title}\n${input.html}`);
  const issues = COMPLIANCE_RULES.flatMap((rule) =>
    rule.pattern.test(text)
      ? [createComplianceIssue(rule.id, rule.message)]
      : []
  );
  const forbiddenTopics = Array.isArray(accountBrand?.forbiddenTopics)
    ? accountBrand.forbiddenTopics.filter((item): item is string =>
      typeof item === "string" && item.trim().length >= 2
    )
    : [];
  for (const topic of forbiddenTopics) {
    if (!text.toLocaleLowerCase().includes(topic.trim().toLocaleLowerCase())) {
      continue;
    }
    issues.push(createComplianceIssue(
      `forbidden-topic-${issues.length + 1}`,
      `正文命中账号禁区主题：${topic.trim()}。`,
    ));
  }
  return issues.slice(0, 8);
}

function applyLocalComplianceReview(
  review: ArticleQualityReview,
  input: { title: string; html: string },
  accountBrand?: JsonObject,
): ArticleQualityReview {
  const complianceIssues = scanLocalComplianceIssues(input, accountBrand);
  if (!complianceIssues.length) return review;

  const issues = [...complianceIssues, ...review.issues]
    .filter((issue, index, all) =>
      all.findIndex((candidate) => candidate.id === issue.id) === index
    )
    .slice(0, 8);
  return {
    ...review,
    overallScore: Math.min(review.overallScore, 39),
    allowPublish: false,
    recommendedAction: "block",
    summary:
      `本地合规检查发现 ${complianceIssues.length} 个阻断问题。${review.summary}`,
    dimensionScores: {
      ...review.dimensionScores,
      riskHandling: Math.min(review.dimensionScores.riskHandling, 20),
    },
    issues,
    repairSuggestions: [
      ...complianceIssues.map((issue) => issue.suggestion),
      ...review.repairSuggestions,
    ].slice(0, 8),
  };
}

function createComplianceIssue(id: string, message: string): QualityIssue {
  return {
    id: `compliance-${id}`,
    category: "risk",
    severity: "blocker",
    message,
    suggestion:
      "删除相关推广、交易、操作指引或禁区主题内容，重新审稿后再发布。",
    autoFixable: false,
  };
}

function normalizeComplianceText(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeQualityReview(
  raw: RawQualityReview,
  fallback: boolean,
  error?: string,
): ArticleQualityReview {
  const dimensionScores = normalizeDimensionScores(raw.dimensionScores);
  let issues = normalizeIssues(raw.issues);
  const overallScore = clampScore(
    raw.overallScore,
    averageDimensionScore(dimensionScores),
  );
  let recommendedAction = normalizeAction(
    raw.recommendedAction,
    overallScore,
    issues,
  );
  const allowPublish = typeof raw.allowPublish === "boolean"
    ? raw.allowPublish
    : recommendedAction === "publish";
  if (
    !issues.length &&
    (recommendedAction === "revise" || recommendedAction === "block" ||
      !allowPublish || overallScore < 80)
  ) {
    issues = synthesizeQualityIssues(
      raw,
      dimensionScores,
      overallScore,
      recommendedAction,
    );
    recommendedAction = normalizeAction(
      recommendedAction,
      overallScore,
      issues,
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    fallback,
    error,
    overallScore,
    allowPublish,
    recommendedAction,
    summary: stringValue(raw.summary) ?? summarizeReview(overallScore, issues),
    dimensionScores,
    issues,
    repairSuggestions: stringArray(raw.repairSuggestions).slice(0, 8),
  };
}

function synthesizeQualityIssues(
  raw: RawQualityReview,
  scores: QualityDimensionScores,
  overallScore: number,
  action: QualityReviewAction,
): QualityIssue[] {
  const category = weakestDimensionCategory(scores);
  const severity: QualityIssueSeverity = action === "block" || overallScore < 50
    ? "blocker"
    : overallScore < 70
    ? "high"
    : "medium";
  const summary = stringValue(raw.summary);
  const suggestion = stringArray(raw.repairSuggestions)[0] ??
    "根据审稿摘要收敛正文中未被来源支持或不够清晰的表述。";
  return [{
    id: "issue-synthesized-1",
    category,
    severity,
    message: summary ??
      `审稿要求继续修订，最低维度为 ${category}，但模型未返回结构化问题。`,
    suggestion,
    autoFixable: severity !== "blocker",
  }];
}

function weakestDimensionCategory(
  scores: QualityDimensionScores,
): QualityIssueCategory {
  const entries: Array<[QualityIssueCategory, number]> = [
    ["fact", scores.factConsistency],
    ["title", scores.titleQuality],
    ["structure", scores.structureQuality],
    ["tone", scores.expressionQuality],
    ["html", scores.htmlCompliance],
    ["image", scores.imageRelevance],
    ["risk", scores.riskHandling],
  ];
  entries.sort((a, b) => a[1] - b[1]);
  return entries[0]?.[0] ?? "structure";
}

function createFallbackQualityReview(
  html: string,
  error: string,
): ArticleQualityReview {
  const issues = scanHtmlIssues(html);
  const htmlCompliance = Math.max(40, 95 - issues.length * 15);
  const dimensionScores: QualityDimensionScores = {
    factConsistency: 75,
    titleQuality: 75,
    structureQuality: 75,
    expressionQuality: 75,
    htmlCompliance,
    imageRelevance: 70,
    riskHandling: 70,
  };
  const overallScore = Math.max(
    50,
    averageDimensionScore(dimensionScores) - issues.length * 3,
  );
  const recommendedAction = normalizeAction(undefined, overallScore, issues);

  return {
    generatedAt: new Date().toISOString(),
    fallback: true,
    error,
    overallScore,
    allowPublish: recommendedAction === "publish",
    recommendedAction,
    summary: issues.length
      ? "AI 审稿失败，已使用本地 HTML 合规规则兜底，发现需要检查的问题。"
      : "AI 审稿失败，已使用本地规则兜底，未发现明显 HTML 合规问题。",
    dimensionScores,
    issues,
    repairSuggestions: issues.map((issue) => issue.suggestion),
  };
}

function scanHtmlIssues(html: string): QualityIssue[] {
  const rules: Array<{
    pattern: RegExp;
    message: string;
    suggestion: string;
  }> = [
    {
      pattern: /<\/?div\b/i,
      message: "正文包含 div 标签，微信公众号粘贴兼容性较差。",
      suggestion: "将 div 转为 section，并使用内联 style。",
    },
    {
      pattern: /<script\b/i,
      message: "正文包含 script 标签。",
      suggestion: "移除 script，公众号正文不允许脚本。",
    },
    {
      pattern: /<style\b/i,
      message: "正文包含 style 标签。",
      suggestion: "移除 style 标签，把必要样式写入元素 style 属性。",
    },
    {
      pattern: /<svg\b/i,
      message: "正文包含 svg 标签。",
      suggestion: "使用图片或普通 HTML 替代 svg。",
    },
    {
      pattern: /\s(?:class|id|on[a-z]+)=/i,
      message: "正文包含 class、id 或事件属性。",
      suggestion: "移除 class/id/on* 属性，仅保留公众号兼容属性。",
    },
  ];

  return rules.flatMap((rule, index) =>
    rule.pattern.test(html)
      ? [{
        id: `html-${index + 1}`,
        category: "html" as const,
        severity: "high" as const,
        message: rule.message,
        suggestion: rule.suggestion,
        autoFixable: true,
      }]
      : []
  );
}

function normalizeDimensionScores(value: unknown): QualityDimensionScores {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    factConsistency: clampScore(record.factConsistency, 75),
    titleQuality: clampScore(record.titleQuality, 75),
    structureQuality: clampScore(record.structureQuality, 75),
    expressionQuality: clampScore(record.expressionQuality, 75),
    htmlCompliance: clampScore(record.htmlCompliance, 90),
    imageRelevance: clampScore(record.imageRelevance, 70),
    riskHandling: clampScore(record.riskHandling, 70),
  };
}

function normalizeIssues(value: unknown): QualityIssue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const message = stringValue(record.message);
    const suggestion = stringValue(record.suggestion);
    if (!message || !suggestion) return [];
    return [{
      id: stringValue(record.id) ?? `issue-${index + 1}`,
      category: normalizeCategory(record.category),
      severity: normalizeSeverity(record.severity),
      message,
      evidence: stringValue(record.evidence),
      suggestion,
      autoFixable: typeof record.autoFixable === "boolean"
        ? record.autoFixable
        : false,
    }];
  }).slice(0, 8);
}

function normalizeAction(
  value: unknown,
  score: number,
  issues: QualityIssue[],
): QualityReviewAction {
  if (
    value === "publish" || value === "dry-run-only" || value === "revise" ||
    value === "block"
  ) {
    return value;
  }
  if (issues.some((issue) => issue.severity === "blocker")) return "block";
  if (
    issues.some((issue) =>
      issue.category === "fact" && issue.severity === "high"
    )
  ) {
    return "block";
  }
  if (score >= 80) return "publish";
  if (score >= 60) return "dry-run-only";
  if (score >= 40) return "revise";
  return "block";
}

function summarizeReview(score: number, issues: QualityIssue[]): string {
  if (!issues.length) return `质量分 ${score}，未发现明显阻断问题。`;
  return `质量分 ${score}，发现 ${issues.length} 个需要关注的问题。`;
}

function averageDimensionScore(scores: QualityDimensionScores): number {
  const values = Object.values(scores);
  return Math.round(
    values.reduce((sum, value) => sum + value, 0) / values.length,
  );
}

function normalizeCategory(value: unknown): QualityIssueCategory {
  if (
    value === "fact" || value === "title" || value === "structure" ||
    value === "tone" || value === "html" || value === "image" ||
    value === "risk"
  ) {
    return value;
  }
  return "structure";
}

function normalizeSeverity(value: unknown): QualityIssueSeverity {
  if (
    value === "low" || value === "medium" || value === "high" ||
    value === "blocker"
  ) {
    return value;
  }
  return "medium";
}

function clampScore(value: unknown, fallback: number): number {
  const number = typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const text = stringValue(item);
    return text ? [text] : [];
  });
}
