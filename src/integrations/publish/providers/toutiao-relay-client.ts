import { ProviderError } from "@src/core/errors/provider-error.ts";
import { redactSensitiveText } from "@src/utils/security/redact.ts";

export interface ToutiaoRelayClientConfig {
  url: string;
  token: string;
}

export interface ToutiaoScheduledPublishRequest {
  title: string;
  contentHtml: string;
  coverImageUrl?: string;
  idempotencyKey: string;
  scheduledAt: string;
}

export interface ToutiaoRelayPublishResult {
  draftId: string;
  articleId?: string;
  status: "scheduled" | "blocked";
  title: string;
  scheduledFor?: string;
  screenshotPath?: string;
  reason?: string;
  errorCode?: string;
  reconciledAt?: string;
}

export interface ToutiaoRelayArticleStatus {
  idempotencyKey: string;
  articleId?: string;
  title: string;
  status: "draft" | "scheduled" | "published" | "pending_reconciliation";
  currentUrl?: string;
  scheduledFor?: string;
  reconciledAt: string;
}

export interface ToutiaoRelayHealthStatus {
  ok: boolean;
  service?: string;
  mode?: string;
}

interface RelayEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: { code?: string; message?: string } | string;
}

/** 今日头条 Relay 的主服务客户端；不持有浏览器登录态。 */
export class ToutiaoRelayClient {
  constructor(
    private readonly config: ToutiaoRelayClientConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async schedule(
    request: ToutiaoScheduledPublishRequest,
  ): Promise<ToutiaoRelayPublishResult> {
    return await this.request<ToutiaoRelayPublishResult>("/api/toutiao/scheduled", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async reconcile(idempotencyKey: string): Promise<ToutiaoRelayArticleStatus> {
    return await this.request<ToutiaoRelayArticleStatus>(
      `/api/toutiao/articles?idempotencyKey=${encodeURIComponent(idempotencyKey)}`,
    );
  }

  async health(): Promise<ToutiaoRelayHealthStatus> {
    if (!this.config.url.trim()) {
      return { ok: false };
    }
    const response = await this.fetcher(
      `${this.config.url.replace(/\/+$/, "")}/health`,
      { headers: { Authorization: `Bearer ${this.config.token}` } },
    ).catch(() => undefined);
    if (!response?.ok) return { ok: false };
    const payload = await response.json().catch(() => ({})) as ToutiaoRelayHealthStatus;
    return { ok: payload.ok === true, service: payload.service, mode: payload.mode };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.config.url.trim() || !this.config.token.trim()) {
      throw new ProviderError({
        provider: "toutiao-relay",
        kind: "auth",
        message: "今日头条 Relay URL 或 Token 未配置",
      });
    }
    const response = await this.fetcher(
      `${this.config.url.replace(/\/+$/, "")}${path}`,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
      },
    ).catch((error) => {
      throw new ProviderError({
        provider: "toutiao-relay",
        kind: "invalid_response",
        message: redactSensitiveText(
          error instanceof Error ? error.message : String(error),
        ),
      });
    });
    const envelope = await response.json().catch(() => ({})) as RelayEnvelope<T>;
    if (!response.ok || !envelope.success || envelope.data === undefined) {
      const error = typeof envelope.error === "string"
        ? envelope.error
        : envelope.error?.message ?? `Relay 请求失败：HTTP ${response.status}`;
      throw new ProviderError({
        provider: "toutiao-relay",
        kind: response.status === 401 ? "auth" : "invalid_response",
        statusCode: response.status,
        message: redactSensitiveText(error),
      });
    }
    return envelope.data;
  }
}
