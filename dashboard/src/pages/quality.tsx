import { useEffect, useMemo, useState } from "react";
import { FileJson } from "lucide-react";
import {
  apiArtifact,
  deleteTopicFeedback,
  getTopicFeedback,
  saveTopicFeedback,
} from "../api/client.ts";
import type {
  AccountLearningSnapshot,
  ArticlePlan,
  ArticleQualityReview,
  ArticleRunDetail,
  ArtifactRef,
  EditorialDecision,
  EditorialTopicFeedback,
  EditorialTopicFeedbackAction,
  EditorialTopicReport,
  PublishArtifactResult,
  TopicCluster,
  TopicRecommendation,
  WeixinAccountInsight,
  WeixinAccountProfile,
} from "../api/types.ts";
import { ArticleQualityShell } from "../components/article-quality-shell.tsx";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  MetricChip,
} from "../components/ui.tsx";

function hostLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function collectArtifacts(run: ArticleRunDetail | null): ArtifactRef[] {
  if (!run) return [];
  const byKey = new Map<string, ArtifactRef>();
  for (const artifact of run.artifacts ?? []) {
    byKey.set(artifact.key, artifact);
  }
  for (const step of run.steps ?? []) {
    for (const artifact of step.inputArtifacts ?? []) {
      byKey.set(artifact.key, artifact);
    }
    for (const artifact of step.outputArtifacts ?? []) {
      byKey.set(artifact.key, artifact);
    }
  }
  return [...byKey.values()];
}

function findTopicArtifact(run: ArticleRunDetail | null): ArtifactRef | null {
  return collectArtifacts(run).find((artifact) =>
    artifact.key.includes("editorial-topics") ||
    artifact.label === "今日选题"
  ) ?? null;
}

function findArticlePlanArtifact(
  run: ArticleRunDetail | null,
): ArtifactRef | null {
  return collectArtifacts(run).find((artifact) =>
    artifact.key.includes("article-plan") ||
    artifact.label === "文章计划"
  ) ?? null;
}

function findEditorialDecisionArtifact(
  run: ArticleRunDetail | null,
): ArtifactRef | null {
  return collectArtifacts(run).find((artifact) =>
    artifact.key.includes("editorial-decision") ||
    artifact.label === "编辑决策"
  ) ?? null;
}

function findQualityReviewArtifact(
  run: ArticleRunDetail | null,
): ArtifactRef | null {
  return collectArtifacts(run).find((artifact) =>
    artifact.key.includes("quality-review") ||
    artifact.label === "质量审稿"
  ) ?? null;
}

function findPublishArtifact(run: ArticleRunDetail | null): ArtifactRef | null {
  return collectArtifacts(run).find((artifact) =>
    artifact.key.includes("publish-result") ||
    artifact.label === "发布结果"
  ) ?? null;
}

function findAccountLearningArtifact(
  run: ArticleRunDetail | null,
): ArtifactRef | null {
  return collectArtifacts(run).find((artifact) =>
    artifact.key.includes("account-learning") ||
    artifact.label === "账号学习快照"
  ) ?? null;
}

function recommendationLabel(value: TopicRecommendation) {
  switch (value) {
    case "lead":
      return "主线";
    case "brief":
      return "短讯";
    case "watch":
      return "观察";
    case "skip":
      return "跳过";
  }
}

function recommendationTone(value: TopicRecommendation) {
  if (value === "lead") return "success";
  if (value === "skip") return "danger";
  if (value === "brief") return "info";
  return "muted";
}

function topicFeedbackActionLabel(value: EditorialTopicFeedbackAction) {
  if (value === "lead") return "锁主线";
  if (value === "adopt") return "采用";
  return "跳过";
}

function topicFeedbackTone(value: EditorialTopicFeedbackAction) {
  if (value === "lead") return "success";
  if (value === "adopt") return "info";
  return "danger";
}

