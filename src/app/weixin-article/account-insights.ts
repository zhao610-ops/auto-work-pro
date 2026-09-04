import type {
  EditorialMemoryStore,
  EditorialRunFeedback,
  EditorialTopicFeedback,
} from "@src/core/ports/editorial-memory-store.ts";
import type {
  ArticleRunRecord,
  RunStatus,
} from "@src/core/ports/run-state-store.ts";
import type {
  WeixinAccountProfile,
} from "@src/core/ports/runtime-config-store.ts";

export type WeixinAccountLearningTone =
  | "success"
  | "info"
  | "warning"
  | "danger";

export interface WeixinAccountLearningItem {
  type: "profile" | "quality" | "feedback" | "topic" | "source" | "publish";
  tone: WeixinAccountLearningTone;
  title: string;
  detail: string;
  evidence?: string;
}

export interface WeixinAccountLearningSummary {
  profileCompleteness: {
    score: number;
    missingFields: string[];
    presentFields: string[];
  };
  qualityTrend: {
    direction: "up" | "down" | "stable" | "unknown";
    label: string;
    delta?: number;
    recentAverage?: number;
    previousAverage?: number;
  };
  writingGuidance: string[];
  riskSignals: WeixinAccountLearningItem[];
  recommendedActions: WeixinAccountLearningItem[];
}

export interface WeixinAccountInsight {
  accountId: string;
  totalRuns: number;
  latestRun?: {
    runId: string;
    status: RunStatus;
    dryRun: boolean;
    createdAt: string;
    finishedAt?: string;
  };
  latestMatrixRunId?: string;
  averageQualityScore?: number;
  recentArticles: Array<{
    runId: string;
    title: string;
    qualityScore?: number;
    publishStatus: string;
    dryRun: boolean;
    createdAt: string;
  }>;
  publishStatusCounts: Record<string, number>;
  feedbackCounts: Record<EditorialRunFeedback["rating"], number>;
  topicFeedbackCounts: Record<EditorialTopicFeedback["action"], number>;
  latestFeedback?: {
    runId: string;
    rating: EditorialRunFeedback["rating"];
    note?: string;
    updatedAt: string;
  };
  latestTopicFeedback?: {
    runId: string;
    topicId: string;
    action: EditorialTopicFeedback["action"];
    title?: string;
    reason?: string;
    updatedAt: string;
  };
  learning: WeixinAccountLearningSummary;
}

