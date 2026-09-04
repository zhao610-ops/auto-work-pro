import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import type {
  EditorialMemoryContext,
  EditorialTopicFeedback,
} from "@src/core/ports/editorial-memory-store.ts";
import type { LLMProvider } from "@src/core/ports/llm.ts";
import type { JsonObject } from "@src/core/ports/runtime-config-store.ts";
import {
  EditorialTopicReport,
  TopicCluster,
  TopicRecommendation,
  TopicScore,
} from "@src/features/weixin-article/domain/editorial-topic.ts";
import {
  getEditorialTopicSystemPrompt,
  getEditorialTopicUserPrompt,
} from "@src/prompts/editorial-topic.prompt.ts";
import type { PromptProfileName } from "@src/prompts/prompt-profile.ts";
import { createStructuredJsonCompletion } from "@src/utils/llm-structured-output.ts";
import { Logger } from "@zilla/logger";

const logger = new Logger("weixin-editorial-topic-service");

interface RawTopicReport {
  clusters?: unknown;
  scores?: unknown;
}

export class WeixinArticleEditorialTopicService {
  constructor(
    private readonly llm: LLMProvider,
    private readonly promptProfile?: PromptProfileName,
    private readonly maxTopics = 8,
    private readonly accountBrand?: JsonObject,
  ) {}