function accountDisplayName(
  account?: WeixinAccountProfile,
  accountId?: string,
) {
  if (!account && !accountId) return "未指定账号";
  const brandName = account?.brand?.displayName;
  return typeof brandName === "string" && brandName.trim()
    ? brandName.trim()
    : account?.name ?? accountId ?? "未指定账号";
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function formatDate(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function profileScoreTone(score: number) {
  if (score >= 75) return "success";
  if (score >= 50) return "warning";
  return "danger";
}

function LearningWorkspace(
  {
    run,
    apiKey,
    account,
    accountInsight,
    onPreviewArtifact,
  }: {
    run: ArticleRunDetail | null;
    apiKey: string;
    account?: WeixinAccountProfile;
    accountInsight?: WeixinAccountInsight;
    onPreviewArtifact: (artifact: ArtifactRef) => void;
  },
) {
  const artifact = useMemo(() => findAccountLearningArtifact(run), [run]);
  const [snapshot, setSnapshot] = useState<AccountLearningSnapshot | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!artifact) {
      setSnapshot(null);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    apiArtifact(
      `/api/artifacts?key=${encodeURIComponent(artifact.key)}`,
      apiKey,
    )
      .then(async (response) =>
        setSnapshot(
          JSON.parse(await response.text()) as AccountLearningSnapshot,
        )
      )
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err))
      )
      .finally(() => setLoading(false));
  }, [artifact, apiKey]);

  if (!run) {
    return (
      <Card>
        <EmptyState>选择一条运行记录查看账号学习依据</EmptyState>
      </Card>
    );
  }

  if (!artifact) {
    return (
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="tp-title text-base font-semibold">账号学习依据</h2>
          <Badge>{run.runId}</Badge>
        </div>
        <EmptyState>
          当前 run
          还没有账号学习快照。新版本运行后会生成画像、反馈和学习规则摘要。
        </EmptyState>
      </Card>
    );
  }

  const accountName = accountDisplayName(account, run.accountId);
  const profileScore = snapshot?.profile.completenessScore ??
    accountInsight?.learning.profileCompleteness.score ?? 0;
  const feedbackCounts = snapshot?.feedback.counts ?? {
    good: accountInsight?.feedbackCounts.good ?? 0,
    ok: accountInsight?.feedbackCounts.ok ?? 0,
    bad: accountInsight?.feedbackCounts.bad ?? 0,
  };
  const topicCounts = snapshot?.topicFeedback.counts ?? {
    lead: accountInsight?.topicFeedbackCounts.lead ?? 0,
    adopt: accountInsight?.topicFeedbackCounts.adopt ?? 0,
    skip: accountInsight?.topicFeedbackCounts.skip ?? 0,
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge>{run.runId}</Badge>
              <Badge>{accountName}</Badge>
              {snapshot && (
                <Badge
                  tone={snapshot.memoryScope === "account-strict"
                    ? "success"
                    : "warning"}
                >
                  {snapshot.memoryScope === "account-strict"
                    ? "账号独立记忆"
                    : "混合/全局记忆"}
                </Badge>
              )}
              <Badge tone={profileScoreTone(profileScore)}>
                画像 {profileScore}%
              </Badge>
            </div>
            <h2 className="tp-title text-lg font-semibold">账号学习依据</h2>
            <p className="tp-muted mt-1 text-sm leading-6">
              这里解释本次文章生成前系统读到了哪些账号画像、人工反馈、主题取舍和来源信号。
              这些信息会影响下一次选题和编辑决策。
            </p>
          </div>
          <Button size="sm" onClick={() => onPreviewArtifact(artifact)}>
            <FileJson className="size-3.5" />
            查看 JSON
          </Button>
        </div>
      </Card>

      {loading && (
        <Card>
          <EmptyState>正在加载账号学习快照...</EmptyState>
        </Card>
      )}
      {error && (
        <div className="tp-danger rounded-md border p-3 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && snapshot && (
        <>
          <div className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="tp-title text-base font-semibold">画像摘要</h3>
                <Badge tone={profileScoreTone(profileScore)}>
                  完整度 {profileScore}%
                </Badge>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <MetricChip
                  label="账号定位"
                  value={snapshot.profile.positioning ?? "未配置"}
                />
                <MetricChip
                  label="目标读者"
                  value={snapshot.profile.audience ?? "未配置"}
                />
                <MetricChip
                  label="语气风格"
                  value={snapshot.profile.tone ?? "未配置"}
                />
                <MetricChip
                  label="标题偏好"
                  value={snapshot.profile.titleStyle ?? "未配置"}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {snapshot.profile.presentFields.map((field) => (
                  <Badge key={field} tone="success">已配置 · {field}</Badge>
                ))}
                {snapshot.profile.missingFields.map((field) => (
                  <Badge key={field} tone="warning">缺少 · {field}</Badge>
                ))}
              </div>
            </Card>

            <Card>
              <h3 className="tp-title text-base font-semibold">反馈入账</h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <MetricChip label="好评" value={feedbackCounts.good} />
                <MetricChip label="一般" value={feedbackCounts.ok} />
                <MetricChip label="差评" value={feedbackCounts.bad} />
                <MetricChip label="锁主线" value={topicCounts.lead} />
                <MetricChip label="采用" value={topicCounts.adopt} />
                <MetricChip label="跳过" value={topicCounts.skip} />
              </div>
              {(snapshot.feedback.latestGood || snapshot.feedback.latestBad) &&
                (
                  <div className="mt-3 space-y-2">
                    {snapshot.feedback.latestGood && (
                      <p className="rounded-md border border-[#bbf7d0] bg-[#ecfdf5] p-2.5 text-sm leading-6 text-[#047857]">
                        延续正反馈：{snapshot.feedback.latestGood}
                      </p>
                    )}
                    {snapshot.feedback.latestBad && (
                      <p className="rounded-md border border-[#fecaca] bg-[#fef2f2] p-2.5 text-sm leading-6 text-[#b91c1c]">
                        规避差反馈：{snapshot.feedback.latestBad}
                      </p>
                    )}
                  </div>
                )}
            </Card>
          </div>

          <div className="grid gap-3 lg:grid-cols-[1fr_0.9fr]">
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="tp-title text-base font-semibold">
                  本次应用的写作指导
                </h3>
                <Badge>{snapshot.appliedGuidance.length}</Badge>
              </div>
              {snapshot.appliedGuidance.length
                ? (
                  <div className="grid gap-2">
                    {snapshot.appliedGuidance.map((item, index) => (
                      <div
                        key={`${item}-${index}`}
                        className="rounded-md border border-[#e2e8f0] bg-[#ffffff]/58 p-3 text-sm leading-6 text-[#334155]"
                      >
                        {item}
                      </div>
                    ))}
                  </div>
                )
                : <EmptyState>暂无明确写作指导</EmptyState>}
            </Card>

            <Card>
              <h3 className="tp-title mb-3 text-base font-semibold">
                主题取舍记忆
              </h3>
              <TopicFeedbackList
                title="锁主线"
                tone="success"
                values={snapshot.topicFeedback.lead}
              />
              <TopicFeedbackList
                title="采用"
                tone="info"
                values={snapshot.topicFeedback.adopt}
              />
              <TopicFeedbackList
                title="跳过"
                tone="danger"
                values={snapshot.topicFeedback.skip}
              />
            </Card>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="tp-title text-base font-semibold">
                  确定性学习规则
                </h3>
                <Badge>{snapshot.deterministicRules.length}</Badge>
              </div>
              <div className="space-y-2">
                {snapshot.deterministicRules.map((rule, index) => (
                  <div
                    key={`${rule}-${index}`}
                    className="rounded-md border border-[#e2e8f0] bg-[#f8fafc] p-3 text-sm leading-6 text-[#334155]"
                  >
                    {rule}
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="tp-title text-base font-semibold">来源信号</h3>
                <Badge>{snapshot.sourceSignals.length} sources</Badge>
              </div>
              {snapshot.sourceSignals.length
                ? (
                  <div className="space-y-2">
                    {snapshot.sourceSignals.slice(0, 6).map((source) => (
                      <div
                        key={`${source.group}-${source.url}`}
                        className="rounded-md border border-[#e2e8f0] bg-[#ffffff]/58 p-3"
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="tp-title min-w-0 truncate text-sm font-medium">
                            {hostLabel(source.url)}
                          </span>
                          <Badge
                            tone={source.lastStatus === "succeeded"
                              ? "success"
                              : source.lastStatus === "failed"
                              ? "danger"
                              : "warning"}
                          >
                            {source.successRate}%
                          </Badge>
                        </div>
                        <p className="tp-muted text-xs leading-5">
                          {source.group} · 有效文章 {source.totalArticles}{" "}
                          · 最近 {source.lastStatus}
                        </p>
                      </div>
                    ))}
                  </div>
                )
                : <EmptyState>暂无来源表现记录</EmptyState>}
            </Card>
          </div>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="tp-title text-base font-semibold">近期文章记忆</h3>
              <Badge>{snapshot.recentArticles.length}</Badge>
            </div>
            {snapshot.recentArticles.length
              ? (
                <div className="grid gap-2 md:grid-cols-2">
                  {snapshot.recentArticles.slice(0, 6).map((article) => (
                    <div
                      key={`${article.createdAt}-${article.title}`}
                      className="rounded-md border border-[#e2e8f0] p-3"
                    >
                      <div className="mb-2 flex items-center gap-2">
                        {article.qualityScore !== undefined && (
                          <Badge
                            tone={article.qualityScore >= 85
                              ? "success"
                              : article.qualityScore >= 75
                              ? "info"
                              : "warning"}
                          >
                            {article.qualityScore} 分
                          </Badge>
                        )}
                        <Badge>{article.publishStatus}</Badge>
                      </div>
                      <h4 className="tp-title text-sm font-semibold leading-6">
                        {article.title}
                      </h4>
                      <p className="tp-muted mt-1 text-xs">
                        {formatDate(article.createdAt)}
                      </p>
                    </div>
                  ))}
                </div>
              )
              : <EmptyState>暂无近期文章记忆</EmptyState>}
          </Card>
        </>
      )}
    </div>
  );
}

function TopicFeedbackList(
  { title, tone, values }: {
    title: string;
    tone: "success" | "info" | "danger";
    values: string[];
  },
) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-2 flex items-center gap-2">
        <Badge tone={tone}>{title}</Badge>
        <span className="tp-muted text-xs">{values.length}</span>
      </div>
      {values.length
        ? (
          <div className="flex flex-wrap gap-1.5">
            {values.slice(0, 8).map((item) => (
              <span
                key={item}
                className="rounded-full border border-[#e2e8f0] bg-[#ffffff]/70 px-2 py-1 text-xs text-[#475569]"
              >
                {item}
              </span>
            ))}
          </div>
        )
        : <p className="tp-muted text-xs">暂无</p>}
    </div>
  );
}

