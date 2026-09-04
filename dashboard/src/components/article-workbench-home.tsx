import React from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileText,
  Globe2,
  Layers3,
  Loader2,
  Newspaper,
  PenLine,
  Play,
  Rocket,
  ShieldCheck,
  Target,
  Users2,
  XCircle,
} from "lucide-react";
import type {
  ArticleRunRecord,
  ArticleRuntimeProfileDetail,
  ConfigSummary,
  HealthResponse,
  RunStatus,
  WeixinAccountProfile,
} from "../api/types.ts";
import type { DashboardView } from "../dashboard/views.ts";
import { Badge, Button, Card, EmptyState } from "./ui.tsx";

type BadgeTone = "success" | "danger" | "info" | "muted";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function formatDate(value?: string) {
  if (!value) return "暂无记录";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusTone(status?: RunStatus): BadgeTone {
  if (status === "succeeded") return "success";
  if (status === "failed" || status === "cancelled") return "danger";
  if (status === "running" || status === "queued") return "info";
  return "muted";
}

function statusIcon(status?: RunStatus) {
  if (status === "succeeded") return <CheckCircle2 className="size-4" />;
  if (status === "failed" || status === "cancelled") {
    return <XCircle className="size-4" />;
  }
  if (status === "running") return <Loader2 className="size-4 animate-spin" />;
  return <Clock3 className="size-4" />;
}

export function ArticleWorkbenchHome(
  { health, config, latestRun, accounts, profiles, onNavigate, onRun }: {
    health: HealthResponse | null;
    config: ConfigSummary | null;
    latestRun: ArticleRunRecord | undefined;
    accounts: WeixinAccountProfile[];
    profiles: ArticleRuntimeProfileDetail[];
    onNavigate: (view: DashboardView) => void;
    onRun: () => void;
  },
) {
  const checks = health ? Object.entries(health.checks) : [];
  const readyProviders = Object.values(config?.providersConfigured ?? {})
    .filter(Boolean).length;
  const providerTotal = Object.keys(config?.providersConfigured ?? {}).length;
  const decision = publishDecision(config, latestRun);
  const enabledAccounts = accounts.filter((account) => account.enabled);
  const defaultAccount = pickDefaultAccount(accounts, config);
  const defaultProfile = pickDefaultProfile(profiles, defaultAccount);
  const qualityMode = qualityGateLabel(config);

  return (
    <div className="grid gap-4">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="overflow-hidden p-0">
          <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="p-5">
              <div className="tp-kicker">发布中心</div>
              <h2 className="mt-2 text-[28px] font-semibold leading-tight text-[var(--tp-ink)]">
                今天发什么，发给谁，是否进入草稿箱？
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--tp-muted)]">
                这里不展示系统杂项，只回答一次微信文章生产最关键的四件事：
                选题来源是否足够、账号风格是否明确、质量风险是否可控、下一步是否创建草稿。
              </p>
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                <AnswerTile
                  label="目标账号"
                  value={defaultAccount?.name ?? "未指定"}
                  detail={enabledAccounts.length
                    ? `${enabledAccounts.length} 个账号可运行`
                    : "先配置账号矩阵"}
                  icon={<Users2 className="size-3.5" />}
                  tone={enabledAccounts.length ? "success" : "danger"}
                  onClick={() => onNavigate("accounts")}
                />
                <AnswerTile
                  label="文章方案"
                  value={defaultProfile?.profile.name ??
                    config?.article.renderer.template ??
                    "-"}
                  detail={`${config?.article.count ?? 0} 篇候选 · ${
                    config?.article.renderer.promptProfile ?? "默认风格"
                  }`}
                  icon={<PenLine className="size-3.5" />}
                  tone="info"
                  onClick={() => onNavigate("trend")}
                />
                <AnswerTile
                  label="质量策略"
                  value={qualityMode.title}
                  detail={qualityMode.detail}
                  icon={<ShieldCheck className="size-3.5" />}
                  tone={qualityMode.tone}
                  onClick={() => onNavigate("quality")}
                />
                <AnswerTile
                  label="下一步"
                  value={decision.label}
                  detail={decision.action}
                  icon={<Rocket className="size-3.5" />}
                  tone={decision.tone}
                  onClick={() => onNavigate(decision.view)}
                />
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button type="button" variant="primary" onClick={onRun}>
                  <Play className="size-3.5" />
                  运行 dry-run
                </Button>
                <Button type="button" onClick={() => onNavigate("accounts")}>
                  <Users2 className="size-3.5" />
                  账号矩阵
                </Button>
                <Button type="button" onClick={() => onNavigate("quality")}>
                  <ShieldCheck className="size-3.5" />
                  看质量复盘
                </Button>
                <Button type="button" onClick={() => onNavigate("sources")}>
                  <Globe2 className="size-3.5" />
                  管理来源
                </Button>
              </div>
            </div>
            <div className="border-t border-[var(--tp-border)] bg-[var(--tp-panel-muted)] p-5 lg:border-l lg:border-t-0">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-[var(--tp-subtle)]">
                  当前建议
                </span>
                <Badge tone={decision.tone}>{decision.label}</Badge>
              </div>
              <div className="text-sm leading-6 text-[var(--tp-muted)]">
                {decision.detail}
              </div>
              <div className="mt-4 grid gap-2 text-xs">
                <SetupLine
                  label="默认账号"
                  value={defaultAccount?.name ?? "未配置"}
                />
                <SetupLine
                  label="文章方案"
                  value={defaultProfile?.profile.name ?? "使用默认方案"}
                />
                <SetupLine
                  label="真实发布"
                  value={config?.article.qualityGate.forcePublish
                    ? "不达标也创建草稿"
                    : "按质量门禁阻断"}
                />
              </div>
              <button
                type="button"
                onClick={() => onNavigate(decision.view)}
                className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--tp-accent-strong)]"
              >
                {decision.action}
                <ArrowRight className="size-3.5" />
              </button>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-medium text-[var(--tp-subtle)]">
                最近运行
              </div>
              <div className="mt-1 text-xl font-semibold text-[var(--tp-ink)]">
                {latestRun?.status ?? "未运行"}
              </div>
            </div>
            <div className="tp-icon-tile grid size-10 place-items-center rounded-md">
              {statusIcon(latestRun?.status)}
            </div>
          </div>
          <div className="grid gap-2 text-xs text-[var(--tp-muted)]">
            <SetupLine
              label="模式"
              value={latestRun
                ? latestRun.dryRun ? "dry-run" : "发布草稿"
                : "等待运行"}
            />
            <SetupLine
              label="更新"
              value={latestRun ? formatDate(latestRun.updatedAt) : "暂无记录"}
            />
            <SetupLine
              label="产物"
              value={`${latestRun?.artifacts?.length ?? 0} 个文件`}
            />
          </div>
        </Card>
      </section>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SignalButton
          title="数据源"
          value={`${config?.article.sourcesCount ?? 0}`}
          detail={config?.fetchGroups?.length
            ? `${config.fetchGroups.length} 个抓取策略`
            : "default / auto"}
          icon={<Globe2 className="size-4" />}
          tone={config?.article.sourcesCount ? "success" : "muted"}
          onClick={() => onNavigate("sources")}
        />
        <SignalButton
          title="选题与质量"
          value={latestRun?.status === "failed" ? "需处理" : "待复盘"}
          detail="选题、证据、审稿、风险"
          icon={<ShieldCheck className="size-4" />}
          tone={latestRun?.status === "failed" ? "danger" : "muted"}
          onClick={() => onNavigate("quality")}
        />
        <SignalButton
          title="文章方案"
          value={config?.article.renderer.template ?? "-"}
          detail={`${config?.article.count ?? 0} 篇候选 · ${
            config?.article.renderer.promptProfile ?? "默认提示词"
          }`}
          icon={<Newspaper className="size-4" />}
          tone="muted"
          onClick={() => onNavigate("trend")}
        />
        <SignalButton
          title="外部能力"
          value={providerTotal ? `${readyProviders}/${providerTotal}` : "-"}
          detail={config?.article.publisher.provider
            ? `发布: ${config.article.publisher.provider}${
              config.article.publisher.accountId
                ? ` · ${config.article.publisher.accountId}`
                : ""
            }`
            : "连接状态待检测"}
          icon={<Layers3 className="size-4" />}
          tone={providerTotal && readyProviders === providerTotal
            ? "success"
            : "muted"}
          onClick={() => onNavigate("settings")}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_380px]">
        <Card className="p-0">
          <div className="border-b border-[var(--tp-border)] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--tp-ink)]">
                  文章生产线
                </h3>
                <p className="mt-1 text-xs text-[var(--tp-muted)]">
                  只展示影响文章质量和发布稳定性的关键环节。
                </p>
              </div>
              <Badge tone={statusTone(latestRun?.status)}>
                {latestRun?.status ?? "idle"}
              </Badge>
            </div>
          </div>
          <div className="grid divide-y divide-[var(--tp-border)]">
            {pipelineRows(config, latestRun).map((row) => (
              <button
                key={row.name}
                type="button"
                onClick={() => onNavigate(row.view)}
                className="grid gap-3 px-4 py-3 text-left transition hover:bg-[var(--tp-hover)] sm:grid-cols-[176px_minmax(0,1fr)_auto]"
              >
                <div className="flex items-center gap-3">
                  <div className="tp-icon-tile grid size-8 place-items-center rounded-md">
                    {row.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-[var(--tp-ink)]">
                      {row.name}
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--tp-subtle)]">
                      {row.stage}
                    </div>
                  </div>
                </div>
                <div className="min-w-0 text-sm leading-6 text-[var(--tp-muted)]">
                  {row.detail}
                </div>
                <Badge tone={row.tone}>{row.state}</Badge>
              </button>
            ))}
          </div>
        </Card>

        <div className="grid gap-4">
          <Card>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--tp-ink)]">
                  账号发布队列
                </h3>
                <p className="mt-1 text-xs text-[var(--tp-muted)]">
                  每个账号保留自己的定位、读者和标题风格，运行时生成独立产物。
                </p>
              </div>
              <Badge tone={enabledAccounts.length ? "success" : "muted"}>
                {enabledAccounts.length} enabled
              </Badge>
            </div>
            {enabledAccounts.length
              ? (
                <div className="grid gap-2">
                  {enabledAccounts.slice(0, 4).map((account) => (
                    <AccountQueueRow
                      key={account.id}
                      account={account}
                      profile={profileName(profiles, account)}
                    />
                  ))}
                  {enabledAccounts.length > 4 && (
                    <button
                      type="button"
                      onClick={() => onNavigate("accounts")}
                      className="rounded-md border border-dashed border-[var(--tp-border)] px-3 py-2 text-left text-xs font-medium text-[var(--tp-muted)] hover:bg-[var(--tp-hover)]"
                    >
                      还有 {enabledAccounts.length - 4} 个账号，查看账号矩阵
                    </button>
                  )}
                </div>
              )
              : <EmptyState>还没有启用的公众号账号</EmptyState>}
          </Card>

          <Card>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--tp-ink)]">
                  系统状态
                </h3>
                <p className="mt-1 text-xs text-[var(--tp-muted)]">
                  本地、Docker、远程部署共用同一套状态接口。
                </p>
              </div>
              <Badge tone={health?.ok ? "success" : "muted"}>
                {health?.mode ?? config?.mode ?? "unknown"}
              </Badge>
            </div>
            {checks.length
              ? (
                <div className="grid gap-2">
                  {checks.slice(0, 5).map(([name, check]) => (
                    <div
                      key={name}
                      className="flex items-start gap-2 rounded-md border border-[var(--tp-border)] bg-white px-3 py-2"
                    >
                      <span
                        className={cx(
                          "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full",
                          check.ok
                            ? "bg-[#ecfdf5] text-[#047857]"
                            : "bg-[#fef2f2] text-[#b91c1c]",
                        )}
                      >
                        {check.ok
                          ? <CheckCircle2 className="size-3.5" />
                          : <AlertCircle className="size-3.5" />}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-[var(--tp-ink)]">
                          {name}
                        </div>
                        <div className="truncate text-xs text-[var(--tp-muted)]">
                          {check.detail}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
              : <EmptyState>还没有健康检查结果</EmptyState>}
          </Card>

          <Card>
            <h3 className="text-sm font-semibold text-[var(--tp-ink)]">
              当前文章配置
            </h3>
            <div className="mt-3 grid gap-2">
              <SetupLine
                label="发布方式"
                value={config?.article.publisher.accountId
                  ? `${config.article.publisher.provider} · ${config.article.publisher.accountId}`
                  : config?.article.publisher.provider ?? "-"}
              />
              <SetupLine
                label="封面"
                value={config?.article.cover.enabled
                  ? `${config.article.cover.provider} · ${config.article.cover.model}`
                  : "关闭"}
              />
              <SetupLine
                label="正文配图"
                value={`${config?.article.bodyImages.mode ?? "off"} · ${
                  config?.article.bodyImages.provider ?? "-"
                }`}
              />
              <SetupLine
                label="质量门禁"
                value={config?.article.qualityGate.enabled
                  ? config.article.qualityGate.forcePublish
                    ? `强制发布 · ≥ ${config.article.qualityGate.minScore}`
                    : `≥ ${config.article.qualityGate.minScore}`
                  : "关闭"}
              />
              <SetupLine
                label="运行存储"
                value={`${config?.storage.runState ?? "-"} / ${
                  config?.storage.artifacts ?? "-"
                }`}
              />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function publishDecision(
  config: ConfigSummary | null,
  latestRun: ArticleRunRecord | undefined,
): {
  label: string;
  detail: string;
  tone: BadgeTone;
  action: string;
  view: DashboardView;
} {
  if (!config?.article.sourcesCount) {
    return {
      label: "先补来源",
      detail: "当前没有可用数据源。先添加稳定来源，否则文章质量无法保证。",
      tone: "danger",
      action: "去添加数据源",
      view: "sources",
    };
  }
  if (!latestRun) {
    return {
      label: "建议 dry-run",
      detail: "还没有运行记录。先跑 dry-run，检查选题、正文、图片和质量审稿。",
      tone: "info",
      action: "查看运行入口",
      view: "runs",
    };
  }
  if (latestRun.status === "failed" || latestRun.status === "cancelled") {
    return {
      label: "需要处理",
      detail: "最近一次运行没有完成。先看失败步骤和错误解释，再决定是否重跑。",
      tone: "danger",
      action: "查看失败步骤",
      view: "runs",
    };
  }
  if (latestRun.status === "running" || latestRun.status === "queued") {
    return {
      label: "正在运行",
      detail: "文章流程还在执行中。等待步骤完成后再审阅产物。",
      tone: "info",
      action: "查看进度",
      view: "runs",
    };
  }
  if (latestRun.dryRun) {
    return {
      label: "等待审阅",
      detail: "dry-run 已完成。先看质量复盘和文章产物，通过后再创建草稿。",
      tone: "success",
      action: "审阅产物",
      view: "quality",
    };
  }
  return {
    label: "草稿已创建",
    detail: "最近一次真实发布已完成。可以到公众号后台继续编辑或发布。",
    tone: "success",
    action: "查看发布结果",
    view: "runs",
  };
}

function SignalButton(
  {
    title,
    value,
    detail,
    icon,
    tone,
    onClick,
  }: {
    title: string;
    value: string;
    detail: string;
    icon: React.ReactNode;
    tone: BadgeTone;
    onClick: () => void;
  },
) {
  return (
    <Card className="p-0">
      <button
        type="button"
        onClick={onClick}
        className="flex h-full min-h-[126px] w-full flex-col items-start p-4 text-left"
      >
        <div className="mb-4 flex w-full items-center justify-between gap-3">
          <div className="tp-icon-tile grid size-8 place-items-center rounded-md">
            {icon}
          </div>
          <Badge tone={tone}>{title}</Badge>
        </div>
        <div className="max-w-full truncate text-xl font-semibold text-[var(--tp-ink)]">
          {value}
        </div>
        <div className="mt-1 line-clamp-2 text-xs leading-[18px] text-[var(--tp-muted)]">
          {detail}
        </div>
      </button>
    </Card>
  );
}

function AnswerTile(
  {
    label,
    value,
    detail,
    icon,
    tone,
    onClick,
  }: {
    label: string;
    value: string;
    detail: string;
    icon: React.ReactNode;
    tone: BadgeTone;
    onClick: () => void;
  },
) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group rounded-md border border-[var(--tp-border)] bg-white px-3 py-2.5 text-left transition hover:border-[#bfdbfe] hover:bg-[#f8fafc]"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-[var(--tp-subtle)]">
          {label}
        </span>
        <span
          className={cx(
            "grid size-6 place-items-center rounded-md",
            tone === "success" && "bg-[#ecfdf5] text-[#047857]",
            tone === "danger" && "bg-[#fef2f2] text-[#b91c1c]",
            tone === "info" && "bg-[#eff6ff] text-[#2563eb]",
            tone === "muted" && "bg-[#f8fafc] text-[#64748b]",
          )}
        >
          {icon}
        </span>
      </div>
      <div className="truncate text-sm font-semibold text-[var(--tp-ink)]">
        {value}
      </div>
      <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-[var(--tp-muted)]">
        {detail}
      </div>
    </button>
  );
}

function AccountQueueRow(
  { account, profile }: {
    account: WeixinAccountProfile;
    profile: string;
  },
) {
  const positioning = textValue(account.brand.positioning) ?? "未配置账号定位";
  const tone = textValue(account.brand.tone) ?? "未配置语气";

  return (
    <div className="rounded-md border border-[var(--tp-border)] bg-white px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-[var(--tp-ink)]">
              {account.name}
            </span>
            <Badge tone={account.relay?.configured ? "success" : "danger"}>
              {account.relay?.configured ? "relay ready" : "未连接"}
            </Badge>
          </div>
          <div className="mt-1 truncate text-xs text-[var(--tp-muted)]">
            {positioning}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[11px] text-[var(--tp-subtle)]">默认方案</div>
          <div className="mt-0.5 max-w-[128px] truncate text-xs font-medium text-[var(--tp-ink)]">
            {profile}
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--tp-subtle)]">
        <Target className="size-3.5" />
        <span className="truncate">{tone}</span>
      </div>
    </div>
  );
}

function pipelineRows(
  config: ConfigSummary | null,
  latestRun: ArticleRunRecord | undefined,
) {
  const runState = latestRun?.status ?? "queued";
  return [
    {
      name: "数据源输入",
      stage: "Input",
      detail: `${config?.article.sourcesCount ?? 0} 个来源，策略: ${
        config?.fetchGroups?.slice(0, 3).join(" / ") || "default"
      }`,
      state: config?.article.sourcesCount ? "ready" : "empty",
      tone: config?.article.sourcesCount ? "success" : "muted",
      icon: <Globe2 className="size-4" />,
      view: "sources" as const,
    },
    {
      name: "选题与证据",
      stage: "Selection",
      detail: "去重、聚类、排序、证据补全，决定今天最值得写的主线。",
      state: runState === "failed" ? "check" : "ready",
      tone: runState === "failed" ? "danger" : "muted",
      icon: <ShieldCheck className="size-4" />,
      view: "quality" as const,
    },
    {
      name: "文章生成",
      stage: "Compose",
      detail: `模板 ${config?.article.renderer.template ?? "-"}，提示词 ${
        config?.article.renderer.promptProfile ?? "-"
      }，质量审稿最多 ${
        config?.article.qualityGate.maxRevisionRounds ?? 0
      } 轮。`,
      state: "ready",
      tone: "muted",
      icon: <FileText className="size-4" />,
      view: "trend" as const,
    },
    {
      name: "草稿发布",
      stage: "Publish",
      detail: config?.article.qualityGate.forcePublish
        ? "真实发布默认强制创建草稿；质量问题会保留到复盘中。"
        : config?.article.dryRunDefault
        ? "默认 dry-run。真实发布需要二次确认，只创建公众号草稿。"
        : "默认创建公众号草稿。远程部署建议通过 weixin-relay 转发。",
      state: config?.article.qualityGate.forcePublish
        ? "force"
        : config?.article.dryRunDefault
        ? "guarded"
        : "live",
      tone: config?.article.qualityGate.forcePublish
        ? "info"
        : config?.article.dryRunDefault
        ? "info"
        : "success",
      icon: <Rocket className="size-4" />,
      view: "runs" as const,
    },
  ] satisfies Array<{
    name: string;
    stage: string;
    detail: string;
    state: string;
    tone: BadgeTone;
    icon: React.ReactNode;
    view: DashboardView;
  }>;
}

function SetupLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-3 rounded-md border border-[var(--tp-border)] bg-white px-3 py-2">
      <div className="text-xs text-[var(--tp-subtle)]">{label}</div>
      <div className="truncate text-xs font-medium text-[var(--tp-ink)]">
        {value}
      </div>
    </div>
  );
}

