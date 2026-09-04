import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getArticleProfiles,
  getCapabilities,
  getConfigSummary,
  getHealth,
  getRunDetail,
  getRuns,
  getWeixinAccountInsights,
  getWeixinAccounts,
  triggerMatrixRun,
  triggerRun,
} from "../api/client.ts";
import type {
  TriggerMatrixRunPayload,
  TriggerRunPayload,
} from "../api/types.ts";

export const AUTO_REFRESH_MS = 8000;

export function dashboardQueryKeys(apiKey: string) {
  return {
    health: ["dashboard", apiKey, "health"] as const,
    config: ["dashboard", apiKey, "config-summary"] as const,
    capabilities: ["dashboard", apiKey, "capabilities"] as const,
    profiles: ["dashboard", apiKey, "article-profiles"] as const,
    accounts: ["dashboard", apiKey, "weixin-accounts"] as const,
    accountInsights: ["dashboard", apiKey, "weixin-account-insights"] as const,
    runs: ["dashboard", apiKey, "runs"] as const,
    runDetail: (runId: string | null) =>
      ["dashboard", apiKey, "run-detail", runId] as const,
  };
}

export function useDashboardQueries(
  apiKey: string,
  selectedRunId: string | null,
  autoRefresh: boolean,
) {
  const keys = dashboardQueryKeys(apiKey);
  const enabled = Boolean(apiKey);

  const health = useQuery({
    queryKey: keys.health,
    queryFn: () => getHealth(apiKey),
    enabled,
    staleTime: 30_000,
  });

  const config = useQuery({
    queryKey: keys.config,
    queryFn: () => getConfigSummary(apiKey),
    enabled,
    staleTime: 30_000,
  });

  const capabilities = useQuery({
    queryKey: keys.capabilities,
    queryFn: () => getCapabilities(apiKey),
    enabled,
    staleTime: 30_000,
  });

  const articleProfiles = useQuery({
    queryKey: keys.profiles,
    queryFn: () => getArticleProfiles(apiKey),
    enabled,
    staleTime: 30_000,
  });

  const accounts = useQuery({
    queryKey: keys.accounts,
    queryFn: () => getWeixinAccounts(apiKey),
    enabled,
    staleTime: 30_000,
  });

  const accountInsights = useQuery({
    queryKey: keys.accountInsights,
    queryFn: () => getWeixinAccountInsights(apiKey),
    enabled,
    refetchInterval: autoRefresh ? AUTO_REFRESH_MS : false,
  });

  const runs = useQuery({
    queryKey: keys.runs,
    queryFn: () => getRuns(apiKey),
    enabled,
    refetchInterval: autoRefresh ? AUTO_REFRESH_MS : false,
  });

  const selectedRun = useQuery({
    queryKey: keys.runDetail(selectedRunId),
    queryFn: () => getRunDetail(apiKey, selectedRunId ?? ""),
    enabled: enabled && Boolean(selectedRunId),
    refetchInterval: autoRefresh && selectedRunId ? AUTO_REFRESH_MS : false,
  });

  return {
    health,
    config,
    capabilities,
    articleProfiles,
    accounts,
    accountInsights,
    runs,
    selectedRun,
  };
}

export function useDashboardRefresh(apiKey: string) {
  const queryClient = useQueryClient();
  const keys = dashboardQueryKeys(apiKey);

  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.health }),
      queryClient.invalidateQueries({ queryKey: keys.config }),
      queryClient.invalidateQueries({ queryKey: keys.capabilities }),
      queryClient.invalidateQueries({ queryKey: keys.profiles }),
      queryClient.invalidateQueries({ queryKey: keys.accounts }),
      queryClient.invalidateQueries({ queryKey: keys.accountInsights }),
      queryClient.invalidateQueries({ queryKey: keys.runs }),
    ]);
}

export function useTriggerMatrixRun(apiKey: string) {
  const queryClient = useQueryClient();
  const keys = dashboardQueryKeys(apiKey);

  return useMutation({
    mutationFn: (payload: TriggerMatrixRunPayload) =>
      triggerMatrixRun(apiKey, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.runs });
      await queryClient.invalidateQueries({ queryKey: keys.accountInsights });
    },
  });
}

export function useTriggerRun(apiKey: string) {
  const queryClient = useQueryClient();
  const keys = dashboardQueryKeys(apiKey);

  return useMutation({
    mutationFn: (payload: TriggerRunPayload) => triggerRun(apiKey, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.runs });
      await queryClient.invalidateQueries({ queryKey: keys.accountInsights });
    },
  });
}
