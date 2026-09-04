import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import type { LLMProvider } from "@src/core/ports/llm.ts";
import type { JsonObject } from "@src/core/ports/runtime-config-store.ts";
import {
  ArticleBodyImagePlan,
  ArticleCoverDirection,
  ArticlePlan,
  ArticlePlanFormat,
  ArticlePlanSection,
  ArticleRiskNote,
  ArticleTitleDirection,
} from "@src/features/weixin-article/domain/article-plan.ts";
import type { EditorialDecision } from "@src/features/weixin-article/domain/editorial-decision.ts";
import type { EvidencePack } from "@src/features/weixin-article/domain/evidence.ts";
import type { EditorialTopicReport } from "@src/features/weixin-article/domain/editorial-topic.ts";
import {
  getArticlePlanSystemPrompt,
  getArticlePlanUserPrompt,
  isArticlePlanFormat,
} from "@src/prompts/article-plan.prompt.ts";
import type { PromptProfileName } from "@src/prompts/prompt-profile.ts";
import { createStructuredJsonCompletion } from "@src/utils/llm-structured-output.ts";
import { Logger } from "@zilla/logger";

const logger = new Logger("weixin-article-plan-service");

interface RawArticlePlan {
  format?: unknown;
  thesis?: unknown;
  targetReader?: unknown;
  summary?: unknown;
  sections?: unknown;
  titleDirections?: unknown;
  coverDirection?: unknown;
  bodyImagePlan?: unknown;
  riskNotes?: unknown;
}

export class WeixinArticlePlanService {
  constructor(
    private readonly llm: LLMProvider,
    private readonly promptProfile?: PromptProfileName,
    private readonly accountBrand?: JsonObject,
  ) {}

