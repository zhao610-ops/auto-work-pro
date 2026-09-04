import type {
  EditorialMemoryContext,
  EditorialRunFeedback,
  EditorialTopicFeedback,
} from "@src/core/ports/editorial-memory-store.ts";
import type { JsonObject } from "@src/core/ports/runtime-config-store.ts";

export interface AccountLearningSnapshot {
  generatedAt: string;
  accountId?: string;
  profileId?: string;
  memoryScope: "account-strict" | "mixed-or-global";
  profile: {
    completenessScore: number;
    presentFields: string[];
    missingFields: string[];
    positioning?: string;
    audience?: string;
    tone?: string;
    titleStyle?: string;
  };
  feedback: {
    counts: Record<EditorialRunFeedback["rating"], number>;
    latestGood?: string;
    latestBad?: string;
  };
  topicFeedback: {
    counts: Record<EditorialTopicFeedback["action"], number>;
    lead: string[];
    adopt: string[];
    skip: string[];
  };
  recentArticles: Array<{
    title: string;
    qualityScore?: number;
    publishStatus: string;
    createdAt: string;
  }>;
  sourceSignals: Array<{
    url: string;
    group: string;
    successRate: number;
    totalArticles: number;
    lastStatus: string;
  }>;
  appliedGuidance: string[];
  deterministicRules: string[];
}

export function createAccountLearningSnapshot(options: {
  memory: EditorialMemoryContext;
  accountBrand?: JsonObject;
  accountId?: string;
  profileId?: string;
  strictAccount?: boolean;
}): AccountLearningSnapshot {
  const profile = summarizeProfile(options.accountBrand);
  const recentFeedback = options.memory.recentFeedback;
  const topicFeedback = options.memory.recentTopicFeedback;
  const feedbackCounts = countFeedback(recentFeedback);
  const topicFeedbackCounts = countTopicFeedback(topicFeedback);
  const leadTopics = feedbackLabels(topicFeedback, "lead");
  const adoptTopics = feedbackLabels(topicFeedback, "adopt");
  const skipTopics = feedbackLabels(topicFeedback, "skip");

  return {
    generatedAt: new Date().toISOString(),
    accountId: options.accountId,
    profileId: options.profileId,
    memoryScope: options.strictAccount ? "account-strict" : "mixed-or-global",
    profile,
    feedback: {
      counts: feedbackCounts,
      latestGood: latestFeedbackNote(recentFeedback, "good"),
      latestBad: latestFeedbackNote(recentFeedback, "bad"),
    },
    topicFeedback: {
      counts: topicFeedbackCounts,
      lead: leadTopics,
      adopt: adoptTopics,
      skip: skipTopics,
    },
    recentArticles: options.memory.recentArticles.slice(0, 8).map((
      article,
    ) => ({
      title: article.title,
      qualityScore: article.qualityScore,
      publishStatus: article.publishStatus,
      createdAt: article.createdAt,
    })),
    sourceSignals: options.memory.sourcePerformance.slice(0, 8).map((
      source,
    ) => ({
      url: source.url,
      group: source.group,
      successRate: source.runs > 0
        ? Math.round((source.successes / source.runs) * 100)
        : 0,
      totalArticles: source.totalArticles,
      lastStatus: source.lastStatus,
    })),
    appliedGuidance: buildAppliedGuidance({
      profile,
      latestGood: latestFeedbackNote(recentFeedback, "good"),
      latestBad: latestFeedbackNote(recentFeedback, "bad"),
      leadTopics,
      adoptTopics,
      skipTopics,
      recentArticleTitle: options.memory.recentArticles[0]?.title,
    }),
    deterministicRules: [
      "同账号 recentTopicFeedback.action=skip 的相似主题会被硬降级为 skip。",
      "同账号 recentTopicFeedback.action=lead 的相似主题只在证据充足且风险可控时提升为 lead。",
      "同账号 recentTopicFeedback.action=adopt 的相似主题会适度提高优先级，但不会覆盖高风险事实校验。",
      "近期差评会进入选题和编辑决策提示词，作为标题、角度和读者收益的强规避项。",
    ],
  };
}

