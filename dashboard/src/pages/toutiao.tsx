import { Card, Badge, Button, EmptyState, MetricChip, SectionTitle } from "../components/ui.tsx";
import type { ToutiaoJobsResponse, ToutiaoOpsResponse, ToutiaoScheduleJob } from "../api/types.ts";

function formatTime(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function tone(status: ToutiaoScheduleJob["status"]) {
  if (status === "published" || status === "scheduled") return "success" as const;
  if (status === "failed" || status === "blocked") return "danger" as const;
  if (status === "preparing" || status === "ready") return "info" as const;
  return "muted" as const;
}

export function ToutiaoWorkspace(
  { data, ops, onCheck, onRetry, checking }: {
    data: ToutiaoJobsResponse | null;
    ops: ToutiaoOpsResponse | null;
    onCheck: () => Promise<void>;
    onRetry: (jobId: string) => Promise<void>;
    checking: boolean;
  },
) {
  if (!data) return <EmptyState>正在读取头条定时任务…</EmptyState>;
  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle
          title="今日头条原生定时发布"
          description="内容在提交窗口内预生成，Relay 直接设置头条原生定时；不会影响微信公众号发布队列。"
          action={<Button size="sm" onClick={() => void onCheck()} disabled={checking}>检查调度</Button>}
        />
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <MetricChip label="自动化" value={data.enabled ? "已启用" : "未启用"} />
          <MetricChip label="每日发布时间" value={data.scheduleTime} />
          <MetricChip label="预生成提前量" value={`${data.preparationLeadMinutes} 分钟`} />
          <MetricChip label="Relay" value={data.relayConfigured ? "已配置" : "未配置"} />
          <MetricChip label="健康状态" value={ops?.relayHealth.ok ? "正常" : "待检查/异常"} />
        </div>
      </Card>

      {!data.jobs.length
        ? <EmptyState>暂无头条定时任务。启用配置后，系统会在预生成窗口自动创建任务。</EmptyState>
        : (
          <Card>
            <SectionTitle title="任务记录" description="保留执行状态、真实文章 ID、失败原因和 Relay 截图路径。" />
            <div className="space-y-2">
              {data.jobs.map((job) => (
                <div key={job.id} className="rounded-md border border-[#e2e8f0] p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium text-[#0f172a]">{job.title ?? job.id}</div>
                    <Badge tone={tone(job.status)}>{job.status}</Badge>
                  </div>
                  <div className="mt-2 grid gap-1 text-xs text-[#64748b] md:grid-cols-3">
                    <span>计划：{formatTime(job.targetAt)}</span>
                    <span>文章 ID：{job.articleId ?? "等待回填"}</span>
                    <span>尝试：{job.attempts}</span>
                  </div>
                  {job.error && <div className="mt-2 text-xs text-[#b91c1c]">{job.error}</div>}
                  {job.screenshotPath && <div className="mt-1 text-xs text-[#64748b]">失败快照：{job.screenshotPath}</div>}
                  {(job.status === "failed" || job.status === "blocked") && job.htmlArtifactKey && (
                    <Button size="sm" className="mt-2" onClick={() => void onRetry(job.id)}>重试准备</Button>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}
    </div>
  );
}
