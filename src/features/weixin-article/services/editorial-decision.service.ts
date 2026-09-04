import type { ScrapedContent } from "@src/core/ports/content-scraper.ts";
import type { EditorialMemoryContext } from "@src/core/ports/editorial-memory-store.ts";
import type { LLMProvider } from "@src/core/ports/llm.ts";
import type { ArticlePlanFormat } from "@src/features/weixin-article/domain/article-plan.ts";
import type {
  EditorialDecision,
  EditorialDecisionSelectedTopic,
  EditorialDecisionSkippedTopic,
  EditorialDecisionSourceJudgement,
} from "@src/features/weixin-article/domain/editorial-decision.ts";
import type { EditorialTopicReport } from "@src/features/weixin-article/domain/editorial-topic.ts";
import {
  getEditorialDecisionSystemPrompt,
  getEditorialDecisionUserPrompt,
} from "@src/prompts/editorial-decision.prompt.ts";
import { isArticlePlanFormat } from "@src/prompts/article-plan.prompt.ts";
import type { PromptProfileName } from "@src/prompts/prompt-profile.ts";
import { createStructuredJsonCompletion } from "@src/utils/llm-structured-output.ts";
import { Logger } from "@zilla/logger";
import type { JsonObject } from "@src/core/ports/runtime-config-store.ts";

const logger = new Logger("weixin-editorial-decision-service");

interface RawEditorialDecision {
  leadTopicId?: unknown;
  leadTopicTitle?: unknown;
  decisionSummary?: unknown;
  whyThisNow?: unknown;
  selectedTopics?: unknown;
  skippedTopics?: unknown;
  duplicationRisk?: unknown;
  sourceJudgements?: unknown;
  recommendedFormat?: unknown;
  writingDirectives?: unknown;
  titleWarnings?: unknown;
}

export class WeixinArticleEditorialDecisionService {
  constructor(
    private readonly llm: LLMProvider,
    private readonly promptProfile?: PromptProfileName,
    private readonly accountBrand?: JsonObject,
  ) {}