  async createTopicReport(
    contents: ScrapedContent[],
    memory?: EditorialMemoryContext,
  ): Promise<EditorialTopicReport> {
    if (!contents.length) {
      return {
        generatedAt: new Date().toISOString(),
        fallback: false,
        clusters: [],
        scores: [],
      };
    }

    try {
      const messages = [
        {
          role: "system" as const,
          content: getEditorialTopicSystemPrompt(
            this.promptProfile,
            this.accountBrand,
          ),
        },
        {
          role: "user" as const,
          content: getEditorialTopicUserPrompt(
            contents,
            this.maxTopics,
            memory,
            this.accountBrand,
          ),
        },
      ];
      return await createStructuredJsonCompletion<
        RawTopicReport,
        EditorialTopicReport
      >({
        label: "选题聚类",
        llm: this.llm,
        messages,
        chatOptions: {
          temperature: 0.35,
          response_format: { type: "json_object" },
        },
        maxAttempts: 3,
        normalize: (raw) =>
          normalizeTopicReport(
            raw,
            contents,
            false,
            undefined,
            memory,
          ),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[选题聚类] AI 生成失败，使用本地兜底: ${message}`);
      return createFallbackTopicReport(
        contents,
        this.maxTopics,
        message,
        memory,
      );
    }
  }
}

export function normalizeTopicReport(
  raw: RawTopicReport,
  contents: ScrapedContent[],
  fallback: boolean,
  error?: string,
  memory?: EditorialMemoryContext,
): EditorialTopicReport {
  const contentById = new Map(contents.map((content) => [content.id, content]));
  const clusters = Array.isArray(raw.clusters)
    ? raw.clusters.flatMap((item, index) => {
      const cluster = normalizeCluster(item, index, contentById);
      return cluster ? [cluster] : [];
    })
    : [];
  const clusterIds = new Set(clusters.map((cluster) => cluster.id));
  const scores = Array.isArray(raw.scores)
    ? raw.scores.flatMap((item) => {
      const score = normalizeScore(item, clusterIds);
      return score ? [score] : [];
    })
    : [];
  const scoredIds = new Set(scores.map((score) => score.topicId));

  for (const cluster of clusters) {
    if (!scoredIds.has(cluster.id)) {
      scores.push(createDefaultScore(cluster));
    }
  }

  if (!clusters.length) {
    throw new Error("主题聚类结果为空");
  }

  applyGroundingGuard(clusters, scores, contentById);
  applyTopicFeedbackLearning(clusters, scores, memory);
  scores.sort((a, b) => b.finalScore - a.finalScore);

  return {
    generatedAt: new Date().toISOString(),
    fallback,
    error,
    clusters,
    scores,
  };
}

function applyTopicFeedbackLearning(
  clusters: TopicCluster[],
  scores: TopicScore[],
  memory?: EditorialMemoryContext,
): void {
  const feedback = memory?.recentTopicFeedback ?? [];
  if (!feedback.length) return;

  const clusterById = new Map(clusters.map((cluster) => [cluster.id, cluster]));
  for (const score of scores) {
    const cluster = clusterById.get(score.topicId);
    if (!cluster) continue;

    const matches = feedback
      .map((item) => ({
        item,
        strength: getTopicFeedbackMatchStrength(item, cluster),
      }))
      .filter((match) => match.strength > 0)
      .sort((a, b) => b.strength - a.strength);
    if (!matches.length) continue;

    const skip = matches.find((match) => match.item.action === "skip");
    if (skip) {
      applySkipFeedback(score, skip.item);
      continue;
    }

    const lead = matches.find((match) => match.item.action === "lead");
    if (lead) {
      applyLeadFeedback(score, lead.item);
      continue;
    }

    const adopt = matches.find((match) => match.item.action === "adopt");
    if (adopt) {
      applyAdoptFeedback(score, adopt.item);
    }
  }
}

function getTopicFeedbackMatchStrength(
  feedback: EditorialTopicFeedback,
  cluster: TopicCluster,
): number {
  if (feedback.topicId === cluster.id) return 100;

  const feedbackTitle = normalizeText(feedback.title ?? "");
  const clusterText = normalizeText(getClusterLearningText(cluster));
  if (feedbackTitle.length >= 6 && clusterText.includes(feedbackTitle)) {
    return 90;
  }

  const feedbackTokens = tokenizeLearningText(
    [feedback.title, feedback.reason, feedback.topicId].filter(Boolean).join(
      " ",
    ),
  );
  if (!feedbackTokens.size) return 0;

  const clusterTokens = tokenizeLearningText(getClusterLearningText(cluster));
  let overlap = 0;
  for (const token of feedbackTokens) {
    if (clusterTokens.has(token)) overlap += 1;
  }

  if (overlap >= 3) return 60 + overlap;
  if (overlap >= 2 && feedbackTokens.size <= 4) return 50 + overlap;
  return 0;
}

function applySkipFeedback(
  score: TopicScore,
  feedback: EditorialTopicFeedback,
): void {
  score.saturation = Math.max(score.saturation, 85);
  score.risk = Math.max(score.risk, 70);
  score.finalScore = Math.min(score.finalScore, 35);
  score.recommendedUse = "skip";
  score.reason = appendReason(
    score.reason,
    `人工反馈曾要求跳过相似选题「${
      formatFeedbackLabel(feedback)
    }」，本次自动降级。`,
  );
}

function applyLeadFeedback(
  score: TopicScore,
  feedback: EditorialTopicFeedback,
): void {
  if (score.risk >= 75 || score.evidence < 45) {
    score.reason = appendReason(
      score.reason,
      `人工反馈偏好相似主线「${
        formatFeedbackLabel(feedback)
      }」，但当前证据或风险不足以强推。`,
    );
    return;
  }
  score.relevance = Math.max(score.relevance, 75);
  score.actionability = Math.max(score.actionability, 65);
  score.finalScore = Math.max(score.finalScore, 82);
  score.recommendedUse = "lead";
  score.reason = appendReason(
    score.reason,
    `匹配账号历史“锁主线”反馈「${
      formatFeedbackLabel(feedback)
    }」，优先作为主线候选。`,
  );
}

function applyAdoptFeedback(
  score: TopicScore,
  feedback: EditorialTopicFeedback,
): void {
  if (score.recommendedUse === "skip" || score.risk >= 80) return;
  score.finalScore = Math.min(90, Math.max(score.finalScore + 8, 68));
  if (score.recommendedUse === "watch" && score.finalScore >= 68) {
    score.recommendedUse = "brief";
  }
  score.reason = appendReason(
    score.reason,
    `匹配账号历史“采用”反馈「${
      formatFeedbackLabel(feedback)
    }」，适度提高优先级。`,
  );
}

function getClusterLearningText(cluster: TopicCluster): string {
  return [
    cluster.id,
    cluster.title,
    cluster.summary,
    ...cluster.keywords,
  ].join(" ");
}

function appendReason(reason: string, addition: string): string {
  const normalized = reason.trim();
  return normalized.endsWith("。")
    ? `${normalized}${addition}`
    : `${normalized}。${addition}`;
}

function formatFeedbackLabel(feedback: EditorialTopicFeedback): string {
  return feedback.title || feedback.topicId;
}

function applyGroundingGuard(
  clusters: TopicCluster[],
  scores: TopicScore[],
  contentById: Map<string, ScrapedContent>,
): void {
  const clusterById = new Map(clusters.map((cluster) => [cluster.id, cluster]));
  for (const score of scores) {
    const cluster = clusterById.get(score.topicId);
    if (!cluster) continue;
    const unsupportedClaims = findUnsupportedHighRiskClaims(
      cluster,
      contentById,
    );
    if (!unsupportedClaims.length) continue;

    cluster.confidence = Math.min(cluster.confidence, 45);
    score.evidence = Math.min(score.evidence, 35);
    score.risk = Math.max(score.risk, 85);
    score.finalScore = Math.min(score.finalScore, 45);
    score.recommendedUse = "watch";
    score.reason = `${score.reason} 高风险事实缺少关联来源直接支撑: ${
      unsupportedClaims.join("、")
    }。`;
  }
}

function findUnsupportedHighRiskClaims(
  cluster: TopicCluster,
  contentById: Map<string, ScrapedContent>,
): string[] {
  const claimText = normalizeText([
    cluster.title,
    cluster.summary,
    ...cluster.keywords,
  ].join("\n"));
  const sourceText = normalizeText(
    cluster.articleIds
      .map((id) => contentById.get(id))
      .filter((content): content is ScrapedContent => Boolean(content))
      .map((content) => `${content.title}\n${content.content}`)
      .join("\n"),
  );

  return highRiskClaimRules.flatMap((rule) => {
    if (!rule.claim.test(claimText)) return [];
    rule.claim.lastIndex = 0;
    const supported = rule.source.test(sourceText);
    rule.source.lastIndex = 0;
    return supported ? [] : [rule.label];
  });
}

const highRiskClaimRules: Array<{
  label: string;
  claim: RegExp;
  source: RegExp;
}> = [
  {
    label: "付费/定价",
    claim:
      /付费|商业化|可商用|paid|pricing|计费|定价|rate\s*limits?|调用限制|订阅制|tiers?/i,
    source:
      /付费|商业化|可商用|paid|pricing|计费|定价|rate\s*limits?|调用限制|订阅制|tiers?/i,
  },
  {
    label: "API/接口开放",
    claim: /\bapi\b|接口|开放|接入|调用/i,
    source: /\bapi\b|接口|开放|接入|调用/i,
  },
  {
    label: "替代/废弃关系",
    claim: /替代|取代|deprecated|legacy|过渡期|正式切换|成为.*入口/i,
    source: /替代|取代|deprecated|legacy|过渡期|正式切换|成为.*入口/i,
  },
  {
    label: "论文/验证背书",
    claim: /nature|论文|paper|真实场景|背书|验证/i,
    source: /nature|论文|paper|真实场景|背书|验证/i,
  },
  {
    label: "waitlist/排队",
    claim: /waitlist|排队|候补|报名/i,
    source: /waitlist|排队|候补|报名/i,
  },
  {
    label: "多 Agent 机制",
    claim: /六\s*agent|6\s*agent|多\s*agent|博弈机制|假设生成.*验证.*迭代/i,
    source: /六\s*agent|6\s*agent|多\s*agent|博弈机制|假设生成.*验证.*迭代/i,
  },
];

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ");
}

const learningStopwords = new Set([
  "ai",
  "人工",
  "智能",
  "人工智能",
  "模型",
  "发布",
  "更新",
  "今日",
  "快讯",
  "行业",
  "观察",
  "主题",
  "文章",
  "工具",
  "产品",
]);

function tokenizeLearningText(value: string): Set<string> {
  const normalized = normalizeText(value);
  const tokens = new Set<string>();

  for (const match of normalized.matchAll(/[a-z0-9][a-z0-9._-]{2,}/g)) {
    const token = match[0].replace(/^[-_.]+|[-_.]+$/g, "");
    if (token && !learningStopwords.has(token)) tokens.add(token);
  }

  for (const match of value.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
    const segment = match[0];
    if (segment.length <= 8 && !learningStopwords.has(segment)) {
      tokens.add(segment);
    }
    for (let size = 2; size <= 3; size += 1) {
      for (let index = 0; index <= segment.length - size; index += 1) {
        const token = segment.slice(index, index + size);
        if (!learningStopwords.has(token)) tokens.add(token);
      }
    }
  }

  return tokens;
}

function normalizeCluster(
  value: unknown,
  index: number,
  contentById: Map<string, ScrapedContent>,
): TopicCluster | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const articleIds = stringArray(record.articleIds)
    .filter((id) => contentById.has(id));
  if (!articleIds.length) return null;

  const primaryArticleId = stringValue(record.primaryArticleId);
  const primary = primaryArticleId && articleIds.includes(primaryArticleId)
    ? primaryArticleId
    : articleIds[0];
  const primaryContent = contentById.get(primary);

  return {
    id: stringValue(record.id) ?? `topic-${index + 1}`,
    title: stringValue(record.title) ?? primaryContent?.title ?? "未命名主题",
    summary: stringValue(record.summary) ??
      primaryContent?.content.slice(0, 160) ?? "",
    keywords: stringArray(record.keywords).slice(0, 8),
    articleIds,
    primaryArticleId: primary,
    sourceCount: integerValue(record.sourceCount) ?? articleIds.length,
    freshness: clampScore(record.freshness, 60),
    confidence: clampScore(record.confidence, 70),
  };
}

function normalizeScore(
  value: unknown,
  clusterIds: Set<string>,
): TopicScore | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const topicId = stringValue(record.topicId);
  if (!topicId || !clusterIds.has(topicId)) return null;
  return {
    topicId,
    novelty: clampScore(record.novelty, 60),
    relevance: clampScore(record.relevance, 60),
    impact: clampScore(record.impact, 60),
    evidence: clampScore(record.evidence, 60),
    actionability: clampScore(record.actionability, 50),
    saturation: clampScore(record.saturation, 30),
    risk: clampScore(record.risk, 20),
    finalScore: clampScore(record.finalScore, 60),
    reason: stringValue(record.reason) ?? "主题具备基础编辑价值。",
    recommendedUse: readRecommendation(record.recommendedUse),
  };
}

function createFallbackTopicReport(
  contents: ScrapedContent[],
  maxTopics: number,
  error: string,
  memory?: EditorialMemoryContext,
): EditorialTopicReport {
  const clusters = prioritizeFallbackTopicContents(contents)
    .slice(0, maxTopics)
    .map((content, index) => ({
      id: `topic-${index + 1}`,
      title: content.title || `候选主题 ${index + 1}`,
      summary: content.content.slice(0, 180),
      keywords: readMetadataKeywords(content.metadata),
      articleIds: [content.id],
      primaryArticleId: content.id,
      sourceCount: 1,
      freshness: 50,
      confidence: 45,
    }));
  const scores = clusters.map(createDefaultScore);
  applyTopicFeedbackLearning(clusters, scores, memory);
  scores.sort((a, b) => b.finalScore - a.finalScore);

  return {
    generatedAt: new Date().toISOString(),
    fallback: true,
    error,
    clusters,
    scores,
  };
}

function prioritizeFallbackTopicContents(
  contents: ScrapedContent[],
): ScrapedContent[] {
  return [...contents].sort((left, right) =>
    fallbackTopicPriority(right, contents.indexOf(right)) -
    fallbackTopicPriority(left, contents.indexOf(left))
  );
}

function fallbackTopicPriority(
  content: ScrapedContent,
  originalIndex: number,
): number {
  let score = 100 - Math.min(originalIndex, 50) * 0.1;
  if (booleanMetadata(content.metadata, "requiresHydration")) score += 18;
  if (booleanMetadata(content.metadata, "extractedFromListPage")) score += 10;
  if (isLikelyListPageContent(content)) score -= 80;
  if ((content.title || "").trim().length < 8) score -= 12;
  if (
    content.content.trim().length < 120 &&
    !booleanMetadata(content.metadata, "requiresHydration")
  ) {
    score -= 16;
  }
  return score;
}

function isLikelyListPageContent(content: ScrapedContent): boolean {
  if (booleanMetadata(content.metadata, "requiresHydration")) return false;
  const title = content.title.trim().toLowerCase();
  const genericTitle = /^(news|blog|updates?|openai news|anthropic news)$/i
    .test(title);
  const markdownLinkCount = (content.content.match(/\]\(https?:\/\//g) ?? [])
    .length;
  const imageCount = (content.content.match(/!\[[^\]]*]\(https?:\/\//g) ?? [])
    .length;
  let listPath = false;
  try {
    const url = new URL(content.url);
    listPath = /\/(news|blog|updates?|research)\/?$/i.test(url.pathname);
  } catch {
    listPath = false;
  }
  return (genericTitle || listPath) &&
    (markdownLinkCount >= 4 || imageCount >= 3);
}

function createDefaultScore(cluster: TopicCluster): TopicScore {
  const sourceBonus = Math.min(cluster.sourceCount * 4, 16);
  const confidence = Math.round((cluster.confidence + cluster.freshness) / 2);
  const finalScore = clampScore(confidence + sourceBonus, 55);
  return {
    topicId: cluster.id,
    novelty: cluster.freshness,
    relevance: 60,
    impact: 55,
    evidence: cluster.confidence,
    actionability: 50,
    saturation: 35,
    risk: 25,
    finalScore,
    reason: "本地兜底评分：基于主题新鲜度、置信度和来源数量估算。",
    recommendedUse: finalScore >= 75
      ? "lead"
      : finalScore >= 55
      ? "brief"
      : "watch",
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string =>
      typeof item === "string" && item.trim().length > 0
    ).map((item) => item.trim())
    : [];
}

function integerValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : undefined;
}

function clampScore(value: unknown, fallback: number): number {
  const number = typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
  return Math.max(0, Math.min(100, Math.round(number * 10) / 10));
}

function readRecommendation(value: unknown): TopicRecommendation {
  return value === "lead" || value === "brief" || value === "skip" ||
      value === "watch"
    ? value
    : "watch";
}

function readMetadataKeywords(metadata: Record<string, unknown>): string[] {
  const value = metadata.keywords;
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .slice(0, 6);
  }
  return [];
}

function booleanMetadata(
  metadata: Record<string, unknown>,
  key: string,
): boolean {
  return metadata[key] === true;
}