function summarizeProfile(accountBrand?: JsonObject): AccountLearningSnapshot[
  "profile"
] {
  const fields = [
    ["账号定位", stringValue(accountBrand?.positioning)],
    ["目标读者", stringValue(accountBrand?.audience)],
    ["语气风格", stringValue(accountBrand?.tone)],
    ["标题偏好", stringValue(accountBrand?.titleStyle)],
  ] as const;
  const presentFields = fields
    .filter(([, value]) => Boolean(value))
    .map(([label]) => label);
  const missingFields = fields
    .filter(([, value]) => !value)
    .map(([label]) => label);
  return {
    completenessScore: Math.round((presentFields.length / fields.length) * 100),
    presentFields,
    missingFields,
    positioning: stringValue(accountBrand?.positioning),
    audience: stringValue(accountBrand?.audience),
    tone: stringValue(accountBrand?.tone),
    titleStyle: stringValue(accountBrand?.titleStyle),
  };
}

function buildAppliedGuidance(options: {
  profile: AccountLearningSnapshot["profile"];
  latestGood?: string;
  latestBad?: string;
  leadTopics: string[];
  adoptTopics: string[];
  skipTopics: string[];
  recentArticleTitle?: string;
}): string[] {
  const lines = [
    options.profile.positioning
      ? `选题服务账号定位：${options.profile.positioning}`
      : undefined,
    options.profile.audience
      ? `默认读者：${options.profile.audience}`
      : undefined,
    options.profile.tone ? `表达语气：${options.profile.tone}` : undefined,
    options.profile.titleStyle
      ? `标题偏好：${options.profile.titleStyle}`
      : undefined,
    options.latestGood ? `延续正反馈：${options.latestGood}` : undefined,
    options.latestBad ? `规避差反馈：${options.latestBad}` : undefined,
    options.leadTopics[0]
      ? `优先评估锁主线主题：${options.leadTopics[0]}`
      : undefined,
    options.adoptTopics[0]
      ? `可采用相似主题：${options.adoptTopics[0]}`
      : undefined,
    options.skipTopics[0]
      ? `避免相似跳过主题：${options.skipTopics[0]}`
      : undefined,
    options.recentArticleTitle
      ? `避免无新事实时重复近期文章：${options.recentArticleTitle}`
      : undefined,
  ];
  return dedupeStrings(lines.filter((line): line is string => Boolean(line)))
    .slice(0, 10);
}

function countFeedback(
  feedback: EditorialRunFeedback[],
): Record<EditorialRunFeedback["rating"], number> {
  return {
    good: feedback.filter((item) => item.rating === "good").length,
    ok: feedback.filter((item) => item.rating === "ok").length,
    bad: feedback.filter((item) => item.rating === "bad").length,
  };
}

function countTopicFeedback(
  feedback: EditorialTopicFeedback[],
): Record<EditorialTopicFeedback["action"], number> {
  return {
    lead: feedback.filter((item) => item.action === "lead").length,
    adopt: feedback.filter((item) => item.action === "adopt").length,
    skip: feedback.filter((item) => item.action === "skip").length,
  };
}

function latestFeedbackNote(
  feedback: EditorialRunFeedback[],
  rating: EditorialRunFeedback["rating"],
): string | undefined {
  return [...feedback]
    .filter((item) => item.rating === rating && stringValue(item.note))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0]
    ?.note?.trim();
}

function feedbackLabels(
  feedback: EditorialTopicFeedback[],
  action: EditorialTopicFeedback["action"],
): string[] {
  return feedback
    .filter((item) => item.action === action)
    .map((item) => item.title || item.topicId)
    .filter((label): label is string => Boolean(label))
    .slice(0, 8);
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
