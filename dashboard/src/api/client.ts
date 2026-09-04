import type {
  ApiErrorPayload,
  ArticleRunDetail,
  ArticleRunRecord,
  ArticleRuntimeProfileDetail,
  CapabilityProfile,
  ConfigSummary,
  EditorialTopicFeedback,
  EditorialTopicFeedbackAction,
  HealthResponse,
  TriggerMatrixRunPayload,
  TriggerRunPayload,
  WeixinAccountInsight,
  WeixinAccountProfile,
  WeixinAccountRelayCheck,
} from "./types.ts";

export async function parseApiError(response: Response) {
  const text = await response.text();
  if (!text) return `${response.status} ${response.statusText}`;
  try {
    const parsed = JSON.parse(text) as ApiErrorPayload;
    if (typeof parsed.error === "string") return parsed.error;
    return parsed.error?.message ?? parsed.error?.data?.error ?? text;
  } catch {
    return text;
  }
}

export async function apiJson<T>(
  path: string,
  apiKey: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }
  return await response.json() as T;
}

export async function apiArtifact(
  path: string,
  apiKey: string,
): Promise<Response> {
  const response = await fetch(path, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }
  return response;
}

export function getHealth(apiKey: string) {
  return apiJson<HealthResponse>("/api/health", apiKey);
}

export function getConfigSummary(apiKey: string) {
  return apiJson<ConfigSummary>("/api/config/summary", apiKey);
}

export function getCapabilities(apiKey: string) {
  return apiJson<{ capabilities: CapabilityProfile[] }>(
    "/api/config/capabilities",
    apiKey,
  );
}

export function getArticleProfiles(apiKey: string) {
  return apiJson<{ profiles: ArticleRuntimeProfileDetail[] }>(
    "/api/config/features/article/profiles",
    apiKey,
  );
}

export function getWeixinAccounts(apiKey: string) {
  return apiJson<{ accounts: WeixinAccountProfile[] }>(
    "/api/config/weixin/accounts",
    apiKey,
  );
}

export function getWeixinAccountInsights(apiKey: string) {
  return apiJson<{ insights: WeixinAccountInsight[] }>(
    "/api/accounts/insights",
    apiKey,
  );
}

export function checkWeixinAccountRelay(apiKey: string, accountId: string) {
  return apiJson<{ check: WeixinAccountRelayCheck }>(
    `/api/config/weixin/accounts/${encodeURIComponent(accountId)}/relay-check`,
    apiKey,
    { method: "POST" },
  );
}

export function getRuns(apiKey: string) {
  return apiJson<{ runs: ArticleRunRecord[] }>("/api/runs", apiKey);
}

export function getRunDetail(apiKey: string, runId: string) {
  return apiJson<{ run: ArticleRunDetail }>(
    `/api/runs/${encodeURIComponent(runId)}`,
    apiKey,
  );
}

export function triggerRun(apiKey: string, payload: TriggerRunPayload) {
  return apiJson<{ success: boolean; runId: string }>("/api/runs", apiKey, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function triggerMatrixRun(
  apiKey: string,
  payload: TriggerMatrixRunPayload,
) {
  return apiJson<{
    success: boolean;
    matrixRunId: string;
    childRunIds: string[];
  }>("/api/runs/matrix", apiKey, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getTopicFeedback(apiKey: string, runId: string) {
  return apiJson<{ feedback: EditorialTopicFeedback[] }>(
    `/api/runs/${encodeURIComponent(runId)}/topic-feedback`,
    apiKey,
  );
}

export function saveTopicFeedback(
  apiKey: string,
  runId: string,
  topicId: string,
  payload: {
    action: EditorialTopicFeedbackAction;
    title?: string;
    reason?: string;
    profileId?: string;
    accountId?: string;
  },
) {
  return apiJson<{ feedback: EditorialTopicFeedback }>(
    `/api/runs/${encodeURIComponent(runId)}/topic-feedback/${
      encodeURIComponent(topicId)
    }`,
    apiKey,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  );
}

export function deleteTopicFeedback(
  apiKey: string,
  runId: string,
  topicId: string,
) {
  return apiJson<{ deleted: boolean }>(
    `/api/runs/${encodeURIComponent(runId)}/topic-feedback/${
      encodeURIComponent(topicId)
    }`,
    apiKey,
    { method: "DELETE" },
  );
}