function TopicsWorkspace(
  {
    run,
    apiKey,
    account,
    accountInsight,
    onPreviewArtifact,
  }: {
    run: ArticleRunDetail | null;
    apiKey: string;
    account?: WeixinAccountProfile;
    accountInsight?: WeixinAccountInsight;
    onPreviewArtifact: (artifact: ArtifactRef) => void;
  },
) {
  const artifact = useMemo(() => findTopicArtifact(run), [run]);
  const decisionArtifact = useMemo(() => findEditorialDecisionArtifact(run), [
    run,
  ]);
  const [report, setReport] = useState<EditorialTopicReport | null>(null);
  const [decision, setDecision] = useState<EditorialDecision | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [topicFeedback, setTopicFeedback] = useState<
    EditorialTopicFeedback[]
  >([]);
  const [topicFeedbackError, setTopicFeedbackError] = useState("");
  const [feedbackSavingTopic, setFeedbackSavingTopic] = useState("");

  useEffect(() => {
    if (!artifact) {
      setReport(null);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    apiArtifact(
      `/api/artifacts?key=${encodeURIComponent(artifact.key)}`,
      apiKey,
    )
      .then(async (response) =>
        setReport(JSON.parse(await response.text()) as EditorialTopicReport)
      )
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err))
      )
      .finally(() => setLoading(false));
  }, [artifact, apiKey]);

  useEffect(() => {
    if (!decisionArtifact) {
      setDecision(null);
      return;
    }
    apiArtifact(
      `/api/artifacts?key=${encodeURIComponent(decisionArtifact.key)}`,
      apiKey,
    )
      .then(async (response) =>
        setDecision(JSON.parse(await response.text()) as EditorialDecision)
      )
      .catch(() => setDecision(null));
  }, [decisionArtifact, apiKey]);

  useEffect(() => {
    let cancelled = false;
    if (!run) {
      setTopicFeedback([]);
      setTopicFeedbackError("");
      return;
    }
    setTopicFeedbackError("");
    getTopicFeedback(apiKey, run.runId)
      .then((data) => {
        if (!cancelled) setTopicFeedback(data.feedback);
      })
      .catch((err) => {
        if (!cancelled) {
          setTopicFeedback([]);
          setTopicFeedbackError(
            err instanceof Error ? err.message : String(err),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [run, apiKey]);

  if (!run) {
    return (
      <Card>
        <EmptyState>选择一条运行记录查看今日选题</EmptyState>
      </Card>
    );
  }

  if (!artifact) {
    return (
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="tp-title text-base font-semibold">今日选题</h2>
          <Badge>{run.runId}</Badge>
        </div>
        <EmptyState>
          当前 run 还没有选题产物。新版本运行后会生成主题聚类和评分。
        </EmptyState>
      </Card>
    );
  }

  const scoreByTopic = new Map(
    report?.scores.map((score) => [score.topicId, score]) ?? [],
  );
  const selectedByTopic = new Map(
    decision?.selectedTopics.map((topic) => [topic.topicId, topic]) ?? [],
  );
  const skippedByTopic = new Map(
    decision?.skippedTopics.map((topic) => [topic.topicId, topic]) ?? [],
  );
  const sortedClusters = [...(report?.clusters ?? [])].sort((left, right) =>
    (scoreByTopic.get(right.id)?.finalScore ?? 0) -
    (scoreByTopic.get(left.id)?.finalScore ?? 0)
  );
  const leadCount =
    report?.scores.filter((score) => score.recommendedUse === "lead").length ??
      0;
  const skippedCount = decision?.skippedTopics.length ?? 0;
  const selectedCount = decision?.selectedTopics.length ?? 0;
  const topicFeedbackByTopic = new Map(
    topicFeedback.map((item) => [item.topicId, item]),
  );
  const accountName = accountDisplayName(account, run.accountId);
  const accountPositioning = textValue(account?.brand?.positioning);
  const accountAudience = textValue(account?.brand?.audience);
  const accountTone = textValue(account?.brand?.tone);
  const accountGuidance = accountInsight?.learning.writingGuidance ?? [];

  async function markTopicFeedback(
    cluster: TopicCluster,
    action: EditorialTopicFeedbackAction,
  ) {
    if (!run) return;
    setFeedbackSavingTopic(cluster.id);
    try {
      const label = topicFeedbackActionLabel(action);
      const data = await saveTopicFeedback(apiKey, run.runId, cluster.id, {
        action,
        title: cluster.title,
        reason: `用户在选题工作台标记为${label}`,
        profileId: run.profileId,
        accountId: run.accountId,
      });
      setTopicFeedback((current) => [
        data.feedback,
        ...current.filter((item) => item.topicId !== cluster.id),
      ]);
      setTopicFeedbackError("");
    } catch (err) {
      setTopicFeedbackError(err instanceof Error ? err.message : String(err));
    } finally {
      setFeedbackSavingTopic("");
    }
  }

  async function clearTopicFeedback(cluster: TopicCluster) {
    if (!run) return;
    setFeedbackSavingTopic(cluster.id);
    try {
      await deleteTopicFeedback(apiKey, run.runId, cluster.id);
      setTopicFeedback((current) =>
        current.filter((item) => item.topicId !== cluster.id)
      );
      setTopicFeedbackError("");
    } catch (err) {
      setTopicFeedbackError(err instanceof Error ? err.message : String(err));
    } finally {
      setFeedbackSavingTopic("");
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge>{run.runId}</Badge>
              {report?.fallback && <Badge tone="danger">fallback</Badge>}
              {report && <Badge tone="success">{leadCount} 个主线候选</Badge>}
              {decision && <Badge>{selectedCount} 个入选</Badge>}
              {decision && skippedCount > 0 && (
                <Badge tone="warning">{skippedCount} 个跳过</Badge>
              )}
              <Badge>{accountName}</Badge>
            </div>
            <h2 className="tp-title text-lg font-semibold">选题工作台</h2>
            <p className="tp-muted mt-1 text-sm leading-6">
              先审主题，再看账号适配和编辑取舍：哪些做主线、哪些做辅助、哪些应该跳过。
            </p>
            {report?.error && (
              <div className="tp-danger mt-3 rounded-md border p-3 text-sm">
                AI 选题失败，已使用本地兜底：{report.error}
              </div>
            )}
          </div>
          <Button size="sm" onClick={() => onPreviewArtifact(artifact)}>
            <FileJson className="size-3.5" />
            查看 JSON
          </Button>
        </div>
      </Card>

      {loading && (
        <Card>
          <EmptyState>正在加载选题产物...</EmptyState>
        </Card>
      )}
      {error && (
        <div className="tp-danger rounded-md border p-3 text-sm">
          {error}
        </div>
      )}
      {topicFeedbackError && (
        <div className="tp-danger rounded-md border p-3 text-sm">
          主题反馈保存失败：{topicFeedbackError}
        </div>
      )}

      {!loading && !error && report && (
        <>
          <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
            <Card>
              <h3 className="tp-title text-base font-semibold">账号适配</h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <MetricChip label="目标账号" value={accountName} />
                <MetricChip
                  label="账号定位"
                  value={accountPositioning || "未配置"}
                />
                <MetricChip
                  label="目标读者"
                  value={accountAudience || "未配置"}
                />
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {accountTone && (
                  <div className="rounded-md border border-[#e2e8f0] bg-[#ffffff]/58 p-3 text-sm leading-6 text-[#475569]">
                    表达语气：{accountTone}
                  </div>
                )}
                {decision?.decisionSummary && (
                  <div className="rounded-md border border-[#e2e8f0] bg-[#ffffff]/58 p-3 text-sm leading-6 text-[#475569]">
                    编辑判断：{decision.decisionSummary}
                  </div>
                )}
              </div>
            </Card>
            <Card>
              <h3 className="tp-title text-base font-semibold">审题提醒</h3>
              <div className="mt-3 space-y-2">
                {(accountGuidance.length ? accountGuidance.slice(0, 4) : [
                  "先确认主线是否服务账号定位。",
                  "避免只按热度选题，优先看证据和读者收益。",
                ]).map((item) => (
                  <p
                    key={item}
                    className="rounded-md border border-[#e2e8f0] bg-[#ffffff]/58 p-2.5 text-sm leading-6 text-[#475569]"
                  >
                    {item}
                  </p>
                ))}
              </div>
            </Card>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {sortedClusters.map((cluster) => {
              const score = scoreByTopic.get(cluster.id);
              const selected = selectedByTopic.get(cluster.id);
              const skipped = skippedByTopic.get(cluster.id);
              const manualFeedback = topicFeedbackByTopic.get(cluster.id);
              const decisionReason = selected?.reason ?? skipped?.reason;
              const decisionTone = skipped
                ? "danger"
                : selected?.role === "lead"
                ? "success"
                : selected
                ? "info"
                : "muted";
              return (
                <Card key={cluster.id} className="p-3">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge
                          tone={recommendationTone(
                            score?.recommendedUse ??
                              "watch",
                          )}
                        >
                          {recommendationLabel(
                            score?.recommendedUse ?? "watch",
                          )}
                        </Badge>
                        <Badge tone={decisionTone}>
                          {skipped
                            ? "已跳过"
                            : selected
                            ? `已入选 · ${selected.role}`
                            : "待判断"}
                        </Badge>
                        <Badge>{score?.finalScore ?? "-"} 分</Badge>
                        <Badge>{cluster.sourceCount} sources</Badge>
                        {manualFeedback && (
                          <Badge
                            tone={topicFeedbackTone(manualFeedback.action)}
                          >
                            人工 · {topicFeedbackActionLabel(
                              manualFeedback.action,
                            )}
                          </Badge>
                        )}
                      </div>
                      <h3 className="tp-title text-base font-semibold leading-6">
                        {cluster.title}
                      </h3>
                    </div>
                  </div>
                  <p className="tp-muted text-sm leading-6">
                    {cluster.summary}
                  </p>
                  <div className="mt-3 grid gap-2">
                    {score?.reason && (
                      <div className="rounded-md border border-[#e2e8f0] bg-[#ffffff]/58 p-2.5 text-sm leading-6 text-[#475569]">
                        推荐理由：{score.reason}
                      </div>
                    )}
                    {decisionReason && (
                      <div className="rounded-md border border-[#e2e8f0] bg-[#f8fafc] p-2.5 text-sm leading-6 text-[#334155]">
                        编辑取舍：{decisionReason}
                      </div>
                    )}
                    {manualFeedback?.reason && (
                      <div className="rounded-md border border-[#fed7aa] bg-[#fff7ed] p-2.5 text-sm leading-6 text-[#9a3412]">
                        人工取舍：{manualFeedback.reason}
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--tp-border)] pt-3">
                    <Button
                      size="sm"
                      variant={manualFeedback?.action === "lead"
                        ? "primary"
                        : "secondary"}
                      disabled={feedbackSavingTopic === cluster.id}
                      onClick={() => markTopicFeedback(cluster, "lead")}
                    >
                      锁主线
                    </Button>
                    <Button
                      size="sm"
                      variant={manualFeedback?.action === "adopt"
                        ? "primary"
                        : "secondary"}
                      disabled={feedbackSavingTopic === cluster.id}
                      onClick={() => markTopicFeedback(cluster, "adopt")}
                    >
                      采用
                    </Button>
                    <Button
                      size="sm"
                      variant={manualFeedback?.action === "skip"
                        ? "danger"
                        : "secondary"}
                      disabled={feedbackSavingTopic === cluster.id}
                      onClick={() => markTopicFeedback(cluster, "skip")}
                    >
                      跳过
                    </Button>
                    {manualFeedback && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={feedbackSavingTopic === cluster.id}
                        onClick={() => clearTopicFeedback(cluster)}
                      >
                        清除
                      </Button>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <MetricChip label="新鲜度" value={score?.novelty ?? "-"} />
                    <MetricChip
                      label="相关性"
                      value={score?.relevance ?? "-"}
                    />
                    <MetricChip label="影响" value={score?.impact ?? "-"} />
                    <MetricChip label="证据" value={score?.evidence ?? "-"} />
                    <MetricChip
                      label="可行动"
                      value={score?.actionability ?? "-"}
                    />
                    <MetricChip label="风险" value={score?.risk ?? "-"} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {cluster.keywords.slice(0, 6).map((keyword) => (
                      <span
                        key={keyword}
                        className="rounded-full bg-[#eff6ff] px-2 py-0.5 text-xs text-[#64748b]"
                      >
                        {keyword}
                      </span>
                    ))}
                  </div>
                  <div className="tp-muted mt-3 truncate text-xs">
                    Primary: {cluster.primaryArticleId} · Articles:{" "}
                    {cluster.articleIds.join(", ")}
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function EditorialDecisionWorkspace(
  {
    run,
    apiKey,
    onPreviewArtifact,
  }: {
    run: ArticleRunDetail | null;
    apiKey: string;
    onPreviewArtifact: (artifact: ArtifactRef) => void;
  },
) {
  const artifact = useMemo(() => findEditorialDecisionArtifact(run), [run]);
  const [decision, setDecision] = useState<EditorialDecision | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!artifact) {
      setDecision(null);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    apiArtifact(
      `/api/artifacts?key=${encodeURIComponent(artifact.key)}`,
      apiKey,
    )
      .then(async (response) =>
        setDecision(JSON.parse(await response.text()) as EditorialDecision)
      )
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err))
      )
      .finally(() => setLoading(false));
  }, [artifact, apiKey]);

  if (!run) {
    return (
      <Card>
        <EmptyState>选择一条运行记录查看编辑决策</EmptyState>
      </Card>
    );
  }

  if (!artifact) {
    return (
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="tp-title text-base font-semibold">编辑决策</h2>
          <Badge>{run.runId}</Badge>
        </div>
        <EmptyState>
          当前 run 还没有编辑决策产物。新版本运行后会解释为什么写这篇。
        </EmptyState>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge>{run.runId}</Badge>
              {decision?.fallback && <Badge tone="danger">fallback</Badge>}
              {decision && (
                <Badge tone="success">{decision.recommendedFormat}</Badge>
              )}
              {decision && (
                <Badge
                  tone={decision.duplicationRisk.level === "high"
                    ? "danger"
                    : decision.duplicationRisk.level === "medium"
                    ? "muted"
                    : "success"}
                >
                  重复风险 {decision.duplicationRisk.level}
                </Badge>
              )}
            </div>
            <h2 className="tp-title text-lg font-semibold">为什么写这篇</h2>
            <p className="tp-muted mt-1 text-sm leading-6">
              编辑决策会把主题评分、历史记忆和人工反馈转成写作前的取舍说明。
            </p>
            {decision?.error && (
              <div className="tp-danger mt-3 rounded-md border p-3 text-sm">
                AI 编辑决策失败，已使用本地兜底：{decision.error}
              </div>
            )}
          </div>
          <Button size="sm" onClick={() => onPreviewArtifact(artifact)}>
            <FileJson className="size-3.5" />
            查看 JSON
          </Button>
        </div>
      </Card>

      {loading && (
        <Card>
          <EmptyState>正在加载编辑决策...</EmptyState>
        </Card>
      )}
      {error && (
        <div className="tp-danger rounded-md border p-3 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && decision && (
        <>
          <div className="grid gap-3 lg:grid-cols-[1fr_0.8fr]">
            <Card>
              <div className="tp-muted text-xs">主线选题</div>
              <h3 className="tp-title mt-2 text-xl font-semibold leading-7">
                {decision.leadTopicTitle}
              </h3>
              <p className="mt-3 text-sm leading-6 text-[#334155]">
                {decision.decisionSummary}
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {decision.whyThisNow.map((reason) => (
                  <div
                    key={reason}
                    className="rounded-md border border-[#e2e8f0] bg-[#ffffff]/58 p-2.5 text-sm leading-6 text-[#475569]"
                  >
                    {reason}
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <h3 className="tp-title mb-3 text-base font-semibold">
                写作边界
              </h3>
              <div className="space-y-2">
                {decision.writingDirectives.map((item) => (
                  <p key={item} className="text-sm leading-6 text-[#334155]">
                    {item}
                  </p>
                ))}
              </div>
              {decision.titleWarnings.length > 0 && (
                <div className="mt-4 rounded-md border border-[#e2e8f0] bg-[#f8fafc] p-3">
                  <div className="tp-title mb-2 text-sm font-semibold">
                    标题避免项
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {decision.titleWarnings.map((item) => (
                      <Badge key={item} tone="danger">{item}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <h3 className="tp-title mb-3 text-base font-semibold">
                入选主题
              </h3>
              <div className="space-y-2">
                {decision.selectedTopics.map((topic) => (
                  <div
                    key={topic.topicId}
                    className="rounded-md border border-[#e2e8f0] p-3"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <Badge tone={topic.role === "lead" ? "success" : "info"}>
                        {topic.role}
                      </Badge>
                      <span className="tp-title text-sm font-medium">
                        {topic.topicId}
                      </span>
                    </div>
                    <p className="tp-muted text-sm leading-6">{topic.reason}</p>
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <h3 className="tp-title mb-3 text-base font-semibold">
                跳过主题
              </h3>
              {decision.skippedTopics.length
                ? (
                  <div className="space-y-2">
                    {decision.skippedTopics.map((topic) => (
                      <div
                        key={topic.topicId}
                        className="rounded-md border border-[#e2e8f0] p-3"
                      >
                        <div className="tp-title text-sm font-medium">
                          {topic.topicId}
                        </div>
                        <p className="tp-muted mt-1 text-sm leading-6">
                          {topic.reason}
                        </p>
                      </div>
                    ))}
                  </div>
                )
                : <EmptyState>没有明确跳过的主题</EmptyState>}
            </Card>
          </div>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="tp-title text-base font-semibold">来源判断</h3>
              <Badge>{decision.sourceJudgements.length} sources</Badge>
            </div>
            {decision.sourceJudgements.length
              ? (
                <div className="grid gap-2 md:grid-cols-2">
                  {decision.sourceJudgements.map((source) => (
                    <div
                      key={source.url}
                      className="rounded-md border border-[#e2e8f0] bg-[#ffffff]/58 p-3"
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="tp-title min-w-0 truncate text-sm font-medium">
                          {hostLabel(source.url)}
                        </span>
                        <Badge>{source.role}</Badge>
                      </div>
                      <p className="tp-muted text-sm leading-6">
                        {source.reason}
                      </p>
                    </div>
                  ))}
                </div>
              )
              : <EmptyState>没有单独来源判断</EmptyState>}
          </Card>
        </>
      )}
    </div>
  );
}

function ArticlePlanWorkspace(
  {
    run,
    apiKey,
    onPreviewArtifact,
  }: {
    run: ArticleRunDetail | null;
    apiKey: string;
    onPreviewArtifact: (artifact: ArtifactRef) => void;
  },
) {
  const artifact = useMemo(() => findArticlePlanArtifact(run), [run]);
  const [plan, setPlan] = useState<ArticlePlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!artifact) {
      setPlan(null);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    apiArtifact(
      `/api/artifacts?key=${encodeURIComponent(artifact.key)}`,
      apiKey,
    )
      .then(async (response) =>
        setPlan(JSON.parse(await response.text()) as ArticlePlan)
      )
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err))
      )
      .finally(() => setLoading(false));
  }, [artifact, apiKey]);

  if (!run) {
    return (
      <Card>
        <EmptyState>选择一条运行记录查看文章计划</EmptyState>
      </Card>
    );
  }

  if (!artifact) {
    return (
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="tp-title text-base font-semibold">文章计划</h2>
          <Badge>{run.runId}</Badge>
        </div>
        <EmptyState>
          当前 run 还没有文章计划产物。新版本运行后会在正文生成前输出计划。
        </EmptyState>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge>{run.runId}</Badge>
              {plan?.fallback && <Badge tone="danger">fallback</Badge>}
              {plan && <Badge tone="success">{plan.format}</Badge>}
            </div>
            <h2 className="tp-title text-lg font-semibold">文章计划</h2>
            <p className="tp-muted mt-1 text-sm leading-6">
              正文生成前的编辑蓝图：主线、章节、标题、封面、配图和风险边界。
            </p>
            {plan?.error && (
              <div className="tp-danger mt-3 rounded-md border p-3 text-sm">
                AI 文章计划失败，已使用本地兜底：{plan.error}
              </div>
            )}
          </div>
          <Button size="sm" onClick={() => onPreviewArtifact(artifact)}>
            <FileJson className="size-3.5" />
            查看 JSON
          </Button>
        </div>
      </Card>

      {loading && (
        <Card>
          <EmptyState>正在加载文章计划...</EmptyState>
        </Card>
      )}
      {error && (
        <div className="tp-danger rounded-md border p-3 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && plan && (
        <>
          <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <div className="tp-muted mb-2 text-xs">主线观点</div>
              <h3 className="tp-title text-lg font-semibold leading-7">
                {plan.thesis}
              </h3>
              <p className="tp-muted mt-3 text-sm leading-6">
                {plan.summary}
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <MetricChip label="目标读者" value={plan.targetReader} />
                <MetricChip
                  label="来源文章"
                  value={plan.sourceArticleIds.length}
                />
              </div>
            </Card>
            <Card>
              <div className="tp-muted mb-2 text-xs">封面方向</div>
              <h3 className="tp-title text-base font-semibold">
                {plan.coverDirection.textBrief}
              </h3>
              <p className="tp-muted mt-2 text-sm leading-6">
                {plan.coverDirection.visualBrief}
              </p>
              <Badge className="mt-3">{plan.coverDirection.mood}</Badge>
            </Card>
          </div>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="tp-title text-base font-semibold">章节结构</h3>
              <Badge>{plan.sections.length} sections</Badge>
            </div>
            <div className="space-y-3">
              {plan.sections.map((section, index) => (
                <div
                  key={section.id}
                  className="rounded-md border border-[#e2e8f0] bg-[#ffffff]/58 p-3"
                >
                  <div className="mb-2 flex items-start gap-3">
                    <span className="grid size-7 shrink-0 place-items-center rounded-md bg-[#0f172a] text-xs font-semibold text-[#ffffff]">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <h4 className="tp-title text-sm font-semibold leading-6">
                        {section.title}
                      </h4>
                      <p className="tp-muted text-xs leading-5">
                        {section.intent} · {section.angle}
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-2 lg:grid-cols-[1fr_160px]">
                    <div className="space-y-1">
                      {section.keyPoints.slice(0, 5).map((point) => (
                        <p
                          key={point}
                          className="text-sm leading-6 text-[#334155]"
                        >
                          {point}
                        </p>
                      ))}
                    </div>
                    <div className="tp-muted text-xs leading-5">
                      Articles: {section.articleIds.join(", ")}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <h3 className="tp-title mb-3 text-base font-semibold">
                标题方向
              </h3>
              <div className="space-y-2">
                {plan.titleDirections.map((item) => (
                  <div
                    key={`${item.title}-${item.angle}`}
                    className="rounded-md border border-[#e2e8f0] p-3"
                  >
                    <div className="tp-title text-sm font-semibold">
                      {item.title}
                    </div>
                    <p className="tp-muted mt-1 text-xs leading-5">
                      {item.angle} · {item.reason}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <h3 className="tp-title mb-3 text-base font-semibold">
                风险边界
              </h3>
              <div className="space-y-2">
                {plan.riskNotes.map((note) => (
                  <div
                    key={`${note.level}-${note.issue}`}
                    className="rounded-md border border-[#e2e8f0] p-3"
                  >
                    <Badge
                      tone={note.level === "high"
                        ? "danger"
                        : note.level === "medium"
                        ? "info"
                        : "muted"}
                    >
                      {note.level}
                    </Badge>
                    <div className="tp-title mt-2 text-sm font-semibold">
                      {note.issue}
                    </div>
                    <p className="tp-muted mt-1 text-xs leading-5">
                      {note.handling}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function QualityReviewWorkspace(
  {
    run,
    apiKey,
    onPreviewArtifact,
  }: {
    run: ArticleRunDetail | null;
    apiKey: string;
    onPreviewArtifact: (artifact: ArtifactRef) => void;
  },
) {
  const artifact = useMemo(() => findQualityReviewArtifact(run), [run]);
  const publishArtifact = useMemo(() => findPublishArtifact(run), [run]);
  const [review, setReview] = useState<ArticleQualityReview | null>(null);
  const [publishResult, setPublishResult] = useState<
    PublishArtifactResult | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!artifact) {
      setReview(null);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    apiArtifact(
      `/api/artifacts?key=${encodeURIComponent(artifact.key)}`,
      apiKey,
    )
      .then(async (response) =>
        setReview(JSON.parse(await response.text()) as ArticleQualityReview)
      )
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err))
      )
      .finally(() => setLoading(false));
  }, [artifact, apiKey]);

  useEffect(() => {
    if (!publishArtifact) {
      setPublishResult(null);
      return;
    }
    apiArtifact(
      `/api/artifacts?key=${encodeURIComponent(publishArtifact.key)}`,
      apiKey,
    )
      .then(async (response) =>
        setPublishResult(
          JSON.parse(await response.text()) as PublishArtifactResult,
        )
      )
      .catch(() => setPublishResult(null));
  }, [publishArtifact, apiKey]);

  if (!run) {
    return (
      <Card>
        <EmptyState>选择一条运行记录查看质量审稿</EmptyState>
      </Card>
    );
  }

  if (!artifact) {
    return (
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="tp-title text-base font-semibold">质量审稿</h2>
          <Badge>{run.runId}</Badge>
        </div>
        <EmptyState>
          当前 run 还没有质量审稿产物。新版本运行后会在发布前输出审稿报告。
        </EmptyState>
      </Card>
    );
  }

  const dimensionLabels: Record<string, string> = {
    factConsistency: "事实一致",
    titleQuality: "标题质量",
    structureQuality: "结构",
    expressionQuality: "表达",
    htmlCompliance: "HTML",
    imageRelevance: "图片",
    riskHandling: "风险",
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge>{run.runId}</Badge>
              {review?.fallback && <Badge tone="danger">fallback</Badge>}
              {review && (
                <Badge tone={review.allowPublish ? "success" : "danger"}>
                  {review.recommendedAction}
                </Badge>
              )}
            </div>
            <h2 className="tp-title text-lg font-semibold">质量审稿</h2>
            <p className="tp-muted mt-1 text-sm leading-6">
              发布前检查事实、标题、结构、表达、HTML、图片和风险边界。
            </p>
            {review?.error && (
              <div className="tp-danger mt-3 rounded-md border p-3 text-sm">
                AI 审稿失败，已使用本地兜底：{review.error}
              </div>
            )}
            {publishResult?.status === "blocked" && (
              <div className="tp-danger mt-3 rounded-md border p-3 text-sm">
                真实发布已被质量门禁拦截：{publishResult.reason ?? "质量未通过"}
              </div>
            )}
          </div>
          <Button size="sm" onClick={() => onPreviewArtifact(artifact)}>
            <FileJson className="size-3.5" />
            查看 JSON
          </Button>
        </div>
      </Card>

      {loading && (
        <Card>
          <EmptyState>正在加载质量审稿...</EmptyState>
        </Card>
      )}
      {error && (
        <div className="tp-danger rounded-md border p-3 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && review && (
        <>
          <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
            <Card>
              <div className="tp-muted text-xs">总分</div>
              <div className="mt-2 flex items-end gap-2">
                <span className="tp-title text-5xl font-semibold leading-none">
                  {review.overallScore}
                </span>
                <span className="tp-muted pb-1 text-sm">/ 100</span>
              </div>
              <p className="tp-muted mt-4 text-sm leading-6">
                {review.summary}
              </p>
            </Card>
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="tp-title text-base font-semibold">维度评分</h3>
                <Badge>{Object.keys(review.dimensionScores).length}</Badge>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(review.dimensionScores).map(([key, value]) => (
                  <MetricChip
                    key={key}
                    label={dimensionLabels[key] ?? key}
                    value={value}
                  />
                ))}
              </div>
            </Card>
          </div>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="tp-title text-base font-semibold">问题列表</h3>
              <Badge>{review.issues.length} issues</Badge>
            </div>
            {review.issues.length
              ? (
                <div className="space-y-2">
                  {review.issues.map((issue) => (
                    <div
                      key={issue.id}
                      className="rounded-md border border-[#e2e8f0] bg-[#ffffff]/58 p-3"
                    >
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <Badge tone={issueSeverityTone(issue.severity)}>
                          {issue.severity}
                        </Badge>
                        <Badge>{issue.category}</Badge>
                        {issue.autoFixable && <Badge tone="info">可修复</Badge>}
                      </div>
                      <div className="tp-title text-sm font-semibold">
                        {issue.message}
                      </div>
                      {issue.evidence && (
                        <p className="tp-muted mt-1 text-xs leading-5">
                          证据：{issue.evidence}
                        </p>
                      )}
                      <p className="mt-2 text-sm leading-6 text-[#334155]">
                        {issue.suggestion}
                      </p>
                    </div>
                  ))}
                </div>
              )
              : <EmptyState>没有发现明确问题</EmptyState>}
          </Card>

          {review.repairSuggestions.length > 0 && (
            <Card>
              <h3 className="tp-title mb-3 text-base font-semibold">
                修复建议
              </h3>
              <div className="space-y-2">
                {review.repairSuggestions.map((suggestion) => (
                  <p
                    key={suggestion}
                    className="rounded-md border border-[#e2e8f0] p-3 text-sm leading-6 text-[#334155]"
                  >
                    {suggestion}
                  </p>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

export function ArticleQualityWorkspace(
  {
    run,
    apiKey,
    accounts,
    insights,
    onPreviewArtifact,
  }: {
    run: ArticleRunDetail | null;
    apiKey: string;
    accounts?: WeixinAccountProfile[];
    insights?: WeixinAccountInsight[];
    onPreviewArtifact: (artifact: ArtifactRef) => void;
  },
) {
  const accountId = run?.accountId ?? "default";
  const account = accounts?.find((item) => item.id === accountId);
  const accountInsight = insights?.find((item) => item.accountId === accountId);
  return (
    <ArticleQualityShell
      runStatus={run?.status}
      accountId={run?.accountId}
      profileId={run?.profileId}
      renderTab={(tab) => (
        tab === "learning"
          ? (
            <LearningWorkspace
              run={run}
              apiKey={apiKey}
              account={account}
              accountInsight={accountInsight}
              onPreviewArtifact={onPreviewArtifact}
            />
          )
          : tab === "review"
          ? (
            <QualityReviewWorkspace
              run={run}
              apiKey={apiKey}
              onPreviewArtifact={onPreviewArtifact}
            />
          )
          : tab === "topics"
          ? (
            <TopicsWorkspace
              run={run}
              apiKey={apiKey}
              account={account}
              accountInsight={accountInsight}
              onPreviewArtifact={onPreviewArtifact}
            />
          )
          : tab === "decision"
          ? (
            <EditorialDecisionWorkspace
              run={run}
              apiKey={apiKey}
              onPreviewArtifact={onPreviewArtifact}
            />
          )
          : (
            <ArticlePlanWorkspace
              run={run}
              apiKey={apiKey}
              onPreviewArtifact={onPreviewArtifact}
            />
          )
      )}
    />
  );
}

function issueSeverityTone(
  severity: ArticleQualityReview["issues"][number]["severity"],
) {
  if (severity === "blocker" || severity === "high") return "danger";
  if (severity === "medium") return "info";
  return "muted";
}
