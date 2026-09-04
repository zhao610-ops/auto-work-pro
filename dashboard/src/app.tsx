import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AppShell,
  Burger,
  createTheme,
  Group,
  MantineProvider,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@mantine/core/styles.css";
import { Bell, LogOut, Play, RefreshCw, Rocket } from "lucide-react";
import { ArticleWorkbenchHome } from "./components/article-workbench-home.tsx";
import { LoginView } from "./components/login-view.tsx";
import { FeatureNav, Sidebar } from "./components/shell/navigation.tsx";
import { TriggerRunDialog } from "./components/trigger-run-dialog.tsx";
import { Button, EmptyState } from "./components/ui.tsx";
import type { ArtifactRef, RunStatus } from "./api/types.ts";
import { type DashboardView, VIEW_META } from "./dashboard/views.ts";
import {
  useDashboardQueries,
  useDashboardRefresh,
  useTriggerMatrixRun,
  useTriggerRun,
} from "./hooks/use-dashboard-queries.ts";
import { AccountsWorkspace } from "./pages/accounts.tsx";
import { ArtifactPreview, ArtifactsPanel } from "./pages/artifacts.tsx";
import { ArticleQualityWorkspace } from "./pages/quality.tsx";
import { RuntimeConfigPanel } from "./pages/runtime-config.tsx";
import { RunsWorkspace } from "./pages/runs.tsx";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const theme = createTheme({
  primaryColor: "blue",
  fontFamily:
    "Inter, IBM Plex Sans, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  defaultRadius: "md",
  headings: {
    fontWeight: "650",
  },
  components: {
    Button: {
      defaultProps: {
        radius: "md",
      },
    },
    Card: {
      defaultProps: {
        radius: "md",
        withBorder: true,
      },
    },
  },
});

