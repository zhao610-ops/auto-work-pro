import {
  Database,
  FileText,
  Globe2,
  Home,
  Layers3,
  Network,
  Settings,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import type { DashboardView } from "../../dashboard/views.ts";

type NavConfig = {
  article: {
    sourcesCount: number;
  };
} | null;

type NavRun = {
  status: string;
  dryRun: boolean;
  updatedAt: string;
} | undefined;

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function formatDate(value?: string) {
  if (!value) return "等待运行记录";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function navTone(status?: string) {
  if (status === "succeeded") {
    return "border-[#bbf7d0] bg-[#ecfdf5] text-[#047857]";
  }
  if (status === "failed" || status === "cancelled") {
    return "border-[#fecaca] bg-[#fef2f2] text-[#b91c1c]";
  }
  if (status === "running" || status === "queued") {
    return "border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]";
  }
  return "border-[#e2e8f0] bg-[#f8fafc] text-[#475569]";
}

function navItems(config: NavConfig, latestRun: NavRun) {
  return [
    {
      view: "home" as const,
      label: "发布中心",
      meta: "今日决策",
      icon: <Home className="size-4" />,
    },
    {
      view: "trend" as const,
      label: "文章方案",
      meta: "模板与配图",
      icon: <Workflow className="size-4" />,
    },
    {
      view: "accounts" as const,
      label: "账号矩阵",
      meta: "风格与定位",
      icon: <Network className="size-4" />,
    },
    {
      view: "sources" as const,
      label: "内容来源",
      meta: `${config?.article.sourcesCount ?? 0} 来源`,
      icon: <Globe2 className="size-4" />,
    },
    {
      view: "quality" as const,
      label: "质量复盘",
      meta: latestRun?.status ?? "待复盘",
      icon: <ShieldCheck className="size-4" />,
    },
    {
      view: "runs" as const,
      label: "运行",
      meta: latestRun?.status ?? "idle",
      icon: <Database className="size-4" />,
    },
    {
      view: "artifacts" as const,
      label: "产物库",
      meta: "文章 / 图片",
      icon: <FileText className="size-4" />,
    },
    {
      view: "settings" as const,
      label: "系统设置",
      meta: "高级",
      icon: <Settings className="size-4" />,
    },
  ];
}

export function FeatureNav(
  { config, latestRun, activeView, onChange }: {
    config: NavConfig;
    latestRun: NavRun;
    activeView: DashboardView;
    onChange: (view: DashboardView) => void;
  },
) {
  const items = navItems(config, latestRun);

  return (
    <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1">
      {items.map((item) => (
        <button
          key={item.view}
          type="button"
          onClick={() => onChange(item.view)}
          className={cx(
            "group flex min-w-[112px] items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition",
            activeView === item.view
              ? "border-[#2563eb] bg-[#2563eb] text-white"
              : "border-transparent text-[#334155] hover:border-[#cbd5e1] hover:bg-[#f1f5f9]",
          )}
        >
          <span
            className={cx(
              "grid size-6 shrink-0 place-items-center rounded-md",
              activeView === item.view
                ? "bg-white/15"
                : "bg-[#eff6ff] text-[#2563eb] group-hover:bg-[#dbeafe]",
            )}
          >
            {item.icon}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-medium">
              {item.label}
            </span>
            <span
              className={cx(
                "block truncate text-xs",
                activeView === item.view ? "text-[#dbeafe]" : "text-[#64748b]",
              )}
            >
              {item.meta}
            </span>
          </span>
        </button>
      ))}
    </nav>
  );
}

export function Sidebar(
  { config, latestRun, activeView, onChange }: {
    config: NavConfig;
    latestRun: NavRun;
    activeView: DashboardView;
    onChange: (view: DashboardView) => void;
  },
) {
  const items = navItems(config, latestRun);

  return (
    <aside className="tp-sidebar flex h-full flex-col px-3 py-4">
      <div className="flex items-center gap-3 rounded-md border border-[#e2e8f0] bg-white p-2.5">
        <div className="tp-icon-tile grid size-9 place-items-center rounded-md">
          <Layers3 className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold tracking-[0.08em] text-[#0f172a]">
            TRENDPUBLISH
          </div>
          <div className="truncate text-[11px] text-[#64748b]">
            微信文章自动化
          </div>
        </div>
      </div>

      <nav className="mt-5 flex flex-col gap-1">
        {items.map((item) => (
          <button
            key={item.view}
            type="button"
            onClick={() => onChange(item.view)}
            className={cx(
              "relative flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm transition",
              activeView === item.view ? "tp-nav-active" : "tp-nav-item",
            )}
          >
            {activeView === item.view && (
              <span className="absolute left-0 top-2 h-5 w-0.5 rounded-full bg-[#f38020]" />
            )}
            <span
              className={cx(
                "ml-1 grid size-6 shrink-0 place-items-center rounded-md",
                activeView === item.view
                  ? "bg-white text-[#2563eb]"
                  : "text-[#64748b]",
              )}
            >
              {item.icon}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {item.label}
              </span>
            </span>
          </button>
        ))}
      </nav>

      <div className="mt-auto rounded-md border border-[#e2e8f0] bg-[#f8fafc] p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="tp-muted text-[11px] uppercase tracking-[0.12em]">
              最近运行
            </div>
            <div className="tp-title mt-1 truncate text-sm font-semibold">
              {latestRun?.status ?? "idle"}
            </div>
          </div>
          <span
            className={cx(
              "inline-flex h-7 shrink-0 items-center rounded-full border px-2.5 text-xs font-medium",
              navTone(latestRun?.status),
            )}
          >
            {latestRun?.dryRun ? "dry" : "live"}
          </span>
        </div>
        <div className="mt-3 h-1 rounded-full bg-[#e2e8f0]">
          <div
            className="h-full rounded-full bg-[#2563eb]"
            style={{
              width: latestRun?.status === "succeeded"
                ? "100%"
                : latestRun?.status === "running"
                ? "62%"
                : latestRun?.status === "failed"
                ? "34%"
                : "18%",
            }}
          />
        </div>
        <div className="tp-muted mt-2 truncate text-xs">
          {formatDate(latestRun?.updatedAt)}
        </div>
      </div>
    </aside>
  );
}