export async function buildWeixinAccountInsights(
  options: {
    accounts: WeixinAccountProfile[];
    runs: ArticleRunRecord[];
    editorialMemoryStore: EditorialMemoryStore;
    recentLimit?: number;
  },
): Promise<WeixinAccountInsight[]> {
  const recentLimit = options.recentLimit ?? 8;

  return await Promise.all(options.accounts.map(async (account) => {
    const accountRuns = options.runs
      .filter((run) => sameAccount(run.accountId, account.id))
      .sort(sortRunDesc);
    const context = await options.editorialMemoryStore.getContext({
      accountId: account.id,
      strictAccount: true,
      recentLimit: Math.max(recentLimit, 12),
      sourceLimit: 0,
    });
    const recentArticles = context.recentArticles
      .filter((article) => sameAccount(article.accountId, account.id))
      .slice(0, recentLimit);
    const recentFeedback = context.recentFeedback
      .filter((feedback) => sameAccount(feedback.accountId, account.id));
    const latestFeedback = [...recentFeedback].sort((a, b) =>
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    )[0];
    const recentTopicFeedback = context.recentTopicFeedback
      .filter((feedback) =>
        sameAccount(feedback.accountId, account.id)
      );
    const latestTopicFeedback = [...recentTopicFeedback].sort((a, b) =>
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    )[0];
    const qualityScores = recentArticles
      .map((article) => article.qualityScore)
      .filter((score): score is number => typeof score === "number");
    const averageQualityScore = average(qualityScores);
    const latestRun = accountRuns[0]
      ? {
        runId: accountRuns[0].runId,
        status: accountRuns[0].status,
        dryRun: accountRuns[0].dryRun,
        createdAt: accountRuns[0].createdAt,
        finishedAt: accountRuns[0].finishedAt,
      }
      : undefined;
    const feedbackCounts = {
      good: recentFeedback.filter((item) => item.rating === "good").length,
      ok: recentFeedback.filter((item) => item.rating === "ok").length,
      bad: recentFeedback.filter((item) => item.rating === "bad").length,
    };
    const topicFeedbackCounts = {
      lead: recentTopicFeedback.filter((item) => item.action === "lead")
        .length,
      adopt: recentTopicFeedback.filter((item) => item.action === "adopt")
        .length,
      skip: recentTopicFeedback.filter((item) => item.action === "skip").length,
    };
    const latestMatrixRunId = accountRuns.find((run) => run.parentRunId)
      ?.parentRunId;

    return {
      accountId: account.id,
      totalRuns: accountRuns.length,
      latestRun,
      latestMatrixRunId,
      averageQualityScore,
      recentArticles: recentArticles.map((article) => ({
        runId: article.runId,
        title: article.title,
        qualityScore: article.qualityScore,
        publishStatus: article.publishStatus,
        dryRun: article.dryRun,
        createdAt: article.createdAt,
      })),
      publishStatusCounts: countBy(
        recentArticles,
        (article) => article.publishStatus,
      ),
      feedbackCounts,
      topicFeedbackCounts,
      latestFeedback: latestFeedback
        ? {
          runId: latestFeedback.runId,
          rating: latestFeedback.rating,
          note: latestFeedback.note,
          updatedAt: latestFeedback.updatedAt,
        }
        : undefined,
      latestTopicFeedback: latestTopicFeedback
        ? {
          runId: latestTopicFeedback.runId,
          topicId: latestTopicFeedback.topicId,
          action: latestTopicFeedback.action,
          title: latestTopicFeedback.title,
          reason: latestTopicFeedback.reason,
          updatedAt: latestTopicFeedback.updatedAt,
        }
        : undefined,
      learning: buildLearningSummary({
        account,
        recentArticles,
        recentFeedback,
        recentTopicFeedback,
        feedbackCounts,
        topicFeedbackCounts,
        averageQualityScore,
        latestMatrixRunId,
      }),
    };
  }));
}

