import type {
  ArtifactRef,
  ArtifactStore,
} from "@src/core/ports/artifact-store.ts";
import type {
  ArticleRunRecord,
  RunStateStore,
  RunStatus,
} from "@src/core/ports/run-state-store.ts";

export interface MatrixRunAccountComparison {
  accountId: string;
  runId: string;
  status: RunStatus;
  quality?: string;
  qualityScore?: number;
  qualityPassed: boolean;
  publish?: string;
  topic?: string;
  editorialDecision?: string;
  articlePlan?: string;
  articleFormat?: string;
  artifacts: number;
  error?: string;
}

export interface MatrixRunComparisonReport {
  generatedAt: string;
  parentRunId?: string;
  mode: "dry-run" | "publish";
  accountCount: number;
  qualityThreshold: number;
  quality: {
    scored: number;
    passed: number;
    missing: number;
    minScore?: number;
    averageScore?: number;
    controlled: boolean;
  };
  differentiation: {
    distinctLeadTopics: number;
    distinctArticleFormats: number;
    differentiated: boolean;
    reason: string;
  };
  accounts: MatrixRunAccountComparison[];
  warnings: string[];
}

interface MatrixRunStatusCounts {
  total: number;
  succeeded: number;
  failed: number;
  running: number;
  queued: number;
  cancelled: number;
}

export interface MatrixRunAggregation {
  status: RunStatus;
  summary: string;
  comparison: MatrixRunComparisonReport;
  total: number;
  succeeded: number;
  failed: number;
  running: number;
  queued: number;
  cancelled: number;
}

export interface BuildMatrixRunSummaryOptions {
  parent?: ArticleRunRecord;
  children: ArticleRunRecord[];
  qualityThreshold?: number;
}

export interface SyncMatrixParentRunOptions {
  listLimit?: number;
  artifactStore?: ArtifactStore;
  qualityThreshold?: number;
}

const QUALITY_REVIEW_PATTERN = /质量审稿:\s*([^\n]+)/;
const PUBLISH_PATTERN = /发布:\s*([^\n]+)/;
const TOPIC_PATTERN = /选题:\s*([^\n]+)/;
const EDITORIAL_DECISION_PATTERN = /编辑决策:\s*([^\n]+)/;
const ARTICLE_PLAN_PATTERN = /文章计划:\s*([^\n]+)/;
const ACCOUNT_PATTERN = /账号:\s*([^\n]+)/;
const QUALITY_SCORE_PATTERN = /(\d+(?:\.\d+)?)\s*分/;

export function buildMatrixRunSummary(
  options: BuildMatrixRunSummaryOptions,
): MatrixRunAggregation {
  const children = [...options.children].sort(compareRunByAccount);
  const counts = countStatuses(children);
  const status = resolveMatrixStatus(counts);
  const mode = options.parent?.dryRun === false ? "publish" : "dry-run";
  const comparison = buildMatrixRunComparison({
    parent: options.parent,
    children,
    qualityThreshold: options.qualityThreshold,
  });
  const accountLines = children.map(formatChildRunLine);
  const summaryLines = [
    `矩阵 ${mode} 批次`,
    `- 账号数: ${counts.total}`,
    `- 成功: ${counts.succeeded}`,
    `- 失败: ${counts.failed}`,
    `- 进行中: ${counts.running}`,
    `- 等待: ${counts.queued}`,
    `- 取消: ${counts.cancelled}`,
    `- 质量控制: ${formatQualityControlSummary(comparison)}`,
    `- 差异化: ${formatDifferentiationSummary(comparison)}`,
    accountLines.length > 0
      ? `- 账号结果: ${accountLines.join("; ")}`
      : "- 账号结果: 暂无",
  ];

  return {
    ...counts,
    status,
    comparison,
    summary: summaryLines.join("\n"),
  };
}

