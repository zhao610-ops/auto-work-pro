import {
  ContentImageUploader,
  ContentPublisher,
  PublishArticleRequest,
  PublishResult,
} from "@src/core/ports/content-publisher.ts";
import {
  type ResolvedTrendPublishConfig,
  type ResolvedWeixinPublishAccountConfig,
  resolveWeixinPublishAccount,
} from "@src/utils/config/define-config.ts";
import { ProviderError } from "@src/core/errors/provider-error.ts";
import { redactSensitiveText } from "@src/utils/security/redact.ts";
import { HttpClient, HttpError } from "@src/utils/http/http-client.ts";

type WeixinRelayConfig = ResolvedTrendPublishConfig["providers"]["publish"][
  "weixinRelay"
];
type WeixinProviderConfig = ResolvedTrendPublishConfig["providers"]["publish"][
  "weixin"
];

interface RelayAccountPayload extends ResolvedWeixinPublishAccountConfig {
  accountId: string;
}

interface RelayResponse<T> {
  success?: boolean;
  data?: T;
  error?: string;
}

export interface WeixinRelayHttpClient {
  request<T>(
    url: string,
    options?: RequestInit & {
      timeout?: number;
      retries?: number;
      retryDelay?: number;
    },
  ): Promise<T>;
}

export class WeixinRelayPublisher
  implements ContentPublisher, ContentImageUploader {
  constructor(
    private readonly relayConfig: WeixinRelayConfig,
    private readonly weixinConfig: WeixinProviderConfig,
    private readonly accountId?: string,
    private readonly httpClient: WeixinRelayHttpClient = HttpClient
      .getInstance(),
  ) {}

  async validateIpWhitelist(): Promise<string | boolean> {
    const result = await this.request<{ result: string | boolean }>(
      "/api/weixin/validate-ip",
      {},
    );
    return result.result;
  }

  async uploadImage(imageUrl: string): Promise<string> {
    const result = await this.request<{ mediaId: string }>(
      "/api/weixin/upload-image",
      { imageUrl },
    );
    return result.mediaId;
  }

  async uploadContentImage(
    imageUrl: string,
    imageBuffer?: ArrayBuffer | Uint8Array,
  ): Promise<string> {
    const result = await this.request<{ url: string }>(
      "/api/weixin/upload-content-image",
      {
        imageUrl,
        imageBufferBase64: imageBuffer ? bytesToBase64(imageBuffer) : undefined,
      },
    );
    return result.url;
  }

  async publishArticle(request: PublishArticleRequest): Promise<PublishResult> {
    const result = await this.request<PublishResult>(
      "/api/weixin/publish",
      request,
    );
    return {
      ...result,
      publishedAt: new Date(result.publishedAt),
    };
  }

  private async request<T>(path: string, body: unknown): Promise<T> {
    const baseUrl = this.relayConfig.url.replace(/\/+$/, "");
    if (!baseUrl) {
      throw new Error("providers.publish.weixinRelay.url is not configured");
    }
    if (!this.relayConfig.token) {
      throw new Error("providers.publish.weixinRelay.token is not configured");
    }

    let json: RelayResponse<T>;
    try {
      json = await this.httpClient.request<RelayResponse<T>>(
        `${baseUrl}${path}`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${this.relayConfig.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            account: this.resolveRelayAccount(),
            payload: body,
          }),
          retries: 1,
          timeout: 30000,
        },
      );
    } catch (error) {
      const statusCode = error instanceof HttpError
        ? error.statusCode
        : undefined;
      throw new ProviderError({
        provider: "weixin-relay",
        kind: statusCode === 401 || statusCode === 403
          ? "auth"
          : "invalid_response",
        statusCode,
        message: redactSensitiveText(
          error instanceof Error ? error.message : String(error),
        ),
      });
    }
    if (!json.success) {
      throw new ProviderError({
        provider: "weixin-relay",
        kind: "invalid_response",
        message: redactSensitiveText(
          json.error ?? "Weixin relay request failed",
        ),
      });
    }
    if (json.data === undefined) {
      throw new ProviderError({
        provider: "weixin-relay",
        kind: "empty_content",
        message: "Weixin relay response is missing data",
      });
    }
    return json.data;
  }

  private resolveRelayAccount(): RelayAccountPayload {
    const selected = resolveWeixinPublishAccount(
      this.weixinConfig,
      this.accountId,
    );
    if (!selected) {
      const requested = this.accountId?.trim();
      throw new Error(
        requested
          ? `未找到或未配置微信公众号账号: ${requested}`
          : "未配置默认微信公众号账号；多公众号配置时请设置 publisher.accountId",
      );
    }
    return {
      accountId: selected.accountId,
      appId: selected.account.appId,
      appSecret: selected.account.appSecret,
      author: selected.account.author,
      needOpenComment: selected.account.needOpenComment,
      onlyFansCanComment: selected.account.onlyFansCanComment,
    };
  }
}

function bytesToBase64(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}