function buildLearningSummary(options: {
  account: WeixinAccountProfile;
  recentArticles: WeixinAccountInsight["recentArticles"];
  recentFeedback: EditorialRunFeedback[];
  recentTopicFeedback: EditorialTopicFeedback[];
  feedbackCounts: Record<EditorialRunFeedback["rating"], number>;
  topicFeedbackCounts: Record<EditorialTopicFeedback["action"], number>;
  averageQualityScore?: number;
  latestMatrixRunId?: string;
}): WeixinAccountLearningSummary {
  const profileCompleteness = scoreProfileCompleteness(options.account);
  const qualityTrend = calculateQualityTrend(options.recentArticles);
  const riskSignals: WeixinAccountLearningItem[] = [];
  const recommendedActions: WeixinAccountLearningItem[] = [];

  if (profileCompleteness.missingFields.length > 0) {
    const detail = `缺少 ${
      profileCompleteness.missingFields.join("、")
    }，账号差异化会变弱。`;
    const item: WeixinAccountLearningItem = {
      type: "profile",
      tone: profileCompleteness.score < 50 ? "danger" : "warning",
      title: "补齐账号画像",
      detail,
      evidence: `完整度 ${profileCompleteness.score}%`,
    };
    riskSignals.push(item);
    recommendedActions.push(item);
  }

  if (options.recentArticles.length === 0) {
    recommendedActions.push({
      type: "quality",
      tone: "info",
      title: "先跑一次矩阵 dry-run",
      detail: "系统需要至少一次账号级产物，才能沉淀质量、反馈和写作偏好。",
    });
  } else if (
    typeof options.averageQualityScore === "number" &&
    options.averageQualityScore < 80
  ) {
    const item: WeixinAccountLearningItem = {
      type: "quality",
      tone: options.averageQualityScore < 70 ? "danger" : "warning",
      title: "提高发布前质量阈值",
      detail:
        "近期平均质量分低于 80，建议先调整选题角度或文章结构，再创建草稿。",
      evidence: `近期平均 ${options.averageQualityScore} 分`,
    };
    riskSignals.push(item);
    recommendedActions.push(item);
  }

  if (qualityTrend.direction === "down") {
    const item: WeixinAccountLearningItem = {
      type: "quality",
      tone: "warning",
      title: "质量趋势下降",
      detail:
        "最近几篇的质量分低于上一批，下一次应优先检查选题证据和标题承诺。",
      evidence: qualityTrend.label,
    };
    riskSignals.push(item);
    recommendedActions.push(item);
  }

  if (options.feedbackCounts.bad > options.feedbackCounts.good) {
    const item: WeixinAccountLearningItem = {
      type: "feedback",
      tone: "warning",
      title: "优先处理差评原因",
      detail: "差评多于好评，下一次生成前应把人工反馈视为强约束。",
      evidence:
        `好 ${options.feedbackCounts.good} / 差 ${options.feedbackCounts.bad}`,
    };
    riskSignals.push(item);
    recommendedActions.push(item);
  }

  if (
    options.topicFeedbackCounts.skip >
      options.topicFeedbackCounts.lead + options.topicFeedbackCounts.adopt
  ) {
    const item: WeixinAccountLearningItem = {
      type: "topic",
      tone: "warning",
      title: "复盘被跳过选题",
      detail: "跳过的主题多于采用主题，下一次应收窄来源或强化账号定位约束。",
      evidence:
        `锁主线 ${options.topicFeedbackCounts.lead} / 采用 ${options.topicFeedbackCounts.adopt} / 跳过 ${options.topicFeedbackCounts.skip}`,
    };
    riskSignals.push(item);
    recommendedActions.push(item);
  }

  if (!Array.isArray(options.account.defaults.sourceGroupIds)) {
    recommendedActions.push({
      type: "source",
      tone: "info",
      title: "配置账号专属来源分组",
      detail:
        "为账号绑定 sourceGroupIds 后，同一套系统可以按账号分配不同内容池。",
    });
  }

  if (options.account.relay?.configured !== true) {
    recommendedActions.push({
      type: "publish",
      tone: "warning",
      title: "检测微信 relay",
      detail: "relay 未确认可用时，只建议 dry-run，不建议真实创建草稿。",
    });
  }

  if (
    recommendedActions.length === 0 &&
    options.latestMatrixRunId &&
    qualityTrend.direction !== "down"
  ) {
    recommendedActions.push({
      type: "quality",
      tone: "success",
      title: "保持当前账号策略",
      detail:
        "画像、来源、质量和发布连接都处于可用状态，可以继续通过矩阵 dry-run 做对比复盘。",
    });
  }

  return {
    profileCompleteness,
    qualityTrend,
    writingGuidance: buildWritingGuidance(
      options.account,
      options.recentArticles,
      options.recentFeedback,
      options.recentTopicFeedback,
    ),
    riskSignals: dedupeLearningItems(riskSignals).slice(0, 5),
    recommendedActions: dedupeLearningItems(recommendedActions).slice(0, 6),
  };
}

function scoreProfileCompleteness(account: WeixinAccountProfile) {
  const fields = [
    ["账号定位", account.brand.positioning],
    ["目标读者", account.brand.audience],
    ["语气风格", account.brand.tone],
    ["标题偏好", account.brand.titleStyle],
  ] as const;
  const presentFields = fields
    .filter(([, value]) => textValue(value))
    .map(([label]) => label);
  const missingFields = fields
    .filter(([, value]) => !textValue(value))
    .map(([label]) => label);
  return {
    score: Math.round((presentFields.length / fields.length) * 100),
    presentFields,
    missingFields,
  };
}

