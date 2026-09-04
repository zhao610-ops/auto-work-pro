import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Eye,
  FileJson,
  FileText,
  Image as ImageIcon,
  Loader2,
  RotateCcw,
  Save,
  Search,
  XCircle,
} from "lucide-react";
import { apiJson } from "../api/client.ts";
import type {
  ArticleRunDetail,
  ArticleRunRecord,
  ArtifactRef,
  EditorialFeedbackRating,
  EditorialRunFeedback,
  RunStatus,
  StepStatus,
} from "../api/types.ts";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Select,
} from "../components/ui.tsx";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function formatDate(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatDuration(ms?: number) {
  if (ms === undefined) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatSize(size?: number) {
  if (!size) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function statusTone(status: RunStatus | StepStatus) {
  if (status === "succeeded") return "success";
  if (status === "failed" || status === "cancelled") return "danger";
  if (status === "running" || status === "queued") return "info";
  return "muted";
}

function statusIcon(status: RunStatus | StepStatus) {
  if (status === "succeeded") return <CheckCircle2 className="size-4" />;
  if (status === "failed" || status === "cancelled") {
    return <XCircle className="size-4" />;
  }
  if (status === "running") return <Loader2 className="size-4 animate-spin" />;
  return <Clock3 className="size-4" />;
}

function artifactIcon(contentType: string) {
  if (contentType.includes("image/")) return <ImageIcon className="size-4" />;
  if (contentType.includes("json")) return <FileJson className="size-4" />;
  return <FileText className="size-4" />;
}

function explainError(message?: string) {
  if (!message) return "";
  const lower = message.toLowerCase();
  if (message.includes("IP白名单") || lower.includes("whitelist")) {
    return "微信公众号 IP 白名单不包含当前服务器。远程发布建议走 weixin-relay，固定 IP 机器直连微信。";
  }
  if (
    message.includes("标题生成结果为空") ||
    message.includes("未获取到有效的标题")
  ) {
    return "大模型没有返回可用标题。可以降低模型温度、换模型，或先使用本地标题兜底继续 dry-run。";
  }
  if (message.includes("图片生成任务失败") || message.includes("封面生成")) {
    return "图片生成供应商返回失败。检查图片 provider 的 API Key、模型名、额度和返回 URL 是否可下载。";
  }
  if (message.includes("未解析到有效的评分结果")) {
    return "排序模型输出格式不符合要求，常见原因是模型输出了推理内容或没有按“文章ID: 分数”返回。";
  }
  if (message.includes("数据源") || message.includes("抓取")) {
    return "数据源抓取失败。检查 URL、fetchGroups、对应 provider 凭证和网络可访问性。";
  }
  if (lower.includes("unauthorized") || message.includes("未授权")) {
    return "认证失败。确认 Dashboard/API 使用的是 server.apiKey。";
  }
  return "";
}

function RunList(
  {
    runs,
    selectedRunId,
    onSelect,
    filter,
    setFilter,
    query,
    setQuery,
  }: {
    runs: ArticleRunRecord[];
    selectedRunId: string | null;
    onSelect: (runId: string) => void;
    filter: "all" | RunStatus;
    setFilter: (filter: "all" | RunStatus) => void;
    query: string;
    setQuery: (query: string) => void;
  },
) {
  const filtered = runs.filter((run) => {
    const matchStatus = filter === "all" || run.status === filter;
    const matchQuery = !query ||
      run.runId.toLowerCase().includes(query) ||
      (run.accountId ?? "").toLowerCase().includes(query) ||
      (run.parentRunId ?? "").toLowerCase().includes(query);
    return matchStatus && matchQuery;
  });
  return (
    <Card className="p-0">
      <div className="border-b border-[#e2e8f0] p-3">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="tp-title text-base font-semibold">
            运行记录
          </h2>
          <Badge>{runs.length}</Badge>
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-[#94a3b8]" />
            <Input
              className="pl-9"
              placeholder="搜索 runId"
              value={query}
              onChange={(event) =>
                setQuery(event.currentTarget.value.toLowerCase())}
            />
          </label>
          <Select
            value={filter}
            onChange={(event) =>
              setFilter(event.currentTarget.value as RunStatus)}
          >
            <option value="all">全部状态</option>
            <option value="queued">queued</option>
            <option value="running">running</option>
            <option value="succeeded">succeeded</option>
            <option value="failed">failed</option>
            <option value="cancelled">cancelled</option>
          </Select>
        </div>
      </div>
      <div className="tp-scrollbar max-h-[620px] overflow-auto p-2">
        {filtered.length
          ? filtered.map((run) => (
            <button
              type="button"
              key={run.runId}
              className={cx(
                "mb-1.5 w-full rounded-md border p-2.5 text-left transition",
                run.runId === selectedRunId
                  ? "border-[#0f172a] bg-[#f1e7d7]"
                  : "border-transparent hover:border-[#e2e8f0] hover:bg-[#f8fafc]",
              )}
              onClick={() => onSelect(run.runId)}
            >
              <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                <div className="tp-title min-w-0 truncate pr-1 text-sm font-medium">
                  {run.runId}
                </div>
                <div className="shrink-0">
                  <Badge tone={statusTone(run.status)} className="max-w-[86px]">
                    {statusIcon(run.status)}
                    {run.status}
                  </Badge>
                </div>
              </div>
              <div className="tp-muted text-xs">
                {run.mode} · {run.trigger} ·{" "}
                {run.dryRun ? "dry-run" : "publish"}
              </div>
              {(run.runKind || run.accountId) && (
                <div className="tp-muted mt-1 flex flex-wrap gap-1.5 text-xs">
                  {run.runKind && <span>{run.runKind}</span>}
                  {run.accountId && <span>账号：{run.accountId}</span>}
                </div>
              )}
              <div className="tp-subtle mt-1 text-xs">
                {formatDate(run.createdAt)}
              </div>
            </button>
          ))
          : <EmptyState>没有匹配的运行记录</EmptyState>}
      </div>
    </Card>
  );
}

function RunDetail(
  {
    run,
    allRuns,
    apiKey,
    profileId,
    onSelectRun,
    onRerunAccount,
    onPreviewArtifact,
  }: {
    run: ArticleRunDetail | null;
    allRuns: ArticleRunRecord[];
    apiKey: string;
    profileId: string;
    onSelectRun: (runId: string) => void;
    onRerunAccount?: (run: ArticleRunRecord) => Promise<void>;
    onPreviewArtifact: (artifact: ArtifactRef) => void;
  },
) {
  const artifacts = useMemo(() => collectArtifacts(run), [run]);
  const relatedMatrixRuns = useMemo(
    () => collectRelatedMatrixRuns(run, allRuns),
    [run, allRuns],
  );

  if (!run) {
    return (
      <Card>
        <EmptyState>选择一条运行记录查看详情</EmptyState>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <Badge tone={statusTone(run.status)}>
                {statusIcon(run.status)}
                {run.status}
              </Badge>
              <Badge>{run.dryRun ? "dry-run" : "publish"}</Badge>
              {run.runKind && <Badge>{run.runKind}</Badge>}
            </div>
            <h2 className="tp-title break-all text-lg font-semibold">
              {run.runId}
            </h2>
            {(run.accountId || run.parentRunId || run.profileId) && (
              <div className="tp-muted mt-2 flex flex-wrap gap-2 text-xs">
                {run.accountId && <span>账号：{run.accountId}</span>}
                {run.profileId && <span>方案：{run.profileId}</span>}
                {run.parentRunId && <span>父批次：{run.parentRunId}</span>}
              </div>
            )}
            {run.summary && (
              <p className="tp-muted mt-3 whitespace-pre-wrap text-sm leading-6">
                {run.summary}
              </p>
            )}
            {run.error && (
              <div className="tp-danger mt-3 rounded-md border p-3 text-sm">
                {run.error}
                {explainError(run.error) && (
                  <div className="mt-2 border-t border-[#edc5b8] pt-2 text-xs leading-5">
                    {explainError(run.error)}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="tp-muted grid min-w-56 gap-1.5 text-xs">
            <div>创建：{formatDate(run.createdAt)}</div>
            <div>更新：{formatDate(run.updatedAt)}</div>
            <div>完成：{formatDate(run.finishedAt)}</div>
          </div>
        </div>
      </Card>

      <RunFeedbackPanel run={run} apiKey={apiKey} profileId={profileId} />

      <MatrixRunPanel
        run={run}
        relatedRuns={relatedMatrixRuns}
        onSelectRun={onSelectRun}
        onRerunAccount={onRerunAccount}
      />

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="tp-title text-base font-semibold">
            步骤时间线
          </h3>
          <Badge>{run.steps.length} steps</Badge>
        </div>
        {run.steps.length
          ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="tp-muted border-b border-[#e2e8f0] text-xs">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Step</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium">Attempt</th>
                    <th className="py-2 pr-4 font-medium">Duration</th>
                    <th className="py-2 pr-4 font-medium">Artifacts</th>
                  </tr>
                </thead>
                <tbody>
                  {run.steps.map((step, index) => (
                    <tr
                      key={`${step.name}-${index}`}
                      className="border-b border-[#eee5d4]"
                    >
                      <td className="tp-title py-2.5 pr-4 font-medium">
                        {step.name}
                        {step.error && (
                          <div className="mt-1 max-w-xl whitespace-pre-wrap text-xs font-normal text-[#b42318]">
                            {step.error}
                            {explainError(step.error) && (
                              <div className="mt-1 text-[#7b3f2f]">
                                {explainError(step.error)}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 pr-4">
                        <Badge tone={statusTone(step.status)}>
                          {statusIcon(step.status)}
                          {step.status}
                        </Badge>
                      </td>
                      <td className="tp-muted py-2.5 pr-4">
                        {step.attempt}
                      </td>
                      <td className="tp-muted py-2.5 pr-4">
                        {formatDuration(step.durationMs)}
                      </td>
                      <td className="tp-muted py-2.5 pr-4">
                        {(step.outputArtifacts?.length ?? 0) +
                          (step.inputArtifacts?.length ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
          : <EmptyState>这个 run 还没有 step 记录</EmptyState>}
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="tp-title text-base font-semibold">
            产物
          </h3>
          <Badge>{artifacts.length}</Badge>
        </div>
        {artifacts.length
          ? (
            <div className="grid gap-2">
              {artifacts.map((artifact) => (
                <button
                  type="button"
                  className="flex items-center justify-between gap-3 rounded-md border border-[#e2e8f0] p-2.5 text-left transition hover:bg-[#f8fafc]"
                  key={artifact.key}
                  onClick={() => onPreviewArtifact(artifact)}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid size-8 place-items-center rounded-md bg-[#eff6ff] text-[#2563eb]">
                      {artifactIcon(artifact.contentType)}
                    </div>
                    <div className="min-w-0">
                      <div className="tp-title truncate text-sm font-medium">
                        {artifact.label ?? artifact.key.split("/").pop()}
                      </div>
                      <div className="tp-muted truncate text-xs">
                        {artifact.key}
                      </div>
                    </div>
                  </div>
                  <div className="tp-muted hidden shrink-0 items-center gap-3 text-xs sm:flex">
                    <span>{artifact.contentType}</span>
                    <span>{formatSize(artifact.size)}</span>
                    <Eye className="size-4" />
                  </div>
                </button>
              ))}
            </div>
          )
          : <EmptyState>这个 run 暂无产物</EmptyState>}
      </Card>
    </div>
  );
}

function RunFeedbackPanel(
  { run, apiKey, profileId }: {
    run: ArticleRunDetail;
    apiKey: string;
    profileId: string;
  },
) {
  const [feedback, setFeedback] = useState<EditorialRunFeedback | null>(null);
  const [rating, setRating] = useState<EditorialFeedbackRating>("ok");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    apiJson<{ feedback: EditorialRunFeedback | null }>(
      `/api/runs/${encodeURIComponent(run.runId)}/feedback`,
      apiKey,
    )
      .then((data) => {
        setFeedback(data.feedback);
        setRating(data.feedback?.rating ?? "ok");
        setNote(data.feedback?.note ?? "");
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err))
      );
  }, [run.runId, apiKey]);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const data = await apiJson<{ feedback: EditorialRunFeedback }>(
        `/api/runs/${encodeURIComponent(run.runId)}/feedback`,
        apiKey,
        {
          method: "PUT",
          body: JSON.stringify({
            rating,
            note,
            profileId: run.profileId ?? profileId,
            accountId: run.accountId,
          }),
        },
      );
      setFeedback(data.feedback);
      setRating(data.feedback.rating);
      setNote(data.feedback.note ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    setError("");
    try {
      await apiJson<{ deleted: boolean }>(
        `/api/runs/${encodeURIComponent(run.runId)}/feedback`,
        apiKey,
        { method: "DELETE" },
      );
      setFeedback(null);
      setRating("ok");
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="tp-title text-base font-semibold">人工反馈</h3>
          <p className="tp-muted mt-1 text-xs leading-5">
            反馈会进入下一次选题记忆，用来避免重复差角度、强化好文章特征。
          </p>
        </div>
        {feedback && (
          <Badge
            tone={feedback.rating === "good"
              ? "success"
              : feedback.rating === "bad"
              ? "danger"
              : "muted"}
          >
            已反馈 · {feedbackLabel(feedback.rating)}
            {feedback.accountId ? ` · ${feedback.accountId}` : ""}
          </Badge>
        )}
      </div>
      <div className="grid gap-3">
        <div className="flex flex-wrap gap-2">
          {(["good", "ok", "bad"] as EditorialFeedbackRating[]).map((item) => (
            <button
              key={item}
              type="button"
              className={cx(
                "h-8 rounded-md border px-3 text-sm transition",
                rating === item
                  ? "border-[#0f172a] bg-[#0f172a] text-white"
                  : "border-[#e2e8f0] bg-[#ffffff]/80 text-[#4d4338] hover:bg-[#f5ecdc]",
              )}
              onClick={() => setRating(item)}
            >
              {feedbackLabel(item)}
            </button>
          ))}
        </div>
        <textarea
          className="min-h-20 rounded-md border border-[#e2e8f0] bg-[#ffffff]/80 px-3 py-2 text-sm text-[#201a15] outline-none transition placeholder:text-[#a99b88] focus:border-[#b99b72]"
          value={note}
          placeholder="一句话说明：为什么好，或者哪里不够好。"
          onChange={(event) => setNote(event.currentTarget.value)}
        />
        {error && (
          <div className="tp-danger rounded-md border p-2 text-xs">{error}</div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={save} disabled={saving}>
            <Save className="size-3.5" />
            保存反馈
          </Button>
          {feedback && (
            <Button
              size="sm"
              variant="ghost"
              onClick={remove}
              disabled={saving}
            >
              删除反馈
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function feedbackLabel(rating: EditorialFeedbackRating): string {
  if (rating === "good") return "好";
  if (rating === "bad") return "差";
  return "一般";
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

function collectRelatedMatrixRuns(
  run: ArticleRunDetail | null,
  allRuns: ArticleRunRecord[],
): ArticleRunRecord[] {
  if (!run) return [];
  if (run.runKind === "matrix-parent") {
    return allRuns
      .filter((item) => item.parentRunId === run.runId)
      .sort(sortRunAsc);
  }
  if (run.parentRunId) {
    return allRuns
      .filter((item) => item.parentRunId === run.parentRunId)
      .sort(sortRunAsc);
  }
  return [];
}

function sortRunAsc(a: ArticleRunRecord, b: ArticleRunRecord): number {
  return Date.parse(a.createdAt) - Date.parse(b.createdAt);
}

function MatrixRunPanel(
  { run, relatedRuns, onSelectRun, onRerunAccount }: {
    run: ArticleRunDetail;
    relatedRuns: ArticleRunRecord[];
    onSelectRun: (runId: string) => void;
    onRerunAccount?: (run: ArticleRunRecord) => Promise<void>;
  },
) {
  const [rerunningRunId, setRerunningRunId] = useState("");
  if (relatedRuns.length === 0) return null;
  const succeeded = relatedRuns.filter((item) => item.status === "succeeded")
    .length;
  const failed = relatedRuns.filter((item) => item.status === "failed").length;
  const running =
    relatedRuns.filter((item) =>
      item.status === "running" || item.status === "queued"
    ).length;
  const cancelled = relatedRuns.filter((item) => item.status === "cancelled")
    .length;
  const completed = succeeded + failed + cancelled;
  const completion = Math.round((completed / relatedRuns.length) * 100);
  const title = run.runKind === "matrix-parent" ? "矩阵结果" : "同批账号";

  return (
    <Card>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="tp-title text-base font-semibold">{title}</h3>
          <p className="tp-muted mt-1 text-xs leading-5">
            对比同一批素材在不同公众号账号下的成稿状态，用于判断账号定位是否真的拉开差异。
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge tone="info">完成 {completion}%</Badge>
          <Badge tone="success">成功 {succeeded}</Badge>
          <Badge tone={failed > 0 ? "danger" : "muted"}>失败 {failed}</Badge>
          <Badge tone={running > 0 ? "info" : "muted"}>进行中 {running}</Badge>
        </div>
      </div>
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-[#e2e8f0]">
        <div
          className={cx(
            "h-full rounded-full transition-all",
            failed > 0 ? "bg-[#dc2626]" : "bg-[#16a34a]",
          )}
          style={{ width: `${completion}%` }}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead className="tp-muted border-b border-[#e2e8f0] text-xs">
            <tr>
              <th className="py-2 pr-4 font-medium">账号</th>
              <th className="py-2 pr-4 font-medium">状态</th>
              <th className="py-2 pr-4 font-medium">主线/形态</th>
              <th className="py-2 pr-4 font-medium">质量</th>
              <th className="py-2 pr-4 font-medium">发布</th>
              <th className="py-2 pr-4 font-medium">问题</th>
              <th className="py-2 pr-4 font-medium">产物</th>
              <th className="py-2 pr-4 font-medium">完成</th>
              <th className="py-2 pr-0 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {relatedRuns.map((item) => {
              const summary = parseRunSummary(item.summary);
              const errorHint = explainError(item.error);
              const qualityTone = qualityScoreTone(summary.qualityScore);
              return (
                <tr
                  key={item.runId}
                  className="border-b border-[#eee5d4] hover:bg-[#f8fafc]"
                  onClick={() => onSelectRun(item.runId)}
                >
                  <td className="py-2.5 pr-4">
                    <div className="tp-title font-medium">
                      {item.accountId ?? "default"}
                    </div>
                    <div className="tp-muted max-w-[260px] truncate text-xs">
                      {item.runId}
                    </div>
                  </td>
                  <td className="py-2.5 pr-4">
                    <Badge tone={statusTone(item.status)}>
                      {statusIcon(item.status)}
                      {item.status}
                    </Badge>
                  </td>
                  <td className="py-2.5 pr-4">
                    <div className="max-w-[300px]">
                      <div className="truncate text-sm text-[var(--tp-ink)]">
                        {summary.editorialDecision ?? summary.topic ?? "-"}
                      </div>
                      {summary.articlePlan && (
                        <div className="tp-muted mt-1 truncate text-xs">
                          {summary.articlePlan}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="tp-muted py-2.5 pr-4">
                    {summary.qualityScore !== undefined
                      ? (
                        <Badge tone={qualityTone}>
                          {summary.qualityScore} 分
                        </Badge>
                      )
                      : summary.quality ?? "-"}
                  </td>
                  <td className="tp-muted py-2.5 pr-4">
                    {summary.publish ?? (item.dryRun ? "dry-run" : "-")}
                  </td>
                  <td className="py-2.5 pr-4">
                    {item.error
                      ? (
                        <div className="max-w-[260px]">
                          <div className="truncate text-xs text-[#b42318]">
                            {item.error}
                          </div>
                          {errorHint && (
                            <div className="mt-1 line-clamp-2 text-xs text-[#7b3f2f]">
                              {errorHint}
                            </div>
                          )}
                        </div>
                      )
                      : <span className="tp-muted text-xs">-</span>}
                  </td>
                  <td className="tp-muted py-2.5 pr-4">
                    {item.artifacts?.length ?? 0}
                  </td>
                  <td className="tp-muted py-2.5 pr-4">
                    {formatDate(item.finishedAt ?? item.updatedAt)}
                  </td>
                  <td className="py-2.5 pr-0">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelectRun(item.runId);
                        }}
                      >
                        查看
                      </Button>
                      {onRerunAccount && item.accountId && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={rerunningRunId === item.runId}
                          onClick={async (event) => {
                            event.stopPropagation();
                            setRerunningRunId(item.runId);
                            try {
                              await onRerunAccount(item);
                            } finally {
                              setRerunningRunId("");
                            }
                          }}
                        >
                          <RotateCcw
                            className={cx(
                              "size-3.5",
                              rerunningRunId === item.runId && "animate-spin",
                            )}
                          />
                          复跑
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function parseRunSummary(summary?: string): {
  quality?: string;
  qualityScore?: number;
  publish?: string;
  topic?: string;
  editorialDecision?: string;
  articlePlan?: string;
} {
  if (!summary) return {};
  const quality = summary.match(/质量审稿:\s*([^\n]+)/)?.[1]?.trim();
  const qualityScore = quality?.match(/(\d+(?:\.\d+)?)\s*分/)?.[1];
  const publish = summary.match(/发布:\s*([^\n]+)/)?.[1]?.trim();
  const topic = summary.match(/选题:\s*([^\n]+)/)?.[1]?.trim();
  const editorialDecision = summary.match(/编辑决策:\s*([^\n]+)/)?.[1]
    ?.trim();
  const articlePlan = summary.match(/文章计划:\s*([^\n]+)/)?.[1]?.trim();
  return {
    quality,
    qualityScore: qualityScore ? Number(qualityScore) : undefined,
    publish,
    topic,
    editorialDecision,
    articlePlan,
  };
}

function qualityScoreTone(
  score: number | undefined,
): "success" | "danger" | "info" | "muted" {
  if (score === undefined) return "muted";
  if (score >= 85) return "success";
  if (score < 70) return "danger";
  return "info";
}

export function RunsWorkspace(
  {
    runs,
    selectedRunId,
    selectedRun,
    allRuns,
    filter,
    setFilter,
    query,
    setQuery,
    onSelectRun,
    onRerunAccount,
    apiKey,
    profileId,
    onPreviewArtifact,
  }: {
    runs: ArticleRunRecord[];
    selectedRunId: string | null;
    selectedRun: ArticleRunDetail | null;
    allRuns?: ArticleRunRecord[];
    filter: "all" | RunStatus;
    setFilter: (filter: "all" | RunStatus) => void;
    query: string;
    setQuery: (query: string) => void;
    onSelectRun: (runId: string) => void;
    onRerunAccount?: (run: ArticleRunRecord) => Promise<void>;
    apiKey: string;
    profileId: string;
    onPreviewArtifact: (artifact: ArtifactRef) => void;
  },
) {
  return (
    <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      <RunList
        runs={runs}
        selectedRunId={selectedRunId}
        onSelect={onSelectRun}
        filter={filter}
        setFilter={setFilter}
        query={query}
        setQuery={setQuery}
      />
      <RunDetail
        run={selectedRun}
        allRuns={allRuns ?? runs}
        apiKey={apiKey}
        profileId={profileId}
        onSelectRun={onSelectRun}
        onRerunAccount={onRerunAccount}
        onPreviewArtifact={onPreviewArtifact}
      />
    </div>
  );
}