export function buildMatrixRunComparison(
  options: BuildMatrixRunSummaryOptions,
): MatrixRunComparisonReport {
  const children = [...options.children].sort(compareRunByAccount);
  const mode = options.parent?.dryRun === false ? "publish" : "dry-run";
  const qualityThreshold = options.qualityThreshold ?? 80;
  const accounts = children.map((run) =>
    buildAccountComparison(run, qualityThreshold)
  );
  const scores = accounts
    .map((account) => account.qualityScore)
    .filter((score): score is number => typeof score === "number");
  const passed = accounts.filter((account) => account.qualityPassed).length;
  const succeededAccounts = accounts.filter((account) =>
    account.status === "succeeded"
  );
  const distinctLeadTopics = countDistinct(
    succeededAccounts.map((account) => account.editorialDecision),
  );
  const distinctArticleFormats = countDistinct(
    succeededAccounts.map((account) => account.articleFormat),
  );
  const differentiated = succeededAccounts.length <= 1 ||
    distinctLeadTopics > 1 || distinctArticleFormats > 1;
  const warnings: string[] = [];

  const missingQuality = accounts.length - scores.length;
  if (missingQuality > 0) {
    warnings.push(
      `${missingQuality} 个账号缺少质量审稿分，质量可控性无法完全确认。`,
    );
  }
  if (accounts.some((account) => !account.qualityPassed)) {
    warnings.push(`存在未达到 ${qualityThreshold} 分质量阈值的账号产物。`);
  }
  if (!differentiated && succeededAccounts.length > 1) {
    warnings.push(
      "多个账号的主线或文章形态没有拉开差异，需要补充账号画像或来源分组。",
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    parentRunId: options.parent?.runId,
    mode,
    accountCount: accounts.length,
    qualityThreshold,
    quality: {
      scored: scores.length,
      passed,
      missing: missingQuality,
      minScore: scores.length ? Math.min(...scores) : undefined,
      averageScore: scores.length
        ? Math.round(
          scores.reduce((sum, score) => sum + score, 0) / scores.length,
        )
        : undefined,
      controlled: accounts.length > 0 &&
        missingQuality === 0 &&
        passed === accounts.length,
    },
    differentiation: {
      distinctLeadTopics,
      distinctArticleFormats,
      differentiated,
      reason: differentiated
        ? "账号之间至少在主线选题或文章形态上存在差异。"
        : "当前批次的账号产物主线和文章形态过于接近。",
    },
    accounts,
    warnings,
  };
}

export async function syncMatrixParentRun(
  store: RunStateStore,
  parentRunId: string,
  options: SyncMatrixParentRunOptions = {},
): Promise<MatrixRunAggregation | null> {
  const parent = await store.getRun(parentRunId);
  if (!parent || parent.runKind !== "matrix-parent") {
    return null;
  }

  const runs = await store.listRuns(options.listLimit ?? 1000);
  const children = runs.filter((run) => run.parentRunId === parentRunId);
  const aggregation = buildMatrixRunSummary({
    parent,
    children,
    qualityThreshold: options.qualityThreshold,
  });
  const comparisonRef = await writeComparisonArtifact(
    options.artifactStore,
    parent,
    aggregation.comparison,
  );
  const artifacts = comparisonRef
    ? mergeArtifactRefs(parent.artifacts, comparisonRef)
    : undefined;

  if (aggregation.status === "succeeded") {
    await store.finishRun(parentRunId, {
      summary: aggregation.summary,
      ...(artifacts ? { artifacts } : {}),
    });
    return aggregation;
  }

  if (aggregation.status === "failed") {
    await store.updateRun(parentRunId, {
      summary: aggregation.summary,
      ...(artifacts ? { artifacts } : {}),
    });
    await store.failRun(
      parentRunId,
      aggregation.failed > 0
        ? `矩阵批次失败：${aggregation.failed} 个账号失败`
        : "矩阵批次未全部完成",
    );
    return aggregation;
  }

  await store.updateRun(parentRunId, {
    status: aggregation.status,
    summary: aggregation.summary,
    ...(artifacts ? { artifacts } : {}),
  });
  return aggregation;
}

function countStatuses(children: ArticleRunRecord[]): MatrixRunStatusCounts {
  return {
    total: children.length,
    succeeded: children.filter((run) => run.status === "succeeded").length,
    failed: children.filter((run) => run.status === "failed").length,
    running: children.filter((run) => run.status === "running").length,
    queued: children.filter((run) => run.status === "queued").length,
    cancelled: children.filter((run) => run.status === "cancelled").length,
  };
}

function resolveMatrixStatus(counts: MatrixRunStatusCounts): RunStatus {
  if (counts.total === 0) return "queued";
  if (counts.running > 0) return "running";
  if (counts.queued > 0) {
    return counts.queued === counts.total ? "queued" : "running";
  }
  if (counts.failed > 0 || counts.cancelled > 0) return "failed";
  return "succeeded";
}

function formatChildRunLine(run: ArticleRunRecord): string {
  const account = run.accountId || run.runId;
  const quality = extractSummaryValue(run.summary, QUALITY_REVIEW_PATTERN);
  const publish = extractSummaryValue(run.summary, PUBLISH_PATTERN);
  const details = [quality, publish].filter(Boolean).join(", ");
  return details
    ? `${account}=${run.status}(${details})`
    : `${account}=${run.status}`;
}

function buildAccountComparison(
  run: ArticleRunRecord,
  qualityThreshold: number,
): MatrixRunAccountComparison {
  const quality = extractSummaryValue(run.summary, QUALITY_REVIEW_PATTERN);
  const qualityScore = extractQualityScore(quality);
  const articlePlan = extractSummaryValue(run.summary, ARTICLE_PLAN_PATTERN);
  const accountId = run.accountId ||
    extractSummaryValue(run.summary, ACCOUNT_PATTERN) ||
    run.runId;
  return {
    accountId,
    runId: run.runId,
    status: run.status,
    quality,
    qualityScore,
    qualityPassed: typeof qualityScore === "number" &&
      qualityScore >= qualityThreshold,
    publish: extractSummaryValue(run.summary, PUBLISH_PATTERN),
    topic: extractSummaryValue(run.summary, TOPIC_PATTERN),
    editorialDecision: extractSummaryValue(
      run.summary,
      EDITORIAL_DECISION_PATTERN,
    ),
    articlePlan,
    articleFormat: articlePlan?.split("，")[0]?.trim(),
    artifacts: run.artifacts.length,
    error: run.error,
  };
}

function extractSummaryValue(
  summary: string | undefined,
  pattern: RegExp,
): string | undefined {
  if (!summary) return undefined;
  return summary.match(pattern)?.[1]?.trim();
}

function extractQualityScore(quality: string | undefined): number | undefined {
  const value = quality?.match(QUALITY_SCORE_PATTERN)?.[1];
  return value ? Number(value) : undefined;
}

function compareRunByAccount(a: ArticleRunRecord, b: ArticleRunRecord): number {
  return (a.accountId ?? a.runId).localeCompare(b.accountId ?? b.runId);
}

function countDistinct(values: Array<string | undefined>): number {
  return new Set(
    values.map((value) => normalizeComparableValue(value)).filter(Boolean),
  ).size;
}

function normalizeComparableValue(value: string | undefined): string {
  return (value ?? "")
    .replace(/，兜底/g, "")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

function formatQualityControlSummary(
  comparison: MatrixRunComparisonReport,
): string {
  const quality = comparison.quality;
  const minScore = quality.minScore === undefined
    ? "未知"
    : `${quality.minScore} 分`;
  return `达标 ${quality.passed}/${quality.scored}，未评分 ${quality.missing}，最低 ${minScore}`;
}

function formatDifferentiationSummary(
  comparison: MatrixRunComparisonReport,
): string {
  if (comparison.accountCount === 0) return "暂无账号产物";
  const state = comparison.differentiation.differentiated ? "已拉开" : "偏同质";
  return `${state}，主线 ${comparison.differentiation.distinctLeadTopics} 种，形态 ${comparison.differentiation.distinctArticleFormats} 种`;
}

async function writeComparisonArtifact(
  artifactStore: ArtifactStore | undefined,
  parent: ArticleRunRecord,
  comparison: MatrixRunComparisonReport,
): Promise<ArtifactRef | undefined> {
  if (!artifactStore) return undefined;
  return await artifactStore.putJson(
    artifactStore.createRunKey(
      parent.runId,
      "matrix-account-comparison",
      "json",
    ),
    comparison,
    { label: "矩阵账号对比", contentType: "application/json" },
  );
}

function mergeArtifactRefs(
  current: ArtifactRef[],
  next: ArtifactRef,
): ArtifactRef[] {
  const byKey = new Map(current.map((artifact) => [artifact.key, artifact]));
  byKey.set(next.key, next);
  return [...byKey.values()];
}