function calculateQualityTrend(
  articles: WeixinAccountInsight["recentArticles"],
): WeixinAccountLearningSummary["qualityTrend"] {
  const scored = [...articles]
    .filter((
      article,
    ): article is WeixinAccountInsight["recentArticles"][number] & {
      qualityScore: number;
    } => typeof article.qualityScore === "number")
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  if (scored.length < 2) {
    return { direction: "unknown", label: "样本不足" };
  }
  const recentAverage = average(
    scored.slice(0, 3).map((item) => item.qualityScore),
  );
  const previousAverage = average(
    scored.slice(3, 6).map((item) => item.qualityScore),
  );
  if (
    typeof recentAverage !== "number" || typeof previousAverage !== "number"
  ) {
    return {
      direction: "stable",
      label: `最近平均 ${recentAverage ?? scored[0].qualityScore} 分`,
      recentAverage,
    };
  }
  const delta = recentAverage - previousAverage;
  const direction = delta > 5 ? "up" : delta < -5 ? "down" : "stable";
  const label = direction === "up"
    ? `上升 ${Math.abs(delta)} 分`
    : direction === "down"
    ? `下降 ${Math.abs(delta)} 分`
    : `基本稳定，变化 ${Math.abs(delta)} 分`;
  return {
    direction,
    label,
    delta,
    recentAverage,
    previousAverage,
  };
}

function buildWritingGuidance(
  account: WeixinAccountProfile,
  articles: WeixinAccountInsight["recentArticles"],
  feedback: EditorialRunFeedback[],
  topicFeedback: EditorialTopicFeedback[],
): string[] {
  const lines: string[] = [];
  const audience = textValue(account.brand.audience);
  const tone = textValue(account.brand.tone);
  const titleStyle = textValue(account.brand.titleStyle);
  const positioning = textValue(account.brand.positioning);
  if (positioning) lines.push(`选题优先服务账号定位：${positioning}`);
  if (audience) lines.push(`默认面向读者：${audience}`);
  if (tone) lines.push(`表达语气保持：${tone}`);
  if (titleStyle) lines.push(`标题偏好：${titleStyle}`);

  const forbiddenTopics = Array.isArray(account.brand.forbiddenTopics)
    ? account.brand.forbiddenTopics
      .filter((item): item is string =>
        typeof item === "string" && !!item.trim()
      )
      .map((item) => item.trim())
    : [];
  if (forbiddenTopics.length) {
    lines.push(`避免触碰：${forbiddenTopics.slice(0, 4).join("、")}`);
  }

  const goodNote = feedback.find((item) =>
    item.rating === "good" && textValue(item.note)
  )?.note;
  if (goodNote) lines.push(`延续正反馈：${goodNote.trim()}`);
  const badNote = feedback.find((item) =>
    item.rating === "bad" && textValue(item.note)
  )?.note;
  if (badNote) lines.push(`规避差反馈：${badNote.trim()}`);

  const leadTopic = topicFeedback.find((item) => item.action === "lead");
  if (leadTopic) {
    lines.push(`优先延续锁定主线：${leadTopic.title || leadTopic.topicId}`);
  }
  const adoptedTopic = topicFeedback.find((item) => item.action === "adopt");
  if (adoptedTopic) {
    lines.push(
      `可继续采用相似选题：${adoptedTopic.title || adoptedTopic.topicId}`,
    );
  }
  const skippedTopic = topicFeedback.find((item) => item.action === "skip");
  if (skippedTopic) {
    lines.push(
      `避免类似被跳过选题：${skippedTopic.title || skippedTopic.topicId}`,
    );
  }

  const bestArticle = [...articles]
    .filter((article) => typeof article.qualityScore === "number")
    .sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0))[0];
  if (bestArticle && (bestArticle.qualityScore ?? 0) >= 85) {
    lines.push(`可复用高分角度：${bestArticle.title}`);
  }

  return dedupeStrings(lines).slice(0, 8);
}

function dedupeLearningItems(
  items: WeixinAccountLearningItem[],
): WeixinAccountLearningItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.type}:${item.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sameAccount(value: string | undefined, accountId: string): boolean {
  return value === accountId || (accountId === "default" && !value);
}

function sortRunDesc(a: ArticleRunRecord, b: ArticleRunRecord): number {
  return Date.parse(b.createdAt) - Date.parse(a.createdAt);
}

function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round(total / values.length);
}

function countBy<T>(
  values: T[],
  getKey: (value: T) => string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = getKey(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