  async createEditorialDecision(
    topicReport: EditorialTopicReport,
    contents: ScrapedContent[],
    memory?: EditorialMemoryContext,
  ): Promise<EditorialDecision> {
    if (!topicReport.clusters.length || !contents.length) {
      return createFallbackEditorialDecision(topicReport, contents);
    }

    try {
      const messages = [
        {
          role: "system" as const,
          content: getEditorialDecisionSystemPrompt(
            this.promptProfile,
            this.accountBrand,
          ),
        },
        {
          role: "user" as const,
          content: getEditorialDecisionUserPrompt(
            topicReport,
            contents,
            memory,
            this.accountBrand,
          ),
        },
      ];
      return await createStructuredJsonCompletion<
        RawEditorialDecision,
        EditorialDecision
      >({
        label: "编辑决策",
        llm: this.llm,
        messages,
        chatOptions: {
          temperature: 0.28,
          max_tokens: 2600,
          response_format: { type: "json_object" },
        },
        maxAttempts: 2,
        normalize: (raw) =>
          normalizeEditorialDecision(raw, topicReport, contents, false),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[编辑决策] AI 生成失败，使用本地兜底: ${message}`);
      return createFallbackEditorialDecision(topicReport, contents, message);
    }
  }
}

export function normalizeEditorialDecision(
  raw: RawEditorialDecision,
  topicReport: EditorialTopicReport,
  contents: ScrapedContent[],
  fallback: boolean,
  error?: string,
): EditorialDecision {
  const topicIds = new Set(topicReport.clusters.map((cluster) => cluster.id));
  if (!topicIds.size) {
    throw new Error("编辑决策缺少候选主题");
  }
  const leadTopicId = topicIds.has(stringValue(raw.leadTopicId) ?? "")
    ? stringValue(raw.leadTopicId)!
    : pickLeadTopicId(topicReport);
  const leadTopic =
    topicReport.clusters.find((item) => item.id === leadTopicId) ??
      topicReport.clusters[0];
  const articleUrls = new Set(contents.map((content) => content.url));

  const selectedTopics = normalizeSelectedTopics(
    raw.selectedTopics,
    topicIds,
    leadTopicId,
  );
  const skippedTopics = normalizeSkippedTopics(
    raw.skippedTopics,
    topicIds,
    new Set(selectedTopics.map((item) => item.topicId)),
  );
  const duplicationRisk = normalizeDuplicationRisk(raw.duplicationRisk);
  const sourceJudgements = normalizeSourceJudgements(
    raw.sourceJudgements,
    articleUrls,
  );

  return {
    generatedAt: new Date().toISOString(),
    fallback,
    error,
    leadTopicId,
    leadTopicTitle: stringValue(raw.leadTopicTitle) ?? leadTopic.title,
    decisionSummary: stringValue(raw.decisionSummary) ??
      `本次选择“${leadTopic.title}”作为主线。`,
    whyThisNow: stringArray(raw.whyThisNow).slice(0, 6),
    selectedTopics,
    skippedTopics,
    duplicationRisk,
    sourceJudgements,
    recommendedFormat: normalizeFormat(raw.recommendedFormat),
    writingDirectives: stringArray(raw.writingDirectives).slice(0, 10),
    titleWarnings: stringArray(raw.titleWarnings).slice(0, 8),
  };
}

function createFallbackEditorialDecision(
  topicReport: EditorialTopicReport,
  contents: ScrapedContent[],
  error?: string,
): EditorialDecision {
  const leadTopicId = pickLeadTopicId(topicReport);
  const leadTopic =
    topicReport.clusters.find((cluster) => cluster.id === leadTopicId) ??
      topicReport.clusters[0];
  const selectedTopics = topicReport.scores
    .filter((score) => score.recommendedUse !== "skip")
    .slice(0, 4)
    .map((score): EditorialDecisionSelectedTopic => ({
      topicId: score.topicId,
      role: score.topicId === leadTopicId
        ? "lead"
        : score.recommendedUse === "watch"
        ? "watch"
        : "supporting",
      reason: score.reason,
    }));
  const selectedIds = new Set(selectedTopics.map((item) => item.topicId));

  return {
    generatedAt: new Date().toISOString(),
    fallback: true,
    error,
    leadTopicId,
    leadTopicTitle: leadTopic?.title ?? contents[0]?.title ?? "今日主线",
    decisionSummary: leadTopic
      ? `本地兜底选择“${leadTopic.title}”作为主线。`
      : "缺少有效主题，使用首篇文章作为临时主线。",
    whyThisNow: leadTopic
      ? [
        leadTopic.summary,
        `主题置信度 ${leadTopic.confidence}，新鲜度 ${leadTopic.freshness}`,
      ]
      : ["缺少 AI 编辑决策，保持保守组织。"],
    selectedTopics: selectedTopics.length ? selectedTopics : leadTopic
      ? [{
        topicId: leadTopic.id,
        role: "lead",
        reason: "主题排序靠前，作为本地兜底主线。",
      }]
      : [],
    skippedTopics: topicReport.clusters
      .filter((cluster) => !selectedIds.has(cluster.id))
      .map((cluster): EditorialDecisionSkippedTopic => ({
        topicId: cluster.id,
        reason: "本地兜底未选择为主线或补充主题。",
      })),
    duplicationRisk: {
      level: "medium",
      reason: "未能完成 AI 编辑决策，无法充分评估近期重复风险。",
      avoidAngles: ["避免空泛标题", "避免把单一来源写成确定趋势"],
    },
    sourceJudgements: contents.slice(0, 12).map((content) => ({
      url: content.url,
      role: "supporting",
      reason: "候选文章来源，正文引用时保持事实边界。",
    })),
    recommendedFormat: topicReport.clusters.length > 2
      ? "daily-brief"
      : "mixed",
    writingDirectives: [
      "先说明本次主线为什么值得写，再展开具体事实。",
      "保持事实边界，不把来源未确认的信息写成结论。",
    ],
    titleWarnings: ["避免标题太泛", "避免夸大为行业转折"],
  };
}

function pickLeadTopicId(topicReport: EditorialTopicReport): string {
  const leadScore =
    [...topicReport.scores].sort((left, right) =>
      right.finalScore - left.finalScore
    )[0];
  return leadScore?.topicId ?? topicReport.clusters[0]?.id ?? "topic-1";
}

function normalizeSelectedTopics(
  value: unknown,
  topicIds: Set<string>,
  leadTopicId: string,
): EditorialDecisionSelectedTopic[] {
  const selected = Array.isArray(value)
    ? value.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      const topicId = stringValue(record.topicId);
      if (!topicId || !topicIds.has(topicId)) return [];
      return [{
        topicId,
        role: readTopicRole(record.role, topicId === leadTopicId),
        reason: stringValue(record.reason) ?? "编辑决策选择该主题。",
      }];
    })
    : [];
  if (!selected.some((item) => item.topicId === leadTopicId)) {
    selected.unshift({
      topicId: leadTopicId,
      role: "lead",
      reason: "作为本次文章主线。",
    });
  }
  return selected.slice(0, 6);
}

function normalizeSkippedTopics(
  value: unknown,
  topicIds: Set<string>,
  selectedIds: Set<string>,
): EditorialDecisionSkippedTopic[] {
  const skipped = Array.isArray(value)
    ? value.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      const topicId = stringValue(record.topicId);
      if (!topicId || !topicIds.has(topicId) || selectedIds.has(topicId)) {
        return [];
      }
      return [{
        topicId,
        reason: stringValue(record.reason) ?? "编辑决策跳过该主题。",
      }];
    })
    : [];
  for (const topicId of topicIds) {
    if (
      !selectedIds.has(topicId) &&
      !skipped.some((item) => item.topicId === topicId)
    ) {
      skipped.push({ topicId, reason: "未入选本次主线或补充主题。" });
    }
  }
  return skipped.slice(0, 12);
}

function normalizeDuplicationRisk(
  value: unknown,
): EditorialDecision["duplicationRisk"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      level: "medium",
      reason: "未提供重复风险判断。",
      avoidAngles: ["避免重复近期文章角度"],
    };
  }
  const record = value as Record<string, unknown>;
  const level = record.level === "low" || record.level === "medium" ||
      record.level === "high"
    ? record.level
    : "medium";
  return {
    level,
    reason: stringValue(record.reason) ?? "需要避免重复近期表达。",
    avoidAngles: stringArray(record.avoidAngles).slice(0, 8),
  };
}

function normalizeSourceJudgements(
  value: unknown,
  articleUrls: Set<string>,
): EditorialDecisionSourceJudgement[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      const url = stringValue(record.url);
      if (!url || !articleUrls.has(url)) return [];
      return [{
        url,
        role: readSourceRole(record.role),
        reason: stringValue(record.reason) ?? "作为候选来源使用。",
      }];
    }).slice(0, 20)
    : [];
}

function readTopicRole(
  value: unknown,
  isLead: boolean,
): EditorialDecisionSelectedTopic["role"] {
  if (isLead) return "lead";
  return value === "lead" || value === "supporting" || value === "watch"
    ? value
    : "supporting";
}

function readSourceRole(
  value: unknown,
): EditorialDecisionSourceJudgement["role"] {
  return value === "primary" || value === "supporting" ||
      value === "reference-only" || value === "avoid"
    ? value
    : "supporting";
}

function normalizeFormat(value: unknown): ArticlePlanFormat {
  return typeof value === "string" && isArticlePlanFormat(value)
    ? value
    : "mixed";
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