function pickDefaultAccount(
  accounts: WeixinAccountProfile[],
  config: ConfigSummary | null,
) {
  const configuredId = config?.article.publisher.accountId;
  return accounts.find((account) => account.id === configuredId) ??
    accounts.find((account) => account.enabled && account.id === "default") ??
    accounts.find((account) => account.enabled) ??
    accounts[0];
}

function pickDefaultProfile(
  profiles: ArticleRuntimeProfileDetail[],
  account?: WeixinAccountProfile,
) {
  const accountProfileId = account?.defaultArticleProfileId ??
    textValue(account?.defaults.articleProfileId);
  return profiles.find((item) => item.profile.id === accountProfileId) ??
    profiles.find((item) => item.profile.isDefault) ??
    profiles[0];
}

function profileName(
  profiles: ArticleRuntimeProfileDetail[],
  account: WeixinAccountProfile,
) {
  return pickDefaultProfile(profiles, account)?.profile.name ?? "默认文章方案";
}

function qualityGateLabel(config: ConfigSummary | null): {
  title: string;
  detail: string;
  tone: BadgeTone;
} {
  const gate = config?.article.qualityGate;
  if (!gate?.enabled) {
    return {
      title: "未启用",
      detail: "不会阻断草稿创建",
      tone: "muted",
    };
  }
  if (gate.forcePublish) {
    return {
      title: "强制草稿",
      detail: `评分目标 ≥ ${gate.minScore}，不达标也继续`,
      tone: "info",
    };
  }
  return {
    title: `≥ ${gate.minScore} 分`,
    detail: gate.blockOnHighFactIssue ? "高风险事实问题会阻断" : "只按总分判断",
    tone: "success",
  };
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