  async createArticlePlan(
    topicReport: EditorialTopicReport,
    contents: ScrapedContent[],
    decision?: EditorialDecision,
    evidencePack?: EvidencePack,
  ): Promise<ArticlePlan> {
    if (!contents.length) {
      return createFallbackArticlePlan(
        topicReport,
        contents,
        undefined,
        decision,
        undefined,
        this.accountBrand,
      );
    }

    try {
      const messages = [
        {
          role: "system" as const,
          content: getArticlePlanSystemPrompt(
            this.promptProfile,
            this.accountBrand,
          ),
        },
        {
          role: "user" as const,
          content: getArticlePlanUserPrompt(
            topicReport,
            contents,
            this.promptProfile,
            decision,
            evidencePack,
            this.accountBrand,
          ),
        },
      ];
      return await createStructuredJsonCompletion<RawArticlePlan, ArticlePlan>({
        label: "文章计划",
        llm: this.llm,
        messages,
        chatOptions: {
          temperature: 0.35,
          max_tokens: 3600,
          response_format: { type: "json_object" },
        },
        maxAttempts: 3,
        normalize: (raw) =>
          normalizeArticlePlan(
            raw,
            topicReport,
            contents,
            false,
            undefined,
            decision,
            evidencePack,
          ),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[文章计划] AI 生成失败，使用本地兜底: ${message}`);
      return createFallbackArticlePlan(
        topicReport,
        contents,
        message,
        decision,
        evidencePack,
        this.accountBrand,
      );
    }
  }
}

export function normalizeArticlePlan(
  raw: RawArticlePlan,
  topicReport: EditorialTopicReport,
  contents: ScrapedContent[],
  fallback: boolean,
  error?: string,
  decision?: EditorialDecision,
  evidencePack?: EvidencePack,
): ArticlePlan {
  const validArticleIds = new Set(contents.map((content) => content.id));
  const sourceArticleIds = new Set<string>();
  const format = normalizeFormat(raw.format);
  const sections = normalizeSections(raw.sections, validArticleIds);
  for (const section of sections) {
    section.articleIds.forEach((id) => sourceArticleIds.add(id));
  }

  if (!sections.length) {
    throw new Error("文章计划缺少有效章节");
  }

  const coverDirection = normalizeCoverDirection(raw.coverDirection);
  const bodyImagePlan = normalizeBodyImagePlan(
    raw.bodyImagePlan,
    new Set(sections.map((section) => section.id)),
  );
  const riskNotes = normalizeRiskNotes(raw.riskNotes);

  const plan: ArticlePlan = {
    generatedAt: new Date().toISOString(),
    fallback,
    error,
    format,
    thesis: stringValue(raw.thesis) ?? decision?.decisionSummary ??
      inferThesis(topicReport, contents),
    targetReader: stringValue(raw.targetReader) ?? "关注本领域趋势的读者",
    summary: stringValue(raw.summary) ?? evidencePack?.items.slice(0, 3)
      .map((item) => item.title)
      .join("；") ??
      decision?.whyThisNow.join("；") ??
      "基于今日选题生成的文章计划。",
    sections,
    titleDirections: normalizeTitleDirections(raw.titleDirections, contents),
    coverDirection,
    bodyImagePlan,
    riskNotes,
    sourceArticleIds: [...sourceArticleIds],
  };

  return enforceEvidenceDepthGate(
    groundArticlePlanToSources(plan, contents),
    contents,
    evidencePack,
  );
}

function createFallbackArticlePlan(
  topicReport: EditorialTopicReport,
  contents: ScrapedContent[],
  error?: string,
  decision?: EditorialDecision,
  evidencePack?: EvidencePack,
  accountBrand?: JsonObject,
): ArticlePlan {
  const leadTopicIds = decision?.selectedTopics.map((topic) => topic.topicId) ??
    [];
  const leadScores = [...topicReport.scores]
    .sort((left, right) => right.finalScore - left.finalScore)
    .sort((left, right) =>
      Number(leadTopicIds.includes(right.topicId)) -
      Number(leadTopicIds.includes(left.topicId))
    )
    .slice(0, 4);
  const clustersById = new Map(
    topicReport.clusters.map((cluster) => [cluster.id, cluster]),
  );
  const fallbackSections = leadScores.flatMap((score, index) => {
    const cluster = clustersById.get(score.topicId);
    if (!cluster) return [];
    return [{
      id: `section-${index + 1}`,
      title: cluster.title,
      intent: score.recommendedUse === "lead"
        ? "作为文章主线展开"
        : "作为补充信息简要说明",
      angle: score.reason,
      articleIds: cluster.articleIds.filter((id) =>
        contents.some((content) => content.id === id)
      ),
      keyPoints: [
        cluster.summary,
        ...cluster.keywords.slice(0, 3).map((keyword) => `关键词：${keyword}`),
      ].filter(Boolean),
    }];
  });
  const sections = fallbackSections.length
    ? fallbackSections
    : contents.slice(0, 4).map((content, index) => ({
      id: `section-${index + 1}`,
      title: content.title || `章节 ${index + 1}`,
      intent: "保留为基础信息",
      angle: "本地兜底计划：按文章排序组织内容。",
      articleIds: [content.id],
      keyPoints: [content.content.slice(0, 160)],
    }));
  const firstTitle = sections[0]?.title ?? contents[0]?.title ?? "今日内容";
  const targetReader = stringValue(accountBrand?.audience) ??
    "关注本领域趋势的读者";
  const titleStyle = stringValue(accountBrand?.titleStyle);

  const plan: ArticlePlan = {
    generatedAt: new Date().toISOString(),
    fallback: true,
    error,
    format: decision?.recommendedFormat ??
      (sections.length > 3 ? "daily-brief" : "mixed"),
    thesis: decision?.decisionSummary ?? inferThesis(topicReport, contents),
    targetReader,
    summary: evidencePack?.items.length
      ? `结合 ${evidencePack.items.length} 条补充证据兜底组织正文：${
        evidencePack.items.slice(0, 3).map((item) => item.title).join("；")
      }`
      : decision
      ? `依据编辑决策兜底组织正文：${decision.decisionSummary}`
      : "AI 文章计划生成失败，已使用本地兜底计划组织正文结构。",
    sections,
    titleDirections: [
      {
        title: firstTitle,
        angle: "突出最重要主题",
        reason: titleStyle
          ? `使用最高优先级主题，并参考账号标题偏好：${titleStyle}`
          : "使用最高优先级主题作为标题方向。",
      },
      {
        title: "今天值得关注的几个变化",
        angle: "适合多主题速览",
        reason: "当主题分散时，保持标题稳健。",
      },
    ],
    coverDirection: {
      visualBrief: `围绕“${firstTitle}”生成克制、清晰的信息图式封面。`,
      textBrief: firstTitle,
      mood: "清晰、专业、少装饰",
    },
    bodyImagePlan: {
      enabled: false,
      placements: [],
    },
    riskNotes: [{
      level: "medium",
      issue: decision?.duplicationRisk.reason ??
        "文章计划使用本地兜底生成，缺少更细的编辑判断。",
      handling: decision?.writingDirectives[0] ??
        "正文生成时保持事实边界，避免额外扩展结论。",
    }],
    sourceArticleIds: [
      ...new Set(sections.flatMap((section) => section.articleIds)),
    ],
  };

  return enforceEvidenceDepthGate(
    groundArticlePlanToSources(plan, contents),
    contents,
    evidencePack,
  );
}

function enforceEvidenceDepthGate(
  plan: ArticlePlan,
  contents: ScrapedContent[],
  evidencePack?: EvidencePack,
): ArticlePlan {
  const evidenceSupport = evaluateEvidenceSupport(plan, evidencePack);
  if (!shouldDowngradeForEvidenceGap(plan, evidenceSupport)) return plan;
  const sections = contents.slice(0, 3).map((content, index) => ({
    id: `section-${index + 1}`,
    title: content.title || `已确认动态 ${index + 1}`,
    intent: "基于已抓取来源做保守说明，不扩展为深度判断。",
    angle: "只写来源明确出现的信息，缺失的框架细节或评估流程标为待确认。",
    articleIds: [content.id],
    keyPoints: buildGroundedKeyPoints(content),
  }));
  const firstTitle = sections[0]?.title ?? contents[0]?.title ?? "今日 AI 动态";

  const evidenceGapRiskNote: ArticleRiskNote = {
    level: "high",
    issue: evidenceSupport.reason,
    handling:
      "自动降级为简报；正文只能写已确认动态，并提示关键细节需查阅原文或等待补充证据。",
  };

  return {
    ...plan,
    format: "daily-brief",
    thesis:
      `补充证据不足，本期只围绕“${firstTitle}”做保守梳理，不生成深度判断。`,
    summary:
      "补充研究缺少可直接支撑主线的证据，已从分析型文章降级为来源简报，避免把判断、建议或方法论写成未被来源支持的结论。",
    sections,
    titleDirections: [{
      title: firstTitle,
      angle: "证据不足时使用已确认来源标题。",
      reason: "缺少直接证据，避免标题承诺深度分析或检查清单。",
    }],
    bodyImagePlan: {
      enabled: false,
      placements: [],
    },
    riskNotes: [evidenceGapRiskNote, ...plan.riskNotes].slice(0, 6),
    sourceArticleIds: [
      ...new Set(sections.flatMap((section) => section.articleIds)),
    ],
  };
}

interface EvidenceSupportQuality {
  evidencePackPresent: boolean;
  directEvidenceCount: number;
  reason: string;
}

function shouldDowngradeForEvidenceGap(
  plan: ArticlePlan,
  evidenceSupport: EvidenceSupportQuality,
): boolean {
  if (plan.format === "daily-brief") return false;
  if (!evidenceSupport.evidencePackPresent) return false;
  if (evidenceSupport.directEvidenceCount > 0) return false;

  const planText = [
    plan.thesis,
    plan.summary,
    ...plan.sections.flatMap((section) => [
      section.title,
      section.intent,
      section.angle,
      ...section.keyPoints,
    ]),
    ...plan.riskNotes.map((note) => `${note.issue} ${note.handling}`),
  ].join(" ");

  return evidenceRequiredFormats.has(plan.format) ||
    evidenceSensitivePlanPattern.test(planText);
}

function evaluateEvidenceSupport(
  plan: ArticlePlan,
  evidencePack?: EvidencePack,
): EvidenceSupportQuality {
  if (!evidencePack) {
    return {
      evidencePackPresent: false,
      directEvidenceCount: 0,
      reason: "未生成补充证据包，无法判断是否支撑分析型文章。",
    };
  }

  if (!evidencePack.items.length) {
    return {
      evidencePackPresent: true,
      directEvidenceCount: 0,
      reason: "补充证据为空，当前来源不足以支撑分析型文章。",
    };
  }

  const leadSignals = collectEvidenceSignals(plan, evidencePack);
  const directEvidenceCount =
    evidencePack.items.filter((item) => isDirectEvidenceItem(item, leadSignals))
      .length;

  return {
    evidencePackPresent: true,
    directEvidenceCount,
    reason: directEvidenceCount > 0
      ? `已获得 ${directEvidenceCount} 条可直接支撑主线的补充证据。`
      : "补充证据与文章主线缺少直接支持关系，当前来源不足以支撑分析型文章。",
  };
}

function collectEvidenceSignals(
  plan: ArticlePlan,
  evidencePack: EvidencePack,
): string[] {
  return [
    evidencePack.topic,
    plan.thesis,
    plan.summary,
    ...plan.titleDirections.flatMap((direction) => [
      direction.title,
      direction.angle,
    ]),
    ...plan.sections.flatMap((section) => [
      section.title,
      section.intent,
      section.angle,
      ...section.keyPoints.slice(0, 3),
    ]),
  ].flatMap(tokenizeEvidenceSignal).slice(0, 48);
}

function isDirectEvidenceItem(
  item: EvidencePack["items"][number],
  leadSignals: string[],
): boolean {
  if (!leadSignals.length) return false;

  const itemSignals = tokenizeEvidenceSignal([
    item.title,
    item.summary,
    ...item.supports,
  ].join(" "));
  const overlap = leadSignals.filter((signal) => itemSignals.includes(signal))
    .length;
  const supportOverlap = item.supports.some((support) => {
    const supportSignals = tokenizeEvidenceSignal(support);
    return supportSignals.some((signal) => leadSignals.includes(signal));
  });

  if (overlap < 2 && !supportOverlap) return false;

  if (item.sourceType === "official" || item.sourceType === "primary") {
    return item.confidence === "high" || item.confidence === "medium";
  }

  if (item.sourceType === "media") {
    return item.confidence === "high" && (overlap >= 3 || supportOverlap);
  }

  return false;
}

function tokenizeEvidenceSignal(value: string | undefined): string[] {
  if (!value) return [];
  const normalized = value.toLowerCase();
  const baseTokens = normalized
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const tokens = baseTokens.flatMap((token) => {
    if (/^\p{Script=Han}+$/u.test(token)) {
      return createCjkSignalTokens(token);
    }
    return [token];
  });

  return [
    ...new Set(
      tokens
        .filter((token) => token.length >= 2)
        .filter((token) => !genericEvidenceSignalTokens.has(token)),
    ),
  ];
}

function createCjkSignalTokens(value: string): string[] {
  if (value.length <= 4) return [value];
  const tokens = new Set<string>();
  for (const size of [2, 3, 4]) {
    for (let index = 0; index <= value.length - size; index += 1) {
      tokens.add(value.slice(index, index + size));
    }
  }
  return [...tokens];
}

const evidenceRequiredFormats = new Set<ArticlePlanFormat>([
  "deep-analysis",
  "product-review",
  "trend-analysis",
]);

const evidenceSensitivePlanPattern =
  /(治理框架|第三方评估|可信评估|方法论|检查项|合规自查|安全审计|frontier governance|playbook)/i;

const genericEvidenceSignalTokens = new Set([
  "ai",
  "api",
  "www",
  "com",
  "http",
  "https",
  "news",
  "blog",
  "official",
  "announcement",
  "update",
  "updates",
  "model",
  "models",
  "product",
  "products",
  "company",
  "companies",
  "enterprise",
  "enterprises",
  "technology",
  "technologies",
  "anthropic",
  "openai",
  "google",
  "microsoft",
  "meta",
  "nvidia",
  "amazon",
  "发布",
  "更新",
  "官方",
  "企业",
  "模型",
  "技术",
  "产品",
  "文章",
  "主线",
  "变化",
  "影响",
  "现在",
  "可以",
  "什么",
  "这个",
  "一个",
  "几个",
  "分析",
  "深度",
  "今日",
  "本期",
]);

function groundArticlePlanToSources(
  plan: ArticlePlan,
  contents: ScrapedContent[],
): ArticlePlan {
  if (!contents.length) return plan;

  const byId = new Map(contents.map((content) => [content.id, content]));
  const allSourceText = normalizeGroundingText(
    contents.map((content) => `${content.title}\n${content.content}`).join(
      "\n\n",
    ),
  );
  const fallbackContent = contents[0];
  const unsupportedPhrases = new Set<string>();

  const sections = plan.sections.map((section): ArticlePlanSection => {
    const relatedContents = section.articleIds
      .map((id) => byId.get(id))
      .filter((content): content is ScrapedContent => Boolean(content));
    if (!relatedContents.length) return section;

    const sectionSourceText = normalizeGroundingText(
      relatedContents.map((content) => `${content.title}\n${content.content}`)
        .join("\n\n"),
    );
    const titleMissing = extractUnsupportedNamedPhrases(
      section.title,
      sectionSourceText,
    );
    const missing = extractUnsupportedNamedPhrases(
      [
        section.title,
        section.intent,
        section.angle,
        ...section.keyPoints,
      ].join(" "),
      sectionSourceText,
    );
    if (!missing.length) return section;

    missing.forEach((phrase) => unsupportedPhrases.add(phrase));
    const primary = relatedContents[0];
    return {
      ...section,
      title: titleMissing.length
        ? primary.title || section.title
        : section.title,
      intent: "基于已核实来源重写该章节，避免沿用未被来源支持的计划判断。",
      angle: "只写来源明确支持的信息；缺失事实保留为待确认，不写成结论。",
      keyPoints: buildGroundedKeyPoints(primary),
    };
  });

  const titleDirections = plan.titleDirections.map((direction) => {
    const missing = extractUnsupportedNamedPhrases(
      direction.title,
      allSourceText,
    );
    if (!missing.length) return direction;
    missing.forEach((phrase) => unsupportedPhrases.add(phrase));
    return {
      ...direction,
      title: fallbackContent.title || direction.title,
      angle: "使用来源已确认的标题方向。",
      reason: `原标题包含未在来源中确认的实体：${missing.join("、")}。`,
    };
  });

  const thesisMissing = extractUnsupportedNamedPhrases(
    plan.thesis,
    allSourceText,
  );
  thesisMissing.forEach((phrase) => unsupportedPhrases.add(phrase));
  const summaryMissing = extractUnsupportedNamedPhrases(
    plan.summary,
    allSourceText,
  );
  summaryMissing.forEach((phrase) => unsupportedPhrases.add(phrase));

  if (!unsupportedPhrases.size) {
    return { ...plan, sections, titleDirections };
  }

  const unsupportedRiskNote: ArticleRiskNote = {
    level: "high",
    issue: `文章计划包含来源未直接支持的关键实体：${
      [...unsupportedPhrases].slice(0, 6).join("、")
    }。`,
    handling:
      "已将相关章节和标题方向回退到已核实来源，正文不得继续扩展这些实体。",
  };
  const riskNotes: ArticleRiskNote[] = [
    ...plan.riskNotes,
    unsupportedRiskNote,
  ].slice(0, 6);

  return {
    ...plan,
    thesis: thesisMissing.length
      ? `本期基于已确认来源，围绕“${fallbackContent.title}”梳理关键信息和事实边界。`
      : plan.thesis,
    summary: summaryMissing.length
      ? truncateSourceText(fallbackContent.content, 220)
      : plan.summary,
    sections,
    titleDirections,
    riskNotes,
  };
}

function buildGroundedKeyPoints(content: ScrapedContent): string[] {
  return content.content
    .split(/<next_paragraph\s*\/>|\n{2,}/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((part) => truncateSourceText(part, 180));
}

function extractUnsupportedNamedPhrases(
  value: string,
  normalizedSourceText: string,
): string[] {
  return extractNamedPhrases(value).filter((phrase) =>
    !normalizedSourceText.includes(normalizeGroundingText(phrase))
  );
}

function extractNamedPhrases(value: string): string[] {
  const matches = value.match(
    /\b(?:[A-Z][A-Za-z0-9]*|[A-Z]{2,})(?:[-\s]+(?:[A-Z][A-Za-z0-9]*|[A-Z]{2,}|\d+(?:\.\d+)?)){1,5}\b/g,
  ) ?? [];
  return [
    ...new Set(
      matches.map((match) => match.trim()).filter((match) =>
        !genericNamedPhrases.has(match.toLowerCase())
      ),
    ),
  ];
}

function normalizeGroundingText(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, " ").trim();
}

function truncateSourceText(value: string, maxLength: number): string {
  const normalized = value.replace(/<next_paragraph\s*\/>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized;
}

const genericNamedPhrases = new Set([
  "ai",
  "api",
  "github",
  "rss",
]);

function normalizeFormat(value: unknown): ArticlePlanFormat {
  if (typeof value === "string" && isArticlePlanFormat(value)) return value;
  return "mixed";
}

function normalizeSections(
  value: unknown,
  validArticleIds: Set<string>,
): ArticlePlanSection[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const articleIds = stringArray(record.articleIds)
      .filter((id) => validArticleIds.has(id));
    if (!articleIds.length) return [];
    return [{
      id: stringValue(record.id) ?? `section-${index + 1}`,
      title: stringValue(record.title) ?? `章节 ${index + 1}`,
      intent: stringValue(record.intent) ?? "说明该主题的核心信息",
      angle: stringValue(record.angle) ?? "按事实和影响组织内容",
      articleIds,
      keyPoints: stringArray(record.keyPoints).slice(0, 6),
    }];
  });
}

function normalizeTitleDirections(
  value: unknown,
  contents: ScrapedContent[],
): ArticleTitleDirection[] {
  const directions = Array.isArray(value)
    ? value.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      const title = stringValue(record.title);
      if (!title) return [];
      return [{
        title,
        angle: stringValue(record.angle) ?? "标题方向",
        reason: stringValue(record.reason) ?? "适合当前文章结构。",
      }];
    })
    : [];
  if (directions.length) return directions.slice(0, 5);
  return [{
    title: contents[0]?.title ?? "今日趋势观察",
    angle: "默认标题方向",
    reason: "AI 未提供标题方向，使用首篇文章标题兜底。",
  }];
}

function normalizeCoverDirection(value: unknown): ArticleCoverDirection {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return {
      visualBrief: stringValue(record.visualBrief) ??
        "使用信息清晰、留白充足的专业封面。",
      textBrief: stringValue(record.textBrief) ?? "今日趋势",
      mood: stringValue(record.mood) ?? "专业、克制、清晰",
    };
  }
  return {
    visualBrief: "使用信息清晰、留白充足的专业封面。",
    textBrief: "今日趋势",
    mood: "专业、克制、清晰",
  };
}

function normalizeBodyImagePlan(
  value: unknown,
  sectionIds: Set<string>,
): ArticleBodyImagePlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { enabled: false, placements: [] };
  }
  const record = value as Record<string, unknown>;
  const placements = Array.isArray(record.placements)
    ? record.placements.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const placement = item as Record<string, unknown>;
      const sectionId = stringValue(placement.sectionId);
      if (!sectionId || !sectionIds.has(sectionId)) return [];
      return [{
        sectionId,
        purpose: stringValue(placement.purpose) ?? "辅助理解该章节",
        promptHint: stringValue(placement.promptHint) ?? "",
      }];
    })
    : [];
  return {
    enabled: booleanValue(record.enabled) ?? placements.length > 0,
    placements,
  };
}

function normalizeRiskNotes(value: unknown): ArticleRiskNote[] {
  if (!Array.isArray(value)) {
    return [{
      level: "low",
      issue: "未识别到明确风险。",
      handling: "正文保持事实来源和谨慎表述。",
    }];
  }
  const notes = value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const issue = stringValue(record.issue);
    if (!issue) return [];
    return [{
      level: riskLevel(record.level),
      issue,
      handling: stringValue(record.handling) ?? "正文中谨慎表述。",
    }];
  });
  return notes.length ? notes.slice(0, 6) : [{
    level: "low",
    issue: "未识别到明确风险。",
    handling: "正文保持事实来源和谨慎表述。",
  }];
}

function inferThesis(
  topicReport: EditorialTopicReport,
  contents: ScrapedContent[],
): string {
  const topScore =
    [...topicReport.scores].sort((left, right) =>
      right.finalScore - left.finalScore
    )[0];
  const topCluster = topicReport.clusters.find((cluster) =>
    cluster.id === topScore?.topicId
  );
  if (topCluster) {
    return `本期主线围绕“${topCluster.title}”展开，说明其变化、影响和需要谨慎判断的部分。`;
  }
  return contents[0]?.title
    ? `本期围绕“${contents[0].title}”梳理关键信息。`
    : "本期围绕已抓取内容梳理关键信息。";
}

function riskLevel(value: unknown): ArticleRiskNote["level"] {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }
  return "low";
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

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