const API_KEY_STORAGE = "trendpublish.dashboard.apiKey";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function App() {
  const [apiKey, setApiKey] = useState(() =>
    sessionStorage.getItem(API_KEY_STORAGE) ?? ""
  );
  const [selectedConfigProfileId, setSelectedConfigProfileId] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | RunStatus>("all");
  const [query, setQuery] = useState("");
  const [activeView, setActiveView] = useState<DashboardView>("home");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [error, setError] = useState("");
  const [loginError, setLoginError] = useState("");
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [triggerMode, setTriggerMode] = useState<"single" | "matrix">(
    "single",
  );
  const [previewArtifact, setPreviewArtifact] = useState<ArtifactRef | null>(
    null,
  );
  const [mobileNavOpened, { toggle: toggleMobileNav, close: closeMobileNav }] =
    useDisclosure(false);

  const dashboard = useDashboardQueries(apiKey, selectedRunId, autoRefresh);
  const refreshDashboard = useDashboardRefresh(apiKey);
  const triggerRunMutation = useTriggerRun(apiKey);
  const triggerMatrixRunMutation = useTriggerMatrixRun(apiKey);

  const health = dashboard.health.data ?? null;
  const config = dashboard.config.data ?? null;
  const capabilities = dashboard.capabilities.data?.capabilities ?? [];
  const articleProfiles = dashboard.articleProfiles.data?.profiles ?? [];
  const accounts = dashboard.accounts.data?.accounts ?? [];
  const accountInsights = dashboard.accountInsights.data?.insights ?? [];
  const runs = dashboard.runs.data?.runs ?? [];
  const selectedRun = dashboard.selectedRun.data?.run ?? null;
  const latestRun = runs[0];
  const currentView = VIEW_META[activeView];
  const showRuntimeConfig = articleProfiles.length > 0;
  const loading = dashboard.health.isFetching ||
    dashboard.config.isFetching ||
    dashboard.capabilities.isFetching ||
    dashboard.articleProfiles.isFetching ||
    dashboard.accounts.isFetching ||
    dashboard.accountInsights.isFetching ||
    dashboard.runs.isFetching ||
    dashboard.selectedRun.isFetching ||
    triggerRunMutation.isPending ||
    triggerMatrixRunMutation.isPending;

  const queryError = [
    dashboard.health.error,
    dashboard.config.error,
    dashboard.capabilities.error,
    dashboard.articleProfiles.error,
    dashboard.accounts.error,
    dashboard.accountInsights.error,
    dashboard.runs.error,
    dashboard.selectedRun.error,
  ].find(Boolean);
  const visibleError = error ||
    (queryError instanceof Error ? queryError.message : "");

  const saveApiKey = useCallback((nextApiKey: string) => {
    sessionStorage.setItem(API_KEY_STORAGE, nextApiKey);
    setLoginError("");
    setError("");
    setApiKey(nextApiKey);
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem(API_KEY_STORAGE);
    queryClient.clear();
    setApiKey("");
    setSelectedConfigProfileId("");
    setSelectedRunId(null);
  }, []);

  const rejectApiKey = useCallback((message = "API Key 无效，请重新输入。") => {
    sessionStorage.removeItem(API_KEY_STORAGE);
    queryClient.clear();
    setApiKey("");
    setLoginError(message);
    setError("");
    setSelectedRunId(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!apiKey) return;
    setError("");
    try {
      await refreshDashboard();
      if (selectedRunId) {
        await dashboard.selectedRun.refetch();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("未授权") || message.includes("Authorization")) {
        rejectApiKey("API Key 无效或已失效，请重新输入。");
        return;
      }
      setError(message);
    }
  }, [
    apiKey,
    dashboard.selectedRun,
    refreshDashboard,
    rejectApiKey,
    selectedRunId,
  ]);

  const openTrigger = useCallback((mode: "single" | "matrix" = "single") => {
    setTriggerMode(mode);
    setTriggerOpen(true);
  }, []);

  useEffect(() => {
    if (!queryError) return;
    const message = queryError instanceof Error
      ? queryError.message
      : String(queryError);
    if (message.includes("未授权") || message.includes("Authorization")) {
      rejectApiKey("API Key 无效或已失效，请重新输入。");
    }
  }, [queryError, rejectApiKey]);

  useEffect(() => {
    if (!selectedRunId && runs[0]) {
      setSelectedRunId(runs[0].runId);
    }
  }, [runs, selectedRunId]);

  useEffect(() => {
    setSelectedConfigProfileId((current) =>
      current ||
      articleProfiles.find((item) => item.profile.isDefault)?.profile.id ||
      articleProfiles[0]?.profile.id ||
      ""
    );
  }, [articleProfiles]);

  if (!apiKey) return <LoginView onLogin={saveApiKey} error={loginError} />;

  return (
    <AppShell
      className="tp-surface text-[#0f172a]"
      header={{ height: 58 }}
      navbar={{
        width: 232,
        breakpoint: "lg",
        collapsed: { mobile: !mobileNavOpened },
      }}
      padding={0}
    >
      <AppShell.Header className="tp-header border-b backdrop-blur">
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap" className="min-w-0">
            <Burger
              opened={mobileNavOpened}
              onClick={toggleMobileNav}
              hiddenFrom="lg"
              size="sm"
              aria-label="打开导航"
            />
            <ThemeIcon radius="md" size={34} color="orange">
              <Rocket className="size-4" />
            </ThemeIcon>
            <div className="min-w-0">
              <Group gap={8} wrap="nowrap">
                <span className="hidden h-1.5 w-1.5 rounded-full bg-[#f38020] lg:block" />
                <Text
                  fw={700}
                  size="lg"
                  c="var(--tp-ink)"
                  className="truncate"
                >
                  {currentView.title}
                </Text>
              </Group>
              <Text size="xs" c="dimmed" className="truncate">
                {currentView.description}
              </Text>
            </div>
          </Group>

          <Group gap={6} wrap="nowrap">
            <label className="hidden h-[32px] items-center gap-2 rounded-md border border-[#cbd5e1] bg-white px-2.5 text-xs text-[#475569] sm:flex">
              <input
                className="size-3.5 accent-[#2563eb]"
                type="checkbox"
                checked={autoRefresh}
                onChange={(event) =>
                  setAutoRefresh(event.currentTarget.checked)}
              />
              自动刷新
            </label>
            <Button size="sm" onClick={refresh} disabled={loading}>
              <RefreshCw
                className={cx("size-3.5", loading && "animate-spin")}
              />
              刷新
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => openTrigger("single")}
            >
              <Play className="size-3.5" />
              运行
            </Button>
            <Button
              size="icon"
              variant="secondary"
              aria-label="Notifications"
              className="hidden size-[32px] sm:inline-flex"
            >
              <Bell className="size-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={logout}>
              <span className="grid size-5 place-items-center rounded-full bg-[#eff6ff] text-[11px] font-semibold text-[#2563eb]">
                T
              </span>
              <span className="hidden sm:inline">退出</span>
              <LogOut className="size-3.5" />
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar className="tp-navbar">
        <Sidebar
          config={config}
          latestRun={latestRun}
          activeView={activeView}
          onChange={(view) => {
            setActiveView(view);
            closeMobileNav();
          }}
        />
      </AppShell.Navbar>

      <AppShell.Main>
        <div className="mx-auto max-w-[1280px] space-y-4 px-4 py-4 lg:px-6 lg:py-5">
          <div className="lg:hidden">
            <FeatureNav
              config={config}
              latestRun={latestRun}
              activeView={activeView}
              onChange={setActiveView}
            />
          </div>

          {visibleError && (
            <div className="tp-danger rounded-md border p-3 text-sm">
              {visibleError}
            </div>
          )}

          {activeView === "home" && (
            <ArticleWorkbenchHome
              health={health}
              config={config}
              latestRun={latestRun}
              accounts={accounts}
              profiles={articleProfiles}
              onNavigate={setActiveView}
              onRun={() => openTrigger("single")}
            />
          )}

          {activeView === "trend" && (
            showRuntimeConfig
              ? (
                <RuntimeConfigPanel
                  mode="trend"
                  apiKey={apiKey}
                  profiles={articleProfiles}
                  capabilities={capabilities}
                  latestRun={selectedRun}
                  selectedProfileId={selectedConfigProfileId}
                  onSelectProfile={setSelectedConfigProfileId}
                  onReload={refresh}
                />
              )
              : <EmptyState>还没有可编辑的微信文章方案</EmptyState>
          )}

          {activeView === "sources" && (
            showRuntimeConfig
              ? (
                <RuntimeConfigPanel
                  mode="sources"
                  apiKey={apiKey}
                  profiles={articleProfiles}
                  capabilities={capabilities}
                  latestRun={selectedRun}
                  selectedProfileId={selectedConfigProfileId}
                  onSelectProfile={setSelectedConfigProfileId}
                  onReload={refresh}
                />
              )
              : <EmptyState>还没有可编辑的数据源配置</EmptyState>
          )}

          {activeView === "quality" && (
            <ArticleQualityWorkspace
              run={selectedRun}
              apiKey={apiKey}
              accounts={accounts}
              insights={accountInsights}
              onPreviewArtifact={setPreviewArtifact}
            />
          )}

          {activeView === "accounts" && (
            <AccountsWorkspace
              apiKey={apiKey}
              accounts={accounts}
              insights={accountInsights}
              profiles={articleProfiles}
              onReload={refresh}
              onRun={() => openTrigger("matrix")}
            />
          )}

          {activeView === "runs" && (
            <RunsWorkspace
              runs={runs}
              selectedRunId={selectedRunId}
              selectedRun={selectedRun}
              allRuns={runs}
              filter={filter}
              setFilter={setFilter}
              query={query}
              setQuery={setQuery}
              onSelectRun={setSelectedRunId}
              onRerunAccount={async (run) => {
                const result = await triggerRunMutation.mutateAsync({
                  accountId: run.accountId,
                  profileId: run.profileId || selectedConfigProfileId ||
                    undefined,
                  dryRun: true,
                  forcePublish: false,
                });
                setSelectedRunId(result.runId);
                await refresh();
              }}
              apiKey={apiKey}
              profileId={selectedConfigProfileId}
              onPreviewArtifact={setPreviewArtifact}
            />
          )}

          {activeView === "artifacts" && (
            <ArtifactsPanel
              run={selectedRun}
              onPreviewArtifact={setPreviewArtifact}
            />
          )}

          {activeView === "settings" && (
            showRuntimeConfig
              ? (
                <RuntimeConfigPanel
                  mode="settings"
                  apiKey={apiKey}
                  profiles={articleProfiles}
                  capabilities={capabilities}
                  selectedProfileId={selectedConfigProfileId}
                  onSelectProfile={setSelectedConfigProfileId}
                  onReload={refresh}
                />
              )
              : <EmptyState>还没有可编辑的运行时配置</EmptyState>
          )}
        </div>
      </AppShell.Main>

      <TriggerRunDialog
        open={triggerOpen}
        initialMode={triggerMode}
        profiles={articleProfiles}
        accounts={accounts}
        onClose={() => setTriggerOpen(false)}
        onSubmit={async (payload) => {
          const result = await triggerRunMutation.mutateAsync(payload);
          setSelectedRunId(result.runId);
          await refresh();
        }}
        onSubmitMatrix={async (payload) => {
          const result = await triggerMatrixRunMutation.mutateAsync(payload);
          setSelectedRunId(result.matrixRunId);
          await refresh();
        }}
      />
      <ArtifactPreview
        artifact={previewArtifact}
        apiKey={apiKey}
        onClose={() => setPreviewArtifact(null)}
      />
    </AppShell>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <MantineProvider theme={theme} defaultColorScheme="light">
        <App />
      </MantineProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
